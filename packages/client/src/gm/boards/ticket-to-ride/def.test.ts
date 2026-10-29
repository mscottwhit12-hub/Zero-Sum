import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  SETTINGS,
  applyBreakdownTotal,
  atFinalTrains,
  bdOf,
  breakdownTotal,
  bumpFinalScore,
  clock,
  def,
  duration,
  ensure,
  finishWarnings,
  init,
  markStarted,
  ordinal,
  placements,
  pl,
  ranking,
  recap,
  recordReroll,
  reportText,
  setBreakdownField,
  setLongest,
  statsReport,
  score,
  setFinalScore,
  setLastTurn,
  setTickets,
  setTrains,
  status,
  syncEnded,
  type TtrState,
} from './def';

const player = (id: number, seat: number | null = id): BoardPlayer => ({ id, name: `P${id} Last`, color: null, avatarPath: null, seat });
const defaults = () => Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));
const mk = (n: number, settings: Record<string, number> = {}): BoardContext => ({
  players: Array.from({ length: n }, (_, i) => player(i + 1)),
  table: { name: 'T1', seats: 5, w: 0.3, h: 0.15 },
  rerollsAllowed: false,
  rerollsLeft: {},
  useReroll: async () => undefined,
  settings: { ...defaults(), ...settings },
});

/** Enters final scores (and optionally tickets) for players 1..n. */
const scored = (ctx: BoardContext, scores: number[], tickets: number[] = []): TtrState => {
  let s = init(ctx);
  scores.forEach((v, i) => {
    s = setFinalScore(s, ctx, i + 1, v);
    if (tickets[i] !== undefined) s = setTickets(s, ctx, i + 1, tickets[i]!);
  });
  return s;
};

describe('settings', () => {
  it('has the official defaults and sane ranges', () => {
    expect(SETTINGS.trainsStart!.default).toBe(45);
    expect(SETTINGS.finalRoundTrains!.default).toBe(2);
    expect(SETTINGS.ticketsMax!.default).toBe(30);
    expect(SETTINGS.ticketTiebreak!.default).toBe(1);
    for (const s of Object.values(SETTINGS)) {
      expect(s.min).toBeLessThanOrEqual(s.default);
      expect(s.default).toBeLessThanOrEqual(s.max);
    }
  });
  it('matches the key and label the pack points at', () => {
    expect(def.key).toBe('ticket-to-ride');
    expect(def.label).toBe('Ticket to Ride');
  });
});

describe('init and ensure', () => {
  it('starts everyone on the setting for trains, with no scores', () => {
    const s = init(mk(3, { trainsStart: 40 }));
    for (const id of [1, 2, 3]) expect(s.players[id]).toMatchObject({ trains: 40, finalScore: null, tickets: 0, lastTurnDone: false, rerollsUsed: 0 });
    expect(s.finalBy).toBeNull();
  });
  it('adds a late player and returns the same object when nobody is missing', () => {
    const ctx = mk(2);
    const s = init(ctx);
    expect(ensure(s, ctx)).toBe(s);
    const ctx3 = mk(3);
    expect(ensure(s, ctx3).players[3]!.trains).toBe(45);
  });
  it('reads unknown players as fresh', () => {
    const ctx = mk(2);
    expect(pl(init(ctx), 99, ctx.settings).trains).toBe(45);
  });
});

describe('trains and the final round', () => {
  it('clamps trains between 0 and the starting number and ignores junk', () => {
    const ctx = mk(2);
    let s = init(ctx);
    expect(setTrains(s, ctx, 1, -5).players[1]!.trains).toBe(0);
    expect(setTrains(s, ctx, 1, 999).players[1]!.trains).toBe(45);
    expect(setTrains(s, ctx, 1, NaN)).toBe(s);
    expect(setTrains(s, ctx, 99, 10)).toBe(s);
    s = setTrains(s, ctx, 1, 20.4);
    expect(s.players[1]!.trains).toBe(20);
  });
  it('returns the same object when nothing changes', () => {
    const ctx = mk(2);
    const s = init(ctx);
    expect(setTrains(s, ctx, 1, 45)).toBe(s);
  });
  it('starts the final round at the setting (2 by default) and remembers who started it', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = setTrains(s, ctx, 2, 3);
    expect(status(s, ctx).finalActive).toBe(false);
    s = setTrains(s, ctx, 2, 2);
    expect(status(s, ctx)).toMatchObject({ finalActive: true, triggerId: 2 });
    expect(s.finalBy).toBe(2);
    s = setTrains(s, ctx, 3, 0);
    expect(status(s, ctx).triggerId).toBe(2);
  });
  it('follows the final-round setting', () => {
    const ctx = mk(2, { finalRoundTrains: 5 });
    const s = setTrains(init(ctx), ctx, 1, 5);
    expect(status(s, ctx).finalActive).toBe(true);
  });
  it('hands the trigger to the next low player when the first one is corrected', () => {
    const ctx = mk(3);
    let s = setTrains(init(ctx), ctx, 1, 1);
    s = setTrains(s, ctx, 2, 0);
    s = setTrains(s, ctx, 1, 10);
    expect(status(s, ctx).triggerId).toBe(2);
    expect(s.finalBy).toBe(2);
  });
  it('cancels the final round, and its ticks, if the trains are corrected upwards', () => {
    const ctx = mk(2);
    let s = setTrains(init(ctx), ctx, 1, 2);
    s = setLastTurn(s, ctx, 2, true);
    expect(s.players[2]!.lastTurnDone).toBe(true);
    s = setTrains(s, ctx, 1, 8);
    expect(status(s, ctx).finalActive).toBe(false);
    expect(s.players[2]!.lastTurnDone).toBe(false);
    expect(s.finalBy).toBeNull();
  });
  it('only lets last turns be ticked during the final round, and tick twice is harmless', () => {
    const ctx = mk(2);
    const s0 = init(ctx);
    expect(setLastTurn(s0, ctx, 1, true)).toBe(s0);
    let s = setTrains(s0, ctx, 1, 1);
    s = setLastTurn(s, ctx, 1, true);
    expect(setLastTurn(s, ctx, 1, true)).toBe(s);
    expect(status(s, ctx).waitingFor).toEqual([2]);
    s = setLastTurn(s, ctx, 2, true);
    expect(status(s, ctx).waitingFor).toEqual([]);
    s = setLastTurn(s, ctx, 2, false);
    expect(status(s, ctx).waitingFor).toEqual([2]);
  });
});

describe('final scores and tickets', () => {
  it('stores whole numbers, allows minus, clamps to the setting, and clears with null', () => {
    const ctx = mk(2);
    let s = init(ctx);
    s = setFinalScore(s, ctx, 1, 123.6);
    expect(s.players[1]!.finalScore).toBe(124);
    s = setFinalScore(s, ctx, 1, -12);
    expect(s.players[1]!.finalScore).toBe(-12);
    s = setFinalScore(s, ctx, 1, 100000);
    expect(s.players[1]!.finalScore).toBe(500);
    s = setFinalScore(s, ctx, 1, null);
    expect(s.players[1]!.finalScore).toBeNull();
  });
  it('same value again returns the same object; junk and strangers do nothing', () => {
    const ctx = mk(2);
    const s = setFinalScore(init(ctx), ctx, 1, 80);
    expect(setFinalScore(s, ctx, 1, 80)).toBe(s);
    expect(setFinalScore(s, ctx, 1, NaN)).toBe(s);
    expect(setFinalScore(s, ctx, 77, 5)).toBe(s);
  });
  it('clamps tickets to 0..ticketsMax', () => {
    const ctx = mk(2, { ticketsMax: 12 });
    let s = init(ctx);
    s = setTickets(s, ctx, 1, 50);
    expect(s.players[1]!.tickets).toBe(12);
    s = setTickets(s, ctx, 1, -3);
    expect(s.players[1]!.tickets).toBe(0);
    expect(setTickets(s, ctx, 1, 0)).toBe(s);
  });
  it('counts re-rolls used', () => {
    const ctx = mk(2);
    const s = recordReroll(recordReroll(init(ctx), ctx, 2), ctx, 2);
    expect(s.players[2]!.rerollsUsed).toBe(2);
  });
});

describe('score (crown)', () => {
  it('is all zeros until every player has a final score: no live leader', () => {
    const ctx = mk(3);
    let s = init(ctx);
    expect(score(s, ctx)).toEqual({ 1: 0, 2: 0, 3: 0 });
    s = setFinalScore(s, ctx, 1, 120);
    s = setFinalScore(s, ctx, 2, 90);
    expect(score(s, ctx)).toEqual({ 1: 0, 2: 0, 3: 0 });
  });
  it('is the final scores once everyone has one', () => {
    const ctx = mk(3);
    expect(score(scored(ctx, [120, 90, -5]), ctx)).toEqual({ 1: 120, 2: 90, 3: -5 });
  });
});

describe('placements', () => {
  it('ranks by final score, highest first', () => {
    const ctx = mk(4);
    expect(placements(scored(ctx, [80, 130, 95, 60]), ctx)).toEqual([[2], [3], [1], [4]]);
  });
  it('splits equal scores by destination tickets completed', () => {
    const ctx = mk(3);
    expect(placements(scored(ctx, [100, 100, 70], [4, 6, 0]), ctx)).toEqual([[2], [1], [3]]);
  });
  it('shares the place when score and tickets are both equal', () => {
    const ctx = mk(3);
    expect(placements(scored(ctx, [100, 100, 70], [5, 5, 0]), ctx)).toEqual([[1, 2], [3]]);
  });
  it('ignores tickets when the tiebreak setting is off', () => {
    const ctx = mk(3, { ticketTiebreak: 0 });
    expect(placements(scored(ctx, [100, 100, 70], [4, 6, 0]), ctx)).toEqual([[1, 2], [3]]);
  });
  it('puts players without a score together in the last place', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = setFinalScore(s, ctx, 3, 50);
    expect(placements(s, ctx)).toEqual([[3], [1, 2, 4]]);
  });
  it('shows one big tie when nothing is entered (the GM sorts it on the result screen)', () => {
    const ctx = mk(3);
    expect(placements(init(ctx), ctx)).toEqual([[1, 2, 3]]);
  });
  it('handles a negative winner', () => {
    const ctx = mk(2);
    expect(placements(scored(ctx, [-10, -20]), ctx)).toEqual([[1], [2]]);
  });
  it('lists every player exactly once', () => {
    const ctx = mk(5);
    const flat = placements(scored(ctx, [1, 2, 2, 3, 3], [0, 1, 1, 2, 3]), ctx).flat();
    expect([...flat].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('ranking', () => {
  it('gives places with ties as 1, 1, 3 style numbering', () => {
    const ctx = mk(4);
    const rows = ranking(scored(ctx, [100, 100, 80, 60], [3, 3, 0, 0]), ctx);
    expect(rows.map((r) => [r.playerId, r.place, r.tied])).toEqual([
      [1, 1, true],
      [2, 1, true],
      [3, 3, false],
      [4, 4, false],
    ]);
  });
  it('does not call a lone unscored player tied', () => {
    const ctx = mk(2);
    const rows = ranking(setFinalScore(init(ctx), ctx, 1, 40), ctx);
    expect(rows[1]).toMatchObject({ playerId: 2, place: 2, tied: false });
  });
});

describe('recap', () => {
  it('gives every player one message', () => {
    const ctx = mk(3);
    const r = recap(scored(ctx, [120, 90, 90], [5, 4, 4]), ctx);
    expect(r.map((x) => x.playerId).sort()).toEqual([1, 2, 3]);
  });
  it('tells the winner they won and everyone else who did', () => {
    const ctx = mk(3);
    const r = recap(scored(ctx, [120, 90, 70]), ctx);
    expect(r.find((x) => x.playerId === 1)!.text).toContain('1st with 120 points');
    expect(r.find((x) => x.playerId === 1)!.text).toContain('You won!');
    const t2 = r.find((x) => x.playerId === 2)!.text;
    expect(t2).toContain('2nd with 90 points');
    expect(t2).toContain('Winner: P1 with 120 points.');
  });
  it('mentions a shared win and a tie', () => {
    const ctx = mk(3);
    const r = recap(scored(ctx, [100, 100, 50], [3, 3, 0]), ctx);
    const t = r.find((x) => x.playerId === 1)!.text;
    expect(t).toContain('1st (tied)');
    expect(t).toContain('You share the win with P2.');
  });
  it('says so when a player has no score', () => {
    const ctx = mk(2);
    const r = recap(setFinalScore(init(ctx), ctx, 1, 10), ctx);
    expect(r.find((x) => x.playerId === 2)!.text).toContain('no final score');
  });
  it('is wired into the def', () => {
    const ctx = mk(2);
    expect(def.recap!(scored(ctx, [5, 3]), ctx)).toHaveLength(2);
  });
});

describe('ordinal', () => {
  it('formats places', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});

describe('game clock', () => {
  const T0 = 1_000_000_000_000;
  it('is unknown until the board has a start time', () => {
    const ctx = mk(2);
    expect(clock(init(ctx), ctx, T0)).toBeNull();
  });
  it('records the start once and returns the same object after that', () => {
    const ctx = mk(2);
    const s = markStarted(init(ctx), T0);
    expect(s.startedAt).toBe(T0);
    expect(markStarted(s, T0 + 5000)).toBe(s);
  });
  it('has no planned end when the host gives none', () => {
    const ctx = mk(2);
    const c = clock(markStarted(init(ctx), T0), ctx, T0 + 30 * 60000)!;
    expect(c).toMatchObject({ elapsedMs: 30 * 60000, remainingMs: null, over: false, source: 'board', endsAt: null });
  });
  it('goes over once past the planned end', () => {
    const ctx = { ...mk(2), startedAt: T0, endsAt: T0 + 60 * 60000 } as BoardContext;
    const c = clock(markStarted(init(ctx), T0), ctx, T0 + 75 * 60000)!;
    expect(c.over).toBe(true);
    expect(c.remainingMs).toBe(-15 * 60000);
  });
  it('prefers the host start and end when the context has them', () => {
    const ctx = { ...mk(2), startedAt: T0 - 600000, endsAt: T0 + 600000 } as BoardContext;
    const c = clock(markStarted(init(ctx), T0 + 999999), ctx, T0)!;
    expect(c).toMatchObject({ source: 'host', elapsedMs: 600000, remainingMs: 600000 });
  });
  it('ignores junk host times and old saved states without a start field', () => {
    const ctx = { ...mk(2), startedAt: NaN, endsAt: 'soon' } as unknown as BoardContext;
    const old = { v: 1, players: {}, finalBy: null } as TtrState;
    expect(clock(old, ctx, T0)).toBeNull();
    expect(clock(markStarted(old, T0), ctx, T0)!.source).toBe('board');
  });
  it('formats durations', () => {
    expect([20000, 28 * 60000, 72 * 60000, 120 * 60000, -15 * 60000].map(duration)).toEqual(['under a minute', '28 min', '1h 12m', '2h', '15 min']);
  });
});

const scoredAll = (s: TtrState, ctx: BoardContext): TtrState => ctx.players.reduce((acc, p) => setFinalScore(acc, ctx, p.id, 50), s);

describe('final score +/- buttons (BUG-005)', () => {
  it('a blank score cannot be pushed down, but can be started upwards', () => {
    const ctx = mk(2);
    const s = init(ctx);
    expect(bumpFinalScore(s, ctx, 1, -1)).toBe(s);
    expect(bumpFinalScore(s, ctx, 1, -10)).toBe(s);
    expect(bumpFinalScore(s, ctx, 1, 10).players[1]!.finalScore).toBe(10);
  });
  it('an entered score moves both ways, including below zero', () => {
    const ctx = mk(2);
    let s = setFinalScore(init(ctx), ctx, 1, 4);
    s = bumpFinalScore(s, ctx, 1, -10);
    expect(s.players[1]!.finalScore).toBe(-6);
    s = bumpFinalScore(s, ctx, 1, 1);
    expect(s.players[1]!.finalScore).toBe(-5);
  });
  it('ignores strangers and junk', () => {
    const ctx = mk(2);
    const s = setFinalScore(init(ctx), ctx, 1, 4);
    expect(bumpFinalScore(s, ctx, 99, 1)).toBe(s);
    expect(bumpFinalScore(s, ctx, 1, NaN)).toBe(s);
  });
});

describe('game over warnings (BUG-002)', () => {
  it('warns that everyone would be tied when nothing is entered', () => {
    const ctx = mk(3);
    const w = finishWarnings(init(ctx), ctx);
    expect(w[0]).toContain('No final scores have been entered');
    expect(w.some((x) => x.includes('final round has not started'))).toBe(true);
  });
  it('counts the players with no score', () => {
    const ctx = mk(3);
    const s = setFinalScore(init(ctx), ctx, 1, 40);
    expect(finishWarnings(s, ctx)[0]).toContain('2 players have no final score');
    const s2 = setFinalScore(s, ctx, 2, 30);
    expect(finishWarnings(s2, ctx)[0]).toContain('1 player has no final score');
  });
  it('names who still has a last turn', () => {
    const ctx = mk(3);
    let s = setTrains(init(ctx), ctx, 1, 1);
    s = setLastTurn(s, ctx, 1, true);
    const w = finishWarnings(scoredAll(s, ctx), ctx);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('Still to play: P2, P3');
  });
  it('has nothing to say when the final round is done and every score is in', () => {
    const ctx = mk(2);
    let s = setTrains(init(ctx), ctx, 1, 0);
    s = setLastTurn(setLastTurn(s, ctx, 1, true), ctx, 2, true);
    expect(finishWarnings(scoredAll(s, ctx), ctx)).toEqual([]);
  });
});

describe('clock stops when the game is scored (BUG-003)', () => {
  const T0 = 1_000_000_000_000;
  it('records the end once every score is in, and only then', () => {
    const ctx = mk(2);
    let s = markStarted(init(ctx), T0);
    s = setFinalScore(s, ctx, 1, 10);
    expect(syncEnded(s, ctx, T0 + 5000)).toBe(s);
    s = setFinalScore(s, ctx, 2, 20);
    const e = syncEnded(s, ctx, T0 + 60 * 60000);
    expect(e.endedAt).toBe(T0 + 60 * 60000);
    expect(syncEnded(e, ctx, T0 + 90 * 60000)).toBe(e);
  });
  it('freezes the clock at the end time', () => {
    const ctx = { ...mk(2), startedAt: T0, endsAt: T0 + 60 * 60000 } as BoardContext;
    let s = scoredAll(markStarted(init(ctx), T0), ctx);
    s = syncEnded(s, ctx, T0 + 50 * 60000);
    const c = clock(s, ctx, T0 + 500 * 60000)!;
    expect(c).toMatchObject({ finished: true, elapsedMs: 50 * 60000, remainingMs: 10 * 60000, over: false });
  });
  it('reports a late finish as over', () => {
    const ctx = { ...mk(2), startedAt: T0, endsAt: T0 + 60 * 60000 } as BoardContext;
    let s = syncEnded(scoredAll(markStarted(init(ctx), T0), ctx), ctx, T0 + 80 * 60000);
    expect(clock(s, ctx, T0 + 999 * 60000)).toMatchObject({ finished: true, over: true, remainingMs: -20 * 60000 });
  });
  it('starts the clock again if a score is cleared', () => {
    const ctx = mk(2);
    let s = syncEnded(scoredAll(markStarted(init(ctx), T0), ctx), ctx, T0 + 50 * 60000);
    s = setFinalScore(s, ctx, 2, null);
    s = syncEnded(s, ctx, T0 + 55 * 60000);
    expect(s.endedAt).toBeNull();
    expect(clock(s, ctx, T0 + 70 * 60000)).toMatchObject({ finished: false, elapsedMs: 70 * 60000 });
  });
  it('an unfinished game reports finished: false', () => {
    const ctx = mk(2);
    expect(clock(markStarted(init(ctx), T0), ctx, T0 + 1000)!.finished).toBe(false);
  });
});

describe('final round at the very start (BUG-009)', () => {
  it('does not start the final round when nobody has used a train, even if the settings overlap', () => {
    const ctx = mk(2, { trainsStart: 2, finalRoundTrains: 2 });
    const s = init(ctx);
    expect(atFinalTrains(2, ctx.settings)).toBe(false);
    expect(status(s, ctx).finalActive).toBe(false);
  });
  it('starts it as soon as someone uses a train', () => {
    const ctx = mk(2, { trainsStart: 2, finalRoundTrains: 2 });
    const s = setTrains(init(ctx), ctx, 1, 1);
    expect(status(s, ctx)).toMatchObject({ finalActive: true, triggerId: 1 });
    expect(s.finalBy).toBe(1);
  });
  it('still behaves normally with the default settings', () => {
    const ctx = mk(2);
    expect(atFinalTrains(3, ctx.settings)).toBe(false);
    expect(atFinalTrains(2, ctx.settings)).toBe(true);
    expect(atFinalTrains(0, ctx.settings)).toBe(true);
    expect(atFinalTrains(45, ctx.settings)).toBe(false);
  });
});

describe('host planned end before the start (BUG-010)', () => {
  const T0 = 1_000_000_000_000;
  it('ignores an end at or before the start', () => {
    const base = mk(2);
    for (const endsAt of [T0 - 5000, T0]) {
      const ctx = { ...base, startedAt: T0, endsAt } as BoardContext;
      const c = clock(init(ctx), ctx, T0 + 60000)!;
      expect(c.endsAt).toBeNull();
      expect(c.over).toBe(false);
    }
  });
  it('still uses a sensible host end', () => {
    const ctx = { ...mk(2), startedAt: T0, endsAt: T0 + 30 * 60000 } as BoardContext;
    expect(clock(init(ctx), ctx, T0)!.endsAt).toBe(T0 + 30 * 60000);
  });
});

describe('blank player names (BUG-011)', () => {
  it('never leaves an empty gap in a recap message', () => {
    const ctx = mk(3);
    ctx.players[0]!.name = '';
    ctx.players[1]!.name = '   ';
    const s = scored(ctx, [100, 90, 80]);
    const r = recap(s, ctx);
    expect(r.find((x) => x.playerId === 2)!.text).toContain('Winner: Player with 100 points.');
    expect(r.find((x) => x.playerId === 3)!.text).toContain('Winner: Player with 100 points.');
    for (const m of r) expect(m.text.includes('  ')).toBe(false);
  });
  it('names a waiting player in the game over warning even when the name is blank', () => {
    const ctx = mk(2);
    ctx.players[1]!.name = '';
    let s = setTrains(init(ctx), ctx, 1, 0);
    s = setLastTurn(s, ctx, 1, true);
    expect(finishWarnings(setFinalScore(setFinalScore(s, ctx, 1, 1), ctx, 2, 2), ctx)[0]).toContain('Still to play: Player.');
  });
});

describe('points breakdown (stats)', () => {
  it('starts empty and does not change the score or ranking', () => {
    const ctx = mk(2);
    const s = scored(ctx, [90, 80]);
    expect(bdOf(s.players[1]!)).toEqual({ routes: 0, ticketPts: 0, ticketLost: 0, ticketsFailed: 0, longest: false });
    expect(placements(s, ctx)).toEqual([[1], [2]]);
  });
  it('stores whole, non-negative numbers capped by the settings; same value is the same object', () => {
    const ctx = mk(2);
    let s = init(ctx);
    s = setBreakdownField(s, ctx, 1, 'routes', 71.4);
    expect(bdOf(s.players[1]!).routes).toBe(71);
    s = setBreakdownField(s, ctx, 1, 'routes', -5);
    expect(bdOf(s.players[1]!).routes).toBe(0);
    s = setBreakdownField(s, ctx, 1, 'ticketPts', 99999);
    expect(bdOf(s.players[1]!).ticketPts).toBe(500);
    s = setBreakdownField(s, ctx, 1, 'ticketsFailed', 999);
    expect(bdOf(s.players[1]!).ticketsFailed).toBe(SETTINGS.ticketsMax!.default);
    expect(setBreakdownField(s, ctx, 1, 'ticketPts', 500)).toBe(s);
    expect(setBreakdownField(s, ctx, 77, 'routes', 1)).toBe(s);
    expect(setBreakdownField(s, ctx, 1, 'routes', NaN)).toBe(s);
  });
  it('adds up routes + tickets - lost tickets + the longest-route bonus', () => {
    const ctx = mk(2);
    let s = init(ctx);
    s = setBreakdownField(s, ctx, 1, 'routes', 70);
    s = setBreakdownField(s, ctx, 1, 'ticketPts', 40);
    s = setBreakdownField(s, ctx, 1, 'ticketLost', 12);
    s = setLongest(s, ctx, 1, true);
    expect(breakdownTotal(s.players[1]!, ctx.settings)).toBe(70 + 40 - 12 + 10);
  });
  it('uses the bonus setting', () => {
    const ctx = mk(2, { longestBonus: 15 });
    const s = setLongest(init(ctx), ctx, 1, true);
    expect(breakdownTotal(s.players[1]!, ctx.settings)).toBe(15);
  });
  it('lets two players share the longest route, and un-sets it', () => {
    const ctx = mk(3);
    let s = setLongest(setLongest(init(ctx), ctx, 1, true), ctx, 2, true);
    expect(statsReport(s, ctx).filter((r) => r.longest)).toHaveLength(2);
    expect(setLongest(s, ctx, 1, true)).toBe(s);
    s = setLongest(s, ctx, 1, false);
    expect(bdOf(s.players[1]!).longest).toBe(false);
  });
  it('copies the breakdown total into the final score', () => {
    const ctx = mk(2);
    let s = setBreakdownField(init(ctx), ctx, 1, 'routes', 60);
    s = applyBreakdownTotal(s, ctx, 1);
    expect(s.players[1]!.finalScore).toBe(60);
  });
  it('reports the difference between the final score and the breakdown, only when both exist', () => {
    const ctx = mk(2);
    let s = scored(ctx, [100, 90]);
    expect(statsReport(s, ctx).every((r) => r.difference === null && r.breakdownTotal === null)).toBe(true);
    s = setBreakdownField(s, ctx, 1, 'routes', 60);
    const r = statsReport(s, ctx).find((x) => x.playerId === 1)!;
    expect(r.breakdownTotal).toBe(60);
    expect(r.difference).toBe(40);
  });
  it('puts the breakdown in the recap, in plain words, only when entered', () => {
    const ctx = mk(2);
    let s = scored(ctx, [100, 90]);
    expect(recap(s, ctx)[0]!.text.includes('Points:')).toBe(false);
    s = setBreakdownField(s, ctx, 1, 'routes', 70);
    s = setBreakdownField(s, ctx, 1, 'ticketPts', 30);
    s = setBreakdownField(s, ctx, 1, 'ticketLost', 8);
    s = setLongest(s, ctx, 1, true);
    const t = recap(s, ctx).find((x) => x.playerId === 1)!.text;
    expect(t).toContain('Points: routes 70, tickets +30, failed tickets -8, longest continuous route +10.');
  });
  it('makes a tab-separated report with a header and one line per player, best first', () => {
    const ctx = mk(3);
    let s = scored(ctx, [80, 120, 100], [2, 5, 3]);
    s = setBreakdownField(s, ctx, 2, 'routes', 90);
    const lines = reportText(s, ctx).split('\n');
    expect(lines).toHaveLength(4);
    const cols = lines[0]!.split('\t').length;
    for (const l of lines) expect(l.split('\t')).toHaveLength(cols);
    expect(lines[1]!.split('\t')[1]).toBe('P2 Last');
    expect(lines[1]!.split('\t')[0]).toBe('1');
    expect(lines[0]).toContain('Longest Continuous Route');
  });
  it('old saved games without a breakdown still work', () => {
    const ctx = mk(2);
    const s = init(ctx);
    delete (s.players[1] as { breakdown?: unknown }).breakdown;
    expect(statsReport(s, ctx)).toHaveLength(2);
    expect(breakdownTotal(s.players[1]!, ctx.settings)).toBe(0);
  });
});
