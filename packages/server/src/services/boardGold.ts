/**
 * Gold a board holds for a game (poker played for gold). The board reports, with each save, how much gold each
 * player has put in ("held") and what each player's chips are worth now ("payouts").
 *
 *  - Held gold leaves the player's cash as a 'game_stake' adjustment the moment it's recorded (changes are
 *    reconciled: a higher figure holds more, a lower one gives the difference back). Like a bet stake it is still
 *    the player's gold: it counts toward net worth while held (`heldGoldByPlayer`).
 *  - At the result the pot (everything held) is paid out by the board's latest cash-out table, scaled to the pot
 *    so the game can never create or destroy gold. No cash-out table → everyone gets their gold back.
 *  - A cancelled game (or one cancelled by End night) refunds every hold.
 */
import { audit } from './audit';
import { conflict, type Ctx } from '../context';
import { computeNightState } from './state';

export interface BoardGold {
  held: Record<number, number>;
  payouts: Record<number, number>;
}

interface HoldRow {
  game_id: number;
  night_id: number;
  player_id: number;
  held_h: number;
  status: 'held' | 'settled' | 'refunded';
}

/** Most gold one player can have held in one game (a sanity cap, not a gameplay number). */
const MAX_HOLD_H = 100_000; // 1,000 gold

const toH = (g: unknown) => {
  const n = Number(g);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_HOLD_H, Math.round(n * 100)) : 0;
};

function cleanMap(v: unknown, ids: Set<number>): Map<number, number> {
  const out = new Map<number, number>();
  if (!v || typeof v !== 'object') return out;
  for (const [k, g] of Object.entries(v as Record<string, unknown>)) {
    const id = Number(k);
    if (ids.has(id)) out.set(id, toH(g));
  }
  return out;
}

const adjust = (ctx: Ctx, nightId: number, playerId: number, goldH: number, reason: string, gmId: number | null) =>
  ctx.db.prepare("INSERT INTO adjustment (night_id, player_id, gold_h, reason, kind, gm_id, created_at) VALUES (?,?,?,?, 'game_stake', ?, ?)").run(nightId, playerId, goldH, reason, gmId, ctx.now());

/**
 * Refuses a save that would hold more gold than a player has in cash (Tate, Nov 5: no negative cash).
 * Only increases are checked; giving gold back is always allowed. Call before the board state is written.
 */
export function checkBoardGold(ctx: Ctx, game: { id: number; night_id: number }, gold: unknown): void {
  if (!gold || typeof gold !== 'object') return;
  const ids = new Set((ctx.db.prepare('SELECT player_id FROM game_participant WHERE game_id = ?').all(game.id) as { player_id: number }[]).map((r) => r.player_id));
  const held = cleanMap((gold as Partial<BoardGold>).held, ids);
  const have = new Map((ctx.db.prepare("SELECT player_id, held_h FROM board_gold WHERE game_id = ? AND status = 'held'").all(game.id) as { player_id: number; held_h: number }[]).map((r) => [r.player_id, r.held_h]));
  const more = [...held].filter(([id, h]) => h > (have.get(id) ?? 0));
  if (!more.length) return;
  const st = computeNightState(ctx, game.night_id);
  for (const [id, h] of more) {
    const cashH = st?.ledger.get(String(id))?.cashH ?? 0;
    const need = h - (have.get(id) ?? 0);
    if (need > cashH) {
      const name = (ctx.db.prepare('SELECT display_name FROM player WHERE id = ?').get(id) as { display_name: string } | undefined)?.display_name ?? 'A player';
      throw conflict('not_enough_gold', `${name} has only ${(Math.max(0, cashH) / 100).toFixed(2)} gold in cash, so ${(need / 100).toFixed(2)} can't be held. They can sell stock first.`);
    }
  }
}

/**
 * Called from saveBoard (inside no transaction of its own; wraps one). `gold` = what the board reported:
 * undefined → this board doesn't hold gold (nothing happens); null → nothing held now (any holds are returned).
 */
export function reconcileBoardGold(ctx: Ctx, game: { id: number; night_id: number; name: string }, gold: unknown, gmId: number | null): void {
  if (gold === undefined) return;
  const ids = new Set((ctx.db.prepare('SELECT player_id FROM game_participant WHERE game_id = ?').all(game.id) as { player_id: number }[]).map((r) => r.player_id));
  const g = (gold && typeof gold === 'object' ? gold : {}) as Partial<BoardGold>;
  const held = cleanMap(g.held, ids);
  const payouts = cleanMap(g.payouts, ids);
  const rows = new Map((ctx.db.prepare("SELECT * FROM board_gold WHERE game_id = ? AND status = 'held'").all(game.id) as HoldRow[]).map((r) => [r.player_id, r]));
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE game_board SET gold = ? WHERE game_id = ?').run(gold ? JSON.stringify({ payouts: Object.fromEntries([...payouts].map(([k, v]) => [k, v / 100])) }) : null, game.id);
    for (const id of new Set([...held.keys(), ...rows.keys()])) {
      const want = held.get(id) ?? 0;
      const have = rows.get(id)?.held_h ?? 0;
      if (want === have) continue;
      adjust(ctx, game.night_id, id, have - want, want > have ? `${game.name}: gold held for the game` : `${game.name}: held gold returned`, gmId);
      ctx.db
        .prepare(
          `INSERT INTO board_gold (game_id, night_id, player_id, held_h, status, updated_at) VALUES (?,?,?,?, 'held', ?)
           ON CONFLICT (game_id, player_id) DO UPDATE SET held_h = excluded.held_h, status = 'held', paid_h = NULL, updated_at = excluded.updated_at`,
        )
        .run(game.id, game.night_id, id, want, ctx.now());
      audit(ctx, { nightId: game.night_id, gmId, action: 'board.gold_hold', entity: 'game', entityId: game.id, before: { playerId: id, heldH: have }, after: { playerId: id, heldH: want } });
    }
  })();
}

/** Gold held for running games, per player (counts toward net worth, like bet stakes). */
export function heldGoldByPlayer(ctx: Ctx, nightId: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of ctx.db.prepare("SELECT player_id, held_h FROM board_gold WHERE night_id = ? AND status = 'held'").all(nightId) as { player_id: number; held_h: number }[])
    m.set(r.player_id, (m.get(r.player_id) ?? 0) + r.held_h);
  return m;
}

/** Splits `pot` hundredths in proportion to `weights` (largest remainder), so the parts add up exactly. */
export function splitPot(pot: number, weights: Map<number, number>): Map<number, number> {
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  const out = new Map<number, number>();
  if (pot <= 0 || total <= 0) return out;
  const parts = [...weights].map(([id, w]) => ({ id, exact: (pot * w) / total }));
  for (const p of parts) out.set(p.id, Math.floor(p.exact));
  let left = pot - [...out.values()].reduce((a, b) => a + b, 0);
  for (const p of [...parts].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.id - b.id)) {
    if (left <= 0) break;
    out.set(p.id, out.get(p.id)! + 1);
    left--;
  }
  return out;
}

/** At the result: pay the pot out by the board's latest cash-out table. Returns true if any gold moved. */
export function settleBoardGold(ctx: Ctx, gameId: number, gmId: number | null): boolean {
  const rows = ctx.db.prepare("SELECT * FROM board_gold WHERE game_id = ? AND status = 'held'").all(gameId) as HoldRow[];
  if (!rows.length) return false;
  const game = ctx.db.prepare('SELECT g.name, b.gold FROM game g LEFT JOIN game_board b ON b.game_id = g.id WHERE g.id = ?').get(gameId) as { name: string; gold: string | null };
  const pot = rows.reduce((a, r) => a + r.held_h, 0);
  const stored = game.gold ? (JSON.parse(game.gold) as { payouts?: Record<string, number> }) : null;
  const weights = new Map<number, number>();
  if (stored?.payouts) for (const [k, v] of Object.entries(stored.payouts)) if (Number(v) > 0) weights.set(Number(k), Math.round(Number(v) * 100));
  // No cash-out table (or nobody has chips): everyone gets back what they put in.
  const pay = weights.size ? splitPot(pot, weights) : new Map(rows.map((r) => [r.player_id, r.held_h]));
  const nightId = rows[0]!.night_id;
  ctx.db.transaction(() => {
    for (const [id, h] of pay) if (h > 0) adjust(ctx, nightId, id, h, `${game.name}: gold cash-out`, gmId);
    for (const r of rows) ctx.db.prepare("UPDATE board_gold SET status = 'settled', paid_h = ?, updated_at = ? WHERE game_id = ? AND player_id = ?").run(pay.get(r.player_id) ?? 0, ctx.now(), gameId, r.player_id);
    // A winner who held nothing (shouldn't happen) still gets a row so the record is complete.
    for (const [id, h] of pay)
      if (!rows.some((r) => r.player_id === id))
        ctx.db.prepare("INSERT OR IGNORE INTO board_gold (game_id, night_id, player_id, held_h, status, paid_h, updated_at) VALUES (?,?,?,0,'settled',?,?)").run(gameId, nightId, id, h, ctx.now());
    audit(ctx, { nightId, gmId, action: 'board.gold_settle', entity: 'game', entityId: gameId, after: { potH: pot, paid: Object.fromEntries(pay) } });
  })();
  return true;
}

/** Game cancelled: every hold goes back. */
export function refundBoardGold(ctx: Ctx, gameId: number, gmId: number | null): boolean {
  const rows = ctx.db.prepare("SELECT * FROM board_gold WHERE game_id = ? AND status = 'held'").all(gameId) as HoldRow[];
  if (!rows.length) return false;
  const name = (ctx.db.prepare('SELECT name FROM game WHERE id = ?').get(gameId) as { name: string }).name;
  ctx.db.transaction(() => {
    for (const r of rows) {
      if (r.held_h > 0) adjust(ctx, r.night_id, r.player_id, r.held_h, `${name}: game cancelled, held gold returned`, gmId);
      ctx.db.prepare("UPDATE board_gold SET status = 'refunded', paid_h = ?, updated_at = ? WHERE game_id = ? AND player_id = ?").run(r.held_h, ctx.now(), gameId, r.player_id);
    }
  })();
  return true;
}
