/**
 * Catan board (classic base game): pure logic (no Svelte, no clock, no storage). Written to board-contract.ts v1.1.
 *
 * What it tracks, per player: settlements, cities, and re-rolls used. Plus who holds the two awards (Longest Road,
 * Largest Army) and one game history: every change, every award transfer and every typed note, with a timestamp.
 * The GM enters the pieces and taps who holds each award; the board adds up the public victory points and shows
 * where they come from. Hidden victory-point cards are NOT tracked (so the crown never carries a secret).
 *
 * Crown (score):       public victory points = settlements x points + cities x points + the awards the player holds.
 * Result (placements): by points, best first; equal points share a place. An unfinished game ranks by current points.
 *
 * Every operation takes the time as an argument and returns a NEW state; if nothing would change it returns the
 * SAME object, so repeating an operation (double tap, onchange twice) is harmless.
 */
import type { BoardContext, BoardDef, BoardSetting } from '../contract';

/** Typed notes are cut to this many characters (a text-box limit, not a gameplay number). */
export const NOTE_MAX = 280;

export type AwardKey = 'longestRoad' | 'largestArmy';

/** The two awards and the board setting that holds each one's points. */
export const AWARDS: { key: AwardKey; label: string; /** Two-letter badge shown on a seat. */ short: string; setting: string }[] = [
  { key: 'longestRoad', label: 'Longest Road', short: 'LR', setting: 'longestRoadPoints' },
  { key: 'largestArmy', label: 'Largest Army', short: 'LA', setting: 'largestArmyPoints' },
];

/** Every gameplay number. Defaults are the classic base-game values. */
export const SETTINGS: Record<string, BoardSetting> = {
  targetPoints: { label: 'Points to win', default: 10, min: 1, max: 99 },
  startSettlements: { label: 'Settlements each player starts with', default: 2, min: 0, max: 20 },
  settlementPoints: { label: 'Points per settlement', default: 1, min: 0, max: 10 },
  cityPoints: { label: 'Points per city', default: 2, min: 0, max: 10 },
  longestRoadPoints: { label: 'Points for Longest Road', default: 2, min: 0, max: 10 },
  largestArmyPoints: { label: 'Points for Largest Army', default: 2, min: 0, max: 10 },
  maxSettlements: { label: 'Settlement pieces per player', default: 5, min: 1, max: 20 },
  maxCities: { label: 'City pieces per player', default: 4, min: 1, max: 20 },
  mergeSeconds: { label: 'History: merge quick taps within (seconds)', default: 5, min: 0, max: 60 },
  logMax: { label: 'History: most entries kept', default: 500, min: 50, max: 2000, step: 50 },
};

/** A setting's current value, falling back to its default. */
export function cfg(settings: Record<string, number> | undefined, key: string): number {
  const v = settings?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (SETTINGS[key]?.default ?? 0);
}

// ------------------------------------------------------------------ state

export interface CatanPlayer {
  settlements: number;
  cities: number;
  rerollsUsed: number;
}

export type LogKind = 'note' | 'settlements' | 'cities' | 'upgrade' | 'award' | 'reroll';

export interface LogEntry {
  id: number;
  /** Epoch ms. */
  t: number;
  kind: LogKind;
  playerId: number | null;
  /** Piece-count changes: value before and after. */
  from?: number;
  to?: number;
  /** Award transfers: which award, and the holder before and after (null = nobody). */
  award?: AwardKey;
  fromHolder?: number | null;
  toHolder?: number | null;
  /** Notes. */
  text?: string;
}

export interface CatanState {
  v: 1;
  players: Record<number, CatanPlayer>;
  /** Player id holding the award; null = nobody. */
  longestRoad: number | null;
  largestArmy: number | null;
  log: LogEntry[];
  /** Last used log id. */
  seq: number;
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

const maxSettlements = (ctx: BoardContext) => Math.max(1, Math.floor(cfg(ctx.settings, 'maxSettlements')));
const maxCities = (ctx: BoardContext) => Math.max(1, Math.floor(cfg(ctx.settings, 'maxCities')));

/** A player's starting numbers (what they have before anyone touches the board). */
const fresh = (ctx: BoardContext): CatanPlayer => ({
  settlements: clampInt(cfg(ctx.settings, 'startSettlements'), 0, maxSettlements(ctx)),
  cities: 0,
  rerollsUsed: 0,
});

/** A player's numbers; players the state doesn't know yet read as a fresh start. */
export const pl = (s: CatanState, ctx: BoardContext, id: number): CatanPlayer => s.players[id] ?? fresh(ctx);

/** Who really holds an award: the saved holder, if they are still one of this game's players. */
export function holder(s: CatanState, ctx: BoardContext, award: AwardKey): number | null {
  const id = s[award];
  return id !== null && ctx.players.some((p) => p.id === id) ? id : null;
}

export function init(ctx: BoardContext): CatanState {
  const players: Record<number, CatanPlayer> = {};
  for (const p of ctx.players) players[p.id] = fresh(ctx);
  return { v: 1, players, longestRoad: null, largestArmy: null, log: [], seq: 0 };
}

// ------------------------------------------------------------------ points

export interface Breakdown {
  settlements: number;
  cities: number;
  /** Points from each source. */
  settlementPts: number;
  cityPts: number;
  longestRoad: number;
  largestArmy: number;
  total: number;
}

/** Where a player's public victory points come from. */
export function breakdown(s: CatanState, ctx: BoardContext, id: number): Breakdown {
  const p = pl(s, ctx, id);
  const settlementPts = p.settlements * cfg(ctx.settings, 'settlementPoints');
  const cityPts = p.cities * cfg(ctx.settings, 'cityPoints');
  const longestRoad = holder(s, ctx, 'longestRoad') === id ? cfg(ctx.settings, 'longestRoadPoints') : 0;
  const largestArmy = holder(s, ctx, 'largestArmy') === id ? cfg(ctx.settings, 'largestArmyPoints') : 0;
  return { settlements: p.settlements, cities: p.cities, settlementPts, cityPts, longestRoad, largestArmy, total: settlementPts + cityPts + longestRoad + largestArmy };
}

export function score(s: CatanState, ctx: BoardContext): Record<number, number> {
  return Object.fromEntries(ctx.players.map((p) => [p.id, breakdown(s, ctx, p.id).total]));
}

/** Best first; equal points share a place. */
export function placements(s: CatanState, ctx: BoardContext): number[][] {
  const pts = score(s, ctx);
  const order = ctx.players.map((p) => p.id);
  const sorted = [...order].sort((a, b) => pts[b]! - pts[a]! || order.indexOf(a) - order.indexOf(b));
  const groups: number[][] = [];
  for (const id of sorted) {
    const last = groups[groups.length - 1];
    if (last && pts[last[0]!] === pts[id]) last.push(id);
    else groups.push([id]);
  }
  return groups;
}

export interface GameStatus {
  target: number;
  /** Highest points in the game, and who has them. */
  top: number;
  leaders: number[];
  /** Someone has reached the points to win. */
  reached: boolean;
  /** Those at the top once the target is reached (normally one player). */
  winners: number[];
}

export function status(s: CatanState, ctx: BoardContext): GameStatus {
  const pts = score(s, ctx);
  const target = cfg(ctx.settings, 'targetPoints');
  const top = ctx.players.length ? Math.max(...ctx.players.map((p) => pts[p.id]!)) : 0;
  const leaders = ctx.players.filter((p) => pts[p.id] === top).map((p) => p.id);
  const reached = ctx.players.length > 0 && top >= target;
  return { target, top, leaders, reached, winners: reached ? leaders : [] };
}

// ------------------------------------------------------------------ operations

/** Adds players the state doesn't know yet (a late joiner) with a fresh start. Returns the same object if none. */
export function ensure(s: CatanState, ctx: BoardContext): CatanState {
  const missing = ctx.players.filter((p) => !s.players[p.id]);
  if (!missing.length) return s;
  const players = { ...s.players };
  for (const p of missing) players[p.id] = fresh(ctx);
  return { ...s, players };
}

const MERGEABLE: LogKind[] = ['settlements', 'cities'];

/** Appends a log entry. A change to the same number by the same player within `mergeSeconds` of the last entry is folded into it. */
function addLog(s: CatanState, entry: Omit<LogEntry, 'id'>, ctx: BoardContext): CatanState {
  const mergeMs = cfg(ctx.settings, 'mergeSeconds') * 1000;
  const max = Math.max(1, Math.floor(cfg(ctx.settings, 'logMax')));
  const last = s.log[s.log.length - 1];
  if (last && MERGEABLE.includes(entry.kind) && last.kind === entry.kind && last.playerId === entry.playerId && entry.t - last.t <= mergeMs) {
    const merged: LogEntry = { ...last, to: entry.to, t: entry.t };
    const log = merged.to === merged.from ? s.log.slice(0, -1) : [...s.log.slice(0, -1), merged];
    return { ...s, log };
  }
  const id = s.seq + 1;
  const log = [...s.log, { ...entry, id }];
  return { ...s, seq: id, log: log.length > max ? log.slice(log.length - max) : log };
}

/** Looks up an editable (known) player; null if the operation should do nothing. */
function editable(s: CatanState, ctx: BoardContext, pid: number): { s: CatanState; p: CatanPlayer } | null {
  if (!ctx.players.some((x) => x.id === pid)) return null;
  const s1 = ensure(s, ctx);
  return { s: s1, p: s1.players[pid]! };
}

const put = (s: CatanState, pid: number, p: CatanPlayer): CatanState => ({ ...s, players: { ...s.players, [pid]: p } });

export function setSettlements(s: CatanState, ctx: BoardContext, pid: number, value: number, now: number): CatanState {
  const e = editable(s, ctx, pid);
  if (!e || !Number.isFinite(value)) return s;
  const v = clampInt(value, 0, maxSettlements(ctx));
  if (v === e.p.settlements) return e.s;
  return addLog(put(e.s, pid, { ...e.p, settlements: v }), { t: now, kind: 'settlements', playerId: pid, from: e.p.settlements, to: v }, ctx);
}

export function setCities(s: CatanState, ctx: BoardContext, pid: number, value: number, now: number): CatanState {
  const e = editable(s, ctx, pid);
  if (!e || !Number.isFinite(value)) return s;
  const v = clampInt(value, 0, maxCities(ctx));
  if (v === e.p.cities) return e.s;
  return addLog(put(e.s, pid, { ...e.p, cities: v }), { t: now, kind: 'cities', playerId: pid, from: e.p.cities, to: v }, ctx);
}

/** True if this player has a settlement to upgrade and a city piece left. */
export function canUpgrade(s: CatanState, ctx: BoardContext, pid: number): boolean {
  const p = pl(s, ctx, pid);
  return p.settlements >= 1 && p.cities < maxCities(ctx);
}

/** Turns one settlement into a city (the settlement piece goes back to the player). Does nothing if they can't. */
export function upgradeToCity(s: CatanState, ctx: BoardContext, pid: number, now: number): CatanState {
  const e = editable(s, ctx, pid);
  if (!e) return s;
  if (e.p.settlements < 1 || e.p.cities >= maxCities(ctx)) return e.s;
  return addLog(put(e.s, pid, { ...e.p, settlements: e.p.settlements - 1, cities: e.p.cities + 1 }), { t: now, kind: 'upgrade', playerId: pid }, ctx);
}

/** Gives an award to a player, or to nobody (null). The same holder again changes nothing. Each real change is logged. */
export function setAward(s: CatanState, ctx: BoardContext, award: AwardKey, to: number | null, now: number): CatanState {
  if (!AWARDS.some((a) => a.key === award)) return s;
  if (to !== null && !ctx.players.some((x) => x.id === to)) return s;
  const s1 = ensure(s, ctx);
  const from = holder(s1, ctx, award);
  if (from === to) return s1; // the effective holder doesn't change (a stale saved id counts as nobody)
  return addLog({ ...s1, [award]: to }, { t: now, kind: 'award', playerId: to ?? from, award, fromHolder: from, toHolder: to }, ctx);
}

export function recordReroll(s: CatanState, ctx: BoardContext, pid: number, now: number): CatanState {
  const e = editable(s, ctx, pid);
  if (!e) return s;
  return addLog(put(e.s, pid, { ...e.p, rerollsUsed: e.p.rerollsUsed + 1 }), { t: now, kind: 'reroll', playerId: pid }, ctx);
}

/** A typed note in the history, optionally about one player. Empty notes are ignored. */
export function addNote(s: CatanState, ctx: BoardContext, text: string, playerId: number | null, now: number): CatanState {
  const clean = text.trim().slice(0, NOTE_MAX);
  if (!clean) return s;
  const pid = playerId !== null && ctx.players.some((x) => x.id === playerId) ? playerId : null;
  return addLog(ensure(s, ctx), { t: now, kind: 'note', playerId: pid, text: clean }, ctx);
}

// ------------------------------------------------------------------ history text

const awardLabel = (k: AwardKey | undefined) => AWARDS.find((a) => a.key === k)?.label ?? 'an award';

export function describeEntry(e: LogEntry, nameOf: (id: number) => string): string {
  const who = e.playerId === null ? '' : nameOf(e.playerId);
  switch (e.kind) {
    case 'note':
      return e.playerId === null ? (e.text ?? '') : `${who}: ${e.text ?? ''}`;
    case 'settlements':
      return `${who}: settlements ${e.from} → ${e.to}`;
    case 'cities':
      return `${who}: cities ${e.from} → ${e.to}`;
    case 'upgrade':
      return `${who} upgraded a settlement to a city`;
    case 'award': {
      const label = awardLabel(e.award);
      const from = e.fromHolder == null ? null : nameOf(e.fromHolder);
      const to = e.toHolder == null ? null : nameOf(e.toHolder);
      if (to === null) return from === null ? `${label} released` : `${label} released (${from} no longer holds it)`;
      return from === null ? `${to} takes ${label}` : `${label} passes from ${from} to ${to}`;
    }
    case 'reroll':
      return `${who} used a re-roll`;
  }
}

// ------------------------------------------------------------------ recap

export interface RecapRow {
  playerId: number;
  name: string;
  /** 1-based; tied players share a place. */
  place: number;
  tied: boolean;
  points: number;
  settlements: number;
  cities: number;
  /** Awards held at the end. */
  awards: string[];
  /** Awards this player held earlier and lost: label, and who took it (null = released). */
  lost: { label: string; to: string | null }[];
  rerollsUsed: number;
}

export const ordinal = (n: number): string => {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** One row per player, best first: the end-of-game stats recap. */
export function recap(s: CatanState, ctx: BoardContext): RecapRow[] {
  const name = (id: number) => ctx.players.find((p) => p.id === id)?.name ?? 'Another player';
  const rows: RecapRow[] = [];
  let place = 1;
  for (const g of placements(s, ctx)) {
    for (const id of g) {
      const b = breakdown(s, ctx, id);
      const lost: RecapRow['lost'] = [];
      for (const a of AWARDS) {
        if (holder(s, ctx, a.key) === id) continue;
        const gone = [...s.log].reverse().find((e) => e.kind === 'award' && e.award === a.key && e.fromHolder === id);
        if (gone) lost.push({ label: a.label, to: gone.toHolder == null ? null : name(gone.toHolder) });
      }
      rows.push({
        playerId: id,
        name: name(id),
        place,
        tied: g.length > 1,
        points: b.total,
        settlements: b.settlements,
        cities: b.cities,
        awards: AWARDS.filter((a) => holder(s, ctx, a.key) === id).map((a) => a.label),
        lost,
        rerollsUsed: pl(s, ctx, id).rerollsUsed,
      });
    }
    place += g.length;
  }
  return rows;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const first = (n: string) => n.split(/\s+/)[0] ?? n;

/**
 * The recap as plain text for one player (a private phone message). `all` is every player's row, for the points line.
 * It deliberately does NOT state a place: the GM can change the finish order on the result screen, and the recap is
 * written from the board alone, so it reports board points and where they came from instead.
 */
export function recapText(r: RecapRow, all: RecapRow[] = []): string {
  const lines = [`Catan recap for ${r.name}: ${plural(r.points, 'point')} on the board.`];
  lines.push(`Finished with ${plural(r.settlements, 'settlement')} and ${plural(r.cities, 'city', 'cities')}${r.awards.length ? `, plus ${r.awards.join(' and ')}` : ''}.`);
  for (const l of r.lost) lines.push(`You held ${l.label} for a while${l.to ? ` before ${l.to} took it` : ' before it was released'}.`);
  if (r.rerollsUsed) lines.push(`Re-rolls used: ${r.rerollsUsed}.`);
  if (all.length > 1) lines.push(`Board points (hidden cards not counted): ${all.map((x) => `${first(x.name)} ${x.points}`).join(', ')}.`);
  return lines.join('\n');
}

export const def: BoardDef<CatanState> = {
  key: 'catan',
  label: 'Catan',
  settings: SETTINGS,
  init,
  score,
  placements,
  recap: (s, ctx) => {
    const rows = recap(s, ctx);
    return rows.map((r) => ({ playerId: r.playerId, text: recapText(r, rows) }));
  },
};
