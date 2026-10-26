/**
 * Seating (spec §17.3): GM drag-drop floor plan of tables; the GM assigns seats.
 * Visible to GM and TV only (never in the public/player view). Setup action → Master only.
 * Positions are fractions (0–1) of the floor-plan area so any screen size can draw them.
 */
import { bad, conflict, notFound, type Ctx } from '../context';
import { audit } from './audit';
import { masterOnly, type GmAuth } from './gm';
import { currentNight, type NightRow } from './state';

export interface SeatingTable {
  id: number;
  name: string;
  seats: number;
  x: number;
  y: number;
  /** seat number (1-based) → player id */
  assignments: { seat: number; playerId: number }[];
  /** Active game at this table, if any (else the next scheduled one). */
  gameId: number | null;
}

const MAX_SEATS = 20;

function night(ctx: Ctx): NightRow {
  const n = currentNight(ctx);
  if (!n || n.status === 'archived') throw notFound('no_night');
  if (n.status === 'ended') throw conflict('night_ended');
  return n;
}

function table(ctx: Ctx, nightId: number, id: number) {
  const t = ctx.db.prepare('SELECT * FROM game_table WHERE id = ? AND night_id = ?').get(id, nightId) as
    | { id: number; name: string; seats: number; map_x: number; map_y: number }
    | undefined;
  if (!t) throw notFound('table_not_found');
  return t;
}

const clamp01 = (v: unknown, d: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d;
};

export function seatingView(ctx: Ctx, nightId: number): SeatingTable[] {
  const seats = ctx.db.prepare('SELECT table_id, seat, player_id FROM seat_assignment WHERE night_id = ? ORDER BY seat').all(nightId) as { table_id: number; seat: number; player_id: number }[];
  const games = ctx.db
    .prepare("SELECT id, table_id, status FROM game WHERE night_id = ? AND table_id IS NOT NULL AND status IN ('active','scheduled') ORDER BY status = 'active' DESC, COALESCE(planned_start, id)")
    .all(nightId) as { id: number; table_id: number }[];
  return (ctx.db.prepare('SELECT * FROM game_table WHERE night_id = ? ORDER BY id').all(nightId) as { id: number; name: string; seats: number; map_x: number; map_y: number }[]).map((t) => ({
    id: t.id,
    name: t.name,
    seats: t.seats,
    x: t.map_x,
    y: t.map_y,
    assignments: seats.filter((s) => s.table_id === t.id).map((s) => ({ seat: s.seat, playerId: s.player_id })),
    gameId: games.find((g) => g.table_id === t.id)?.id ?? null,
  }));
}

function cleanName(v: unknown) {
  const name = typeof v === 'string' ? v.trim().slice(0, 40) : '';
  if (!name) throw bad('bad_name', 'Give the table a name.');
  return name;
}
function cleanSeats(v: unknown) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SEATS) throw bad('bad_seats', `Seats must be 1–${MAX_SEATS}.`);
  return n;
}

export function createTable(ctx: Ctx, actor: GmAuth, input: { name?: unknown; seats?: unknown; x?: unknown; y?: unknown }) {
  masterOnly(actor);
  const n = night(ctx);
  const count = (ctx.db.prepare('SELECT COUNT(*) c FROM game_table WHERE night_id = ?').get(n.id) as { c: number }).c;
  const name = cleanName(input.name ?? `Table ${count + 1}`);
  const seats = cleanSeats(input.seats ?? 4);
  // Default: a loose grid so new tables don't stack.
  const x = clamp01(input.x, 0.15 + (count % 4) * 0.23);
  const y = clamp01(input.y, 0.2 + Math.floor(count / 4) * 0.3);
  const id = Number(ctx.db.prepare('INSERT INTO game_table (night_id, name, seats, map_x, map_y) VALUES (?,?,?,?,?)').run(n.id, name, seats, x, y).lastInsertRowid);
  audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'table.create', entity: 'game_table', entityId: id, after: { name, seats, x, y } });
  ctx.bus.refresh(n.id);
  return { id };
}

export function updateTable(ctx: Ctx, actor: GmAuth, id: number, input: { name?: unknown; seats?: unknown; x?: unknown; y?: unknown }) {
  masterOnly(actor);
  const n = night(ctx);
  const t = table(ctx, n.id, id);
  const name = input.name === undefined ? t.name : cleanName(input.name);
  const seats = input.seats === undefined ? t.seats : cleanSeats(input.seats);
  const x = input.x === undefined ? t.map_x : clamp01(input.x, t.map_x);
  const y = input.y === undefined ? t.map_y : clamp01(input.y, t.map_y);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE game_table SET name = ?, seats = ?, map_x = ?, map_y = ? WHERE id = ?').run(name, seats, x, y, id);
    if (seats < t.seats) ctx.db.prepare('DELETE FROM seat_assignment WHERE table_id = ? AND seat > ?').run(id, seats);
    // Moves are frequent (drag); only audit structural edits.
    if (name !== t.name || seats !== t.seats)
      audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'table.update', entity: 'game_table', entityId: id, before: { name: t.name, seats: t.seats }, after: { name, seats } });
  })();
  ctx.bus.refresh(n.id);
  return { id };
}

export function deleteTable(ctx: Ctx, actor: GmAuth, id: number) {
  masterOnly(actor);
  const n = night(ctx);
  const t = table(ctx, n.id, id);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE game SET table_id = NULL WHERE table_id = ?').run(id);
    ctx.db.prepare('DELETE FROM seat_assignment WHERE table_id = ?').run(id);
    ctx.db.prepare('DELETE FROM game_table WHERE id = ?').run(id);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'table.delete', entity: 'game_table', entityId: id, before: t });
  })();
  ctx.bus.refresh(n.id);
  return { ok: true };
}

/** Put a player in a seat (moving them from any other seat; bumping whoever sat there), or clear it. */
export function assignSeat(ctx: Ctx, actor: GmAuth, tableId: number, input: { seat?: unknown; playerId?: unknown }) {
  masterOnly(actor);
  const n = night(ctx);
  const t = table(ctx, n.id, tableId);
  const seat = Number(input.seat);
  if (!Number.isInteger(seat) || seat < 1 || seat > t.seats) throw bad('bad_seat');
  const playerId = input.playerId == null || input.playerId === '' ? null : Number(input.playerId);
  if (playerId != null && !ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ?').get(playerId, n.id)) throw notFound('player_not_found');
  ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM seat_assignment WHERE table_id = ? AND seat = ?').run(tableId, seat);
    if (playerId != null) {
      ctx.db.prepare('DELETE FROM seat_assignment WHERE night_id = ? AND player_id = ?').run(n.id, playerId);
      ctx.db.prepare('INSERT INTO seat_assignment (night_id, table_id, seat, player_id) VALUES (?,?,?,?)').run(n.id, tableId, seat, playerId);
    }
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'seat.assign', entity: 'game_table', entityId: tableId, after: { seat, playerId } });
  })();
  ctx.bus.refresh(n.id);
  return { ok: true };
}

/** Clear every seat (e.g. between rounds). */
export function clearSeats(ctx: Ctx, actor: GmAuth) {
  masterOnly(actor);
  const n = night(ctx);
  ctx.db.prepare('DELETE FROM seat_assignment WHERE night_id = ?').run(n.id);
  audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'seat.clear', entity: 'night', entityId: n.id });
  ctx.bus.refresh(n.id);
  return { ok: true };
}
