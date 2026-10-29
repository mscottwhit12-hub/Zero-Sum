/**
 * Per-game GM boards (the board UI and rules live in the client: packages/client/src/gm/boards/<key>/).
 * The server only stores each running game's board state (versioned, so two GMs can't silently overwrite each
 * other), the board settings (Master only), and the end-of-game recap, which it sends to players' phones once,
 * when the result is submitted. GM only: nothing here reaches players or the TV except the recap messages.
 */
import { bad, conflict, forbidden, notFound, type Ctx } from '../context';
import { audit } from './audit';
import type { GmAuth } from './gm';
import { currentNight, type PlayerRow } from './state';

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

export function getBoard(ctx: Ctx, _actor: GmAuth, gameId: number): { state: unknown; version: number; claims: BoardClaim[] } {
  boardGame(ctx, gameId);
  const r = ctx.db.prepare('SELECT state, version FROM game_board WHERE game_id = ?').get(gameId) as { state: string; version: number } | undefined;
  const claims = claimsOf(ctx, gameId, 'pending');
  return r ? { state: JSON.parse(r.state), version: r.version, claims } : { state: null, version: 0, claims };
}

// ---------- player-submitted entries (Risk battles), approved by a GM ----------

export interface BattlePayload {
  attackerId: number;
  defenderId: number;
  territories: number;
  attackerLosses: number | null;
  defenderLosses: number | null;
  rounds: number | null;
}
export interface BoardClaim {
  id: number;
  gameId: number;
  playerId: number;
  kind: 'battle';
  payload: BattlePayload;
  status: 'pending' | 'approved' | 'rejected' | 'void';
  createdAt: number;
}
interface ClaimRow {
  id: number;
  game_id: number;
  player_id: number;
  kind: 'battle';
  payload: string;
  status: BoardClaim['status'];
  created_at: number;
}
const toClaim = (r: ClaimRow): BoardClaim => ({ id: r.id, gameId: r.game_id, playerId: r.player_id, kind: r.kind, payload: JSON.parse(r.payload), status: r.status, createdAt: r.created_at });
const MAX_PENDING = 10;

export function claimsOf(ctx: Ctx, gameId: number, status?: BoardClaim['status']): BoardClaim[] {
  const rows = (status
    ? ctx.db.prepare('SELECT * FROM board_claim WHERE game_id = ? AND status = ? ORDER BY id').all(gameId, status)
    : ctx.db.prepare('SELECT * FROM board_claim WHERE game_id = ? ORDER BY id').all(gameId)) as ClaimRow[];
  return rows.map(toClaim);
}

const optInt = (v: unknown, max: number, name: string): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw bad(`bad_${name}`);
  return n;
};

/** A player in a running Risk game logs a battle they attacked in. It waits for a GM. */
export function createClaim(ctx: Ctx, player: PlayerRow, gameId: number, input: Record<string, unknown>): BoardClaim {
  const g = boardGame(ctx, gameId);
  if (g.status !== 'active') throw conflict('board_closed', 'This game is not running.');
  if (g.board !== 'risk') throw conflict('no_claims', 'This game does not take player entries.');
  const parts = (ctx.db.prepare('SELECT player_id FROM game_participant WHERE game_id = ?').all(gameId) as { player_id: number }[]).map((r) => r.player_id);
  if (!parts.includes(player.id)) throw forbidden('not_a_participant');
  const defenderId = Number(input.defenderId);
  if (!parts.includes(defenderId) || defenderId === player.id) throw bad('bad_defender', 'Pick who you attacked.');
  const territories = Number(input.territories);
  if (!Number.isInteger(territories) || territories < 0 || territories > 100) throw bad('bad_territories', 'Territories taken must be a whole number.');
  const payload: BattlePayload = {
    attackerId: player.id,
    defenderId,
    territories,
    attackerLosses: optInt(input.attackerLosses, 1000, 'losses'),
    defenderLosses: optInt(input.defenderLosses, 1000, 'losses'),
    rounds: optInt(input.rounds, 1000, 'rounds'),
  };
  const pending = (ctx.db.prepare("SELECT COUNT(*) c FROM board_claim WHERE game_id = ? AND player_id = ? AND status = 'pending'").get(gameId, player.id) as { c: number }).c;
  if (pending >= MAX_PENDING) throw conflict('too_many_pending', 'Wait for the GM to check your earlier battles.');
  const id = Number(
    ctx.db.prepare("INSERT INTO board_claim (game_id, night_id, player_id, kind, payload, created_at) VALUES (?,?,?,'battle',?,?)").run(gameId, g.night_id, player.id, JSON.stringify(payload), ctx.now()).lastInsertRowid,
  );
  ctx.bus.gm('board:claims', { gameId });
  ctx.bus.refresh(g.night_id);
  return toClaim(ctx.db.prepare('SELECT * FROM board_claim WHERE id = ?').get(id) as ClaimRow);
}

/** GM approves or rejects a pending entry. Only the first decision counts (two GMs can't both apply it). */
export function decideClaim(ctx: Ctx, actor: GmAuth, claimId: number, approve: boolean): BoardClaim {
  const r = ctx.db.prepare('SELECT * FROM board_claim WHERE id = ?').get(claimId) as ClaimRow | undefined;
  if (!r) throw notFound('claim_not_found');
  const res = ctx.db.prepare("UPDATE board_claim SET status = ?, gm_id = ?, decided_at = ? WHERE id = ? AND status = 'pending'").run(approve ? 'approved' : 'rejected', actor.gmId, ctx.now(), claimId);
  if (!res.changes) throw conflict('claim_decided', 'Another GM already handled this entry.');
  audit(ctx, { nightId: null, gmId: actor.gmId, action: approve ? 'claim.approve' : 'claim.reject', entity: 'board_claim', entityId: claimId, after: JSON.parse(r.payload) });
  ctx.bus.gm('board:claims', { gameId: r.game_id });
  const n = currentNight(ctx);
  if (n) ctx.bus.refresh(n.id);
  return toClaim(ctx.db.prepare('SELECT * FROM board_claim WHERE id = ?').get(claimId) as ClaimRow);
}

/**
 * Phone "Risk" app: only for players in a running Risk game. Standings come straight from the board state
 * (territories, armies, out), plus this player's own entries and their status.
 */
export function playerBoardGames(ctx: Ctx, nightId: number, playerId: number) {
  const games = ctx.db
    .prepare(
      `SELECT g.id, g.name, b.state FROM game g JOIN library_game l ON l.id = g.library_game_id JOIN game_participant gp ON gp.game_id = g.id
       LEFT JOIN game_board b ON b.game_id = g.id WHERE g.night_id = ? AND g.status = 'active' AND l.board = 'risk' AND gp.player_id = ? ORDER BY g.id`,
    )
    .all(nightId, playerId) as { id: number; name: string; state: string | null }[];
  return games.map((g) => {
    const st = g.state ? (JSON.parse(g.state) as { players?: Record<string, { territories?: number; armies?: number; eliminated?: boolean }> }) : {};
    const parts = (ctx.db.prepare('SELECT player_id FROM game_participant WHERE game_id = ?').all(g.id) as { player_id: number }[]).map((r) => r.player_id);
    return {
      gameId: g.id,
      name: g.name,
      board: 'risk' as const,
      players: parts.map((id) => {
        const p = st.players?.[String(id)] ?? {};
        return { id, territories: p.territories ?? 0, armies: p.armies ?? 0, out: !!p.eliminated };
      }),
      myClaims: (ctx.db.prepare('SELECT * FROM board_claim WHERE game_id = ? AND player_id = ? ORDER BY id DESC LIMIT 20').all(g.id, playerId) as ClaimRow[]).map(toClaim),
    };
  });
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
  if (g.board === 'risk') ctx.bus.refresh(g.night_id); // players' Risk app shows live standings
  return { version: next };
}

/** Game over (result or cancel): entries still waiting can't be applied any more. */
export function voidClaims(ctx: Ctx, gameId: number): void {
  ctx.db.prepare("UPDATE board_claim SET status = 'void', decided_at = ? WHERE game_id = ? AND status = 'pending'").run(ctx.now(), gameId);
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
