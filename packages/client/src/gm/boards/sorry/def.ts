/**
 * Sorry! board (classic rules): pure logic (no Svelte, no clock, no storage). Written to board-contract.ts v1.3.
 *
 * Sorry! is played on the real table with cards; this board is the GM's live tracker. Every pawn is in one of four
 * places: Start, on the board, in the Safety zone, or Home. Pawns of one player are interchangeable, so the board keeps
 * a history of moves between those places (and bumps), and every count is replayed from it. Undo can't leave a
 * count out of step. The number of pawns per player is a setting (classic = 4, the newer edition = 3).
 *
 * Crown (score):       LIVE. Most pawns home, then most in the Safety zone: home x (pawns + 1) + safety, so it can
 *                      only change when a pawn reaches Safety or Home (no flicker from pawns moving around the board).
 * Result (placements): the first to get every pawn home wins. Everyone else (and an unfinished game) by pawns home,
 *                      then pawns in Safety, then pawns out of Start. Equal on all three = shared place.
 * Re-rolls:            off (Sorry! uses cards, not dice).
 *
 * Every operation returns a NEW state; if nothing would change it returns the SAME object (double taps and a
 * repeated onchange are harmless).
 */
import type { BoardContext, BoardDef, BoardSetting } from '../contract';

/** Every gameplay number. Defaults are the classic values. */
export const SETTINGS: Record<string, BoardSetting> = {
  pawns: { label: 'Pawns per player (4 = classic, 3 = the newer edition)', default: 4, min: 1, max: 6 },
};

/** A setting's current value, falling back to its default. */
export function cfg(settings: Record<string, number> | undefined, key: string): number {
  const v = settings?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (SETTINGS[key]?.default ?? 0);
}

// ------------------------------------------------------------------ state

export type Zone = 'start' | 'board' | 'safety' | 'home';
export const ZONES: readonly Zone[] = ['start', 'board', 'safety', 'home'];
export const ZONE_LABEL: Record<Zone, string> = { start: 'Start', board: 'On the board', safety: 'Safety zone', home: 'Home' };

export type EntryKind = 'move' | 'bump';

export interface Entry {
  id: number;
  /** The player whose pawn moved (for a bump: the one who was sent back). */
  pid: number;
  kind: EntryKind;
  from: Zone;
  to: Zone;
  /** A bump only: who sent the pawn back. Their own id = their own pawn (a slide); null = not known. */
  by: number | null;
  /** When it was entered (epoch ms), null if unknown. */
  at: number | null;
}

export interface SorryState {
  v: 1;
  /** Seating order (clockwise from the first seat); used to list players. */
  order: number[];
  entries: Entry[];
  nextId: number;
  /** The game was ended on the board (the clock stops, entries are locked until it is reopened). */
  over: { at: number | null } | null;
  /** Entries taken back by undo, newest last. Cleared by any new entry. */
  redo?: Entry[];
  /** When the board first opened (epoch ms); only a fallback if the host gives no start time. */
  startedAt?: number | null;
}

export function init(ctx: BoardContext): SorryState {
  const seated = ctx.players.filter((x) => x.seat !== null).sort((a, b) => a.seat! - b.seat! || a.id - b.id);
  const rest = ctx.players.filter((x) => x.seat === null).sort((a, b) => a.id - b.id);
  return { v: 1, order: [...seated, ...rest].map((x) => x.id), entries: [], nextId: 1, over: null, redo: [], startedAt: null };
}

/** Seating order for the players in this game now (someone added later goes last). */
export function turnOrder(s: SorryState, ctx: BoardContext): number[] {
  const ids = new Set(ctx.players.map((x) => x.id));
  const out = s.order.filter((id, i) => ids.has(id) && s.order.indexOf(id) === i);
  for (const x of ctx.players) if (!out.includes(x.id)) out.push(x.id);
  return out;
}

// ------------------------------------------------------------------ the numbers

export type Zones = Record<Zone, number>;

/**
 * Where one player's pawns are, replayed from the history. Start is what is left of the pawns. A move that has no
 * pawn to take (the setting was lowered, or an earlier entry was undone) is skipped, so no count can go negative.
 */
export function zonesOf(s: SorryState, ctx: BoardContext, pid: number): Zones {
  const P = cfg(ctx.settings, 'pawns');
  let board = 0;
  let safety = 0;
  let home = 0;
  const start = () => Math.max(0, P - board - safety - home);
  for (const e of s.entries) {
    if (e.pid !== pid) continue;
    const have = e.from === 'start' ? start() : e.from === 'board' ? board : e.from === 'safety' ? safety : home;
    if (have < 1) continue;
    if (e.from === 'board') board--;
    else if (e.from === 'safety') safety--;
    else if (e.from === 'home') home--;
    if (e.to === 'board') board++;
    else if (e.to === 'safety') safety++;
    else if (e.to === 'home') home++;
  }
  return { start: start(), board, safety, home };
}

/** Everyone has all their pawns home. */
export const isFinished = (z: Zones, ctx: BoardContext): boolean => z.home >= cfg(ctx.settings, 'pawns');

export interface PlayerStats {
  /** Pawns of other players this player sent back to Start. */
  bumpsMade: number;
  /** Times a pawn of this player was sent back (by anyone, including their own slide). */
  bumpsTaken: number;
  /** Times a player's own pawn was slid back by their own move. */
  ownBumps: number;
}

export function statsOf(s: SorryState, pid: number): PlayerStats {
  const st: PlayerStats = { bumpsMade: 0, bumpsTaken: 0, ownBumps: 0 };
  for (const e of s.entries) {
    if (e.kind !== 'bump') continue;
    if (e.pid === pid) st.bumpsTaken++;
    if (e.by === pid && e.pid !== pid) st.bumpsMade++;
    if (e.by === pid && e.pid === pid) st.ownBumps++;
  }
  return st;
}

// ------------------------------------------------------------------ ranking, crown, result

export interface Row {
  playerId: number;
  name: string;
  zones: Zones;
  /** Pawns out of Start (on the board, in Safety or Home). */
  out: number;
  finished: boolean;
  place: number;
  tied: boolean;
  stats: PlayerStats;
}

export const ordinal = (n: number): string => {
  const m = n % 100;
  if (m >= 11 && m <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

const key = (r: { zones: Zones; out: number }): [number, number, number] => [r.zones.home, r.zones.safety, r.out];
const cmp = (a: [number, number, number], b: [number, number, number]): number => b[0] - a[0] || b[1] - a[1] || b[2] - a[2];

/** Everyone, best first: pawns home, then in Safety, then out of Start. Equal on all three share the place. */
export function ranking(s: SorryState, ctx: BoardContext): Row[] {
  const P = cfg(ctx.settings, 'pawns');
  const base = ctx.players.map((x) => {
    const zones = zonesOf(s, ctx, x.id);
    return { playerId: x.id, name: x.name, zones, out: Math.max(0, P - zones.start), finished: isFinished(zones, ctx), stats: statsOf(s, x.id) };
  });
  base.sort((a, b) => cmp(key(a), key(b)) || a.playerId - b.playerId);
  return base.map((r) => {
    const higher = base.filter((o) => cmp(key(o), key(r)) < 0).length;
    const same = base.filter((o) => cmp(key(o), key(r)) === 0).length;
    return { ...r, place: higher + 1, tied: same > 1 };
  });
}

/** Live crown: pawns home first, then pawns in the Safety zone (home x (pawns + 1) + safety). */
export function score(s: SorryState, ctx: BoardContext): Record<number, number> {
  const P = cfg(ctx.settings, 'pawns');
  const out: Record<number, number> = {};
  for (const x of ctx.players) {
    const z = zonesOf(s, ctx, x.id);
    out[x.id] = z.home * (P + 1) + z.safety;
  }
  return out;
}

/** Finish order for the result screen: groups of tied players, best first. */
export function placements(s: SorryState, ctx: BoardContext): number[][] {
  const groups: number[][] = [];
  let last: Row | null = null;
  for (const r of ranking(s, ctx)) {
    if (last && cmp(key(last), key(r)) === 0) groups[groups.length - 1]!.push(r.playerId);
    else groups.push([r.playerId]);
    last = r;
  }
  return groups;
}

// ------------------------------------------------------------------ recap

const first = (n: string) => n.trim().split(/\s+/)[0] || 'Player';

export function recapText(r: Row, rows: Row[], ctx: BoardContext): string {
  const P = cfg(ctx.settings, 'pawns');
  const bits: string[] = [`Sorry!: you finished ${ordinal(r.place)}${r.tied ? ' (tied)' : ''} with ${r.zones.home} of ${P} pawns home.`];
  const winners = rows.filter((x) => x.place === 1);
  if (r.place === 1 && r.finished) {
    const others = winners.filter((w) => w.playerId !== r.playerId).map((w) => first(w.name));
    bits.push(others.length ? `You share the win with ${others.join(' and ')}.` : 'You won!');
  } else if (r.place === 1) {
    bits.push('Nobody got every pawn home; you were ahead when the game ended.');
  } else {
    bits.push(`${winners.length > 1 ? 'Winners' : 'Winner'}: ${winners.map((x) => first(x.name)).join(' and ')}.`);
  }
  if (r.zones.safety > 0) bits.push(`${r.zones.safety} ${r.zones.safety === 1 ? 'pawn' : 'pawns'} waited in the Safety zone.`);
  const st = r.stats;
  if (st.bumpsMade) bits.push(`You sent ${st.bumpsMade} ${st.bumpsMade === 1 ? 'pawn' : 'pawns'} back to Start.`);
  if (st.bumpsTaken) bits.push(`You were sent back ${st.bumpsTaken} ${st.bumpsTaken === 1 ? 'time' : 'times'}.`);
  return bits.join(' ');
}

export function recap(s: SorryState, ctx: BoardContext): { playerId: number; text: string }[] {
  const rows = ranking(s, ctx);
  return rows.map((r) => ({ playerId: r.playerId, text: recapText(r, rows, ctx) }));
}

export const def: BoardDef<SorryState> = {
  key: 'sorry',
  label: 'Sorry!',
  settings: SETTINGS,
  init,
  score,
  placements,
  recap,
};

// ------------------------------------------------------------------ operations

const known = (ctx: BoardContext, pid: number) => ctx.players.some((x) => x.id === pid);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const stamp = (at: number | null | undefined): number | null => (fin(at) ? at : null);
const isZone = (z: unknown): z is Zone => ZONES.includes(z as Zone);

function push(s: SorryState, e: Omit<Entry, 'id'>): SorryState {
  return { ...s, entries: [...s.entries, { ...e, id: s.nextId }], nextId: s.nextId + 1, redo: [] };
}

/** Two identical entries this close together are a double tap, not a second pawn. */
export const DOUBLE_TAP_MS = 1500;
function isDoubleTap(s: SorryState, e: Omit<Entry, 'id' | 'at'>, at: number | null): boolean {
  const last = s.entries[s.entries.length - 1];
  if (!last || at === null || last.at === null) return false;
  const gap = at - last.at;
  return gap >= 0 && gap < DOUBLE_TAP_MS && last.pid === e.pid && last.kind === e.kind && last.from === e.from && last.to === e.to && last.by === e.by;
}

/** One pawn moves from one place to another (out of Start, into Safety, Home, or a correction). */
export function movePawn(s: SorryState, ctx: BoardContext, pid: number, from: Zone, to: Zone, at?: number | null): SorryState {
  if (s.over || !known(ctx, pid) || !isZone(from) || !isZone(to) || from === to) return s;
  if (zonesOf(s, ctx, pid)[from] < 1) return s;
  const e = { pid, kind: 'move' as const, from, to, by: null };
  const t = stamp(at);
  if (isDoubleTap(s, e, t)) return s;
  return push(s, { ...e, at: t });
}

/**
 * `by` sent one of `victim`'s pawns from the board back to Start. `by` = the victim's own id for their own pawn
 * (a slide), null if it is not known. Pawns in the Safety zone cannot be bumped.
 */
export function bumpPawn(s: SorryState, ctx: BoardContext, victim: number, by: number | null, at?: number | null): SorryState {
  if (s.over || !known(ctx, victim) || (by !== null && !known(ctx, by))) return s;
  if (zonesOf(s, ctx, victim).board < 1) return s;
  const e = { pid: victim, kind: 'bump' as const, from: 'board' as const, to: 'start' as const, by };
  const t = stamp(at);
  if (isDoubleTap(s, e, t)) return s;
  return push(s, { ...e, at: t });
}

/** Takes back the last entry (it can be put back with redoLast). Not while the game is ended (reopen it first). */
export function undoLast(s: SorryState): SorryState {
  if (s.over || !s.entries.length) return s;
  const last = s.entries[s.entries.length - 1]!;
  return { ...s, entries: s.entries.slice(0, -1), redo: [...(s.redo ?? []), last].slice(-20) };
}

/** The entry an undo would put back (null = nothing to put back). */
export const redoNext = (s: SorryState): Entry | null => (s.over ? null : (s.redo ?? [])[(s.redo ?? []).length - 1] ?? null);

export function redoLast(s: SorryState): SorryState {
  const e = redoNext(s);
  if (!e) return s;
  return { ...s, entries: [...s.entries, e], redo: (s.redo ?? []).slice(0, -1) };
}

/** Ends the game on the board: the clock stops and entries are locked until it is reopened. */
export function endGame(s: SorryState, at?: number | null): SorryState {
  if (s.over) return s;
  return { ...s, over: { at: stamp(at) } };
}

/** Takes the ending back (to fix an entry). */
export function reopenGame(s: SorryState): SorryState {
  return s.over ? { ...s, over: null } : s;
}

// ------------------------------------------------------------------ game clock

/** Remembers when the board first opened (only if not already known). The same object comes back if it is. */
export function markStarted(s: SorryState, now: number): SorryState {
  if (typeof s.startedAt === 'number' || !Number.isFinite(now)) return s;
  return { ...s, startedAt: now };
}

export interface Clock {
  startedAt: number;
  endsAt: number | null;
  elapsedMs: number;
  remainingMs: number | null;
  over: boolean;
  finished: boolean;
  source: 'host' | 'board';
}

/** null when no start time is known yet. Stops when the game is ended on the board. */
export function clock(s: SorryState, ctx: BoardContext, now: number): Clock | null {
  const fromHost = fin(ctx.startedAt);
  const startedAt = fromHost ? (ctx.startedAt as number) : fin(s.startedAt) ? s.startedAt : null;
  if (startedAt === null) return null;
  const endsAt = fin(ctx.endsAt) && ctx.endsAt > startedAt ? ctx.endsAt : null;
  const finished = !!s.over && fin(s.over.at);
  const at = finished ? (s.over!.at as number) : now;
  const remainingMs = endsAt === null ? null : endsAt - at;
  return { startedAt, endsAt, elapsedMs: Math.max(0, at - startedAt), remainingMs, over: remainingMs !== null && remainingMs < 0, finished, source: fromHost ? 'host' : 'board' };
}

/** "1h 12m", "28 min", "under a minute". */
export function duration(ms: number): string {
  const m = Math.floor(Math.abs(ms) / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

// ------------------------------------------------------------------ text for the history and warnings

/** One history line with the names: "Sam sent Alex's pawn back to Start". */
export function entryLine(e: Entry, nameOf: (id: number) => string): string {
  const who = first(nameOf(e.pid));
  if (e.kind === 'bump') {
    if (e.by === null) return `${who}'s pawn was sent back to Start`;
    if (e.by === e.pid) return `${who} slid onto their own pawn: back to Start`;
    return `${first(nameOf(e.by))} sent ${who}'s pawn back to Start`;
  }
  if (e.from === 'start' && e.to === 'board') return `${who} brought a pawn out of Start`;
  if (e.to === 'safety') return `${who} moved a pawn into the Safety zone`;
  if (e.to === 'home') return `${who} got a pawn Home${e.from === 'safety' ? ' from the Safety zone' : ''}`;
  return `${who} moved a pawn: ${ZONE_LABEL[e.from]} to ${ZONE_LABEL[e.to]}`;
}

/** Things the GM should know before opening the result screen. Empty = nothing to warn about. */
export function finishWarnings(s: SorryState, ctx: BoardContext): string[] {
  const out: string[] = [];
  const P = cfg(ctx.settings, 'pawns');
  if (!s.entries.length) out.push('Nothing has been entered. Everyone will be tied on the result screen.');
  else if (!ctx.players.some((x) => isFinished(zonesOf(s, ctx, x.id), ctx))) out.push(`Nobody has all ${P} pawns home: places use the pawns home, then in Safety, then out of Start.`);
  return out;
}
