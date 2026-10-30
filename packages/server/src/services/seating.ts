/**
 * Seating (spec §17.3): GM drag-drop floor plan of tables; the GM assigns seats.
 * Visible to GM and TV only (never in the public/player view). Setup action → Master only.
 * Positions are fractions (0–1) of the floor-plan area so any screen size can draw them.
 * Table sizes (`w`, `h`) are fractions of the plan WIDTH, so a table keeps its shape on any screen
 * (the plan has a fixed aspect ratio).
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
  w: number;
  h: number;
  /** Where each seat sits around the table: fractions (0–1) along its edge, clockwise from the top-left; index = seat − 1. null = evenly spaced. */
  seatPos: number[] | null;
  /** seat number (1-based) → player id */
  assignments: { seat: number; playerId: number }[];
  /** Active game at this table, if any (else the next scheduled one). */
  gameId: number | null;
}

export const MIN_SEATS = 2;
export const MAX_SEATS = 8;
export const TABLE_W = { min: 0.1, max: 0.6, def: 0.2 };
export const TABLE_H = { min: 0.07, max: 0.6, def: 0.12 };
/** Edge length (fraction of plan width) each seat icon needs so icons never overlap. Mirrors client shared/seating.ts. */
const SEAT_EDGE = 0.07;
/** Smallest table that fits `seats` icons around its edge (keeps the base min proportions). */
export function minSize(seats: number) {
  const k = Math.max(1, (seats * SEAT_EDGE) / (2 * (TABLE_W.min + TABLE_H.min)));
  return { w: Math.min(TABLE_W.max, TABLE_W.min * k), h: Math.min(TABLE_H.max, TABLE_H.min * k) };
}

type TableRow = { id: number; name: string; seats: number; map_x: number; map_y: number; map_w: number; map_h: number; seat_pos: string | null };

/** Stored seat positions, or null when unset or no longer matching the seat count. */
function readSeatPos(raw: string | null, seats: number): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length === seats && v.every((x) => typeof x === 'number' && x >= 0 && x < 1) ? v : null;
  } catch {
    return null;
  }
}
/** Smallest gap between two seats (fraction of the table's edge) that keeps their icons apart. Mirrors the client. */
const minGapFrac = (w: number, h: number) => (SEAT_EDGE * 0.9) / (2 * (w + h));
/** True when every pair of seats is at least a seat icon apart along the edge (the edge is a loop). */
function spacedOk(pos: number[], w: number, h: number) {
  const gap = minGapFrac(w, h);
  const s = [...pos].sort((a, b) => a - b);
  return s.every((v, i) => (i === 0 ? s.length < 2 || v + 1 - s[s.length - 1]! >= gap : v - s[i - 1]! >= gap));
}

function night(ctx: Ctx): NightRow {
  const n = currentNight(ctx);
  if (!n || n.status === 'archived') throw notFound('no_night');
  if (n.status === 'ended') throw conflict('night_ended');
  return n;
}

function table(ctx: Ctx, nightId: number, id: number) {
  const t = ctx.db.prepare('SELECT * FROM game_table WHERE id = ? AND night_id = ?').get(id, nightId) as
    | TableRow
    | undefined;
  if (!t) throw notFound('table_not_found');
  return t;
}

const clamp01 = (v: unknown, d: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d;
};
const clampRange = (v: unknown, d: number, r: { min: number; max: number }) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(r.max, Math.max(r.min, x)) : d;
};

export function seatingView(ctx: Ctx, nightId: number): SeatingTable[] {
  const seats = ctx.db.prepare('SELECT table_id, seat, player_id FROM seat_assignment WHERE night_id = ? ORDER BY seat').all(nightId) as { table_id: number; seat: number; player_id: number }[];
  const games = ctx.db
    .prepare("SELECT id, table_id, status FROM game WHERE night_id = ? AND table_id IS NOT NULL AND status IN ('active','scheduled') ORDER BY status = 'active' DESC, COALESCE(planned_start, id)")
    .all(nightId) as { id: number; table_id: number }[];
  return (ctx.db.prepare('SELECT * FROM game_table WHERE night_id = ? ORDER BY id').all(nightId) as TableRow[]).map((t) => ({
    id: t.id,
    name: t.name,
    seats: t.seats,
    x: t.map_x,
    y: t.map_y,
    w: t.map_w,
    h: t.map_h,
    seatPos: readSeatPos(t.seat_pos, t.seats),
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
  if (!Number.isInteger(n) || n < MIN_SEATS || n > MAX_SEATS) throw bad('bad_seats', `Seats must be ${MIN_SEATS}–${MAX_SEATS}.`);
  return n;
}

export function createTable(ctx: Ctx, actor: GmAuth, input: { name?: unknown; seats?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown }) {
  masterOnly(actor);
  const n = night(ctx);
  const count = (ctx.db.prepare('SELECT COUNT(*) c FROM game_table WHERE night_id = ?').get(n.id) as { c: number }).c;
  const name = cleanName(input.name ?? `Table ${count + 1}`);
  const seats = cleanSeats(input.seats ?? 4);
  // Default: a loose grid so new tables don't stack.
  const x = clamp01(input.x, 0.15 + (count % 4) * 0.23);
  const y = clamp01(input.y, 0.2 + Math.floor(count / 4) * 0.33);
  const min = minSize(seats);
  const w = Math.max(min.w, clampRange(input.w, TABLE_W.def, TABLE_W));
  const h = Math.max(min.h, clampRange(input.h, TABLE_H.def, TABLE_H));
  const id = Number(ctx.db.prepare('INSERT INTO game_table (night_id, name, seats, map_x, map_y, map_w, map_h) VALUES (?,?,?,?,?,?,?)').run(n.id, name, seats, x, y, w, h).lastInsertRowid);
  audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'table.create', entity: 'game_table', entityId: id, after: { name, seats, x, y, w, h } });
  ctx.bus.refresh(n.id);
  return { id };
}

export function updateTable(ctx: Ctx, actor: GmAuth, id: number, input: { name?: unknown; seats?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown; seatPos?: unknown }) {
  masterOnly(actor);
  const n = night(ctx);
  const t = table(ctx, n.id, id);
  const name = input.name === undefined ? t.name : cleanName(input.name);
  const seats = input.seats === undefined ? t.seats : cleanSeats(input.seats);
  const x = input.x === undefined ? t.map_x : clamp01(input.x, t.map_x);
  const y = input.y === undefined ? t.map_y : clamp01(input.y, t.map_y);
  // A table never shrinks below what its seats need; adding seats grows it.
  const min = minSize(seats);
  const w = Math.max(min.w, input.w === undefined ? t.map_w : clampRange(input.w, t.map_w, TABLE_W));
  const h = Math.max(min.h, input.h === undefined ? t.map_h : clampRange(input.h, t.map_h, TABLE_H));
  // Seat positions: a new list (or null = back to even spacing) must fit the seat count and keep icons apart.
  // Changing the seat count, or shrinking the table until seats would touch, goes back to even spacing.
  let seatPos = readSeatPos(t.seat_pos, t.seats);
  if (input.seatPos !== undefined) {
    if (input.seatPos === null) seatPos = null;
    else {
      const v = input.seatPos;
      if (!Array.isArray(v) || v.length !== seats || !v.every((p) => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p < 1)) throw bad('bad_seat_pos', 'Seat positions must be one number from 0 to 1 per seat.');
      if (!spacedOk(v as number[], w, h)) throw bad('seats_too_close', 'Seats would overlap there.');
      seatPos = v as number[];
    }
  } else if (seatPos && (seats !== t.seats || !spacedOk(seatPos, w, h))) seatPos = null;
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE game_table SET name = ?, seats = ?, map_x = ?, map_y = ?, map_w = ?, map_h = ?, seat_pos = ? WHERE id = ?').run(name, seats, x, y, w, h, seatPos ? JSON.stringify(seatPos) : null, id);
    if (seats < t.seats) ctx.db.prepare('DELETE FROM seat_assignment WHERE table_id = ? AND seat > ?').run(id, seats);
    // Moves and resizes are frequent (drag); only audit structural edits.
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

/**
 * Put a player in a seat, or clear it. A player dropped on an occupied seat swaps with its occupant
 * when they were seated somewhere (the occupant takes the player's old seat); an unseated player
 * dropped on an occupied seat sends the occupant back to unseated.
 */
export function assignSeat(ctx: Ctx, actor: GmAuth, tableId: number, input: { seat?: unknown; playerId?: unknown }) {
  masterOnly(actor);
  const n = night(ctx);
  const t = table(ctx, n.id, tableId);
  const seat = Number(input.seat);
  if (!Number.isInteger(seat) || seat < 1 || seat > t.seats) throw bad('bad_seat');
  const playerId = input.playerId == null || input.playerId === '' ? null : Number(input.playerId);
  if (playerId != null && !ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ?').get(playerId, n.id)) throw notFound('player_not_found');
  ctx.db.transaction(() => {
    const occupant = ctx.db.prepare('SELECT player_id FROM seat_assignment WHERE table_id = ? AND seat = ?').get(tableId, seat) as { player_id: number } | undefined;
    const from =
      playerId == null
        ? undefined
        : (ctx.db.prepare('SELECT table_id, seat FROM seat_assignment WHERE night_id = ? AND player_id = ?').get(n.id, playerId) as { table_id: number; seat: number } | undefined);
    ctx.db.prepare('DELETE FROM seat_assignment WHERE table_id = ? AND seat = ?').run(tableId, seat);
    if (playerId != null) {
      ctx.db.prepare('DELETE FROM seat_assignment WHERE night_id = ? AND player_id = ?').run(n.id, playerId);
      ctx.db.prepare('INSERT INTO seat_assignment (night_id, table_id, seat, player_id) VALUES (?,?,?,?)').run(n.id, tableId, seat, playerId);
      if (occupant && occupant.player_id !== playerId && from) {
        ctx.db.prepare('INSERT INTO seat_assignment (night_id, table_id, seat, player_id) VALUES (?,?,?,?)').run(n.id, from.table_id, from.seat, occupant.player_id);
      }
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
