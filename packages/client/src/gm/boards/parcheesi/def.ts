/**
 * Parcheesi board (classic rules): pure logic (no Svelte, no clock, no storage). Written to board-contract.ts v1.3.
 *
 * Parcheesi is played on the real table with two dice; this board is the GM's live tracker. Every pawn is in one of
 * four places: the Nest, on the board, on the Home path, or Home. Pawns of one player are interchangeable, so the board
 * keeps a history of moves between those places (and captures, and three-doubles penalties), and every count is
 * replayed from it. Undo can't leave a count out of step. Pawns per player and every bonus are settings.
 * Bonus moves (20 for a capture, 10 for a pawn home) are played at the table; the board only reminds the GM.
 * Blockades, safe spaces and where a pawn is on the board are NOT tracked.
 *
 * Crown (score):       LIVE. Most pawns home, then most on the Home path: home x (pawns + 1) + path, so it can only
 *                      change when a pawn reaches the Home path or Home (no flicker from pawns moving around the board).
 * Result (placements): the first to get every pawn home wins. Everyone else (and an unfinished game) by pawns home,
 *                      then pawns on the Home path, then pawns out of the Nest. Equal on all three = shared place.
 * Re-rolls:            on (a dice game); the board counts the ones used for the recap.
 *
 * Every operation returns a NEW state; if nothing would change it returns the SAME object (double taps and a
 * repeated onchange are harmless).
 */
import type { BoardContext, BoardDef, BoardSetting } from '../contract';

/** Every gameplay number. Defaults are the classic values. */
export const SETTINGS: Record<string, BoardSetting> = {
  pawns: { label: 'Pawns per player (4 = classic)', default: 4, min: 1, max: 6 },
  captureBonus: { label: 'Bonus move (spaces) for capturing a pawn', default: 20, min: 0, max: 100, step: 5 },
  homeBonus: { label: 'Bonus move (spaces) for getting a pawn Home', default: 10, min: 0, max: 100, step: 5 },
  doublesLimit: { label: 'Doubles in a row that send the furthest pawn back to the Nest', default: 3, min: 2, max: 5 },
  enterRoll: { label: 'Dice number that brings a pawn out of the Nest (a reminder on the board)', default: 5, min: 1, max: 6 },
};

/** A setting's current value, falling back to its default. */
export function cfg(settings: Record<string, number> | undefined, key: string): number {
  const v = settings?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (SETTINGS[key]?.default ?? 0);
}

// ------------------------------------------------------------------ state

export type Zone = 'nest' | 'board' | 'path' | 'home';
export const ZONES: readonly Zone[] = ['nest', 'board', 'path', 'home'];
export const ZONE_LABEL: Record<Zone, string> = { nest: 'Nest', board: 'On the board', path: 'Home path', home: 'Home' };

export type EntryKind = 'move' | 'capture' | 'doubles';

export interface Entry {
  id: number;
  /** The player whose pawn moved (capture: the one captured; doubles: the one penalised). */
  pid: number;
  kind: EntryKind;
  from: Zone;
  to: Zone;
  /** A capture only: who captured the pawn; null = not known. */
  by: number | null;
  /** When it was entered (epoch ms), null if unknown. */
  at: number | null;
}

export interface ParcheesiState {
  v: 1;
  /** Seating order (clockwise from the first seat); used to list players. */
  order: number[];
  entries: Entry[];
  nextId: number;
  /** The game was ended on the board (the clock stops, entries are locked until it is reopened). */
  over: { at: number | null } | null;
  /** Entries taken back by undo, newest last. Cleared by any new entry. */
  redo?: Entry[];
  /** Re-rolls used tonight in this game, per player (for the recap). */
  rerolls: Record<number, number>;
  /** When the board first opened (epoch ms); only a fallback if the host gives no start time. */
  startedAt?: number | null;
}

export function init(ctx: BoardContext): ParcheesiState {
  const seated = ctx.players.filter((x) => x.seat !== null).sort((a, b) => a.seat! - b.seat! || a.id - b.id);
  const rest = ctx.players.filter((x) => x.seat === null).sort((a, b) => a.id - b.id);
  return { v: 1, order: [...seated, ...rest].map((x) => x.id), entries: [], nextId: 1, over: null, redo: [], rerolls: {}, startedAt: null };
}

/** Seating order for the players in this game now (someone added later goes last). */
export function turnOrder(s: ParcheesiState, ctx: BoardContext): number[] {
  const ids = new Set(ctx.players.map((x) => x.id));
  const out = s.order.filter((id, i) => ids.has(id) && s.order.indexOf(id) === i);
  for (const x of ctx.players) if (!out.includes(x.id)) out.push(x.id);
  return out;
}

// ------------------------------------------------------------------ the numbers

export type Zones = Record<Zone, number>;

/**
 * Where one player's pawns are, replayed from the history. The Nest is what is left of the pawns. A move that has no
 * pawn to take (the setting was lowered, or an earlier entry was undone) is skipped, so no count can go negative.
 */
export function zonesOf(s: ParcheesiState, ctx: BoardContext, pid: number): Zones {
  const P = cfg(ctx.settings, 'pawns');
  let board = 0;
  let path = 0;
  let home = 0;
  const nest = () => Math.max(0, P - board - path - home);
  for (const e of s.entries) {
    if (e.pid !== pid) continue;
    const have = e.from === 'nest' ? nest() : e.from === 'board' ? board : e.from === 'path' ? path : home;
    if (have < 1) continue;
    if (e.from === 'board') board--;
    else if (e.from === 'path') path--;
    else if (e.from === 'home') home--;
    if (e.to === 'board') board++;
    else if (e.to === 'path') path++;
    else if (e.to === 'home') home++;
  }
  return { nest: nest(), board, path, home };
}

/** Everyone has all their pawns home. */
export const isFinished = (z: Zones, ctx: BoardContext): boolean => z.home >= cfg(ctx.settings, 'pawns');

export interface PlayerStats {
  /** Pawns of other players this player captured. */
  captures: number;
  /** Times a pawn of this player was captured. */
  captured: number;
  /** Times this player was sent a pawn back by rolling doubles too often. */
  tripleDoubles: number;
}

export function statsOf(s: ParcheesiState, pid: number): PlayerStats {
  const st: PlayerStats = { captures: 0, captured: 0, tripleDoubles: 0 };
  for (const e of s.entries) {
    if (e.kind === 'capture') {
      if (e.pid === pid) st.captured++;
      if (e.by === pid) st.captures++;
    } else if (e.kind === 'doubles' && e.pid === pid) st.tripleDoubles++;
  }
  return st;
}

// ------------------------------------------------------------------ ranking, crown, result

export interface Row {
  playerId: number;
  name: string;
  zones: Zones;
  /** Pawns out of the Nest (on the board, on the Home path or Home). */
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

const key = (r: { zones: Zones; out: number }): [number, number, number] => [r.zones.home, r.zones.path, r.out];
const cmp = (a: [number, number, number], b: [number, number, number]): number => b[0] - a[0] || b[1] - a[1] || b[2] - a[2];

/** Everyone, best first: pawns home, then on the Home path, then out of the Nest. Equal on all three share the place. */
export function ranking(s: ParcheesiState, ctx: BoardContext): Row[] {
  const P = cfg(ctx.settings, 'pawns');
  const base = ctx.players.map((x) => {
    const zones = zonesOf(s, ctx, x.id);
    return { playerId: x.id, name: x.name, zones, out: Math.max(0, P - zones.nest), finished: isFinished(zones, ctx), stats: statsOf(s, x.id) };
  });
  base.sort((a, b) => cmp(key(a), key(b)) || a.playerId - b.playerId);
  return base.map((r) => {
    const higher = base.filter((o) => cmp(key(o), key(r)) < 0).length;
    const same = base.filter((o) => cmp(key(o), key(r)) === 0).length;
    return { ...r, place: higher + 1, tied: same > 1 };
  });
}

/** Live crown: pawns home first, then pawns on the Home path (home x (pawns + 1) + path). */
export function score(s: ParcheesiState, ctx: BoardContext): Record<number, number> {
  const P = cfg(ctx.settings, 'pawns');
  const out: Record<number, number> = {};
  for (const x of ctx.players) {
    const z = zonesOf(s, ctx, x.id);
    out[x.id] = z.home * (P + 1) + z.path;
  }
  return out;
}

/** Finish order for the result screen: groups of tied players, best first. */
export function placements(s: ParcheesiState, ctx: BoardContext): number[][] {
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

export function recapText(r: Row, rows: Row[], s: ParcheesiState, ctx: BoardContext): string {
  const P = cfg(ctx.settings, 'pawns');
  const bits: string[] = [`Parcheesi: you finished ${ordinal(r.place)}${r.tied ? ' (tied)' : ''} with ${r.zones.home} of ${P} pawns home.`];
  const winners = rows.filter((x) => x.place === 1);
  if (r.place === 1 && r.finished) {
    const others = winners.filter((w) => w.playerId !== r.playerId).map((w) => first(w.name));
    bits.push(others.length ? `You share the win with ${others.join(' and ')}.` : 'You won!');
  } else if (r.place === 1) {
    bits.push('Nobody got every pawn home; you were ahead when the game ended.');
  } else {
    bits.push(`${winners.length > 1 ? 'Winners' : 'Winner'}: ${winners.map((x) => first(x.name)).join(' and ')}.`);
  }
  if (r.zones.path > 0) bits.push(`${r.zones.path} ${r.zones.path === 1 ? 'pawn' : 'pawns'} waited on the Home path.`);
  const st = r.stats;
  if (st.captures) bits.push(`You captured ${st.captures} ${st.captures === 1 ? 'pawn' : 'pawns'}.`);
  if (st.captured) bits.push(`You were captured ${st.captured} ${st.captured === 1 ? 'time' : 'times'}.`);
  if (st.tripleDoubles) bits.push(`Too many doubles sent a pawn back to the Nest ${st.tripleDoubles} ${st.tripleDoubles === 1 ? 'time' : 'times'}.`);
  const rr = s.rerolls?.[r.playerId] ?? 0;
  if (rr) bits.push(`Re-rolls used: ${rr}.`);
  return bits.join(' ');
}

export function recap(s: ParcheesiState, ctx: BoardContext): { playerId: number; text: string }[] {
  const rows = ranking(s, ctx);
  return rows.map((r) => ({ playerId: r.playerId, text: recapText(r, rows, s, ctx) }));
}

export const def: BoardDef<ParcheesiState> = {
  key: 'parcheesi',
  label: 'Parcheesi',
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

function push(s: ParcheesiState, e: Omit<Entry, 'id'>): ParcheesiState {
  return { ...s, entries: [...s.entries, { ...e, id: s.nextId }], nextId: s.nextId + 1, redo: [] };
}

/** Two identical entries this close together are a double tap, not a second pawn. */
export const DOUBLE_TAP_MS = 1500;
function isDoubleTap(s: ParcheesiState, e: Omit<Entry, 'id' | 'at'>, at: number | null): boolean {
  const last = s.entries[s.entries.length - 1];
  if (!last || at === null || last.at === null) return false;
  const gap = at - last.at;
  return gap >= 0 && gap < DOUBLE_TAP_MS && last.pid === e.pid && last.kind === e.kind && last.from === e.from && last.to === e.to && last.by === e.by;
}

/** One pawn moves from one place to another (out of the Nest, onto the Home path, Home, or a correction). */
export function movePawn(s: ParcheesiState, ctx: BoardContext, pid: number, from: Zone, to: Zone, at?: number | null): ParcheesiState {
  if (s.over || !known(ctx, pid) || !isZone(from) || !isZone(to) || from === to) return s;
  if (zonesOf(s, ctx, pid)[from] < 1) return s;
  const e = { pid, kind: 'move' as const, from, to, by: null };
  const t = stamp(at);
  if (isDoubleTap(s, e, t)) return s;
  return push(s, { ...e, at: t });
}

/**
 * `by` captured one of `victim`'s pawns from the board: it goes back to the Nest. `by` is another player, or null if
 * it is not known. Pawns on the Home path cannot be captured.
 */
export function capturePawn(s: ParcheesiState, ctx: BoardContext, victim: number, by: number | null, at?: number | null): ParcheesiState {
  if (s.over || !known(ctx, victim) || (by !== null && (!known(ctx, by) || by === victim))) return s;
  if (zonesOf(s, ctx, victim).board < 1) return s;
  const e = { pid: victim, kind: 'capture' as const, from: 'board' as const, to: 'nest' as const, by };
  const t = stamp(at);
  if (isDoubleTap(s, e, t)) return s;
  return push(s, { ...e, at: t });
}

/**
 * The player rolled doubles too many times in a row: their furthest pawn goes back to the Nest. The board does not
 * know which pawn is furthest, and doesn't need to: all pawns on the board count the same. Needs a pawn on the board.
 */
export function doublesPenalty(s: ParcheesiState, ctx: BoardContext, pid: number, at?: number | null): ParcheesiState {
  if (s.over || !known(ctx, pid) || zonesOf(s, ctx, pid).board < 1) return s;
  const e = { pid, kind: 'doubles' as const, from: 'board' as const, to: 'nest' as const, by: null };
  const t = stamp(at);
  if (isDoubleTap(s, e, t)) return s;
  return push(s, { ...e, at: t });
}

/** Takes back the last entry (it can be put back with redoLast). Not while the game is ended (reopen it first). */
export function undoLast(s: ParcheesiState): ParcheesiState {
  if (s.over || !s.entries.length) return s;
  const last = s.entries[s.entries.length - 1]!;
  return { ...s, entries: s.entries.slice(0, -1), redo: [...(s.redo ?? []), last].slice(-20) };
}

/** The entry an undo would put back (null = nothing to put back). */
export const redoNext = (s: ParcheesiState): Entry | null => (s.over ? null : (s.redo ?? [])[(s.redo ?? []).length - 1] ?? null);

export function redoLast(s: ParcheesiState): ParcheesiState {
  const e = redoNext(s);
  if (!e) return s;
  return { ...s, entries: [...s.entries, e], redo: (s.redo ?? []).slice(0, -1) };
}

/** Ends the game on the board: the clock stops and entries are locked until it is reopened. */
export function endGame(s: ParcheesiState, at?: number | null): ParcheesiState {
  if (s.over) return s;
  return { ...s, over: { at: stamp(at) } };
}

/** Takes the ending back (to fix an entry). */
export function reopenGame(s: ParcheesiState): ParcheesiState {
  return s.over ? { ...s, over: null } : s;
}

/** Counts a re-roll after the host has spent the token. */
export function recordReroll(s: ParcheesiState, ctx: BoardContext, pid: number): ParcheesiState {
  if (!known(ctx, pid)) return s;
  const rr = s.rerolls ?? {};
  return { ...s, rerolls: { ...rr, [pid]: (rr[pid] ?? 0) + 1 } };
}

// ------------------------------------------------------------------ game clock

/** Remembers when the board first opened (only if not already known). The same object comes back if it is. */
export function markStarted(s: ParcheesiState, now: number): ParcheesiState {
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
export function clock(s: ParcheesiState, ctx: BoardContext, now: number): Clock | null {
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

/** The bonus move a history entry earns, in spaces (0 = none): a capture, or a pawn getting Home. */
export function bonusOf(e: Entry, settings: Record<string, number> | undefined): number {
  if (e.kind === 'capture' && e.by !== null) return cfg(settings, 'captureBonus');
  if (e.kind === 'move' && e.to === 'home') return cfg(settings, 'homeBonus');
  return 0;
}

/** Who gets the bonus move of an entry (the capturer, or the player whose pawn got Home). */
export const bonusPlayer = (e: Entry): number | null => (e.kind === 'capture' ? e.by : e.kind === 'move' && e.to === 'home' ? e.pid : null);

/** The bonus move the last entry earned, if any (so the GM can remind the table). */
export function lastBonus(s: ParcheesiState, ctx: BoardContext): { pid: number; spaces: number; why: 'capture' | 'home' } | null {
  const e = s.entries[s.entries.length - 1];
  if (!e) return null;
  const spaces = bonusOf(e, ctx.settings);
  const pid = bonusPlayer(e);
  if (spaces < 1 || pid === null) return null;
  return { pid, spaces, why: e.kind === 'capture' ? 'capture' : 'home' };
}

/** One history line with the names: "Sam captured Alex's pawn". */
export function entryLine(e: Entry, nameOf: (id: number) => string): string {
  const who = first(nameOf(e.pid));
  if (e.kind === 'capture') return e.by === null ? `${who}'s pawn was captured` : `${first(nameOf(e.by))} captured ${who}'s pawn`;
  if (e.kind === 'doubles') return `${who} rolled doubles too often: a pawn went back to the Nest`;
  if (e.from === 'nest' && e.to === 'board') return `${who} brought a pawn out of the Nest`;
  if (e.to === 'path') return `${who} moved a pawn onto the Home path`;
  if (e.to === 'home') return `${who} got a pawn Home${e.from === 'path' ? ' from the Home path' : ''}`;
  return `${who} moved a pawn: ${ZONE_LABEL[e.from]} to ${ZONE_LABEL[e.to]}`;
}

/** Things the GM should know before opening the result screen. Empty = nothing to warn about. */
export function finishWarnings(s: ParcheesiState, ctx: BoardContext): string[] {
  const out: string[] = [];
  const P = cfg(ctx.settings, 'pawns');
  if (!s.entries.length) out.push('Nothing has been entered. Everyone will be tied on the result screen.');
  else if (!ctx.players.some((x) => isFinished(zonesOf(s, ctx, x.id), ctx))) out.push(`Nobody has all ${P} pawns home: places use the pawns home, then on the Home path, then out of the Nest.`);
  return out;
}
