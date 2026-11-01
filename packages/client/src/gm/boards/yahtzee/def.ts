/**
 * Yahtzee board (classic rules): pure logic (no Svelte, no clock, no storage). Written to board-contract.ts v1.3.
 *
 * The GM's score sheet. Live tracking is OPTIONAL (setting `tracking`, Tate decided): with it on, the GM fills the
 * 13 boxes per player (smart entry: fixed boxes are one tap, free boxes take a number that is sanity-checked) and
 * the board does every sum. With it off the board asks for nothing during play; the final totals are typed when the
 * game ends (the sheet can still be filled in if someone wants it).
 *
 * State is only the history of entries; every sheet is replayed from it, so undo / redo can never leave a sum out of step.
 *
 * Crown (score):       NO live leader (Tate decided). Everyone reads 0 until the game has been ended on the board, or
 *                      (tracking on) every sheet is full; then the final totals.
 * Result (placements): highest total first; equal totals share the place (no tie-break). A game opened for results
 *                      without being ended on the board is ranked by the running totals ("call time").
 *
 * Every operation returns a NEW state; if nothing would change it returns the SAME object (double taps and a
 * repeated onchange are harmless).
 */
import type { BoardContext, BoardDef, BoardSetting } from '../contract';

/** Every gameplay number. Defaults are the official classic values. */
export const SETTINGS: Record<string, BoardSetting> = {
  tracking: { label: 'Live tracking: fill in the score sheet during play (1 = yes, 0 = no, type only the final totals at the end)', default: 1, min: 0, max: 1 },
  games: { label: 'Games per sitting (several games added up, e.g. 3 for "triple Yahtzee")', default: 1, min: 1, max: 5 },
  dice: { label: 'Number of dice (limits what the upper boxes and the sum boxes accept)', default: 5, min: 3, max: 8 },
  upperBonusAt: { label: 'Upper section bonus: reach this many points in aces to sixes', default: 63, min: 1, max: 200 },
  upperBonus: { label: 'Upper section bonus: points added', default: 35, min: 0, max: 200, step: 5 },
  fullHouse: { label: 'Full house: points', default: 25, min: 1, max: 100, step: 5 },
  smallStraight: { label: 'Small straight: points', default: 30, min: 1, max: 100, step: 5 },
  largeStraight: { label: 'Large straight: points', default: 40, min: 1, max: 100, step: 5 },
  yahtzee: { label: 'Yahtzee (all dice the same): points', default: 50, min: 1, max: 200, step: 5 },
  yahtzeeBonus: { label: 'Yahtzee bonus: points for each extra Yahtzee (after a scored 50)', default: 100, min: 0, max: 500, step: 25 },
  extraYahtzeeMax: { label: 'Most extra Yahtzees the board accepts in one game', default: 12, min: 1, max: 20 },
  threeKindMax: { label: 'Three of a kind: highest score the board accepts', default: 30, min: 10, max: 60 },
  fourKindMax: { label: 'Four of a kind: highest score the board accepts', default: 30, min: 10, max: 60 },
  chanceMax: { label: 'Chance: highest score the board accepts', default: 30, min: 10, max: 60 },
  gameMax: { label: 'Highest total the board accepts for one game when final totals are typed (typo guard)', default: 1600, min: 400, max: 5000, step: 100 },
};

/** A setting's current value, falling back to its default. */
export function cfg(settings: Record<string, number> | undefined, key: string): number {
  const v = settings?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (SETTINGS[key]?.default ?? 0);
}

// ------------------------------------------------------------------ the sheet

export const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const;
export const LOWER = ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'] as const;
export const BOXES = [...UPPER, ...LOWER] as const;
export type BoxKey = (typeof BOXES)[number];

export const BOX_LABEL: Record<BoxKey, string> = {
  ones: 'Aces (ones)',
  twos: 'Twos',
  threes: 'Threes',
  fours: 'Fours',
  fives: 'Fives',
  sixes: 'Sixes',
  threeKind: '3 of a kind',
  fourKind: '4 of a kind',
  fullHouse: 'Full house',
  smallStraight: 'Small straight',
  largeStraight: 'Large straight',
  yahtzee: 'Yahtzee',
  chance: 'Chance',
};

/** The die face each upper box counts. */
export const FACE: Record<(typeof UPPER)[number], number> = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };

export const isUpper = (b: BoxKey): b is (typeof UPPER)[number] => (UPPER as readonly string[]).includes(b);

/** What one box accepts. Fixed: its set value or a scratch (0). Free: 0 (if `zero`) or a number from min to max in steps. */
export type BoxRule = { kind: 'fixed'; value: number } | { kind: 'free'; min: number; max: number; step: number; zero: boolean };

export function boxRule(settings: Record<string, number> | undefined, box: BoxKey): BoxRule {
  const dice = cfg(settings, 'dice');
  if (isUpper(box)) return { kind: 'free', min: FACE[box], max: FACE[box] * dice, step: FACE[box], zero: true };
  switch (box) {
    case 'threeKind':
      return { kind: 'free', min: dice, max: cfg(settings, 'threeKindMax'), step: 1, zero: true };
    case 'fourKind':
      return { kind: 'free', min: dice, max: cfg(settings, 'fourKindMax'), step: 1, zero: true };
    case 'chance':
      return { kind: 'free', min: dice, max: cfg(settings, 'chanceMax'), step: 1, zero: false };
    case 'fullHouse':
      return { kind: 'fixed', value: cfg(settings, 'fullHouse') };
    case 'smallStraight':
      return { kind: 'fixed', value: cfg(settings, 'smallStraight') };
    case 'largeStraight':
      return { kind: 'fixed', value: cfg(settings, 'largeStraight') };
    default:
      return { kind: 'fixed', value: cfg(settings, 'yahtzee') };
  }
}

/** Is `value` a legal entry for this box? (The sanity check behind the smart entry.) */
export function validBox(settings: Record<string, number> | undefined, box: BoxKey, value: number): boolean {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return false;
  const r = boxRule(settings, box);
  if (r.kind === 'fixed') return value === 0 || value === r.value;
  if (value === 0) return r.zero;
  return value >= r.min && value <= r.max && value % r.step === 0;
}

/** Text for the number pad: what a free box accepts. */
export function boxHint(settings: Record<string, number> | undefined, box: BoxKey): string {
  const r = boxRule(settings, box);
  if (r.kind === 'fixed') return `${r.value} or scratch (0)`;
  const step = r.step > 1 ? `, in steps of ${r.step}` : '';
  return `${r.zero ? '0 (scratch) or ' : ''}${r.min} to ${r.max}${step}`;
}

// ------------------------------------------------------------------ state

export type EntryKind = 'box' | 'clear' | 'bonus';

export interface Entry {
  id: number;
  pid: number;
  /** Which game of the sitting (0-based). */
  g: number;
  kind: EntryKind;
  /** The box (box / clear); null for a Yahtzee bonus. */
  box: BoxKey | null;
  /** The box's score (0 = scratch); +1 / −1 for a Yahtzee bonus; 0 for clear. */
  value: number;
  /** When it was entered (epoch ms), null if unknown. */
  at: number | null;
}

export interface Over {
  at: number | null;
  /** Final totals typed by the GM, for the whole sitting. A player missing here is ranked by their sheet. */
  finals: Record<number, number>;
}

export interface YahtzeeState {
  v: 1;
  /** Seating order (clockwise from the first seat); used for "who is next" after an entry. */
  order: number[];
  entries: Entry[];
  nextId: number;
  over: Over | null;
  /** Entries taken back by undo, newest last. Cleared by any new entry. */
  redo?: Entry[];
  rerolls: Record<number, number>;
  /** When the board first opened (epoch ms); only a fallback if the host gives no start time. */
  startedAt?: number | null;
}

export function init(ctx: BoardContext): YahtzeeState {
  const seated = ctx.players.filter((x) => x.seat !== null).sort((a, b) => a.seat! - b.seat! || a.id - b.id);
  const rest = ctx.players.filter((x) => x.seat === null).sort((a, b) => a.id - b.id);
  return { v: 1, order: [...seated, ...rest].map((x) => x.id), entries: [], nextId: 1, over: null, redo: [], rerolls: {}, startedAt: null };
}

/** Seating order for the players in this game now (someone added later goes last). */
export function turnOrder(s: YahtzeeState, ctx: BoardContext): number[] {
  const ids = new Set(ctx.players.map((x) => x.id));
  const out = s.order.filter((id, i) => ids.has(id) && s.order.indexOf(id) === i);
  for (const x of ctx.players) if (!out.includes(x.id)) out.push(x.id);
  return out;
}

/** The player after `pid` in the seating order (the same player if alone). */
export function nextAfter(s: YahtzeeState, ctx: BoardContext, pid: number): number | null {
  const order = turnOrder(s, ctx);
  if (!order.length) return null;
  const i = order.indexOf(pid);
  return order[(i + 1) % order.length] ?? null;
}

/** How many games the sitting has: the setting, or more if entries already exist for later games. */
export function gameCount(s: YahtzeeState, ctx: BoardContext): number {
  let n = cfg(ctx.settings, 'games');
  for (const e of s.entries) n = Math.max(n, e.g + 1);
  return n;
}

// ------------------------------------------------------------------ the numbers

export interface Sheet {
  boxes: Partial<Record<BoxKey, number>>;
  /** Extra Yahtzees recorded (before checking that the Yahtzee box holds a real Yahtzee). */
  extra: number;
}

/** One player's sheet for one game, replayed from the history. */
export function sheetOf(s: YahtzeeState, pid: number, g: number): Sheet {
  const boxes: Partial<Record<BoxKey, number>> = {};
  let extra = 0;
  for (const e of s.entries) {
    if (e.pid !== pid || e.g !== g) continue;
    if (e.kind === 'box' && e.box) boxes[e.box] = e.value;
    else if (e.kind === 'clear' && e.box) delete boxes[e.box];
    else if (e.kind === 'bonus') extra = Math.max(0, extra + e.value);
  }
  return { boxes, extra };
}

export interface SheetTotals {
  filled: number;
  upper: number;
  /** Points still needed for the upper bonus (0 when reached). */
  toBonus: number;
  upperBonus: number;
  lower: number;
  /** Extra Yahtzees that count (only if the Yahtzee box holds a real Yahtzee). */
  extra: number;
  yahtzeeBonus: number;
  total: number;
}

export function totalsOf(settings: Record<string, number> | undefined, sh: Sheet): SheetTotals {
  let upper = 0;
  let lower = 0;
  let filled = 0;
  for (const b of BOXES) {
    const v = sh.boxes[b];
    if (v === undefined) continue;
    filled++;
    if (isUpper(b)) upper += v;
    else lower += v;
  }
  const at = cfg(settings, 'upperBonusAt');
  const upperBonus = upper >= at ? cfg(settings, 'upperBonus') : 0;
  const real = sh.boxes.yahtzee !== undefined && sh.boxes.yahtzee > 0;
  const extra = real ? sh.extra : 0;
  const yahtzeeBonus = extra * cfg(settings, 'yahtzeeBonus');
  return { filled, upper, toBonus: Math.max(0, at - upper), upperBonus, lower, extra, yahtzeeBonus, total: upper + upperBonus + lower + yahtzeeBonus };
}

export const gameTotals = (s: YahtzeeState, ctx: BoardContext, pid: number, g: number): SheetTotals => totalsOf(ctx.settings, sheetOf(s, pid, g));

/** The sheets' running total over every game of the sitting (typed finals not applied). */
export function sheetTotal(s: YahtzeeState, ctx: BoardContext, pid: number): number {
  let t = 0;
  const n = gameCount(s, ctx);
  for (let g = 0; g < n; g++) t += gameTotals(s, ctx, pid, g).total;
  return t;
}

/** The total that counts: the typed final if the game was ended with one, else the sheets. */
export function totalScore(s: YahtzeeState, ctx: BoardContext, pid: number): number {
  const typed = s.over?.finals[pid];
  return typeof typed === 'number' ? typed : sheetTotal(s, ctx, pid);
}

/** Boxes filled over every game of the sitting, and how many there are in all. */
export function progress(s: YahtzeeState, ctx: BoardContext, pid: number): { filled: number; of: number } {
  const n = gameCount(s, ctx);
  let filled = 0;
  for (let g = 0; g < n; g++) filled += gameTotals(s, ctx, pid, g).filled;
  return { filled, of: n * BOXES.length };
}

/** Tracking is on and every box of every sheet is filled. */
export function sheetsFull(s: YahtzeeState, ctx: BoardContext): boolean {
  if (cfg(ctx.settings, 'tracking') < 1 || !ctx.players.length) return false;
  return ctx.players.every((x) => {
    const p = progress(s, ctx, x.id);
    return p.filled >= p.of;
  });
}

// ------------------------------------------------------------------ ranking, crown, result

export interface Row {
  playerId: number;
  name: string;
  total: number;
  place: number;
  tied: boolean;
  /** The total came from a typed final, not the sheets. */
  typed: boolean;
  filled: number;
  of: number;
  upper: number;
  upperBonus: boolean;
  yahtzees: number;
  extra: number;
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

/** Everyone, best first. Equal totals share the place (1, 2, 2, 4). */
export function ranking(s: YahtzeeState, ctx: BoardContext): Row[] {
  const n = gameCount(s, ctx);
  const base = ctx.players.map((x) => {
    let upper = 0;
    let yahtzees = 0;
    let extra = 0;
    let bonuses = 0;
    for (let g = 0; g < n; g++) {
      const t = gameTotals(s, ctx, x.id, g);
      upper += t.upper;
      if (t.upperBonus > 0) bonuses++;
      extra += t.extra;
      if ((sheetOf(s, x.id, g).boxes.yahtzee ?? 0) > 0) yahtzees++;
    }
    const p = progress(s, ctx, x.id);
    return { playerId: x.id, name: x.name, total: totalScore(s, ctx, x.id), typed: typeof s.over?.finals[x.id] === 'number', filled: p.filled, of: p.of, upper, upperBonus: bonuses > 0, yahtzees, extra };
  });
  base.sort((a, b) => b.total - a.total || a.playerId - b.playerId);
  return base.map((r) => {
    const higher = base.filter((o) => o.total > r.total).length;
    const same = base.filter((o) => o.total === r.total).length;
    return { ...r, place: higher + 1, tied: same > 1 };
  });
}

/** No live leader: the crown only sees scores once the game is over (ended on the board, or every sheet full). */
export function score(s: YahtzeeState, ctx: BoardContext): Record<number, number> {
  const out: Record<number, number> = {};
  const live = !!s.over || sheetsFull(s, ctx);
  for (const x of ctx.players) out[x.id] = live ? totalScore(s, ctx, x.id) : 0;
  return out;
}

/** Finish order for the result screen: groups of tied players, best first. */
export function placements(s: YahtzeeState, ctx: BoardContext): number[][] {
  const groups: number[][] = [];
  let lastTotal: number | null = null;
  for (const r of ranking(s, ctx)) {
    if (lastTotal === r.total && groups.length) groups[groups.length - 1]!.push(r.playerId);
    else groups.push([r.playerId]);
    lastTotal = r.total;
  }
  return groups;
}

// ------------------------------------------------------------------ recap

const first = (n: string) => n.trim().split(/\s+/)[0] || 'Player';

export function recapText(r: Row, rows: Row[], s: YahtzeeState, ctx: BoardContext): string {
  const bits: string[] = [`Yahtzee: you finished ${ordinal(r.place)}${r.tied ? ' (tied)' : ''} with ${r.total} points.`];
  const winners = rows.filter((x) => x.place === 1);
  if (r.place === 1) {
    const others = winners.filter((w) => w.playerId !== r.playerId).map((w) => first(w.name));
    bits.push(others.length ? `You share the win with ${others.join(' and ')}.` : 'You won!');
  } else {
    bits.push(`${winners.length > 1 ? 'Winners' : 'Winner'}: ${winners.map((x) => first(x.name)).join(' and ')} with ${winners[0]!.total} points.`);
  }
  if (r.filled > 0 && !r.typed) {
    const n = gameCount(s, ctx);
    const bits2: string[] = [];
    if (r.upperBonus) bits2.push('upper bonus earned');
    if (r.yahtzees > 0) bits2.push(`${r.yahtzees} ${r.yahtzees === 1 ? 'Yahtzee' : 'Yahtzees'}${r.extra ? ` (+${r.extra} extra)` : ''}`);
    if (bits2.length) bits.push(`${bits2.join(', ')}${n > 1 ? ` over ${n} games` : ''}.`);
  }
  const rr = s.rerolls?.[r.playerId] ?? 0;
  if (rr) bits.push(`Re-rolls used: ${rr}.`);
  return bits.join(' ');
}

export function recap(s: YahtzeeState, ctx: BoardContext): { playerId: number; text: string }[] {
  const rows = ranking(s, ctx);
  return rows.map((r) => ({ playerId: r.playerId, text: recapText(r, rows, s, ctx) }));
}

export const def: BoardDef<YahtzeeState> = {
  key: 'yahtzee',
  label: 'Yahtzee',
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
const goodGame = (s: YahtzeeState, ctx: BoardContext, g: number) => Number.isInteger(g) && g >= 0 && g < gameCount(s, ctx);

function push(s: YahtzeeState, e: Omit<Entry, 'id'>): YahtzeeState {
  return { ...s, entries: [...s.entries, { ...e, id: s.nextId }], nextId: s.nextId + 1, redo: [] };
}

/** Two identical bonus taps this close together are a double tap, not a second extra Yahtzee. */
export const DOUBLE_TAP_MS = 1500;

/** Writes one box (a score or a scratch). A filled box can be written again to correct it. */
export function setBox(s: YahtzeeState, ctx: BoardContext, pid: number, g: number, box: BoxKey, value: number, at?: number | null): YahtzeeState {
  if (s.over || !known(ctx, pid) || !goodGame(s, ctx, g) || !BOXES.includes(box) || !validBox(ctx.settings, box, value)) return s;
  const sh = sheetOf(s, pid, g);
  if (sh.boxes[box] === value) return s;
  // the extra Yahtzees only count while the Yahtzee box holds a real Yahtzee: don't pull it away from under them
  if (box === 'yahtzee' && value === 0 && sh.extra > 0) return s;
  return push(s, { pid, g, kind: 'box', box, value, at: stamp(at) });
}

/** Empties a box (for a box entered by mistake). */
export function clearBox(s: YahtzeeState, ctx: BoardContext, pid: number, g: number, box: BoxKey, at?: number | null): YahtzeeState {
  if (s.over || !known(ctx, pid) || !goodGame(s, ctx, g) || !BOXES.includes(box)) return s;
  const sh = sheetOf(s, pid, g);
  if (sh.boxes[box] === undefined) return s;
  if (box === 'yahtzee' && sh.extra > 0) return s;
  return push(s, { pid, g, kind: 'clear', box, value: 0, at: stamp(at) });
}

/** Can this player take an extra-Yahtzee bonus now? (They need a scored Yahtzee, and the limit not reached.) */
export function canBonus(s: YahtzeeState, ctx: BoardContext, pid: number, g: number): boolean {
  if (s.over || !known(ctx, pid) || !goodGame(s, ctx, g)) return false;
  const sh = sheetOf(s, pid, g);
  return (sh.boxes.yahtzee ?? 0) > 0 && sh.extra < cfg(ctx.settings, 'extraYahtzeeMax') && cfg(ctx.settings, 'yahtzeeBonus') > 0;
}

export function addBonus(s: YahtzeeState, ctx: BoardContext, pid: number, g: number, at?: number | null): YahtzeeState {
  if (!canBonus(s, ctx, pid, g)) return s;
  const last = s.entries[s.entries.length - 1];
  const t = stamp(at);
  if (last && last.kind === 'bonus' && last.value === 1 && last.pid === pid && last.g === g && t !== null && last.at !== null && t - last.at >= 0 && t - last.at < DOUBLE_TAP_MS) return s;
  return push(s, { pid, g, kind: 'bonus', box: null, value: 1, at: t });
}

export function removeBonus(s: YahtzeeState, ctx: BoardContext, pid: number, g: number, at?: number | null): YahtzeeState {
  if (s.over || !known(ctx, pid) || !goodGame(s, ctx, g) || sheetOf(s, pid, g).extra < 1) return s;
  return push(s, { pid, g, kind: 'bonus', box: null, value: -1, at: stamp(at) });
}

/** Takes back the last entry (it can be put back with redoLast). Not while the game is ended (reopen it first). */
export function undoLast(s: YahtzeeState): YahtzeeState {
  if (s.over || !s.entries.length) return s;
  const last = s.entries[s.entries.length - 1]!;
  return { ...s, entries: s.entries.slice(0, -1), redo: [...(s.redo ?? []), last].slice(-20) };
}

export const redoNext = (s: YahtzeeState): Entry | null => (s.over ? null : (s.redo ?? [])[(s.redo ?? []).length - 1] ?? null);

export function redoLast(s: YahtzeeState): YahtzeeState {
  const e = redoNext(s);
  if (!e) return s;
  return { ...s, entries: [...s.entries, e], redo: (s.redo ?? []).slice(0, -1) };
}

/** Highest final total one player may be given for the whole sitting. */
export const finalMax = (s: YahtzeeState, ctx: BoardContext): number => cfg(ctx.settings, 'gameMax') * gameCount(s, ctx);

/**
 * Ends the game on the board: from now on the crown shows the totals. `finals` = totals the GM typed (whole
 * sitting); a player without a valid one is ranked by their sheet.
 */
export function endGame(s: YahtzeeState, ctx: BoardContext, finals: Record<number, number>, at?: number | null): YahtzeeState {
  if (s.over) return s;
  const clean: Record<number, number> = {};
  for (const x of ctx.players) {
    const raw = finals[x.id];
    if (fin(raw) && Number.isInteger(raw) && raw >= 0 && raw <= finalMax(s, ctx)) clean[x.id] = raw;
  }
  return { ...s, over: { at: stamp(at), finals: clean } };
}

/** Takes the ending back (to fix an entry). */
export function reopenGame(s: YahtzeeState): YahtzeeState {
  return s.over ? { ...s, over: null } : s;
}

/** Counts a re-roll after the host has spent the token. */
export function recordReroll(s: YahtzeeState, ctx: BoardContext, pid: number): YahtzeeState {
  if (!known(ctx, pid)) return s;
  const rr = s.rerolls ?? {};
  return { ...s, rerolls: { ...rr, [pid]: (rr[pid] ?? 0) + 1 } };
}

// ------------------------------------------------------------------ game clock

/** Remembers when the board first opened (only if not already known). The same object comes back if it is. */
export function markStarted(s: YahtzeeState, now: number): YahtzeeState {
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
export function clock(s: YahtzeeState, ctx: BoardContext, now: number): Clock | null {
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

/** One history line without the name: "Full house 25", "scratched Yahtzee". */
export function entryText(e: Entry, games = 1): string {
  const pre = games > 1 ? `game ${e.g + 1}: ` : '';
  switch (e.kind) {
    case 'box': {
      const label = e.box ? BOX_LABEL[e.box] : 'a box';
      return e.value === 0 ? `${pre}scratched ${label}` : `${pre}${label} ${e.value}`;
    }
    case 'clear':
      return `${pre}cleared ${e.box ? BOX_LABEL[e.box] : 'a box'}`;
    case 'bonus':
      return e.value > 0 ? `${pre}extra Yahtzee (bonus)` : `${pre}extra Yahtzee taken off`;
  }
}

/** Things the GM should know before opening the result screen. Empty = nothing to warn about. */
export function finishWarnings(s: YahtzeeState, ctx: BoardContext): string[] {
  const out: string[] = [];
  const tracking = cfg(ctx.settings, 'tracking') >= 1;
  const typed = s.over ? Object.keys(s.over.finals).length : 0;
  if (!s.entries.length && !typed) out.push('No scores have been entered. Everyone will be tied on the result screen.');
  if (!s.over && !sheetsFull(s, ctx)) out.push('The game has not been ended on the board: places use the running totals from the sheets.');
  if (tracking) {
    const open = ctx.players.filter((x) => {
      const p = progress(s, ctx, x.id);
      return p.filled < p.of && typeof s.over?.finals[x.id] !== 'number';
    });
    if (open.length && s.entries.length) out.push(`${open.length === 1 ? 'One sheet is' : `${open.length} sheets are`} not full: ${open.map((x) => first(x.name)).join(', ')}.`);
  }
  return out;
}
