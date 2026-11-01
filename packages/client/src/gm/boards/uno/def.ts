/**
 * Uno board (classic rules): pure logic (no Svelte, no clock, no storage). Written to board-contract.ts v1.3.
 *
 * Uno is played at the real table with the cards; this board is the GM's score sheet. The game is played in rounds:
 * the player who goes out scores the points left in everyone else's hands, and the first to reach the target wins.
 * The GM enters ONE number per round (who went out, and the points they won), or, if they like, each other player's
 * leftover points (the board adds them up). History of rounds with timestamps and undo / redo.
 *
 * Crown (score):       LIVE. Everyone's points so far (leadMode "high").
 * Result (placements): the first to reach the target wins; everyone else by points; equal points share the place.
 *                      A game that is stopped early ("call time") is ranked by the current points.
 * Re-rolls:            off (no dice).
 * House rules (stacking, 7-0 swaps, jump-in, draw until you can play) are labels for the table only: they never
 * change the score.
 *
 * Every operation returns a NEW state; if nothing would change it returns the SAME object (double taps and a
 * repeated onchange are harmless).
 */
import type { BoardContext, BoardDef, BoardSetting } from '../contract';

/** Every gameplay number. Defaults are the official classic values. */
export const SETTINGS: Record<string, BoardSetting> = {
  target: { label: 'Target: the first player to reach this many points wins (1 = a single hand)', default: 500, min: 1, max: 5000, step: 50 },
  actionValue: { label: 'Card value: Skip, Reverse, Draw Two (used by the per-player breakdown buttons)', default: 20, min: 0, max: 100, step: 5 },
  wildValue: { label: 'Card value: Wild, Wild Draw Four (used by the per-player breakdown buttons)', default: 50, min: 0, max: 100, step: 5 },
  handMax: { label: 'Most points one player can be left holding (limits the per-player breakdown)', default: 300, min: 50, max: 970, step: 10 },
  roundMax: { label: 'Biggest score the board accepts for one round', default: 1000, min: 100, max: 5000, step: 50 },
  bigRound: { label: 'A round score this big or bigger asks "are you sure?" before it is added (typo guard)', default: 200, min: 20, max: 5000, step: 10 },
  stacking: { label: 'House rule on the table: stacking +2 / +4 (1 = on, 0 = off; a label only)', default: 0, min: 0, max: 1 },
  sevenZero: { label: 'House rule on the table: 7-0 swaps (1 = on, 0 = off; a label only)', default: 0, min: 0, max: 1 },
  jumpIn: { label: 'House rule on the table: jump-in (1 = on, 0 = off; a label only)', default: 0, min: 0, max: 1 },
  drawUntilPlay: { label: 'House rule on the table: draw until you can play (1 = on, 0 = off; a label only)', default: 0, min: 0, max: 1 },
};

export const HOUSE_RULES: { key: string; label: string }[] = [
  { key: 'stacking', label: 'Stacking +2 / +4' },
  { key: 'sevenZero', label: '7-0 swaps' },
  { key: 'jumpIn', label: 'Jump-in' },
  { key: 'drawUntilPlay', label: 'Draw until you can play' },
];

/** A setting's current value, falling back to its default. */
export function cfg(settings: Record<string, number> | undefined, key: string): number {
  const v = settings?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (SETTINGS[key]?.default ?? 0);
}

/** The house rules switched on, for the label at the top of the board. */
export function houseRules(settings: Record<string, number> | undefined): string[] {
  return HOUSE_RULES.filter((r) => cfg(settings, r.key) >= 1).map((r) => r.label);
}

// ------------------------------------------------------------------ state

export interface Round {
  id: number;
  /** The player who went out and scored. */
  winner: number;
  /** Points the winner scored this round. */
  points: number;
  /** Points left in each other player's hand, when the GM broke the round down; null = one number only. */
  hands: Record<number, number> | null;
  /** When it was entered (epoch ms), null if unknown. */
  at: number | null;
}

export interface UnoState {
  v: 1;
  /** Seating order (clockwise from the first seat). */
  order: number[];
  rounds: Round[];
  nextId: number;
  /** The game was ended on the board (the clock stops, entries are locked until it is reopened). */
  over: { at: number | null } | null;
  /** Rounds taken back by undo, newest last. Cleared by any new round. */
  redo?: Round[];
  /** When the board first opened (epoch ms); only a fallback if the host gives no start time. */
  startedAt?: number | null;
}

export function init(ctx: BoardContext): UnoState {
  const seated = ctx.players.filter((x) => x.seat !== null).sort((a, b) => a.seat! - b.seat! || a.id - b.id);
  const rest = ctx.players.filter((x) => x.seat === null).sort((a, b) => a.id - b.id);
  return { v: 1, order: [...seated, ...rest].map((x) => x.id), rounds: [], nextId: 1, over: null, redo: [], startedAt: null };
}

/** Seating order for the players in this game now (someone added later goes last). */
export function turnOrder(s: UnoState, ctx: BoardContext): number[] {
  const ids = new Set(ctx.players.map((x) => x.id));
  const out = s.order.filter((id, i) => ids.has(id) && s.order.indexOf(id) === i);
  for (const x of ctx.players) if (!out.includes(x.id)) out.push(x.id);
  return out;
}

// ------------------------------------------------------------------ the numbers

/** A player's points so far. */
export function totalOf(s: UnoState, pid: number): number {
  let t = 0;
  for (const r of s.rounds) if (r.winner === pid) t += r.points;
  return t;
}

export const roundsWon = (s: UnoState, pid: number): number => s.rounds.filter((r) => r.winner === pid).length;

/** Points still needed to reach the target (0 once reached). */
export const toGo = (s: UnoState, ctx: BoardContext, pid: number): number => Math.max(0, cfg(ctx.settings, 'target') - totalOf(s, pid));

/** The first player to reach the target, replaying the rounds in order; null if nobody has. */
export function targetWinner(s: UnoState, ctx: BoardContext): number | null {
  const target = cfg(ctx.settings, 'target');
  const run: Record<number, number> = {};
  for (const r of s.rounds) {
    run[r.winner] = (run[r.winner] ?? 0) + r.points;
    if (run[r.winner]! >= target) return r.winner;
  }
  return null;
}

/** Points left in other players' hands in a round the GM broke down: what that round was worth. */
export const handsTotal = (hands: Record<number, number>): number => Object.values(hands).reduce((a, b) => a + b, 0);

// ------------------------------------------------------------------ ranking, crown, result

export interface Row {
  playerId: number;
  name: string;
  total: number;
  won: number;
  /** Reached the target first. */
  winner: boolean;
  place: number;
  tied: boolean;
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

/** Everyone, best first: the player who reached the target, then everyone else by points. Equal points share the place. */
export function ranking(s: UnoState, ctx: BoardContext): Row[] {
  const tw = targetWinner(s, ctx);
  const base = ctx.players.map((x) => ({ playerId: x.id, name: x.name, total: totalOf(s, x.id), won: roundsWon(s, x.id), winner: x.id === tw }));
  base.sort((a, b) => Number(b.winner) - Number(a.winner) || b.total - a.total || a.playerId - b.playerId);
  return base.map((r) => {
    const better = base.filter((o) => (o.winner && !r.winner) || (o.winner === r.winner && o.total > r.total)).length;
    const same = base.filter((o) => o.winner === r.winner && o.total === r.total).length;
    return { ...r, place: better + 1, tied: same > 1 };
  });
}

/** Live crown: everyone's points so far. */
export function score(s: UnoState, ctx: BoardContext): Record<number, number> {
  const out: Record<number, number> = {};
  for (const x of ctx.players) out[x.id] = totalOf(s, x.id);
  return out;
}

/** Finish order for the result screen: groups of tied players, best first. */
export function placements(s: UnoState, ctx: BoardContext): number[][] {
  const groups: number[][] = [];
  let last: Row | null = null;
  for (const r of ranking(s, ctx)) {
    if (last && last.winner === r.winner && last.total === r.total) groups[groups.length - 1]!.push(r.playerId);
    else groups.push([r.playerId]);
    last = r;
  }
  return groups;
}

// ------------------------------------------------------------------ recap

const first = (n: string) => n.trim().split(/\s+/)[0] || 'Player';

export function recapText(r: Row, rows: Row[], s: UnoState, ctx: BoardContext): string {
  const bits: string[] = [`Uno: you finished ${ordinal(r.place)}${r.tied ? ' (tied)' : ''} with ${r.total} points.`];
  const winners = rows.filter((x) => x.place === 1);
  if (r.place === 1) {
    const others = winners.filter((w) => w.playerId !== r.playerId).map((w) => first(w.name));
    if (others.length) bits.push(`You share the lead with ${others.join(' and ')}.`);
    else bits.push(r.winner ? `You reached ${cfg(ctx.settings, 'target')} points first and won!` : 'You were ahead when the game ended.');
  } else {
    bits.push(`${winners.length > 1 ? 'Leaders' : 'Winner'}: ${winners.map((x) => first(x.name)).join(' and ')} with ${winners[0]!.total} points.`);
  }
  if (r.won > 0) bits.push(`You went out in ${r.won} of ${s.rounds.length} ${s.rounds.length === 1 ? 'round' : 'rounds'}.`);
  else if (s.rounds.length) bits.push(`You did not go out in any of the ${s.rounds.length} ${s.rounds.length === 1 ? 'round' : 'rounds'}.`);
  const best = Math.max(0, ...s.rounds.filter((x) => x.winner === r.playerId).map((x) => x.points));
  if (best > 0) bits.push(`Your best round was ${best}.`);
  return bits.join(' ');
}

export function recap(s: UnoState, ctx: BoardContext): { playerId: number; text: string }[] {
  const rows = ranking(s, ctx);
  return rows.map((r) => ({ playerId: r.playerId, text: recapText(r, rows, s, ctx) }));
}

export const def: BoardDef<UnoState> = {
  key: 'uno',
  label: 'Uno',
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
const wholeIn = (v: unknown, lo: number, hi: number): v is number => fin(v) && Number.isInteger(v) && v >= lo && v <= hi;

/** Two identical rounds this close together are a double tap, not a second round. */
export const DOUBLE_TAP_MS = 1500;

/**
 * One round: `winner` went out and scored `points`. If `hands` is given (the points left in each OTHER player's hand)
 * the round is worth their sum and `points` is ignored. Not once someone has reached the target (undo first).
 */
export function addRound(s: UnoState, ctx: BoardContext, winner: number, points: number, hands?: Record<number, number> | null, at?: number | null): UnoState {
  if (s.over || !known(ctx, winner) || targetWinner(s, ctx) !== null) return s;
  let value = points;
  let clean: Record<number, number> | null = null;
  if (hands) {
    clean = {};
    for (const x of ctx.players) {
      if (x.id === winner) continue;
      const v = hands[x.id] ?? 0;
      if (!wholeIn(v, 0, cfg(ctx.settings, 'handMax'))) return s;
      clean[x.id] = v;
    }
    value = handsTotal(clean);
  }
  if (!wholeIn(value, 0, cfg(ctx.settings, 'roundMax'))) return s;
  const t = stamp(at);
  const last = s.rounds[s.rounds.length - 1];
  if (last && t !== null && last.at !== null && t - last.at >= 0 && t - last.at < DOUBLE_TAP_MS && last.winner === winner && last.points === value) return s;
  return { ...s, rounds: [...s.rounds, { id: s.nextId, winner, points: value, hands: clean, at: t }], nextId: s.nextId + 1, redo: [] };
}

/** Takes back the last round (it can be put back with redoLast). Not while the game is ended (reopen it first). */
export function undoLast(s: UnoState): UnoState {
  if (s.over || !s.rounds.length) return s;
  const last = s.rounds[s.rounds.length - 1]!;
  return { ...s, rounds: s.rounds.slice(0, -1), redo: [...(s.redo ?? []), last].slice(-20) };
}

/** The round an undo would put back (null = nothing to put back). */
export const redoNext = (s: UnoState): Round | null => (s.over ? null : (s.redo ?? [])[(s.redo ?? []).length - 1] ?? null);

export function redoLast(s: UnoState): UnoState {
  const r = redoNext(s);
  if (!r) return s;
  return { ...s, rounds: [...s.rounds, r], redo: (s.redo ?? []).slice(0, -1) };
}

/** Ends the game on the board (also "call time"): the clock stops and entries are locked until it is reopened. */
export function endGame(s: UnoState, at?: number | null): UnoState {
  if (s.over) return s;
  return { ...s, over: { at: stamp(at) } };
}

/** Takes the ending back (to fix an entry). */
export function reopenGame(s: UnoState): UnoState {
  return s.over ? { ...s, over: null } : s;
}

// ------------------------------------------------------------------ game clock

/** Remembers when the board first opened (only if not already known). The same object comes back if it is. */
export function markStarted(s: UnoState, now: number): UnoState {
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
export function clock(s: UnoState, ctx: BoardContext, now: number): Clock | null {
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

/** One history line with the names: "Round 3: Sam went out for 84 (Alex 30, Jo 54)". */
export function roundLine(r: Round, n: number, nameOf: (id: number) => string): string {
  const parts = r.hands ? ` (${Object.entries(r.hands).map(([id, v]) => `${first(nameOf(Number(id)))} ${v}`).join(', ')})` : '';
  return `Round ${n}: ${first(nameOf(r.winner))} went out for ${r.points}${parts}`;
}

/** Things the GM should know before opening the result screen. Empty = nothing to warn about. */
export function finishWarnings(s: UnoState, ctx: BoardContext): string[] {
  const out: string[] = [];
  if (!s.rounds.length) out.push('No rounds have been entered. Everyone will be tied on the result screen.');
  else if (targetWinner(s, ctx) === null) out.push(`Nobody has reached ${cfg(ctx.settings, 'target')} points: places use the points so far.`);
  return out;
}
