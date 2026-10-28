/**
 * Per-game GM boards (the board UI and rules live in the client: packages/client/src/gm/boards/<key>/).
 * The server only stores each running game's board state (versioned, so two GMs can't silently overwrite each
 * other), the board settings (Master only), and the end-of-game recap, which it sends to players' phones once,
 * when the result is submitted. GM only: nothing here reaches players or the TV except the recap messages.
 */
import { bad, conflict, forbidden, notFound, type Ctx } from '../context';
import { audit } from './audit';
import type { GmAuth } from './gm';
import { currentNight } from './state';

const MAX_STATE_BYTES = 256 * 1024;
const MAX_RECAP_TEXT = 1000;

interface BoardRow {
  game_id: number;
  night_id: number;
  state: string;
  version: number;
  recap: string | null;
  recap_sent: number;
}

/** The game's board key (from its library game), or null if it has none. */
function boardGame(ctx: Ctx, gameId: number) {
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  const g = ctx.db
    .prepare('SELECT g.id, g.night_id, g.status, l.board FROM game g LEFT JOIN library_game l ON l.id = g.library_game_id WHERE g.id = ? AND g.night_id = ?')
    .get(gameId, n.id) as { id: number; night_id: number; status: string; board: string | null } | undefined;
  if (!g) throw notFound('game_not_found');
  if (!g.board) throw conflict('no_board', 'This game has no board.');
  return g;
}

export function getBoard(ctx: Ctx, _actor: GmAuth, gameId: number): { state: unknown; version: number } {
  boardGame(ctx, gameId);
  const r = ctx.db.prepare('SELECT state, version FROM game_board WHERE game_id = ?').get(gameId) as { state: string; version: number } | undefined;
  return r ? { state: JSON.parse(r.state), version: r.version } : { state: null, version: 0 };
}

function cleanRecap(v: unknown): { playerId: number; text: string }[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) throw bad('bad_recap');
  return v
    .filter((x) => x && typeof x === 'object' && Number.isInteger(Number((x as { playerId: unknown }).playerId)) && typeof (x as { text: unknown }).text === 'string')
    .map((x) => ({ playerId: Number((x as { playerId: unknown }).playerId), text: String((x as { text: string }).text).trim().slice(0, MAX_RECAP_TEXT) }))
    .filter((x) => x.text);
}

/**
 * Saves a board. `version` must be the version the client last saw; a stale write is refused (409 board_stale)
 * and the client reloads. Saving the exact same state at the same version again is a no-op success.
 */
export function saveBoard(ctx: Ctx, _actor: GmAuth, gameId: number, input: { state?: unknown; version?: unknown; recap?: unknown }): { version: number } {
  const g = boardGame(ctx, gameId);
  if (g.status !== 'active') throw conflict('board_closed', 'This game is not running.');
  if (input.state === undefined || input.state === null || typeof input.state !== 'object') throw bad('bad_board_state');
  const json = JSON.stringify(input.state);
  if (json.length > MAX_STATE_BYTES) throw bad('board_too_large', 'The board has too much history. Lower its history size in Settings.');
  const recap = cleanRecap(input.recap);
  const version = Number(input.version ?? 0);
  const row = ctx.db.prepare('SELECT * FROM game_board WHERE game_id = ?').get(gameId) as BoardRow | undefined;
  const current = row?.version ?? 0;
  if (row && row.state === json && version === current - 1) return { version: current }; // same save twice
  if (version !== current) throw conflict('board_stale', 'Someone else changed this board. It has been reloaded.');
  const next = current + 1;
  const recapJson = recap ? JSON.stringify(recap) : (row?.recap ?? null);
  if (row) ctx.db.prepare('UPDATE game_board SET state = ?, version = ?, recap = ?, updated_at = ? WHERE game_id = ?').run(json, next, recapJson, ctx.now(), gameId);
  else ctx.db.prepare('INSERT INTO game_board (game_id, night_id, state, version, recap, updated_at) VALUES (?,?,?,?,?,?)').run(gameId, g.night_id, json, next, recapJson, ctx.now());
  ctx.bus.gm('board:update', { gameId, version: next });
  return { version: next };
}

/** Sends the stored recap to each player once (call inside the result transaction). Returns who got one. */
export function sendBoardRecap(ctx: Ctx, gameId: number, gmId: number | null): number[] {
  const row = ctx.db.prepare('SELECT * FROM game_board WHERE game_id = ?').get(gameId) as BoardRow | undefined;
  if (!row || row.recap_sent || !row.recap) return [];
  const players = new Set(
    (ctx.db.prepare('SELECT player_id FROM game_participant WHERE game_id = ?').all(gameId) as { player_id: number }[]).map((r) => r.player_id),
  );
  const sent: number[] = [];
  const ins = ctx.db.prepare("INSERT INTO notification (night_id, target, message, sent_by_gm_id, read_by, created_at) VALUES (?,?,?,?, '[]', ?)");
  for (const r of JSON.parse(row.recap) as { playerId: number; text: string }[]) {
    if (!players.has(r.playerId) || sent.includes(r.playerId)) continue;
    ins.run(row.night_id, `player:${r.playerId}`, r.text, gmId, ctx.now());
    sent.push(r.playerId);
  }
  ctx.db.prepare('UPDATE game_board SET recap_sent = 1 WHERE game_id = ?').run(gameId);
  return sent;
}

// ---------------------------------------------------------------- settings

export function boardSettings(ctx: Ctx): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of ctx.db.prepare('SELECT board, name, value FROM board_setting').all() as { board: string; name: string; value: number }[]) {
    (out[r.board] ??= {})[r.name] = r.value;
  }
  return out;
}

/** Master only. `values[name] = null` resets that setting to the board's default. */
export function setBoardSettings(ctx: Ctx, actor: GmAuth, board: string, values: unknown) {
  if (actor.role !== 'master') throw forbidden('master_only');
  if (!/^[a-z0-9-]{1,32}$/.test(board)) throw bad('bad_board');
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw bad('bad_settings');
  const entries = Object.entries(values as Record<string, unknown>);
  if (entries.length > 100) throw bad('bad_settings');
  ctx.db.transaction(() => {
    for (const [name, v] of entries) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(name)) throw bad('bad_settings');
      if (v === null) ctx.db.prepare('DELETE FROM board_setting WHERE board = ? AND name = ?').run(board, name);
      else {
        const x = Number(v);
        if (!Number.isFinite(x)) throw bad('bad_settings');
        ctx.db.prepare('INSERT INTO board_setting (board, name, value) VALUES (?,?,?) ON CONFLICT(board, name) DO UPDATE SET value = excluded.value').run(board, name, x);
      }
    }
    audit(ctx, { nightId: currentNight(ctx)?.id ?? null, gmId: actor.gmId, action: 'board.settings', entity: 'board_setting', after: { board, values } });
  })();
  const n = currentNight(ctx);
  if (n) ctx.bus.refresh(n.id);
  return boardSettings(ctx)[board] ?? {};
}
