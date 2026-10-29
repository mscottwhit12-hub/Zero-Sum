/**
 * Ticket to Ride: Europe board: pure logic (no Svelte, no clock, no storage).
 * Written to board-contract.ts v1.1.
 *
 * Ticket to Ride is played on the real table and scored by the players at the end, so this board is a light
 * control panel, not a score keeper. Per player it tracks: trains left (to spot the final round), whether they
 * have played their last turn, stations left (Europe: 3 each, +4 per unused station at the end), the final score
 * the GM types in once the players have counted, destination tickets completed (used only to break ties), and
 * re-rolls used.
 *
 * Crown (score):       no live leader. Nothing until EVERY player has a final score; then the final scores.
 * Result (placements): highest final score first; equal scores are split by most destination tickets completed,
 *                      then by fewest stations built (both settings); still equal = shared place. The European
 *                      Express (longest route) bonus is NOT handled here: the players work it out and it is simply
 *                      part of the score the GM types in, so the last official tiebreak (who holds it) is not used.
 *                      Unused stations are tracked as a helper; the final score is still typed in.
 *                      Players with no final score yet share the last place.
 *
 * Every operation returns a NEW state; if nothing would change it returns the SAME object (double taps and a
 * repeated onchange are harmless).
 */
import type { BoardContext, BoardDef, BoardSetting } from '../contract';

/** Every gameplay number. Defaults are the official Ticket to Ride: Europe values. */
export const SETTINGS: Record<string, BoardSetting> = {
  trainsStart: { label: 'Trains each player starts with', default: 45, min: 1, max: 100 },
  finalRoundTrains: { label: 'Final round starts when a player has this many trains left or fewer', default: 2, min: 0, max: 10 },
  stationsStart: { label: 'Stations each player starts with', default: 3, min: 0, max: 10 },
  stationValue: { label: 'Points for each unused station at the end', default: 4, min: 0, max: 20 },
  ticketsMax: { label: 'Most destination tickets one player can complete', default: 46, min: 1, max: 100 },
  scoreMax: { label: 'Biggest final score the board accepts (and, as a minus, the smallest)', default: 500, min: 100, max: 2000, step: 50 },
  longestBonus: { label: 'Points for the European Express bonus (used by the optional points breakdown)', default: 10, min: 0, max: 50 },
  ticketTiebreak: { label: 'Break tied scores by most destination tickets completed (1 = yes, 0 = no)', default: 1, min: 0, max: 1 },
  stationTiebreak: { label: 'Then break ties by fewest stations built (1 = yes, 0 = no)', default: 1, min: 0, max: 1 },
};

/** A setting's current value, falling back to its default. */
export function cfg(settings: Record<string, number> | undefined, key: string): number {
  const v = settings?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (SETTINGS[key]?.default ?? 0);
}

// ------------------------------------------------------------------ state

export interface TtrPlayer {
  /** Trains left in their hand of plastic trains. */
  trains: number;
  /** Stations still in reserve (each unused one is worth points at the end). */
  stations: number;
  /** Final round only: they have taken their last turn. */
  lastTurnDone: boolean;
  /** Typed in by the GM at the end (route points + tickets + bonuses, counted by the players). null = not entered. */
  finalScore: number | null;
  /** Destination tickets completed; used only to break ties. */
  tickets: number;
  rerollsUsed: number;
  /** Optional: where the points came from, for the stats report. Missing in older saved games. */
  breakdown?: Partial<Breakdown>;
}

/** Where a player's points came from. Every field is optional to fill in; the final score is still typed separately. */
export interface Breakdown {
  /** Points from claimed routes (trains placed). */
  routes: number;
  /** Points from completed destination tickets. */
  ticketPts: number;
  /** Points lost on failed destination tickets, entered as a positive number. */
  ticketLost: number;
  /** How many destination tickets were failed. */
  ticketsFailed: number;
  /** Holds the European Express bonus. */
  longest: boolean;
}

export interface TtrState {
  v: 1;
  players: Record<number, TtrPlayer>;
  /** When the board first opened for this game (epoch ms); only a fallback if the host gives no start time. */
  startedAt?: number | null;
  /** When the last final score went in (epoch ms): stops the game clock. null/missing = still running. */
  endedAt?: number | null;
  /** Whoever first dropped to the final-round trains (remembered so the banner doesn't jump around). null = none. */
  finalBy: number | null;
}

const blank = (ctxSettings: Record<string, number> | undefined): TtrPlayer => ({
  trains: cfg(ctxSettings, 'trainsStart'),
  stations: cfg(ctxSettings, 'stationsStart'),
  lastTurnDone: false,
  finalScore: null,
  tickets: 0,
  rerollsUsed: 0,
});

const ZERO_BD: Breakdown = { routes: 0, ticketPts: 0, ticketLost: 0, ticketsFailed: 0, longest: false };
export const bdOf = (p: TtrPlayer): Breakdown => ({ ...ZERO_BD, ...(p.breakdown ?? {}) });
/** Something has been entered in the breakdown (by hand: automatic station points don't count). */
export const hasBreakdown = (p: TtrPlayer): boolean => {
  const b = bdOf(p);
  return b.routes !== 0 || b.ticketPts !== 0 || b.ticketLost !== 0 || b.ticketsFailed !== 0 || b.longest;
};
/** What the breakdown adds up to: routes + tickets - lost tickets + the longest-route bonus + unused stations. */
export function breakdownTotal(p: TtrPlayer, settings: Record<string, number> | undefined): number {
  const b = bdOf(p);
  return b.routes + b.ticketPts - b.ticketLost + (b.longest ? cfg(settings, 'longestBonus') : 0) + Math.max(0, p.stations) * cfg(settings, 'stationValue');
}

/** A player's numbers; players the state doesn't know yet read as fresh. */
export const pl = (s: TtrState, id: number, settings?: Record<string, number>): TtrPlayer => s.players[id] ?? blank(settings);

export function init(ctx: BoardContext): TtrState {
  const players: Record<number, TtrPlayer> = {};
  for (const p of ctx.players) players[p.id] = blank(ctx.settings);
  return { v: 1, players, finalBy: null, startedAt: null };
}

/** Adds any participants the state doesn't know yet (someone added after the game started). */
export function ensure(s: TtrState, ctx: BoardContext): TtrState {
  const missing = ctx.players.filter((p) => !s.players[p.id]);
  if (!missing.length) return s;
  const players = { ...s.players };
  for (const p of missing) players[p.id] = blank(ctx.settings);
  return { ...s, players };
}

// ------------------------------------------------------------------ status and ranking

export interface GameStatus {
  /** Someone is at or under the final-round trains: everyone (them too) gets one more turn. */
  finalActive: boolean;
  /** The player who started the final round. */
  triggerId: number | null;
  /** Players who still have to take their last turn (empty when the final round isn't on). */
  waitingFor: number[];
  scored: number;
  allScored: boolean;
}

/** At or under the final-round trains. A player who has not used a single train never counts, so odd settings can't start the final round at turn one. */
export const atFinalTrains = (trains: number, settings: Record<string, number> | undefined): boolean =>
  trains <= cfg(settings, 'finalRoundTrains') && trains < cfg(settings, 'trainsStart');

export function status(s: TtrState, ctx: BoardContext): GameStatus {
  const low = ctx.players.filter((p) => atFinalTrains(pl(s, p.id, ctx.settings).trains, ctx.settings)).map((p) => p.id);
  const finalActive = low.length > 0;
  const triggerId = !finalActive ? null : s.finalBy !== null && low.includes(s.finalBy) ? s.finalBy : low[0]!;
  const waitingFor = finalActive ? ctx.players.filter((p) => !pl(s, p.id, ctx.settings).lastTurnDone).map((p) => p.id) : [];
  const scored = ctx.players.filter((p) => pl(s, p.id, ctx.settings).finalScore !== null).length;
  return { finalActive, triggerId, waitingFor, scored, allScored: ctx.players.length > 0 && scored === ctx.players.length };
}

/** The breakdown in plain words; empty when nothing was entered. */
export function breakdownLine(d: TtrPlayer, settings: Record<string, number> | undefined): string {
  if (!hasBreakdown(d)) return '';
  const b = bdOf(d);
  const parts: string[] = [];
  if (b.routes) parts.push(`routes ${b.routes}`);
  if (b.ticketPts) parts.push(`tickets +${b.ticketPts}`);
  if (b.ticketLost) parts.push(`failed tickets -${b.ticketLost}`);
  if (b.longest) parts.push(`european express +${cfg(settings, 'longestBonus')}`);
  if (d.stations > 0 && cfg(settings, 'stationValue') > 0) parts.push(`unused stations +${d.stations * cfg(settings, 'stationValue')}`);
  return parts.join(', ');
}

export interface Row {
  playerId: number;
  name: string;
  trains: number;
  stations: number;
  finalScore: number | null;
  tickets: number;
  rerollsUsed: number;
  /** Plain-words breakdown (empty if none was entered), e.g. "routes 70, tickets +30". */
  breakdownLine: string;
  place: number;
  tied: boolean;
}

export const ordinal = (n: number): string => {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** Everyone ranked: highest final score first, ties split by tickets (if the setting is on); no score = last, shared. */
export function ranking(s: TtrState, ctx: BoardContext): Row[] {
  const tb = cfg(ctx.settings, 'ticketTiebreak') >= 1;
  const sb = cfg(ctx.settings, 'stationTiebreak') >= 1;
  const rows = ctx.players.map((p) => {
    const d = pl(s, p.id, ctx.settings);
    return { playerId: p.id, name: p.name, trains: d.trains, stations: d.stations, finalScore: d.finalScore, tickets: d.tickets, rerollsUsed: d.rerollsUsed, breakdownLine: breakdownLine(d, ctx.settings) };
  });
  const scored = rows.filter((r) => r.finalScore !== null).sort((a, b) => b.finalScore! - a.finalScore! || (tb ? b.tickets - a.tickets : 0) || (sb ? b.stations - a.stations : 0) || a.playerId - b.playerId);
  const unscored = rows.filter((r) => r.finalScore === null).sort((a, b) => a.playerId - b.playerId);
  const same = (a: Omit<Row, 'place' | 'tied'>, b: Omit<Row, 'place' | 'tied'>) => a.finalScore === b.finalScore && (!tb || a.tickets === b.tickets) && (!sb || a.stations === b.stations);
  const out: Row[] = [];
  let i = 0;
  while (i < scored.length) {
    let j = i + 1;
    while (j < scored.length && same(scored[i]!, scored[j]!)) j++;
    for (let k = i; k < j; k++) out.push({ ...scored[k]!, place: i + 1, tied: j - i > 1 });
    i = j;
  }
  for (const r of unscored) out.push({ ...r, place: scored.length + 1, tied: unscored.length > 1 });
  return out;
}

/** Points the players add for stations still unused. A helper for the GM; never added to the typed score. */
export const stationBonus = (stations: number, settings: Record<string, number> | undefined): number => Math.max(0, stations) * cfg(settings, 'stationValue');

/** No live leader: the crown only sees scores once every player has one. Until then everyone reads 0. */
export function score(s: TtrState, ctx: BoardContext): Record<number, number> {
  const out: Record<number, number> = {};
  const all = status(s, ctx).allScored;
  for (const p of ctx.players) out[p.id] = all ? (pl(s, p.id, ctx.settings).finalScore ?? 0) : 0;
  return out;
}

export function placements(s: TtrState, ctx: BoardContext): number[][] {
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

/** First word of a name; a blank name reads as "Player" so messages never show an empty gap. */
const first = (n: string) => n.trim().split(/\s+/)[0] || 'Player';

export function recapText(r: Row, rows: Row[], ctx: BoardContext): string {
  if (r.finalScore === null) return 'Ticket to Ride Europe: no final score was entered for you tonight.';
  const bits: string[] = [`Ticket to Ride Europe: you finished ${ordinal(r.place)}${r.tied ? ' (tied)' : ''} with ${r.finalScore} points.`];
  if (cfg(ctx.settings, 'ticketTiebreak') >= 1 && r.tickets > 0) bits.push(`Destination tickets completed: ${r.tickets}.`);
  if (r.stations > 0) bits.push(`Unused stations: ${r.stations}.`);
  const winners = rows.filter((x) => x.place === 1 && x.finalScore !== null);
  if (r.place === 1) {
    const others = winners.filter((w) => w.playerId !== r.playerId).map((w) => first(w.name));
    bits.push(others.length ? `You share the win with ${others.join(' and ')}.` : 'You won!');
  } else if (winners.length) {
    const w = winners[0]!;
    bits.push(`${winners.length > 1 ? 'Winners' : 'Winner'}: ${winners.map((x) => first(x.name)).join(' and ')} with ${w.finalScore} points.`);
  }
  if (r.breakdownLine) bits.push(`Points: ${r.breakdownLine}.`);
  if (r.rerollsUsed) bits.push(`Re-rolls used: ${r.rerollsUsed}.`);
  return bits.join(' ');
}

export function recap(s: TtrState, ctx: BoardContext): { playerId: number; text: string }[] {
  const rows = ranking(s, ctx);
  return rows.map((r) => ({ playerId: r.playerId, text: recapText(r, rows, ctx) }));
}

export const def: BoardDef<TtrState> = {
  key: 'ticket-to-ride-europe',
  label: 'Ticket to Ride: Europe',
  settings: SETTINGS,
  init,
  score,
  placements,
  recap,
};

// ------------------------------------------------------------------ operations

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
const known = (ctx: BoardContext, pid: number) => ctx.players.some((x) => x.id === pid);
const put = (s: TtrState, pid: number, p: TtrPlayer): TtrState => ({ ...s, players: { ...s.players, [pid]: p } });

/** Keeps `finalBy` and the last-turn ticks honest after trains change. */
function settleFinal(s: TtrState, ctx: BoardContext, changed: number): TtrState {
  const low = ctx.players.filter((p) => atFinalTrains(s.players[p.id]!.trains, ctx.settings)).map((p) => p.id);
  if (!low.length) {
    const anyTick = ctx.players.some((p) => s.players[p.id]!.lastTurnDone);
    if (s.finalBy === null && !anyTick) return s;
    const players = { ...s.players };
    for (const p of ctx.players) if (players[p.id]!.lastTurnDone) players[p.id] = { ...players[p.id]!, lastTurnDone: false };
    return { ...s, players, finalBy: null };
  }
  const by = s.finalBy !== null && low.includes(s.finalBy) ? s.finalBy : low.includes(changed) ? changed : low[0]!;
  return by === s.finalBy ? s : { ...s, finalBy: by };
}

export function setTrains(s: TtrState, ctx: BoardContext, pid: number, value: number): TtrState {
  if (!known(ctx, pid) || !Number.isFinite(value)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  const v = clampInt(value, 0, cfg(ctx.settings, 'trainsStart'));
  if (v === p.trains) return s1;
  return settleFinal(put(s1, pid, { ...p, trains: v }), ctx, pid);
}

export function setStations(s: TtrState, ctx: BoardContext, pid: number, value: number): TtrState {
  if (!known(ctx, pid) || !Number.isFinite(value)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  const v = clampInt(value, 0, cfg(ctx.settings, 'stationsStart'));
  if (v === p.stations) return s1;
  return put(s1, pid, { ...p, stations: v });
}

/** Ticks or unticks "has played their last turn" (an explicit value, so a double tap can't undo itself). Final round only. */
export function setLastTurn(s: TtrState, ctx: BoardContext, pid: number, done: boolean): TtrState {
  if (!known(ctx, pid)) return s;
  const s1 = ensure(s, ctx);
  if (!status(s1, ctx).finalActive) return s1;
  const p = s1.players[pid]!;
  if (p.lastTurnDone === done) return s1;
  return put(s1, pid, { ...p, lastTurnDone: done });
}

/** The final score the players counted; null clears it. */
export function setFinalScore(s: TtrState, ctx: BoardContext, pid: number, value: number | null): TtrState {
  if (!known(ctx, pid)) return s;
  if (value !== null && !Number.isFinite(value)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  const max = cfg(ctx.settings, 'scoreMax');
  const v = value === null ? null : clampInt(value, -max, max);
  if (v === p.finalScore) return s1;
  return put(s1, pid, { ...p, finalScore: v });
}

export function setTickets(s: TtrState, ctx: BoardContext, pid: number, value: number): TtrState {
  if (!known(ctx, pid) || !Number.isFinite(value)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  const v = clampInt(value, 0, cfg(ctx.settings, 'ticketsMax'));
  if (v === p.tickets) return s1;
  return put(s1, pid, { ...p, tickets: v });
}

/** Counts a re-roll after the host has spent the token. */
export function recordReroll(s: TtrState, ctx: BoardContext, pid: number): TtrState {
  if (!known(ctx, pid)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  return put(s1, pid, { ...p, rerollsUsed: p.rerollsUsed + 1 });
}

// ------------------------------------------------------------------ game clock

/** The context as the host may extend it: optional start and planned end (epoch ms). Both are read defensively. */
export type TimedContext = BoardContext & { startedAt?: number | null; endsAt?: number | null };

/** Remembers when the board first opened (only if not already known). The same object comes back if it is. */
export function markStarted(s: TtrState, now: number): TtrState {
  if (typeof s.startedAt === 'number' || !Number.isFinite(now)) return s;
  return { ...s, startedAt: now };
}

/** Freezes the clock when the last final score goes in, and un-freezes it if a score is cleared again. Same object if nothing changes. */
export function syncEnded(s: TtrState, ctx: BoardContext, now: number): TtrState {
  const all = status(s, ctx).allScored;
  const has = typeof s.endedAt === 'number';
  if (all && !has) return Number.isFinite(now) ? { ...s, endedAt: now } : s;
  if (!all && has) return { ...s, endedAt: null };
  return s;
}

export interface Clock {
  startedAt: number;
  /** Planned end (epoch ms) from the host (start + the library game's length); null when the game has no length. */
  endsAt: number | null;
  elapsedMs: number;
  /** Time left; negative once the game has run over. null without a planned end. */
  remainingMs: number | null;
  over: boolean;
  /** True once every final score is in: the clock is frozen at that moment. */
  finished: boolean;
  /** 'host' = times came from the host, 'board' = the board's own clock. */
  source: 'host' | 'board';
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** null when no start time is known yet. */
export function clock(s: TtrState, ctx: BoardContext, now: number): Clock | null {
  const t = ctx as TimedContext;
  const fromHost = fin(t.startedAt);
  const startedAt = fromHost ? (t.startedAt as number) : fin(s.startedAt) ? s.startedAt : null;
  if (startedAt === null) return null;
  // the planned end comes only from the host (the library game's length); one at or before the start can't be right
  const endsAt = fin(t.endsAt) && t.endsAt > startedAt ? t.endsAt : null;
  const finished = fin(s.endedAt);
  const at = finished ? (s.endedAt as number) : now;
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

/** Adds to the final score from the +/- buttons. A blank score only moves up (from 0), never down, so a blank can't turn into a typed-looking minus. */
export function bumpFinalScore(s: TtrState, ctx: BoardContext, pid: number, by: number): TtrState {
  if (!known(ctx, pid) || !Number.isFinite(by)) return s;
  const cur = pl(s, pid, ctx.settings).finalScore;
  if (cur === null && by < 0) return s;
  return setFinalScore(s, ctx, pid, (cur ?? 0) + by);
}

/** Things the GM should know before opening the result screen. Empty = nothing to warn about. */
export function finishWarnings(s: TtrState, ctx: BoardContext): string[] {
  const st = status(s, ctx);
  const out: string[] = [];
  const nameOf = (id: number) => first(ctx.players.find((p) => p.id === id)?.name ?? '');
  if (st.scored === 0) out.push('No final scores have been entered. Everyone will be tied on the result screen.');
  else if (!st.allScored) {
    const n = ctx.players.length - st.scored;
    out.push(`${n} player${n === 1 ? ' has' : 's have'} no final score and will share the last place.`);
  }
  if (!st.finalActive) out.push(`The final round has not started: nobody is down to ${cfg(ctx.settings, 'finalRoundTrains')} trains or fewer.`);
  else if (st.waitingFor.length) out.push(`The final round is not finished. Still to play: ${st.waitingFor.map(nameOf).join(', ')}.`);
  return out;
}

// ------------------------------------------------------------------ points breakdown and stats report

export type BreakdownField = 'routes' | 'ticketPts' | 'ticketLost' | 'ticketsFailed';

/** Sets one breakdown number (whole, never below 0, capped by the score or ticket limits). */
export function setBreakdownField(s: TtrState, ctx: BoardContext, pid: number, field: BreakdownField, value: number): TtrState {
  if (!known(ctx, pid) || !Number.isFinite(value)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  const b = bdOf(p);
  const v = clampInt(value, 0, field === 'ticketsFailed' ? cfg(ctx.settings, 'ticketsMax') : cfg(ctx.settings, 'scoreMax'));
  if (v === b[field]) return s1;
  return put(s1, pid, { ...p, breakdown: { ...b, [field]: v } });
}

/** Marks who holds the European Express bonus. More than one player may (a shared longest route). */
export function setLongest(s: TtrState, ctx: BoardContext, pid: number, holds: boolean): TtrState {
  if (!known(ctx, pid)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  const b = bdOf(p);
  if (b.longest === holds) return s1;
  return put(s1, pid, { ...p, breakdown: { ...b, longest: holds } });
}

/** Copies what the breakdown adds up to into the final score. */
export function applyBreakdownTotal(s: TtrState, ctx: BoardContext, pid: number): TtrState {
  if (!known(ctx, pid)) return s;
  return setFinalScore(s, ctx, pid, breakdownTotal(pl(s, pid, ctx.settings), ctx.settings));
}

export interface StatsRow {
  playerId: number;
  name: string;
  place: number;
  finalScore: number | null;
  routes: number;
  ticketPts: number;
  ticketLost: number;
  ticketsCompleted: number;
  ticketsFailed: number;
  longest: boolean;
  stationsUnused: number;
  stationPts: number;
  trainsLeft: number;
  /** What the breakdown adds up to (null when nothing was entered). */
  breakdownTotal: number | null;
  /** Final score minus the breakdown total; 0 = they agree, null = one of them is missing. */
  difference: number | null;
}

/** One row per player, best place first, for the post-game stats report. */
export function statsReport(s: TtrState, ctx: BoardContext): StatsRow[] {
  return ranking(s, ctx).map((r) => {
    const d = pl(s, r.playerId, ctx.settings);
    const b = bdOf(d);
    const has = hasBreakdown(d);
    const total = has ? breakdownTotal(d, ctx.settings) : null;
    return {
      playerId: r.playerId,
      name: r.name,
      place: r.place,
      finalScore: r.finalScore,
      routes: b.routes,
      ticketPts: b.ticketPts,
      ticketLost: b.ticketLost,
      ticketsCompleted: d.tickets,
      ticketsFailed: b.ticketsFailed,
      longest: b.longest,
      stationsUnused: d.stations,
      stationPts: Math.max(0, d.stations) * cfg(ctx.settings, 'stationValue'),
      trainsLeft: d.trains,
      breakdownTotal: total,
      difference: total !== null && r.finalScore !== null ? r.finalScore - total : null,
    };
  });
}

/** The stats report as tab-separated text (pastes straight into a spreadsheet). */
export function reportText(s: TtrState, ctx: BoardContext): string {
  const head = ['Place', 'Player', 'Final score', 'Route points', 'Ticket points', 'Ticket points lost', 'Tickets completed', 'Tickets failed', 'European Express', 'Stations unused', 'Station points', 'Trains left', 'Breakdown total', 'Difference'];
  const lines = statsReport(s, ctx).map((r) =>
    [
      r.place,
      r.name,
      r.finalScore ?? '',
      r.routes,
      r.ticketPts,
      r.ticketLost,
      r.ticketsCompleted,
      r.ticketsFailed,
      r.longest ? 'yes' : 'no',
      r.stationsUnused,
      r.stationPts,
      r.trainsLeft,
      r.breakdownTotal ?? '',
      r.difference ?? '',
    ].join('\t'),
  );
  return [head.join('\t'), ...lines].join('\n');
}
