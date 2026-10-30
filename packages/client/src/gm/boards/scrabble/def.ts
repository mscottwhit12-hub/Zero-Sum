/**
 * Scrabble board (classic rules): pure logic (no Svelte, no clock, no storage). Written to board-contract.ts v1.2.
 *
 * Scrabble is played on the real table; this board is the GM's score sheet. The GM types ONE number per turn
 * (word optional); the board keeps every entry in a history with undo, the tiles left in the bag, whose turn it is,
 * and the end-game tile adjustment.
 *
 * Crown (score):       NO live leader (Tate decided). Everyone reads 0 until the game has been ended on the board;
 *                      then the final totals (after the end-game adjustment).
 * Result (placements): highest total first. Equal totals: the higher score BEFORE the end-game adjustment wins
 *                      (official rule, a setting); still equal = shared place. A game opened for results without
 *                      being ended on the board is ranked by the running totals, no adjustment.
 *
 * Every operation returns a NEW state; if nothing would change it returns the SAME object (double taps and a
 * repeated onchange are harmless).
 */
import type { BoardContext, BoardDef, BoardSetting } from '../contract';

/** Every gameplay number. Defaults are the official classic values. */
export const SETTINGS: Record<string, BoardSetting> = {
  bingoBonus: { label: 'Bingo bonus: points for playing all the tiles on your rack in one turn', default: 50, min: 0, max: 200, step: 5 },
  rackSize: { label: 'Tiles on a rack', default: 7, min: 1, max: 10 },
  tilesTotal: { label: 'Tiles in the whole game (bag + racks at the start)', default: 100, min: 20, max: 200, step: 1 },
  tileMax: { label: 'Highest value of one tile (limits the tiles-left points typed at the end)', default: 10, min: 1, max: 20 },
  defaultTiles: { label: 'Tiles played in a turn, pre-filled on the entry (can be changed per turn)', default: 3, min: 1, max: 10 },
  turnMax: { label: 'Biggest score the board accepts for one turn', default: 500, min: 50, max: 1500, step: 50 },
  bigScore: { label: 'A turn score this big or bigger asks "are you sure?" before it is added (typo guard)', default: 150, min: 20, max: 1500, step: 10 },
  challengeRule: { label: 'Challenge rule (0 = free, no penalty; 1 = single, lose points; 2 = double, lose your turn)', default: 2, min: 0, max: 2 },
  challengePenalty: { label: 'Single challenge: points lost for a failed challenge', default: 5, min: 0, max: 50 },
  endAdjust: { label: 'End of game: subtract tiles left, and add them to the player who went out (1 = yes, 0 = no)', default: 1, min: 0, max: 1 },
  scorelessLimit: { label: 'Game can end after this many scoreless turns in a row (0 = off)', default: 6, min: 0, max: 20 },
  turnSeconds: { label: 'Turn timer in seconds (0 = no timer)', default: 0, min: 0, max: 900, step: 15 },
  overtimePenalty: { label: 'Points lost per minute over the turn timer (0 = no penalty)', default: 0, min: 0, max: 20 },
  tieHigherBefore: { label: 'Break tied totals by the higher score before the end adjustment (1 = yes, 0 = no)', default: 1, min: 0, max: 1 },
  dictionary: { label: 'Dictionary shown on the board (1 = NWL North American, 2 = Collins, 3 = house list); a label only', default: 1, min: 1, max: 3 },
};

export const DICTIONARIES: Record<number, string> = { 1: 'NWL (North American)', 2: 'Collins', 3: 'House word list' };

/** A setting's current value, falling back to its default. */
export function cfg(settings: Record<string, number> | undefined, key: string): number {
  const v = settings?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (SETTINGS[key]?.default ?? 0);
}

// ------------------------------------------------------------------ state

export type Kind = 'play' | 'pass' | 'exchange' | 'challengedOff' | 'lostChallenge' | 'penalty';

export interface Entry {
  id: number;
  pid: number;
  kind: Kind;
  /** The score of the word (plays), or the points lost as a NEGATIVE number (penalties, single-challenge losses); else 0. */
  points: number;
  /** Bingo bonus awarded with this play (stored so a later settings change can't rewrite history). */
  bonus: number;
  /** The word, or a note (for example "overtime"). Optional. */
  word: string;
  /** Tiles taken out of the bag by this play (0 for everything else). */
  tiles: number;
  /** This entry used up the player's turn (so the next player is up). */
  turn: boolean;
  /** When it was entered (epoch ms), null if unknown. */
  at: number | null;
  /** A play that was challenged off keeps its numbers here, so undo can put the play back. */
  prev?: { points: number; bonus: number; tiles: number };
}

/** How the game ended on the board. */
export type EndMode = 'out' | 'blocked' | 'time';

export interface Over {
  at: number | null;
  /** out = a player used all their tiles; blocked = nobody can move (scoreless turns); time = stopped, no adjustment. */
  mode: EndMode;
  wentOut: number | null;
  /** Points on the tiles each player had left. */
  racks: Record<number, number>;
}

export interface ScrabbleState {
  v: 1;
  /** Turn order (clockwise from the first player). Players missing here are added at the end when read. */
  order: number[];
  entries: Entry[];
  nextId: number;
  /** The GM's correction to the bag count. */
  bagAdj: number;
  over: Over | null;
  /** Entries taken back by undo, newest last, so a mis-tapped undo can be put back. Cleared by any new entry. Missing in older saved games. */
  redo?: Entry[];
  rerolls: Record<number, number>;
  /** When the board first opened (epoch ms); only a fallback if the host gives no start time. */
  startedAt?: number | null;
}

export function init(ctx: BoardContext): ScrabbleState {
  const seated = ctx.players.filter((x) => x.seat !== null).sort((a, b) => a.seat! - b.seat! || a.id - b.id);
  const rest = ctx.players.filter((x) => x.seat === null).sort((a, b) => a.id - b.id);
  return { v: 1, order: [...seated, ...rest].map((x) => x.id), entries: [], nextId: 1, bagAdj: 0, over: null, redo: [], rerolls: {}, startedAt: null };
}

/** Turn order for the players that are in this game now (someone added later goes last). */
export function turnOrder(s: ScrabbleState, ctx: BoardContext): number[] {
  const ids = new Set(ctx.players.map((x) => x.id));
  const out = s.order.filter((id, i) => ids.has(id) && s.order.indexOf(id) === i);
  for (const x of ctx.players) if (!out.includes(x.id)) out.push(x.id);
  return out;
}

const lastTurnEntry = (s: ScrabbleState): Entry | null => {
  for (let i = s.entries.length - 1; i >= 0; i--) if (s.entries[i]!.turn) return s.entries[i]!;
  return null;
};

/** Whose turn it is: the player after whoever took the last turn; the first in the order at the start. null = nobody. */
export function currentPlayer(s: ScrabbleState, ctx: BoardContext): number | null {
  const order = turnOrder(s, ctx);
  if (!order.length) return null;
  const last = lastTurnEntry(s);
  if (!last) return order[0]!;
  const i = order.indexOf(last.pid);
  return i < 0 ? order[0]! : order[(i + 1) % order.length]!;
}

// ------------------------------------------------------------------ numbers

export const entryPoints = (e: Entry): number => e.points + e.bonus;

/** Running total of every entry (no end-game adjustment). */
export function baseScore(s: ScrabbleState, pid: number): number {
  let t = 0;
  for (const e of s.entries) if (e.pid === pid) t += entryPoints(e);
  return t;
}

const rackOf = (o: Over, pid: number) => o.racks[pid] ?? 0;

/**
 * The end-game adjustment for one player under a given ending: minus the points left on their rack; the player who
 * went out also gets the sum of everyone else's. Nothing when the setting is off or the game just stopped (time).
 */
export function adjustmentFor(o: Over | null, ctx: BoardContext, pid: number): number {
  if (!o || o.mode === 'time' || cfg(ctx.settings, 'endAdjust') < 1) return 0;
  if (o.mode === 'out' && o.wentOut === pid) {
    let sum = 0;
    for (const x of ctx.players) if (x.id !== pid) sum += rackOf(o, x.id);
    return sum;
  }
  return -rackOf(o, pid);
}

/** The adjustment actually applied: only once the game has been ended. */
export const adjustment = (s: ScrabbleState, ctx: BoardContext, pid: number): number => adjustmentFor(s.over, ctx, pid);
export const totalScore = (s: ScrabbleState, ctx: BoardContext, pid: number): number => baseScore(s, pid) + adjustment(s, ctx, pid);

/** Tiles left in the bag. */
export function bagRaw(s: ScrabbleState, ctx: BoardContext): number {
  let used = 0;
  for (const e of s.entries) used += e.tiles;
  return cfg(ctx.settings, 'tilesTotal') - cfg(ctx.settings, 'rackSize') * ctx.players.length - used;
}
export function bagCount(s: ScrabbleState, ctx: BoardContext): number {
  return Math.min(cfg(ctx.settings, 'tilesTotal'), Math.max(0, bagRaw(s, ctx) + s.bagAdj));
}

/** Scoreless turns in a row at the end of the history (passes, exchanges, challenged-off plays, lost challenges that cost the turn). */
export function scorelessRun(s: ScrabbleState): number {
  let n = 0;
  for (let i = s.entries.length - 1; i >= 0; i--) {
    const e = s.entries[i]!;
    if (!e.turn) continue; // a penalty between turns neither counts nor breaks the run
    if (e.kind === 'play') break;
    n++;
  }
  return n;
}

export interface PlayerStats {
  plays: number;
  best: number;
  bestWord: string;
  bingos: number;
  passes: number;
  exchanges: number;
  lostChallenges: number;
  penalties: number;
}

export function statsOf(s: ScrabbleState, pid: number): PlayerStats {
  const st: PlayerStats = { plays: 0, best: 0, bestWord: '', bingos: 0, passes: 0, exchanges: 0, lostChallenges: 0, penalties: 0 };
  for (const e of s.entries) {
    if (e.pid !== pid) continue;
    if (e.kind === 'play') {
      st.plays++;
      if (e.bonus > 0) st.bingos++;
      const v = entryPoints(e);
      if (v > st.best) {
        st.best = v;
        st.bestWord = e.word;
      }
    } else if (e.kind === 'pass') st.passes++;
    else if (e.kind === 'exchange') st.exchanges++;
    else if (e.kind === 'lostChallenge') st.lostChallenges++;
    else if (e.kind === 'penalty') st.penalties++;
  }
  return st;
}

// ------------------------------------------------------------------ ranking

export interface Row {
  playerId: number;
  name: string;
  base: number;
  adj: number;
  total: number;
  stats: PlayerStats;
  place: number;
  tied: boolean;
}

export const ordinal = (n: number): string => {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** Everyone ranked by total (after the end adjustment once the game is over). */
export function rankWith(s: ScrabbleState, ctx: BoardContext, over: Over | null): Row[] {
  const tb = cfg(ctx.settings, 'tieHigherBefore') >= 1;
  const rows = ctx.players.map((x) => {
    const base = baseScore(s, x.id);
    const adj = adjustmentFor(over, ctx, x.id);
    return { playerId: x.id, name: x.name, base, adj, total: base + adj, stats: statsOf(s, x.id) };
  });
  rows.sort((a, b) => b.total - a.total || (tb ? b.base - a.base : 0) || a.playerId - b.playerId);
  const same = (a: (typeof rows)[number], b: (typeof rows)[number]) => a.total === b.total && (!tb || a.base === b.base);
  const out: Row[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && same(rows[i]!, rows[j]!)) j++;
    for (let k = i; k < j; k++) out.push({ ...rows[k]!, place: i + 1, tied: j - i > 1 });
    i = j;
  }
  return out;
}
export const ranking = (s: ScrabbleState, ctx: BoardContext): Row[] => rankWith(s, ctx, s.over);

/** No live leader: the crown only sees scores once the game has been ended on the board. Until then everyone reads 0. */
export function score(s: ScrabbleState, ctx: BoardContext): Record<number, number> {
  const out: Record<number, number> = {};
  for (const x of ctx.players) out[x.id] = s.over ? totalScore(s, ctx, x.id) : 0;
  return out;
}

export function placements(s: ScrabbleState, ctx: BoardContext): number[][] {
  const groups: number[][] = [];
  let lastPlace = -1;
  for (const r of ranking(s, ctx)) {
    if (r.place === lastPlace) groups[groups.length - 1]!.push(r.playerId);
    else groups.push([r.playerId]);
    lastPlace = r.place;
  }
  return groups;
}

// ------------------------------------------------------------------ recap

const first = (n: string) => n.trim().split(/\s+/)[0] || 'Player';

export function recapText(r: Row, rows: Row[], s: ScrabbleState, ctx: BoardContext): string {
  const bits: string[] = [`Scrabble: you finished ${ordinal(r.place)}${r.tied ? ' (tied)' : ''} with ${r.total} points.`];
  const winners = rows.filter((x) => x.place === 1);
  if (r.place === 1) {
    const others = winners.filter((w) => w.playerId !== r.playerId).map((w) => first(w.name));
    bits.push(others.length ? `You share the win with ${others.join(' and ')}.` : 'You won!');
  } else {
    bits.push(`${winners.length > 1 ? 'Winners' : 'Winner'}: ${winners.map((x) => first(x.name)).join(' and ')} with ${winners[0]!.total} points.`);
  }
  if (r.adj !== 0) bits.push(`End-game tiles: ${r.adj > 0 ? '+' : '−'}${Math.abs(r.adj)} (you had ${r.base} before).`);
  const st = r.stats;
  if (st.plays > 0) {
    const bestTxt = st.best > 0 ? `, best ${st.bestWord ? `${st.bestWord} for ` : ''}${st.best}` : '';
    bits.push(`${st.plays} ${st.plays === 1 ? 'play' : 'plays'}${bestTxt}${st.bingos ? `, ${st.bingos} ${st.bingos === 1 ? 'bingo' : 'bingos'}` : ''}.`);
  }
  if (st.lostChallenges) bits.push(`Challenges lost: ${st.lostChallenges}.`);
  const rr = s.rerolls?.[r.playerId] ?? 0;
  if (rr) bits.push(`Re-rolls used: ${rr}.`);
  void ctx;
  return bits.join(' ');
}

export function recap(s: ScrabbleState, ctx: BoardContext): { playerId: number; text: string }[] {
  const rows = ranking(s, ctx);
  return rows.map((r) => ({ playerId: r.playerId, text: recapText(r, rows, s, ctx) }));
}

export const def: BoardDef<ScrabbleState> = {
  key: 'scrabble',
  label: 'Scrabble',
  settings: SETTINGS,
  init,
  score,
  placements,
  recap,
};

// ------------------------------------------------------------------ operations

/** Whole number inside lo..hi; NaN reads as lo, so a bad value can never poison a total. */
const clampInt = (v: number, lo: number, hi: number) => (Number.isNaN(v) ? lo : Math.min(hi, Math.max(lo, Math.round(v))));
const known = (ctx: BoardContext, pid: number) => ctx.players.some((x) => x.id === pid);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const stamp = (at: number | null | undefined): number | null => (fin(at) ? at : null);

function push(s: ScrabbleState, e: Omit<Entry, 'id'>): ScrabbleState {
  return { ...s, entries: [...s.entries, { ...e, id: s.nextId }], nextId: s.nextId + 1, redo: [] };
}

/** Two identical entries for the same player this close together are a double tap, not a second action. */
export const DOUBLE_TAP_MS = 1500;
function isDoubleTap(s: ScrabbleState, pid: number, kind: Kind, at: number | null | undefined, same: (e: Entry) => boolean = () => true): boolean {
  const last = s.entries[s.entries.length - 1];
  if (!last || !fin(at) || !fin(last.at)) return false;
  const gap = at - last.at;
  return last.pid === pid && last.kind === kind && gap >= 0 && gap < DOUBLE_TAP_MS && same(last);
}
const blankEntry = (pid: number, kind: Kind, at: number | null | undefined): Omit<Entry, 'id'> => ({ pid, kind, points: 0, bonus: 0, word: '', tiles: 0, turn: true, at: stamp(at) });

const cleanWord = (w: string | undefined): string => (w ?? '').trim().replace(/\s+/g, ' ').slice(0, 30).toUpperCase();

/** One turn's score. `score` is the word score WITHOUT the bingo bonus (the board adds it when `bingo` is set). */
export function addPlay(s: ScrabbleState, ctx: BoardContext, pid: number, score: number, opts: { word?: string; bingo?: boolean; tiles?: number } = {}, at?: number | null): ScrabbleState {
  if (s.over || !known(ctx, pid) || !fin(score)) return s;
  const v = Math.round(score);
  if (v < 1 || v > cfg(ctx.settings, 'turnMax')) return s;
  const rack = cfg(ctx.settings, 'rackSize');
  const bingo = !!opts.bingo;
  const tiles = bingo ? rack : clampInt(opts.tiles ?? cfg(ctx.settings, 'defaultTiles'), 1, rack);
  const word = cleanWord(opts.word);
  if (isDoubleTap(s, pid, 'play', at, (e) => e.points === v && e.word === word)) return s;
  return push(s, { ...blankEntry(pid, 'play', at), points: v, bonus: bingo ? cfg(ctx.settings, 'bingoBonus') : 0, word, tiles });
}

export function addPass(s: ScrabbleState, ctx: BoardContext, pid: number, at?: number | null): ScrabbleState {
  if (s.over || !known(ctx, pid) || isDoubleTap(s, pid, 'pass', at)) return s;
  return push(s, blankEntry(pid, 'pass', at));
}

export function addExchange(s: ScrabbleState, ctx: BoardContext, pid: number, at?: number | null): ScrabbleState {
  if (s.over || !known(ctx, pid) || isDoubleTap(s, pid, 'exchange', at)) return s;
  return push(s, blankEntry(pid, 'exchange', at));
}

/** A failed challenge. Free challenge: nothing to record. Single: lose the penalty points, the turn goes on. Double: lose the turn. */
export function addLostChallenge(s: ScrabbleState, ctx: BoardContext, pid: number, at?: number | null): ScrabbleState {
  if (s.over || !known(ctx, pid) || isDoubleTap(s, pid, 'lostChallenge', at)) return s;
  const rule = cfg(ctx.settings, 'challengeRule');
  if (rule < 1) return s;
  if (rule === 1) {
    const pts = cfg(ctx.settings, 'challengePenalty');
    if (pts <= 0) return s;
    return push(s, { ...blankEntry(pid, 'lostChallenge', at), points: -pts, turn: false });
  }
  return push(s, blankEntry(pid, 'lostChallenge', at));
}

/** The last play was challenged and came off the board: it scores nothing, but the turn is still used. */
export function challengeOff(s: ScrabbleState, ctx: BoardContext): ScrabbleState {
  void ctx;
  if (s.over) return s;
  const last = s.entries[s.entries.length - 1];
  if (!last || last.kind !== 'play') return s;
  const swapped: Entry = { ...last, kind: 'challengedOff', points: 0, bonus: 0, tiles: 0, prev: { points: last.points, bonus: last.bonus, tiles: last.tiles } };
  return { ...s, entries: [...s.entries.slice(0, -1), swapped], redo: [] };
}

/** Points lost outside a turn (overtime, a house penalty). `points` is typed as a positive number. */
export function addPenalty(s: ScrabbleState, ctx: BoardContext, pid: number, points: number, note: string, at?: number | null): ScrabbleState {
  if (s.over || !known(ctx, pid) || !fin(points)) return s;
  const v = clampInt(points, 0, cfg(ctx.settings, 'turnMax'));
  if (v < 1 || isDoubleTap(s, pid, 'penalty', at)) return s;
  return push(s, { ...blankEntry(pid, 'penalty', at), points: -v, word: cleanWord(note), turn: false });
}

/**
 * Takes back the last entry (it can be put back with redoLast). Undoing a "challenged off" puts the original play
 * back instead of deleting it. Not while the game is ended (reopen it first).
 */
export function undoLast(s: ScrabbleState): ScrabbleState {
  if (s.over || !s.entries.length) return s;
  const last = s.entries[s.entries.length - 1]!;
  if (last.kind === 'challengedOff' && last.prev) {
    const { prev, ...rest } = last;
    return { ...s, entries: [...s.entries.slice(0, -1), { ...rest, kind: 'play', points: prev.points, bonus: prev.bonus, tiles: prev.tiles }] };
  }
  return { ...s, entries: s.entries.slice(0, -1), redo: [...(s.redo ?? []), last].slice(-20) };
}

/** The entry an undo would put back (null = nothing to put back). */
export const redoNext = (s: ScrabbleState): Entry | null => (s.over ? null : (s.redo ?? [])[(s.redo ?? []).length - 1] ?? null);

/** Puts back the entry the last undo took away. */
export function redoLast(s: ScrabbleState): ScrabbleState {
  const e = redoNext(s);
  if (!e) return s;
  return { ...s, entries: [...s.entries, e], redo: (s.redo ?? []).slice(0, -1) };
}

/** Who plays first (before anything is entered). The order after them stays the same. */
export function setFirst(s: ScrabbleState, ctx: BoardContext, pid: number): ScrabbleState {
  if (s.entries.length || s.over || !known(ctx, pid)) return s;
  const order = turnOrder(s, ctx);
  const i = order.indexOf(pid);
  if (i <= 0) return order.join() === s.order.join() ? s : { ...s, order };
  return { ...s, order: [...order.slice(i), ...order.slice(0, i)] };
}

/** The GM sets the bag count directly (after counting the bag, or fixing a missed entry). */
export function setBag(s: ScrabbleState, ctx: BoardContext, value: number): ScrabbleState {
  if (!fin(value)) return s;
  const v = clampInt(value, 0, cfg(ctx.settings, 'tilesTotal'));
  if (v === bagCount(s, ctx)) return s;
  return { ...s, bagAdj: v - bagRaw(s, ctx) };
}

/** Largest points the tiles left on one rack can be worth. */
export const rackMax = (ctx: BoardContext): number => cfg(ctx.settings, 'rackSize') * cfg(ctx.settings, 'tileMax');

/** Ends the game on the board: from now on the crown shows the totals. `racks` = points left on each rack. */
export function endGame(s: ScrabbleState, ctx: BoardContext, mode: EndMode, wentOut: number | null, racks: Record<number, number>, at?: number | null): ScrabbleState {
  if (s.over) return s;
  if (mode === 'out' && (wentOut === null || !known(ctx, wentOut))) return s;
  const clean: Record<number, number> = {};
  for (const x of ctx.players) {
    const raw = racks[x.id];
    clean[x.id] = mode === 'time' || (mode === 'out' && x.id === wentOut) || !fin(raw) ? 0 : clampInt(raw, 0, rackMax(ctx));
  }
  return { ...s, over: { at: stamp(at), mode, wentOut: mode === 'out' ? wentOut : null, racks: clean } };
}

/** Takes the ending back (to fix an entry). */
export function reopenGame(s: ScrabbleState): ScrabbleState {
  return s.over ? { ...s, over: null } : s;
}

/** Counts a re-roll after the host has spent the token. */
export function recordReroll(s: ScrabbleState, ctx: BoardContext, pid: number): ScrabbleState {
  if (!known(ctx, pid)) return s;
  const rr = s.rerolls ?? {};
  return { ...s, rerolls: { ...rr, [pid]: (rr[pid] ?? 0) + 1 } };
}

// ------------------------------------------------------------------ turn timer

/** An overtime penalty has already been taken for the turn that is running (so a second tap can't charge it twice). */
export function overtimeApplied(s: ScrabbleState): boolean {
  for (let i = s.entries.length - 1; i >= 0; i--) {
    const e = s.entries[i]!;
    if (e.turn) return false;
    if (e.kind === 'penalty' && e.word === 'OVERTIME') return true;
  }
  return false;
}

export interface TurnClock {
  limitSec: number;
  elapsedSec: number;
  remainingSec: number;
  over: boolean;
  /** Minutes started past the limit. */
  overMinutes: number;
  /** Points the overtime penalty would take now (0 when the penalty is off or not over time). */
  penalty: number;
}

/** The turn timer, from the end of the last turn (or the game start). null when the timer is off or the game has no start. */
export function turnClock(s: ScrabbleState, ctx: BoardContext, now: number): TurnClock | null {
  const limit = cfg(ctx.settings, 'turnSeconds');
  if (limit <= 0 || s.over || !fin(now)) return null;
  const last = lastTurnEntry(s);
  const t = ctx as BoardContext & { startedAt?: number | null };
  const from = last && fin(last.at) ? last.at : fin(t.startedAt) ? t.startedAt : fin(s.startedAt) ? s.startedAt : null;
  if (from === null) return null;
  const elapsedSec = Math.max(0, Math.floor((now - from) / 1000));
  const remainingSec = limit - elapsedSec;
  const over = remainingSec < 0;
  const overMinutes = over ? Math.ceil(-remainingSec / 60) : 0;
  return { limitSec: limit, elapsedSec, remainingSec, over, overMinutes, penalty: over && !overtimeApplied(s) ? overMinutes * cfg(ctx.settings, 'overtimePenalty') : 0 };
}

// ------------------------------------------------------------------ game clock

/** Remembers when the board first opened (only if not already known). The same object comes back if it is. */
export function markStarted(s: ScrabbleState, now: number): ScrabbleState {
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
export function clock(s: ScrabbleState, ctx: BoardContext, now: number): Clock | null {
  const t = ctx as BoardContext & { startedAt?: number | null; endsAt?: number | null };
  const fromHost = fin(t.startedAt);
  const startedAt = fromHost ? (t.startedAt as number) : fin(s.startedAt) ? s.startedAt : null;
  if (startedAt === null) return null;
  const endsAt = fin(t.endsAt) && t.endsAt > startedAt ? t.endsAt : null;
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

/** One history line without the name: "QUIZ for 64 (bingo +50)". */
export function entryText(e: Entry): string {
  const pts = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
  switch (e.kind) {
    case 'play':
      return `${e.word ? `${e.word} for ` : 'scored '}${e.points + e.bonus}${e.bonus ? ` (incl. bingo +${e.bonus})` : ''}`;
    case 'pass':
      return 'passed';
    case 'exchange':
      return 'exchanged tiles';
    case 'challengedOff':
      return `play challenged off${e.word ? ` (${e.word})` : ''}: no score, turn used`;
    case 'lostChallenge':
      return e.turn ? 'lost a challenge: turn skipped' : `lost a challenge ${pts(e.points)}`;
    case 'penalty':
      return `penalty ${pts(e.points)}${e.word ? ` (${e.word})` : ''}`;
  }
}

/** Things the GM should know before opening the result screen. Empty = nothing to warn about. */
export function finishWarnings(s: ScrabbleState, ctx: BoardContext): string[] {
  const out: string[] = [];
  if (!s.entries.length) out.push('No scores have been entered. Everyone will be tied on the result screen.');
  if (!s.over) out.push('The game has not been ended on the board: places use the running totals, with no tiles-left adjustment.');
  else if (s.over.mode === 'time') out.push('The game was stopped early: places use the running totals, with no tiles-left adjustment.');
  const run = scorelessRun(s);
  void ctx;
  if (!s.over && run === 0 && bagCount(s, ctx) > 0 && s.entries.length) out.push(`There are still ${bagCount(s, ctx)} tiles in the bag.`);
  return out;
}
