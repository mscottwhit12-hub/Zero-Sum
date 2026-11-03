/**
 * Texas Hold'em board: pure logic (no Svelte, no clock, no storage). Written to board-contract.ts v1.3.
 *
 * What it tracks: every player's chip stack (the GM keeps it current, or takes a timestamped "count round" where
 * everyone counts at once), buy-ins and rebuys in dollars and chips, who is out and when, the blind clock, an
 * optional dealer button with the small / big blind seats, a chip-count history ("flow of the game") and a typed
 * history of every change.
 *
 * Format (setting `format`): 0 = tournament, 1 = cash game.
 *   Tournament: play until one player has every chip. Latest out places highest; players who bust on the SAME hand
 *               share a place. If the GM calls time early, the players still in are ranked by chips and placed
 *               above everyone already out.
 *   Cash game:  fixed time; "Call time and finish" ranks everyone by chips (equal chips tie).
 * Crown (score): the chip leader. The GM can pin the crown on someone else (`pin`); clearing the pin goes back to chips.
 * Chips vs dollars: the buy-in is tracked in dollars, but nothing here touches gold. Rebuys cost the buy-in and give
 *               `rebuyChips`; the table's chips are checked against all chips bought in (a warning, never a block).
 *
 * Blind clock: the current level is DERIVED from an anchor time (so it keeps running with no one tapping and the TV
 * can compute the same thing). `ackLevels` writes any levels reached since the last look into the history.
 * Every operation takes the time as an argument and returns a NEW state; if nothing would change (or the move isn't
 * allowed) it returns the SAME object, so repeating an operation is harmless. `*Block` helpers give the reason in words.
 */
import type { BoardContext, BoardDef, BoardSetting } from '../contract';
import { MAX_COLOURS, planChips, type ChipColour, type ChipPlan } from './chips';

/** Typed notes are cut to this many characters (a text-box limit, not a gameplay number). */
export const NOTE_MAX = 280;
/** How many blind levels the settings screen has slots for (a layout limit; `blindLevels` says how many are used). */
export const MAX_LEVELS = 8;

/** First blinds are 1/200 of the default 2,000-point stack (a $20 buy-in): 100 big blinds, and the schedule climbs from there. */
const DEFAULT_SB = [10, 20, 30, 40, 60, 80, 120, 160];
const DEFAULT_BB = [20, 40, 60, 80, 120, 160, 240, 320];

/**
 * Every gameplay number, in the order the GM sees them. Labels start with their group:
 * Game, Money and chips, Chip plan, Rebuys, Blinds, Dealer, Reminders, Buttons and limits.
 * Points are the smallest unit the board counts in: with the default 100 points per $1 (or per 1 gold),
 * 1 point is 1 cent, and a $20 buy-in is a 2,000-point stack.
 */
export const SETTINGS: Record<string, BoardSetting> = (() => {
  const s: Record<string, BoardSetting> = {};
  s.format = { label: 'Game: format (0 = tournament, 1 = cash game)', default: 0, min: 0, max: 1 };
  s.currency = { label: 'Money: players put up (0 = real money, cash or Venmo; 1 = gold)', default: 0, min: 0, max: 1 };
  s.requirePayment = { label: 'Money: collect every buy-in before the first hand (1 = yes, 0 = no)', default: 1, min: 0, max: 1 };
  s.buyIn = { label: 'Money: buy-in per player ($ or gold); a rebuy costs the same', default: 20, min: 5, max: 100, step: 5 };
  s.startStack = { label: 'Chips: starting stack (points); should equal the buy-in in points', default: 2000, min: 100, max: 10000000, step: 100 };
  s.pointsPerUnit = { label: 'Chips: points per $1 or per 1 gold (100 = 1 point is a cent)', default: 100, min: 1, max: 1000 };
  s.shareNum = { label: 'Chip plan: share of chips handed to players, top number (1 of 3 = a third)', default: 1, min: 1, max: 100 };
  s.shareDen = { label: 'Chip plan: share of chips handed to players, bottom number (the rest stays in the bank)', default: 3, min: 1, max: 100 };
  s.maxRebuys = { label: 'Rebuys: allowed per player (0 = no rebuys)', default: 3, min: 0, max: 10 };
  s.rebuyChips = { label: 'Rebuys: chips given by one rebuy (points)', default: 2000, min: 100, max: 10000000, step: 100 };
  s.rebuyUntilLevel = { label: 'Rebuys: allowed through blind level', default: 4, min: 1, max: MAX_LEVELS };
  s.levelMinutes = { label: 'Blinds: minutes per level (tournament)', default: 20, min: 1, max: 180 };
  s.blindLevels = { label: 'Blinds: number of levels in use (1 to 8)', default: MAX_LEVELS, min: 1, max: MAX_LEVELS };
  s.antePercent = { label: 'Blinds: ante as % of the big blind (0 = no antes)', default: 0, min: 0, max: 100, step: 5 };
  for (let i = 0; i < MAX_LEVELS; i++) {
    s[`sb${i + 1}`] = { label: `Blinds: level ${i + 1} small blind (points)`, default: DEFAULT_SB[i]!, min: 1, max: 10000000, step: 5 };
    s[`bb${i + 1}`] = { label: `Blinds: level ${i + 1} big blind (points)`, default: DEFAULT_BB[i]!, min: 1, max: 10000000, step: 5 };
  }
  s.trackButton = { label: 'Dealer: track the button and blind seats (1 = yes, 0 = no)', default: 1, min: 0, max: 1 };
  s.headsUpRule = { label: 'Dealer: heads-up, the dealer posts the small blind (1 = yes, 0 = normal rotation)', default: 1, min: 0, max: 1 };
  s.countEveryMinutes = { label: 'Reminders: take a chip count every (minutes)', default: 30, min: 5, max: 240, step: 5 };
  s.stepSmall = { label: 'Buttons: small chip step (points)', default: 100, min: 1, max: 1000000, step: 25 };
  s.stepBig = { label: 'Buttons: big chip step (points)', default: 1000, min: 1, max: 10000000, step: 100 };
  s.chipMax = { label: 'Limits: most chips one player can have (points)', default: 10000000, min: 1000, max: 1000000000, step: 1000 };
  s.mergeSeconds = { label: 'History: merge quick chip taps within (seconds)', default: 5, min: 0, max: 60 };
  s.logMax = { label: 'History: most entries kept', default: 500, min: 50, max: 2000, step: 50 };
  return s;
})();

/** A setting's current value, falling back to its default. */
export function cfg(settings: Record<string, number> | undefined, key: string): number {
  const v = settings?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (SETTINGS[key]?.default ?? 0);
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

export const isCash = (settings: Record<string, number>): boolean => cfg(settings, 'format') >= 1;
export const levelCount = (settings: Record<string, number>): number => clampInt(cfg(settings, 'blindLevels'), 1, MAX_LEVELS);
export const levelMs = (settings: Record<string, number>): number => Math.max(1, cfg(settings, 'levelMinutes')) * 60000;

export interface Blinds {
  sb: number;
  bb: number;
  ante: number;
}

/** The blinds (and ante) of a level, 1-based; levels outside the schedule read as the nearest end. */
export function blindsFor(level: number, settings: Record<string, number>): Blinds {
  const l = clampInt(level, 1, levelCount(settings));
  const bb = cfg(settings, `bb${l}`);
  return { sb: cfg(settings, `sb${l}`), bb, ante: Math.round((bb * cfg(settings, 'antePercent')) / 100) };
}

/** "5,000". */
export const chips = (n: number): string => `${n < 0 ? '-' : ''}${String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
/** "$40". */
export const money = (n: number): string => `${n < 0 ? '-' : ''}$${chips(Math.abs(n))}`;
/** "25/50", or "25/50 (ante 5)". */
export const blindText = (b: Blinds): string => `${chips(b.sb)}/${chips(b.bb)}${b.ante > 0 ? ` (ante ${chips(b.ante)})` : ''}`;
/** "19:05" for a countdown. */
export const clockText = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
};
/** "1h 25m", "45m". */
export const spanText = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
export const ordinal = (n: number): string => {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

// ------------------------------------------------------------------ state

export interface Buy {
  /** Epoch ms of the purchase; null for the first buy-in when the start time wasn't known. */
  t: number | null;
  chips: number;
  dollars: number;
  /** Set when this rebuy brought a player back in, so undoing it puts them out again exactly as they were. */
  revived?: { outAt: number | null; outGroup: number | null; backup: number | null };
}

export interface PokerPlayer {
  /** Current chips (0 once out). */
  stack: number;
  /** The first entry is the starting buy-in; the rest are rebuys. */
  buys: Buy[];
  out: boolean;
  outAt: number | null;
  /** Bust group: same number = busted on the same hand = tied place. Higher = out later. */
  outGroup: number | null;
  /** The stack the player had when marked out, so a mis-tap can be undone. */
  backup: number | null;
  /** Who was given this player's chips when they went out (and how many), so undoing the bust takes them back. */
  wonBy?: number | null;
  wonAmt?: number;
}

export interface Clock {
  /** Level at the anchor (1-based). */
  base: number;
  /** Epoch ms when `base` began; null = the clock hasn't been started. */
  anchor: number | null;
  /** Epoch ms the clock was paused, or null while running. */
  pausedAt: number | null;
  /** Highest level already written to the history / acknowledged by the GM. */
  ackLevel: number;
  /** Level length (ms) this clock is running on; `syncClock` re-times it when the setting changes mid-game. */
  per: number;
}

export interface Snap {
  /** Same id as its history line. */
  id: number;
  t: number;
  /** player id -> chips at that moment (0 for players who are out). */
  stacks: Record<number, number>;
}

export type LogKind = 'note' | 'stack' | 'count' | 'countRemoved' | 'paid' | 'unpaid' | 'plan' | 'bust' | 'tie' | 'restore' | 'rebuy' | 'unrebuy' | 'blinds' | 'clock' | 'pin';

export interface LogEntry {
  id: number;
  /** Epoch ms. */
  t: number;
  kind: LogKind;
  playerId: number | null;
  /** bust: everyone out on the same hand. */
  playerIds?: number[];
  /** tie: the player they were moved in with. */
  withId?: number;
  /** stack: chips before / after. blinds: small / big blind. */
  from?: number | null;
  to?: number | null;
  /** blinds: the level reached. */
  level?: number;
  /** blinds: set by the GM rather than by the clock. */
  manual?: boolean;
  /** count: chips on the table. rebuy: chips bought. */
  amount?: number;
  /** rebuy / paid: dollars (or gold) paid. */
  dollars?: number;
  /** paid: how the money came in. */
  how?: string;
  text?: string;
}

/** What the GM typed into the chip plan (every field optional: blanks fall back to the settings). */
export interface PlanDraft {
  /** Listed lowest value first. */
  colours: ChipColour[];
  players?: number | null;
  buyIn?: number | null;
  /** 0 = real money, 1 = gold. */
  currency?: number | null;
  /** Share of chips handed to players, in percent (10 to 100). */
  sharePercent?: number | null;
}

/** A chip plan that was accepted for this game. Its money settings replace the settings screen's for this game only. */
export interface Applied {
  currency: number;
  buyIn: number;
  startStack: number;
  rebuyChips: number;
  players: number;
  shareNum: number;
  shareDen: number;
  /** What each colour is worth, how many chips there are and how many each player gets. */
  rows: { name: string; value: number; count: number; perPlayer: number }[];
  at: number;
}

/** Money collected from one player so far, in dollars or gold. */
export interface Pay {
  got: number;
  how: 'cash' | 'venmo' | 'gold' | null;
  at: number | null;
}

export interface PokerState {
  v: 1;
  /** The chip plan the GM is working on (before the first hand). */
  plan?: PlanDraft;
  /** The accepted chip plan, if any. */
  applied?: Applied;
  /** Money collected per player. */
  pay?: Record<number, Pay>;
  players: Record<number, PokerPlayer>;
  clock: Clock;
  /** Player holding the dealer button, or null = not set yet. */
  button: number | null;
  /** Dealer and blind seats of the hand being played; they stay put until the next hand is dealt. */
  deal: ButtonInfo | null;
  /** Hands dealt since the button was first set. */
  hand: number;
  /** Player the GM pinned the crown on, or null = the chip leader wears it. */
  pin: number | null;
  /** Chip-count snapshots, oldest first. */
  snaps: Snap[];
  /** Epoch ms the GM last put off a count reminder. */
  remindedAt: number | null;
  log: LogEntry[];
  /** Last used log id. */
  seq: number;
  /** How many bust groups have happened (never goes down, so order stays unique). */
  bustCount: number;
}

/**
 * The settings in force for this game: the settings screen's, except that an accepted chip plan replaces the currency,
 * buy-in, starting stack and rebuy chips for this game only.
 */
export function settingsOf(s: PokerState, ctx: BoardContext): Record<string, number> {
  const a = s.applied;
  return a ? { ...ctx.settings, currency: a.currency, buyIn: a.buyIn, startStack: a.startStack, rebuyChips: a.rebuyChips } : ctx.settings;
}
/** The board context with `settingsOf` applied: read-only code can use it in place of `ctx`. */
export const effectiveCtx = (s: PokerState, ctx: BoardContext): BoardContext => (s.applied ? { ...ctx, settings: settingsOf(s, ctx) } : ctx);

export const isGold = (settings: Record<string, number>): boolean => cfg(settings, 'currency') >= 1;
/** 20 -> "20", 18.5 -> "18.50", 1234.5 -> "1,234.50": whole amounts have no decimals, anything else shows cents. */
const plain = (n: number): string => {
  const r = Math.round(Math.abs(n) * 100) / 100;
  const [i, d] = (Number.isInteger(r) ? String(r) : r.toFixed(2)).split('.');
  return `${n < 0 ? '-' : ''}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${d ? `.${d}` : ''}`;
};
/** An amount of money in the game's currency: "$20", "$18.50" or "20 gold". */
export const units = (n: number, settings: Record<string, number>): string => (isGold(settings) ? `${plain(n)} gold` : `${n < 0 ? '-' : ''}$${plain(Math.abs(n))}`);
/** What chip points are worth in the game's currency: 25 points -> "$0.25" (or "0.25 gold"). */
export const worth = (points: number, settings: Record<string, number>): string => units(points / Math.max(1, cfg(settings, 'pointsPerUnit')), settings);

const blank = (ctx: BoardContext, settings: Record<string, number> = ctx.settings): PokerPlayer => {
  const start = Math.min(cfg(settings, 'startStack'), cfg(settings, 'chipMax'));
  return {
    stack: start,
    buys: [{ t: ctx.startedAt ?? null, chips: start, dollars: cfg(settings, 'buyIn') }],
    out: false,
    outAt: null,
    outGroup: null,
    backup: null,
  };
};

/** A player's record; players the state doesn't know yet read as a fresh buy-in. */
export const pl = (s: PokerState, id: number, ctx: BoardContext): PokerPlayer => s.players[id] ?? blank(ctx, settingsOf(s, ctx));

export function init(ctx: BoardContext): PokerState {
  const players: Record<number, PokerPlayer> = {};
  for (const p of ctx.players) players[p.id] = blank(ctx);
  return {
    v: 1,
    players,
    clock: { base: 1, anchor: ctx.startedAt ?? null, pausedAt: null, ackLevel: 1, per: levelMs(ctx.settings) },
    button: null,
    deal: null,
    hand: 0,
    pin: null,
    snaps: [],
    remindedAt: null,
    log: [],
    seq: 0,
    bustCount: 0,
  };
}

export const boughtChips = (p: PokerPlayer): number => p.buys.reduce((n, b) => n + b.chips, 0);
export const paidDollars = (p: PokerPlayer): number => p.buys.reduce((n, b) => n + b.dollars, 0);
export const rebuysOf = (p: PokerPlayer): number => Math.max(0, p.buys.length - 1);

export interface ChipTotals {
  /** Chips of everyone still in. */
  onTable: number;
  /** Every chip bought in (starting stacks and rebuys, including players now out). */
  boughtIn: number;
  /** onTable - boughtIn; anything but 0 means a count is off or stale. */
  diff: number;
  /** Dollars bought in, all players. */
  dollars: number;
  /** Chips still recorded for players who are no longer in the game (they can't be counted any more). */
  removedChips: number;
}

export function chipTotals(s: PokerState, ctx: BoardContext): ChipTotals {
  let onTable = 0;
  let boughtIn = 0;
  let dollars = 0;
  for (const p of ctx.players) {
    const d = pl(s, p.id, ctx);
    onTable += d.out ? 0 : d.stack;
    boughtIn += boughtChips(d);
    dollars += paidDollars(d);
  }
  const here = new Set(ctx.players.map((p) => p.id));
  let removedChips = 0;
  for (const [id, d] of Object.entries(s.players)) if (!here.has(Number(id)) && !d.out) removedChips += d.stack;
  return { onTable, boughtIn, diff: onTable - boughtIn, dollars, removedChips };
}

/** Crown number: chips. A pinned player (still in) leads regardless of chips. */
export function score(s: PokerState, ctx: BoardContext): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of ctx.players) {
    const d = pl(s, p.id, ctx);
    out[p.id] = d.out ? 0 : d.stack;
  }
  const pin = s.pin;
  if (pin !== null && pin in out && !pl(s, pin, ctx).out) {
    let others = 0;
    for (const p of ctx.players) if (p.id !== pin) others = Math.max(others, out[p.id]!);
    out[pin] = Math.max(out[pin]!, others + 1);
  }
  return out;
}

// ------------------------------------------------------------------ placements and status

function group(ids: number[], same: (a: number, b: number) => boolean): number[][] {
  const out: number[][] = [];
  for (const id of ids) {
    const last = out[out.length - 1];
    if (last && same(last[0]!, id)) last.push(id);
    else out.push([id]);
  }
  return out;
}

export function placements(s: PokerState, ctx: BoardContext): number[][] {
  const ids = [...ctx.players.map((p) => p.id)].sort((a, b) => a - b);
  const d = (id: number) => pl(s, id, ctx);
  const stack = (id: number) => (d(id).out ? 0 : d(id).stack);
  if (isCash(ctx.settings)) {
    return group([...ids].sort((x, y) => stack(y) - stack(x)), (x, y) => stack(x) === stack(y));
  }
  const alive = ids.filter((id) => !d(id).out).sort((x, y) => stack(y) - stack(x));
  const out = group(alive, (x, y) => stack(x) === stack(y));
  const dead = ids.filter((id) => d(id).out).sort((x, y) => (d(y).outGroup ?? 0) - (d(x).outGroup ?? 0));
  out.push(...group(dead, (x, y) => (d(x).outGroup ?? 0) === (d(y).outGroup ?? 0)));
  return out;
}

export interface GameStatus {
  alive: number[];
  /** Tournament only: set when exactly one player is left. */
  winnerId: number | null;
  over: boolean;
}

export function status(s: PokerState, ctx: BoardContext): GameStatus {
  const alive = ctx.players.filter((p) => !pl(s, p.id, ctx).out).map((p) => p.id);
  const winnerId = !isCash(ctx.settings) && ctx.players.length > 1 && alive.length === 1 ? alive[0]! : null;
  return { alive, winnerId, over: winnerId !== null };
}

// ------------------------------------------------------------------ blind clock

export interface ClockInfo {
  started: boolean;
  paused: boolean;
  /** Level in force now (1-based). */
  level: number;
  /** Time left in this level; null in a cash game, on the last level, or before the clock starts. */
  remainingMs: number | null;
  /** True when the clock has moved past the last level the GM looked at. */
  newLevel: boolean;
}

/** The blind level at time `now`, worked out from the clock's anchor. Cash games never move up by themselves. */
export function clockInfo(s: PokerState, ctx: BoardContext, now: number): ClockInfo {
  const count = levelCount(ctx.settings);
  const base = clampInt(s.clock.base, 1, count);
  const a = s.clock.anchor;
  if (a === null) return { started: false, paused: false, level: base, remainingMs: null, newLevel: false };
  const paused = s.clock.pausedAt !== null;
  const ref = paused ? s.clock.pausedAt! : now;
  const per = s.clock.per ?? levelMs(ctx.settings);
  const t = Math.max(0, ref - a);
  const auto = !isCash(ctx.settings);
  const steps = auto ? Math.floor(t / per) : 0;
  const level = Math.min(count, base + steps);
  const remainingMs = auto && level < count ? per - (t - steps * per) : null;
  return { started: true, paused, level, remainingMs, newLevel: level > s.clock.ackLevel };
}

/** Moment the clock reached `level` (only meaningful for levels above the base). */
const reachedAt = (s: PokerState, ctx: BoardContext, level: number): number => (s.clock.anchor ?? 0) + (level - s.clock.base) * (s.clock.per ?? levelMs(ctx.settings));

// ------------------------------------------------------------------ operations

/** Adds any participants the state doesn't know yet (someone added after the game started). */
export function ensure(s: PokerState, ctx: BoardContext): PokerState {
  const missing = ctx.players.filter((p) => !s.players[p.id]);
  if (!missing.length) return s;
  const players = { ...s.players };
  const st = settingsOf(s, ctx);
  for (const p of missing) players[p.id] = blank(ctx, st);
  return { ...s, players };
}

/** Appends a history line. Quick chip taps on the same player within `mergeSeconds` are folded into one line. */
function addLog(s: PokerState, entry: Omit<LogEntry, 'id'>, ctx: BoardContext): PokerState {
  const mergeMs = cfg(ctx.settings, 'mergeSeconds') * 1000;
  const max = Math.max(1, Math.floor(cfg(ctx.settings, 'logMax')));
  const last = s.log[s.log.length - 1];
  if (
    last &&
    entry.kind === 'stack' &&
    last.kind === 'stack' &&
    last.playerId === entry.playerId &&
    last.from != null &&
    entry.to != null &&
    entry.t - last.t <= mergeMs
  ) {
    const merged: LogEntry = { ...last, to: entry.to, t: entry.t };
    const log = merged.to === merged.from ? s.log.slice(0, -1) : [...s.log.slice(0, -1), merged];
    return { ...s, log };
  }
  const id = s.seq + 1;
  const log = [...s.log, { ...entry, id }];
  return { ...s, seq: id, log: log.length > max ? log.slice(log.length - max) : log };
}

const putPlayer = (s: PokerState, pid: number, p: PokerPlayer): PokerState => ({ ...s, players: { ...s.players, [pid]: p } });
const known = (ctx: BoardContext, pid: number) => ctx.players.some((x) => x.id === pid);
const nameIn = (ctx: BoardContext, id: number): string => ctx.players.find((p) => p.id === id)?.name ?? 'Another player';

/** A known player who is still in; null if the operation should do nothing. */
function editable(s: PokerState, ctx: BoardContext, pid: number): { s: PokerState; p: PokerPlayer } | null {
  if (!known(ctx, pid)) return null;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  return p.out ? null : { s: s1, p };
}

/** Sets one player's chips (clamped to 0..chipMax). */
export function setStack(s: PokerState, ctx: BoardContext, pid: number, value: number, now: number): PokerState {
  const e = editable(s, ctx, pid);
  if (!e || !Number.isFinite(value)) return s;
  const v = clampInt(value, 0, cfg(ctx.settings, 'chipMax'));
  if (v === e.p.stack) return e.s;
  return addLog(putPlayer(e.s, pid, { ...e.p, stack: v }), { t: now, kind: 'stack', playerId: pid, from: e.p.stack, to: v }, ctx);
}

/**
 * A count round: everyone counted at once. Sets every listed player still in, then stores a timestamped snapshot of
 * all stacks. Players not listed keep their current chips.
 */
export function recordCount(s: PokerState, ctx: BoardContext, values: Record<number, number>, now: number): PokerState {
  const s1 = ensure(s, ctx);
  const max = cfg(ctx.settings, 'chipMax');
  let players = s1.players;
  const stacks: Record<number, number> = {};
  let total = 0;
  for (const p of ctx.players) {
    const cur = s1.players[p.id]!;
    if (cur.out) {
      stacks[p.id] = 0;
      continue;
    }
    const raw = values[p.id];
    const v = typeof raw === 'number' && Number.isFinite(raw) ? clampInt(raw, 0, max) : cur.stack;
    stacks[p.id] = v;
    total += v;
    if (v !== cur.stack) players = { ...players, [p.id]: { ...cur, stack: v } };
  }
  const last = s1.snaps[s1.snaps.length - 1];
  if (last && last.t === now && ctx.players.every((p) => last.stacks[p.id] === stacks[p.id])) return s;
  const id = s1.seq + 1;
  const keep = Math.max(1, Math.floor(cfg(ctx.settings, 'logMax')));
  const snaps = [...s1.snaps, { id, t: now, stacks }];
  const next = addLog({ ...s1, players, snaps: snaps.length > keep ? snaps.slice(snaps.length - keep) : snaps }, { t: now, kind: 'count', playerId: null, amount: total }, ctx);
  return { ...next, remindedAt: null };
}

/** Why these players can't be marked out (optionally giving their chips to `winnerId`), in words; null = they can. */
export function bustBlock(s: PokerState, ctx: BoardContext, pids: number[], winnerId?: number | null): string | null {
  const ids = [...new Set(pids)];
  if (!ids.length) return 'Pick who is out.';
  for (const id of ids) {
    if (!known(ctx, id)) return 'That player isn\u2019t in this game.';
    if (pl(s, id, ctx).out) return `${nameIn(ctx, id)} is already out.`;
  }
  const left = ctx.players.filter((p) => !pl(s, p.id, ctx).out && !ids.includes(p.id));
  if (!left.length) return 'Someone has to stay in: the winner of the hand still has chips.';
  if (winnerId !== undefined && winnerId !== null) {
    if (ids.includes(winnerId) || !left.some((p) => p.id === winnerId)) return `${nameIn(ctx, winnerId)} can\u2019t take these chips.`;
    const moved = ids.reduce((n, id) => n + pl(s, id, ctx).stack, 0);
    const limit = cfg(settingsOf(s, ctx), 'chipMax');
    if (pl(s, winnerId, ctx).stack + moved > limit) return `${nameIn(ctx, winnerId)} would go over the chip limit (${chips(limit)}).`;
  }
  return null;
}

/**
 * Marks players out. Several ids = they all went out on the same hand and share a place.
 * With `winnerId`, the chips they had go straight to that player (one step instead of two).
 */
export function bust(s: PokerState, ctx: BoardContext, pids: number[], now: number, winnerId?: number | null): PokerState {
  if (bustBlock(s, ctx, pids, winnerId) !== null) return s;
  const ids = [...new Set(pids)];
  const s1 = ensure(s, ctx);
  const grp = s1.bustCount + 1;
  const win = winnerId ?? null;
  let players = s1.players;
  let moved = 0;
  for (const id of ids) {
    const p = s1.players[id]!;
    moved += p.stack;
    players = { ...players, [id]: { ...p, out: true, outAt: now, outGroup: grp, backup: p.stack, stack: 0, ...(win !== null && p.stack > 0 ? { wonBy: win, wonAmt: p.stack } : { wonBy: null, wonAmt: 0 }) } };
  }
  if (win !== null && moved > 0) players = { ...players, [win]: { ...players[win]!, stack: players[win]!.stack + moved } };
  const entry: Omit<LogEntry, 'id'> = { t: now, kind: 'bust', playerId: ids[0]!, playerIds: ids, ...(win !== null && moved > 0 ? { withId: win, amount: moved } : {}) };
  const busted = addLog({ ...s1, players, bustCount: grp }, entry, ctx);
  // A crown pinned on someone who goes out is dropped, so it can't jump back to them after a rebuy.
  return busted.pin !== null && ids.includes(busted.pin) ? addLog({ ...busted, pin: null }, { t: now, kind: 'pin', playerId: null }, ctx) : busted;
}

/** Moves an out player into another out player's bust group (they went out on the same hand). */
export function mergeBust(s: PokerState, ctx: BoardContext, pid: number, withId: number, now: number): PokerState {
  if (pid === withId || !known(ctx, pid) || !known(ctx, withId)) return s;
  const s1 = ensure(s, ctx);
  const a = s1.players[pid]!;
  const b = s1.players[withId]!;
  if (!a.out || !b.out || a.outGroup === b.outGroup) return s;
  return addLog(putPlayer(s1, pid, { ...a, outGroup: b.outGroup }), { t: now, kind: 'tie', playerId: pid, withId }, ctx);
}

/** Undoes a bust-out (a mis-tap): the player is back in with the chips they had. */
export function restore(s: PokerState, ctx: BoardContext, pid: number, now: number): PokerState {
  if (!known(ctx, pid)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  if (!p.out) return s1;
  let next = putPlayer(s1, pid, { ...p, out: false, outAt: null, outGroup: null, stack: p.backup ?? 0, backup: null, wonBy: null, wonAmt: 0 });
  const w = p.wonBy != null ? next.players[p.wonBy] : undefined;
  if (w && !w.out && p.wonAmt) next = putPlayer(next, p.wonBy!, { ...w, stack: Math.max(0, w.stack - p.wonAmt) });
  return addLog(next, { t: now, kind: 'restore', playerId: pid }, ctx);
}

/** Why a rebuy isn't allowed right now, in words; null = it is. */
export function rebuyBlock(s: PokerState, ctx: BoardContext, pid: number, now: number): string | null {
  if (!known(ctx, pid)) return 'That player isn\u2019t in this game.';
  const st = settingsOf(s, ctx);
  const max = Math.floor(cfg(st, 'maxRebuys'));
  if (max <= 0) return 'Rebuys are off (the rebuy limit is 0).';
  const d = pl(s, pid, ctx);
  if (rebuysOf(d) >= max) return `${nameIn(ctx, pid)} has used all ${max} rebuy${max === 1 ? '' : 's'}.`;
  const until = Math.floor(cfg(ctx.settings, 'rebuyUntilLevel'));
  if (clockInfo(s, ctx, now).level > until) return `Rebuys closed after blind level ${until}.`;
  const limit = cfg(st, 'chipMax');
  if ((d.out ? 0 : d.stack) + cfg(st, 'rebuyChips') > limit) return `A rebuy would put ${nameIn(ctx, pid)} over the chip limit (${chips(limit)}).`;
  return null;
}

/** A rebuy: costs the buy-in, adds `rebuyChips`. A player who is out comes back in (their place isn't affected). */
export function rebuy(s: PokerState, ctx: BoardContext, pid: number, now: number): PokerState {
  if (rebuyBlock(s, ctx, pid, now) !== null) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  const st = settingsOf(s, ctx);
  const add = cfg(st, 'rebuyChips');
  const dollars = cfg(st, 'buyIn');
  const buy: Buy = { t: now, chips: add, dollars, ...(p.out ? { revived: { outAt: p.outAt, outGroup: p.outGroup, backup: p.backup } } : {}) };
  const next: PokerPlayer = p.out
    ? { ...p, out: false, outAt: null, outGroup: null, backup: null, stack: add, buys: [...p.buys, buy] }
    : { ...p, stack: Math.min(cfg(st, 'chipMax'), p.stack + add), buys: [...p.buys, buy] };
  return addLog(putPlayer(s1, pid, next), { t: now, kind: 'rebuy', playerId: pid, amount: add, dollars }, ctx);
}

/** Undoes a player's latest rebuy (a mis-tap). Never touches the starting buy-in. */
export function undoRebuy(s: PokerState, ctx: BoardContext, pid: number, now: number): PokerState {
  if (!known(ctx, pid)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  if (p.buys.length < 2) return s1;
  const last = p.buys[p.buys.length - 1]!;
  const buys = p.buys.slice(0, -1);
  const next: PokerPlayer = last.revived
    ? { ...p, buys, out: true, outAt: last.revived.outAt, outGroup: last.revived.outGroup, backup: last.revived.backup, stack: 0 }
    : { ...p, buys, stack: Math.max(0, p.stack - last.chips) };
  return addLog(putPlayer(s1, pid, next), { t: now, kind: 'unrebuy', playerId: pid, amount: last.chips, dollars: last.dollars }, ctx);
}

// ---- dealer button

/** Seats clockwise (seat 1 first); players without a seat come last, by id. */
export function seatOrder(ctx: BoardContext): BoardContext['players'] {
  const seated = ctx.players.filter((p) => p.seat !== null).sort((a, b) => a.seat! - b.seat! || a.id - b.id);
  const rest = ctx.players.filter((p) => p.seat === null).sort((a, b) => a.id - b.id);
  return [...seated, ...rest];
}

/** The next player still in, going clockwise from `from` (who may be out or unknown). */
function nextAliveAfter(s: PokerState, ctx: BoardContext, from: number): number | null {
  const order = seatOrder(ctx).map((p) => p.id);
  const i = order.indexOf(from);
  for (let k = 1; k <= order.length; k++) {
    const id = order[(i + k) % order.length]!;
    if (!pl(s, id, ctx).out) return id;
  }
  return null;
}

export interface ButtonInfo {
  dealer: number;
  sb: number;
  bb: number;
  headsUp: boolean;
}

/**
 * Dealer and blinds for a hand dealt with `dealer` on the button, given who is still in.
 * Heads-up: with the rule on, the dealer posts the small blind. null = fewer than 2 players left.
 */
function dealFor(s: PokerState, ctx: BoardContext, dealer: number): ButtonInfo | null {
  const alive = ctx.players.filter((p) => !pl(s, p.id, ctx).out).map((p) => p.id);
  if (alive.length < 2 || !alive.includes(dealer)) return null;
  const other = nextAliveAfter(s, ctx, dealer);
  if (other === null) return null;
  if (alive.length === 2) {
    return cfg(ctx.settings, 'headsUpRule') >= 1 ? { dealer, sb: dealer, bb: other, headsUp: true } : { dealer, sb: other, bb: dealer, headsUp: true };
  }
  const bb = nextAliveAfter(s, ctx, other);
  return bb === null ? null : { dealer, sb: other, bb, headsUp: false };
}

/**
 * Dealer, small blind and big blind of the hand being played. They are fixed when the hand is dealt (`nextHand`,
 * `setButton`), so a bust-out afterwards doesn't re-label the hand just played. null = not set yet.
 */
export function buttonInfo(s: PokerState, _ctx?: BoardContext): ButtonInfo | null {
  return s.deal;
}

const sameDeal = (a: ButtonInfo | null, b: ButtonInfo | null) => (a === null || b === null ? a === b : a.dealer === b.dealer && a.sb === b.sb && a.bb === b.bb && a.headsUp === b.headsUp);

/** Puts the button on a player still in (the first hand, or a correction). */
export function setButton(s: PokerState, ctx: BoardContext, pid: number): PokerState {
  const e = editable(s, ctx, pid);
  if (!e || (e.s.button === null && dealBlock(e.s, ctx) !== null)) return s;
  const deal = dealFor(e.s, ctx, pid);
  if (e.s.button === pid && e.s.hand >= 1 && sameDeal(e.s.deal, deal)) return e.s;
  return { ...e.s, button: pid, deal, hand: Math.max(1, e.s.hand) };
}

/**
 * Next hand: the button moves one seat clockwise from the last dealer (even if that player has since gone out),
 * skipping players who are out. The first call puts it on the first seat.
 */
export function nextHand(s: PokerState, ctx: BoardContext): PokerState {
  const s1 = ensure(s, ctx);
  if (s1.button === null && dealBlock(s1, ctx) !== null) return s;
  const alive = ctx.players.filter((p) => !pl(s1, p.id, ctx).out);
  if (alive.length < 2) return s;
  const dealer = s1.button === null ? (seatOrder(ctx).find((p) => !pl(s1, p.id, ctx).out)?.id ?? null) : nextAliveAfter(s1, ctx, s1.deal?.dealer ?? s1.button);
  if (dealer === null) return s;
  return { ...s1, button: dealer, deal: dealFor(s1, ctx, dealer), hand: s1.button === null ? 1 : s1.hand + 1 };
}

// ---- crown, notes

/** Pins the crown on a player still in, or clears the pin (null). */
export function setPin(s: PokerState, ctx: BoardContext, pid: number | null, now: number): PokerState {
  if (pid === null) return s.pin === null ? s : addLog({ ...s, pin: null }, { t: now, kind: 'pin', playerId: null }, ctx);
  const e = editable(s, ctx, pid);
  if (!e || e.s.pin === pid) return e ? e.s : s;
  return addLog({ ...e.s, pin: pid }, { t: now, kind: 'pin', playerId: pid }, ctx);
}

/** A typed note in the history, optionally about one player. Empty notes are ignored. */
export function addNote(s: PokerState, ctx: BoardContext, text: string, playerId: number | null, now: number): PokerState {
  const clean = text.trim().slice(0, NOTE_MAX);
  if (!clean) return s;
  const pid = playerId !== null && known(ctx, playerId) ? playerId : null;
  return addLog(ensure(s, ctx), { t: now, kind: 'note', playerId: pid, text: clean }, ctx);
}

// ---- blind clock operations

/** Writes the levels the clock moved through since the GM last looked into the history (with the times they began). */
export function ackLevels(s: PokerState, ctx: BoardContext, now: number): PokerState {
  const info = clockInfo(s, ctx, now);
  if (!info.newLevel) return s;
  let cur = s;
  for (let l = s.clock.ackLevel + 1; l <= info.level; l++) {
    const b = blindsFor(l, ctx.settings);
    cur = addLog(cur, { t: reachedAt(s, ctx, l), kind: 'blinds', playerId: null, level: l, from: b.sb, to: b.bb }, ctx);
  }
  return { ...cur, clock: { ...cur.clock, ackLevel: info.level } };
}

/** Starts the blind clock at level 1 (does nothing if it already runs). */
export function startClock(s: PokerState, ctx: BoardContext, now: number): PokerState {
  if (s.clock.anchor !== null) return s;
  const base = clampInt(s.clock.base, 1, levelCount(ctx.settings));
  return addLog({ ...s, clock: { base, anchor: now, pausedAt: null, ackLevel: base, per: levelMs(ctx.settings) } }, { t: now, kind: 'clock', playerId: null, text: 'Blind clock started' }, ctx);
}

export function pauseClock(s: PokerState, ctx: BoardContext, now: number): PokerState {
  if (s.clock.anchor === null || s.clock.pausedAt !== null) return s;
  const s1 = ackLevels(s, ctx, now);
  return addLog({ ...s1, clock: { ...s1.clock, pausedAt: now } }, { t: now, kind: 'clock', playerId: null, text: 'Blind clock paused' }, ctx);
}

export function resumeClock(s: PokerState, ctx: BoardContext, now: number): PokerState {
  if (s.clock.anchor === null || s.clock.pausedAt === null) return s;
  const gap = Math.max(0, now - s.clock.pausedAt);
  return addLog({ ...s, clock: { ...s.clock, anchor: s.clock.anchor + gap, pausedAt: null } }, { t: now, kind: 'clock', playerId: null, text: 'Blind clock resumed' }, ctx);
}

/** The GM sets the blind level by hand (blinds up early, or a correction). The level starts fresh from `now`. */
export function setLevel(s: PokerState, ctx: BoardContext, level: number, now: number): PokerState {
  const target = clampInt(level, 1, levelCount(ctx.settings));
  const s1 = ackLevels(s, ctx, now);
  if (clockInfo(s1, ctx, now).level === target) return s1;
  const b = blindsFor(target, ctx.settings);
  const c = s1.clock;
  const clock: Clock = { base: target, anchor: c.anchor === null ? null : now, pausedAt: c.pausedAt === null ? null : now, ackLevel: target, per: levelMs(ctx.settings) };
  return addLog({ ...s1, clock }, { t: now, kind: 'blinds', playerId: null, level: target, from: b.sb, to: b.bb, manual: true }, ctx);
}

// ---- count reminder

/** When the next chip-count reminder is due: every `countEveryMinutes` after the last count (or the start of the game). */
export function countDue(s: PokerState, ctx: BoardContext, now: number): { due: boolean; dueAt: number | null } {
  const cands = [s.snaps[s.snaps.length - 1]?.t ?? null, s.remindedAt, ctx.startedAt ?? s.clock.anchor].filter((x): x is number => x !== null);
  if (!cands.length) return { due: false, dueAt: null };
  const dueAt = Math.max(...cands) + cfg(ctx.settings, 'countEveryMinutes') * 60000;
  const quiet = status(s, ctx).over || s.clock.pausedAt !== null;
  return { due: !quiet && now >= dueAt, dueAt };
}

/** "Later": puts the reminder off for another full interval. */
export function snoozeCount(s: PokerState, now: number): PokerState {
  return s.remindedAt === now ? s : { ...s, remindedAt: now };
}

// ------------------------------------------------------------------ checks, parsing, housekeeping

/** Reads typed chips: "5000", "5,000", "5 000", "5k", "1.5k". Anything else (hex, exponent, negative, decimals) is null. */
export function parseChips(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(k?)$/.exec(text.trim().toLowerCase().replace(/[,\s]/g, ''));
  if (!m) return null;
  const k = m[2] === 'k';
  if (m[1]!.includes('.') && !k) return null;
  const n = Number(m[1]) * (k ? 1000 : 1);
  return Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-6 ? Math.round(n) : null;
}

/** Players still in with 0 chips: they can't win a pot, so the GM probably forgot to mark them out. */
export function zeroChipAlive(s: PokerState, ctx: BoardContext): number[] {
  return ctx.players.filter((p) => !pl(s, p.id, ctx).out && pl(s, p.id, ctx).stack <= 0).map((p) => p.id);
}

/** Problems with the blind schedule in the settings (checked per level in use), in words. */
export function blindProblems(settings: Record<string, number>): string[] {
  const out: string[] = [];
  for (let l = 1; l <= levelCount(settings); l++) {
    const b = blindsFor(l, settings);
    if (b.sb > b.bb) out.push(`Level ${l}: the small blind is higher than the big blind.`);
    if (l > 1) {
      const a = blindsFor(l - 1, settings);
      if (b.sb < a.sb || b.bb < a.bb) out.push(`Level ${l}: the blinds go down from level ${l - 1}.`);
    }
  }
  return out;
}

/** Adds players who joined after the start, with a history line (they are bought in at the usual buy-in). */
export function syncPlayers(s: PokerState, ctx: BoardContext, now: number): PokerState {
  const missing = ctx.players.filter((p) => !s.players[p.id]);
  if (!missing.length) return s;
  let cur = ensure(s, ctx);
  for (const p of missing) {
    const d = cur.players[p.id]!;
    cur = addLog(cur, { t: now, kind: 'note', playerId: p.id, text: `joined the game: bought in ${units(paidDollars(d), settingsOf(cur, ctx))} for ${chips(d.stack)} chips` }, ctx);
  }
  return cur;
}

/**
 * Keeps the blind clock honest when settings change mid-game: the running level keeps its time-so-far but takes the
 * new level length from now on (levels reached under the old length are written to the history first), and a level
 * count that shrank below the running level is brought back in range.
 */
export function syncClock(s: PokerState, ctx: BoardContext, now: number): PokerState {
  const c = s.clock;
  const count = levelCount(ctx.settings);
  const per = levelMs(ctx.settings);
  if (c.anchor === null) {
    const base = clampInt(c.base, 1, count);
    const ack = Math.min(c.ackLevel, base);
    return base === c.base && ack === c.ackLevel && c.per === per ? s : { ...s, clock: { ...c, base, ackLevel: ack, per } };
  }
  const old = c.per ?? per;
  if (old === per && c.base <= count && c.ackLevel <= count) return s;
  const s1 = ackLevels(s, ctx, now);
  const info = clockInfo(s1, ctx, now);
  const ref = s1.clock.pausedAt ?? now;
  const t = Math.max(0, ref - (s1.clock.anchor ?? ref));
  const elapsed = isCash(ctx.settings) ? 0 : t - Math.floor(t / old) * old;
  const keep = Math.min(Math.max(0, elapsed), per - 1);
  const next: PokerState = { ...s1, clock: { base: info.level, anchor: ref - keep, pausedAt: s1.clock.pausedAt, ackLevel: info.level, per } };
  return old === per ? next : addLog(next, { t: now, kind: 'clock', playerId: null, text: `Blind level length is now ${Math.round(per / 60000)} min` }, ctx);
}

/** Removes a saved chip count (a wrong count). Stacks stay as they are; the history keeps a line saying one was removed. */
export function removeCount(s: PokerState, ctx: BoardContext, id: number, now: number): PokerState {
  if (!s.snaps.some((x) => x.id === id)) return s;
  return addLog({ ...s, snaps: s.snaps.filter((x) => x.id !== id) }, { t: now, kind: 'countRemoved', playerId: null }, ctx);
}

/** Deletes a typed note from the history (only notes; the record of what happened stays). */
export function removeNote(s: PokerState, id: number): PokerState {
  return s.log.some((e) => e.id === id && e.kind === 'note') ? { ...s, log: s.log.filter((e) => e.id !== id) } : s;
}

// ------------------------------------------------------------------ history text

export function describeEntry(e: LogEntry, nameOf: (id: number) => string, settings?: Record<string, number>): string {
  const who = e.playerId === null ? '' : nameOf(e.playerId);
  const pay = (n: number) => (settings ? units(n, settings) : money(n));
  switch (e.kind) {
    case 'note':
      return e.playerId === null || (e.text ?? '').toLowerCase().includes(who.toLowerCase()) ? (e.text ?? '') : `${who}: ${e.text ?? ''}`;
    case 'stack':
      return `${who}: chips ${chips(e.from ?? 0)} \u2192 ${chips(e.to ?? 0)}`;
    case 'count':
      return `Chip count taken (${chips(e.amount ?? 0)} chips on the table)`;
    case 'countRemoved':
      return 'A saved chip count was removed';
    case 'bust': {
      const ids = e.playerIds ?? (e.playerId === null ? [] : [e.playerId]);
      return (ids.length > 1 ? `${ids.map(nameOf).join(' and ')} went out on the same hand` : `${who} is out`) + (e.withId !== undefined && e.amount ? `; ${nameOf(e.withId)} took ${chips(e.amount)} chips` : '');
    }
    case 'tie':
      return `${who} went out on the same hand as ${e.withId === undefined ? 'another player' : nameOf(e.withId)}`;
    case 'restore':
      return `${who} is back in (bust-out undone)`;
    case 'rebuy':
      return `${who} rebought ${chips(e.amount ?? 0)} chips for ${pay(e.dollars ?? 0)}`;
    case 'paid':
      return `${who} paid ${pay(e.dollars ?? 0)}${e.how ? ` (${e.how})` : ''}`;
    case 'unpaid':
      return `${who}\u2019s payment of ${pay(e.dollars ?? 0)} was cleared`;
    case 'plan':
      return e.text ?? 'Chip plan set';
    case 'unrebuy':
      return `${who}'s last rebuy was undone`;
    case 'blinds':
      return `${e.manual ? 'Blinds set to' : 'Blinds up to'} level ${e.level ?? 1}: ${chips(e.from ?? 0)}/${chips(e.to ?? 0)}`;
    case 'clock':
      return e.text ?? 'Blind clock';
    case 'pin':
      return e.playerId === null ? 'Crown pin removed (the chip leader wears it)' : `Crown pinned on ${who}`;
  }
}

// ------------------------------------------------------------------ recap

export interface RecapRow {
  playerId: number;
  name: string;
  /** 1-based; tied players share a place. */
  place: number;
  tied: boolean;
  stack: number;
  out: boolean;
  /** Tournament winner (last one standing). */
  winner: boolean;
  /** Time into the game when they went out; null if not out or the start time is unknown. */
  outAfterMs: number | null;
  rebuys: number;
  dollars: number;
  /** Chips over the night: starting stack, each count, final. */
  trail: number[];
  peak: number;
  /** Time into the game of the biggest stack; null if unknown. */
  peakAfterMs: number | null;
  /** Dollars or gold put in (buy-in plus rebuys). */
  invested: number;
  /** Dollars or gold the player's chips are worth at the end (0 for players who are out). */
  cashOut: number;
}

/** One row per player, best first. */
export function recap(s: PokerState, ctx: BoardContext): RecapRow[] {
  const start = ctx.startedAt ?? null;
  const over = status(s, ctx).over;
  const rows: RecapRow[] = [];
  let place = 1;
  for (const g of placements(s, ctx)) {
    for (const id of g) {
      const d = pl(s, id, ctx);
      const points: { v: number; t: number | null }[] = [{ v: d.buys[0]?.chips ?? 0, t: start === null ? null : 0 }];
      for (const sn of s.snaps) if (id in sn.stacks) points.push({ v: sn.stacks[id]!, t: start === null ? null : sn.t - start });
      points.push({ v: d.out ? 0 : d.stack, t: null });
      let best = points[0]!;
      for (const pt of points) if (pt.v > best.v) best = pt;
      rows.push({
        playerId: id,
        name: nameIn(ctx, id),
        place,
        tied: g.length > 1,
        stack: d.out ? 0 : d.stack,
        out: d.out,
        winner: over && !d.out,
        outAfterMs: d.out && d.outAt !== null && start !== null ? Math.max(0, d.outAt - start) : null,
        rebuys: rebuysOf(d),
        dollars: paidDollars(d),
        trail: points.map((pt) => pt.v),
        peak: best.v,
        peakAfterMs: best.t,
        invested: paidDollars(d),
        cashOut: Math.round(((d.out ? 0 : d.stack) / Math.max(1, cfg(settingsOf(s, ctx), 'pointsPerUnit'))) * 100) / 100,
      });
    }
    place += g.length;
  }
  return rows;
}

/** The recap as plain text for one player (a private phone message). */
export function recapText(r: RecapRow, cash: boolean, settings?: Record<string, number>): string {
  const lines = [`Texas Hold'em recap for ${r.name}: ${ordinal(r.place)} place${r.tied ? ' (tied)' : ''}.`];
  if (cash) lines.push(`Finished with ${chips(r.stack)} chips.`);
  else if (r.out) lines.push(`Went out${r.outAfterMs !== null ? ` after ${spanText(r.outAfterMs)}` : ''}.`);
  else if (r.winner) lines.push(`Last one standing with ${chips(r.stack)} chips.`);
  else lines.push(`Still in with ${chips(r.stack)} chips when time was called.`);
  lines.push(`Bought in for ${settings ? units(r.dollars, settings) : money(r.dollars)}${r.rebuys ? ` (${r.rebuys} rebuy${r.rebuys === 1 ? '' : 's'})` : ''}.`);
  if (settings && cfg(settings, 'requirePayment') >= 1) lines.push(`Cash-out: ${units(r.cashOut, settings)} for your chips (you put in ${units(r.invested, settings)}).`);
  if (r.trail.length >= 3) lines.push(`Your chips through the night: ${r.trail.slice(-8).map(chips).join(' \u2192 ')}.`);
  if (r.peak > r.stack && r.peak > (r.trail[0] ?? 0) && r.trail.length >= 3) lines.push(`Biggest stack: ${chips(r.peak)} chips${r.peakAfterMs !== null ? ` (${spanText(r.peakAfterMs)} in)` : ''}.`);
  return lines.join('\n');
}

export const def: BoardDef<PokerState> = {
  key: 'poker',
  label: "Texas Hold'em",
  settings: SETTINGS,
  init,
  score,
  placements,
  recap: (s, ctx) => recap(s, ctx).map((r) => ({ playerId: r.playerId, text: recapText(r, isCash(ctx.settings), settingsOf(s, ctx)) })),
};

// ------------------------------------------------------------------ money collected

export interface PayRow {
  playerId: number;
  /** Everything this player has bought in for so far (buy-in plus rebuys), in dollars or gold. */
  owed: number;
  got: number;
  /** owed - got, never below 0. */
  short: number;
  how: Pay['how'];
  at: number | null;
}

export interface PayInfo {
  rows: PayRow[];
  owed: number;
  got: number;
  /** Still to collect, including rebuys. */
  toCollect: number;
  /** Players who haven't paid their starting buy-in (these block the first hand). */
  startersShort: number[];
}

const EPS = 1e-9;

/** What every player owes, has paid and still owes. */
export function payInfo(s: PokerState, ctx: BoardContext): PayInfo {
  const rows: PayRow[] = ctx.players.map((p) => {
    const d = pl(s, p.id, ctx);
    const owed = paidDollars(d);
    const rec = s.pay?.[p.id];
    const got = rec?.got ?? 0;
    return { playerId: p.id, owed, got, short: Math.max(0, owed - got), how: rec?.how ?? null, at: rec?.at ?? null };
  });
  const startersShort = ctx.players.filter((p) => (s.pay?.[p.id]?.got ?? 0) + EPS < (pl(s, p.id, ctx).buys[0]?.dollars ?? 0)).map((p) => p.id);
  return { rows, owed: rows.reduce((n, r) => n + r.owed, 0), got: rows.reduce((n, r) => n + Math.min(r.got, r.owed), 0), toCollect: rows.reduce((n, r) => n + r.short, 0), startersShort };
}

/** Why the first hand can't be dealt yet (buy-ins not all in), in words; null = it can. */
export function dealBlock(s: PokerState, ctx: BoardContext): string | null {
  if (s.button !== null || cfg(settingsOf(s, ctx), 'requirePayment') < 1) return null;
  const short = payInfo(s, ctx).startersShort;
  if (!short.length) return null;
  return short.length <= 3 ? `Collect the buy-in from ${short.map((id) => nameIn(ctx, id)).join(', ')} first.` : `Collect ${short.length} more buy-ins first.`;
}

/** The ways money can come in: real money by cash or Venmo, or gold held for the game. */
export const payMethods = (settings: Record<string, number>): ('cash' | 'venmo' | 'gold')[] => (isGold(settings) ? ['gold'] : ['cash', 'venmo']);

/** The GM (or sub-GM) records that a player's money is in: everything they owe so far (buy-in plus any rebuys). */
export function recordPayment(s: PokerState, ctx: BoardContext, pid: number, how: 'cash' | 'venmo' | 'gold', now: number): PokerState {
  if (!known(ctx, pid) || !payMethods(settingsOf(s, ctx)).includes(how)) return s;
  const s1 = ensure(s, ctx);
  const owed = paidDollars(s1.players[pid]!);
  const got = s1.pay?.[pid]?.got ?? 0;
  if (owed - got <= EPS) return s;
  const next: PokerState = { ...s1, pay: { ...(s1.pay ?? {}), [pid]: { got: owed, how, at: now } } };
  return addLog(next, { t: now, kind: 'paid', playerId: pid, dollars: owed - got, how }, ctx);
}

/** Records every player who still owes money as paid the same way (everyone handed over cash at once). */
export function recordAllPayments(s: PokerState, ctx: BoardContext, how: 'cash' | 'venmo' | 'gold', now: number): PokerState {
  let cur = s;
  for (const p of ctx.players) cur = recordPayment(cur, ctx, p.id, how, now);
  return cur;
}

/** Takes a payment back (a mis-tap): the player owes everything again. */
export function clearPayment(s: PokerState, ctx: BoardContext, pid: number, now: number): PokerState {
  const got = s.pay?.[pid]?.got ?? 0;
  if (!known(ctx, pid) || got <= EPS) return s;
  return addLog({ ...s, pay: { ...(s.pay ?? {}), [pid]: { got: 0, how: null, at: null } } }, { t: now, kind: 'unpaid', playerId: pid, dollars: got }, ctx);
}

// ------------------------------------------------------------------ chip plan

/** True until the first hand is dealt and chips start to move: the chip plan can still be changed. */
export function isPristine(s: PokerState): boolean {
  return s.hand === 0 && s.deal === null && s.button === null && s.snaps.length === 0 && s.bustCount === 0 && Object.values(s.players).every((p) => p.buys.length === 1 && !p.out);
}

/** The plan inputs with blanks filled from the settings and this game's players. */
export function planResolved(s: PokerState, ctx: BoardContext) {
  const st = settingsOf(s, ctx);
  const d = s.plan ?? { colours: [] };
  let shareNum = cfg(st, 'shareNum');
  let shareDen = cfg(st, 'shareDen');
  if (d.sharePercent !== undefined && d.sharePercent !== null) {
    const pct = d.sharePercent;
    shareNum = Number.isInteger(pct) ? pct : Math.round(pct * 100);
    shareDen = Number.isInteger(pct) ? 100 : 10000;
  }
  return {
    colours: d.colours,
    players: Math.max(1, Math.floor(d.players ?? (ctx.players.length || 1))),
    buyIn: d.buyIn ?? cfg(st, 'buyIn'),
    currency: d.currency ?? cfg(st, 'currency'),
    shareNum,
    shareDen,
    sharePercent: (shareNum / shareDen) * 100,
  };
}

/** The chip plan for what the GM has typed so far. */
export function computePlan(s: PokerState, ctx: BoardContext): ChipPlan {
  const r = planResolved(s, ctx);
  const st = { ...settingsOf(s, ctx), currency: r.currency };
  return planChips({ colours: r.colours, players: r.players, buyIn: r.buyIn, pointsPerUnit: cfg(st, 'pointsPerUnit'), shareNum: r.shareNum, shareDen: r.shareDen, fmt: (p) => worth(p, st) });
}

const cleanInt = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? clampInt(v, lo, hi) : lo);

/** Saves what the GM typed into the chip plan (only until the first hand). Values that make no sense are tidied or dropped. */
export function setPlan(s: PokerState, ctx: BoardContext, patch: Partial<PlanDraft>): PokerState {
  if (!isPristine(s)) return s;
  const cur: PlanDraft = s.plan ?? { colours: [] };
  const merged = { ...cur, ...patch };
  const colours: ChipColour[] = (merged.colours ?? []).slice(0, MAX_COLOURS).map((c) => ({
    name: String(c.name ?? '').trim().slice(0, 24),
    count: cleanInt(c.count, 0, 1000000),
    value: typeof c.value === 'number' && Number.isFinite(c.value) && c.value >= 1 ? clampInt(c.value, 1, 10000000) : null,
  }));
  const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const bi = SETTINGS.buyIn!;
  const next: PlanDraft = {
    colours,
    players: num(merged.players) === null ? null : clampInt(merged.players!, 1, 60),
    buyIn: num(merged.buyIn) === null ? null : Math.round(Math.min(bi.max, Math.max(bi.min, merged.buyIn!)) * 100) / 100,
    currency: num(merged.currency) === null ? null : merged.currency! >= 1 ? 1 : 0,
    sharePercent: num(merged.sharePercent) === null ? null : Math.round(Math.min(100, Math.max(10, merged.sharePercent!)) * 10) / 10,
  };
  return JSON.stringify(next) === JSON.stringify(cur) ? s : { ...s, plan: next };
}

/** What accepting the chip plan would set for the game. */
export interface PlanOutcome {
  /** Starting stack and rebuy chips, in points. */
  stack: number;
  /** Buy-in per player: the typed one, or (when the chips fall short) what the stack is worth. */
  buyIn: number;
  currency: number;
  players: number;
  shareNum: number;
  shareDen: number;
  rows: Applied['rows'];
}

/**
 * What the chip plan would set: with chips typed, the planned stack (and its buy-in); with no chips typed, just the money
 * (a stack equal to the buy-in in points). null when the plan can't be accepted.
 */
export function planOutcome(s: PokerState, ctx: BoardContext): PlanOutcome | null {
  const r = planResolved(s, ctx);
  const st = settingsOf(s, ctx);
  const ppu = Math.max(1, cfg(st, 'pointsPerUnit'));
  if (!r.colours.some((c) => c.count > 0)) {
    const stack = Math.round(r.buyIn * ppu);
    return r.buyIn > 0 && stack >= 1 ? { stack, buyIn: r.buyIn, currency: r.currency, players: r.players, shareNum: r.shareNum, shareDen: r.shareDen, rows: [] } : null;
  }
  const plan = computePlan(s, ctx);
  if (plan.status === 'empty' || plan.status === 'impossible') return null;
  // When the chips can't make the full buy-in, the buy-in becomes what the stack is worth, so the money collected
  // always matches the chips handed out (and the cash-outs add up to it).
  const buyIn = plan.status === 'exact' ? r.buyIn : Math.round((plan.stack / ppu) * 100) / 100;
  return {
    stack: plan.stack,
    buyIn,
    currency: r.currency,
    players: r.players,
    shareNum: plan.share.num,
    shareDen: plan.share.den,
    rows: plan.rows.map((x) => ({ name: x.name, value: x.value, count: x.count, perPlayer: x.perPlayer })),
  };
}

/** Why the chip plan can't be accepted yet, in words; null = it can. */
export function applyBlock(s: PokerState, ctx: BoardContext): string | null {
  if (!isPristine(s)) return 'The chip plan is locked once the first hand is dealt.';
  if (planOutcome(s, ctx)) return null;
  const r = planResolved(s, ctx);
  if (!r.colours.some((c) => c.count > 0)) return 'Enter a buy-in above 0.';
  const plan = computePlan(s, ctx);
  return plan.problems[0] ?? plan.notes[0] ?? 'These chips can\u2019t make a fair stack.';
}

/**
 * Accepts the chip plan for this game: every player's starting chips become the planned stack, rebuys hand out the same
 * stack, and the plan's currency and buy-in replace the settings screen's for this game only. Chips are reset to the stack.
 * If the chips could only make a smaller stack than the buy-in, the buy-in becomes what that stack is worth.
 * With no chips typed it just sets the money: the stack is the buy-in in points.
 */
export function applyPlan(s: PokerState, ctx: BoardContext, now: number): PokerState {
  if (applyBlock(s, ctx) !== null) return s;
  const o = planOutcome(s, ctx)!;
  const applied: Applied = { currency: o.currency, buyIn: o.buyIn, startStack: o.stack, rebuyChips: o.stack, players: o.players, shareNum: o.shareNum, shareDen: o.shareDen, rows: o.rows, at: now };
  const same = s.applied && JSON.stringify({ ...s.applied, at: 0 }) === JSON.stringify({ ...applied, at: 0 });
  const next: PokerState = { ...s, applied: same ? s.applied : applied };
  const st = settingsOf(next, ctx);
  const players = { ...next.players };
  for (const p of ctx.players) players[p.id] = blank(ctx, st);
  const reset = { ...next, players };
  if (same && JSON.stringify(reset.players) === JSON.stringify(s.players)) return s;
  return addLog(reset, { t: now, kind: 'plan', playerId: null, text: `Chip plan set: ${worth(o.stack, st)} (${chips(o.stack)} chips) per player, buy-in ${units(o.buyIn, st)}` }, ctx);
}

/**
 * Before the first hand, keeps every untouched starting stack and buy-in in step with the settings (the GM may change the
 * buy-in or starting stack after the game was created). Does nothing once a chip plan is accepted or chips have moved.
 */
export function syncStart(s: PokerState, ctx: BoardContext): PokerState {
  if (s.applied || !isPristine(s)) return s;
  const fresh = blank(ctx, settingsOf(s, ctx));
  let players = s.players;
  for (const p of ctx.players) {
    const d = s.players[p.id];
    const b = d?.buys[0];
    if (!d || !b || d.stack !== b.chips) continue;
    if (b.chips !== fresh.buys[0]!.chips || b.dollars !== fresh.buys[0]!.dollars) players = { ...players, [p.id]: { ...d, stack: fresh.stack, buys: [{ ...b, chips: fresh.buys[0]!.chips, dollars: fresh.buys[0]!.dollars }] } };
  }
  return players === s.players ? s : { ...s, players };
}

export interface BankRow {
  name: string;
  value: number;
  perPlayer: number;
  /** Chips of this colour left in the bank (negative = more handed out than the bank had). */
  bank: number;
}

/** What is left in the bank after every handout so far (the first stacks and every rebuy). null without an accepted plan. */
export function bankInfo(s: PokerState, ctx: BoardContext): { rows: BankRow[]; handouts: number; rebuysLeft: number; value: number; short: boolean } | null {
  if (!s.applied) return null;
  const handouts = ctx.players.reduce((n, p) => n + pl(s, p.id, ctx).buys.length, 0);
  const rows = s.applied.rows.map((r) => ({ name: r.name, value: r.value, perPlayer: r.perPlayer, bank: r.count - handouts * r.perPlayer }));
  let rebuysLeft = Infinity;
  for (const r of rows) if (r.perPlayer > 0) rebuysLeft = Math.min(rebuysLeft, Math.floor(r.bank / r.perPlayer));
  return { rows, handouts, rebuysLeft: rebuysLeft === Infinity ? 0 : rebuysLeft, value: rows.reduce((n, r) => n + Math.max(0, r.bank) * r.value, 0), short: rows.some((r) => r.bank < 0) };
}

// ------------------------------------------------------------------ cash-out

export interface CashRow {
  playerId: number;
  name: string;
  /** Put in so far (buy-in plus rebuys), in dollars or gold. */
  invested: number;
  /** What the chips are worth now; players who are out get 0. */
  cashOut: number;
  net: number;
}

/**
 * What everyone receives if the game ended now: exactly what their chips are worth. Because every chip came from a
 * buy-in or rebuy, the cash-outs add up to the money that went in (`diff` is 0) when the stacks are counted right.
 */
export function payoutTable(s: PokerState, ctx: BoardContext): { rows: CashRow[]; invested: number; cashOut: number; diff: number } {
  const ppu = Math.max(1, cfg(settingsOf(s, ctx), 'pointsPerUnit'));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rows = ctx.players.map((p) => {
    const d = pl(s, p.id, ctx);
    const invested = paidDollars(d);
    const cashOut = r2(d.out ? 0 : d.stack / ppu);
    return { playerId: p.id, name: p.name, invested, cashOut, net: r2(cashOut - invested) };
  });
  const invested = r2(rows.reduce((n, r) => n + r.invested, 0));
  const cashOut = r2(rows.reduce((n, r) => n + r.cashOut, 0));
  return { rows, invested, cashOut, diff: r2(cashOut - invested) };
}
