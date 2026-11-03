import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  SETTINGS, ackLevels, addNote, blindProblems, blindText, blindsFor, boughtChips, bust, bustBlock, buttonInfo, chipTotals, chips, clockInfo, clockText,
  countDue, def, describeEntry, init, mergeBust, money, nextHand, ordinal, paidDollars, parseChips, pauseClock, placements, pl, rebuy, rebuyBlock, recap,
  recapText, recordCount, removeCount, removeNote, restore, resumeClock, score, setButton, setLevel, setPin, setStack, snoozeCount, spanText, startClock, status,
  syncClock, syncPlayers, undoRebuy, zeroChipAlive, applyBlock, applyPlan, bankInfo, clearPayment, computePlan, dealBlock, effectiveCtx, isPristine, payInfo, payMethods, payoutTable,
  planOutcome, planResolved, recordAllPayments, syncStart, recordPayment, setPlan, settingsOf, units, worth, type PokerState,
} from './def';

const T0 = 1_000_000_000_000;
const MIN = 60000;
const player = (id: number, seat: number | null = id): BoardPlayer => ({ id, name: `P${id}`, color: null, avatarPath: null, seat });
const realDefaults = () => Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));
/** Settings the first tests were written with (5,000-point stack, 25/50 blinds, no payment gate): they still prove the rules. */
const OLD_SB = [25, 50, 75, 100, 150, 200, 300, 400];
const OLD_BB = [50, 100, 150, 200, 300, 400, 600, 800];
const defaults = () => ({
  ...realDefaults(),
  startStack: 5000,
  rebuyChips: 5000,
  requirePayment: 0,
  ...Object.fromEntries(OLD_SB.flatMap((sb, i) => [[`sb${i + 1}`, sb], [`bb${i + 1}`, OLD_BB[i]]])),
});
const mk = (n: number, settings: Record<string, number> = {}, startedAt: number | null = T0): BoardContext => ({
  players: Array.from({ length: n }, (_, i) => player(i + 1)),
  table: { name: 'T1', seats: 10, w: 0.3, h: 0.15 },
  rerollsAllowed: false,
  rerollsLeft: {},
  useReroll: async () => undefined,
  settings: { ...defaults(), ...settings },
  startedAt,
} as BoardContext);

describe('settings and data', () => {
  it('has the agreed defaults', () => {
    expect(SETTINGS.format!.default).toBe(0);
    expect(SETTINGS.startStack!.default).toBe(2000);
    expect(SETTINGS.buyIn).toMatchObject({ default: 20, min: 5, max: 100 });
    expect(SETTINGS.levelMinutes!.default).toBe(20);
    expect(SETTINGS.blindLevels!.default).toBe(8);
    expect(SETTINGS.antePercent!.default).toBe(0);
    expect(SETTINGS.maxRebuys!.default).toBe(3);
    expect(SETTINGS.rebuyUntilLevel!.default).toBe(4);
    expect(SETTINGS.countEveryMinutes!.default).toBe(30);
    expect(SETTINGS.headsUpRule!.default).toBe(1);
  });
  it('has the agreed blind schedule', () => {
    const c = mk(2);
    const got = [1, 2, 3, 4, 5, 6, 7, 8].map((l) => `${blindsFor(l, c.settings).sb}/${blindsFor(l, c.settings).bb}`);
    expect(got).toEqual(['25/50', '50/100', '75/150', '100/200', '150/300', '200/400', '300/600', '400/800']);
  });
  it('every setting has a sane range', () => {
    for (const s of Object.values(SETTINGS)) {
      expect(s.min).toBeLessThanOrEqual(s.default);
      expect(s.default).toBeLessThanOrEqual(s.max);
    }
  });
  it('antes are a percent of the big blind and off by default', () => {
    expect(blindsFor(3, mk(2).settings).ante).toBe(0);
    expect(blindsFor(3, mk(2, { antePercent: 10 }).settings).ante).toBe(15);
    expect(blindText(blindsFor(3, mk(2, { antePercent: 10 }).settings))).toBe('75/150 (ante 15)');
  });
  it('limits blind levels to the number in use', () => {
    const c = mk(2, { blindLevels: 3 });
    expect(blindsFor(9, c.settings)).toEqual(blindsFor(3, c.settings));
    expect(blindsFor(0, c.settings)).toEqual(blindsFor(1, c.settings));
  });
  it('matches the key and label of the classics entry', () => {
    expect(def.key).toBe('poker');
    expect(SETTINGS.stepSmall!.default).toBe(100);
    expect(SETTINGS.stepBig!.default).toBe(1000);
    expect(def.label).toBe("Texas Hold'em");
  });
  it('formats numbers and times', () => {
    expect(chips(1234567)).toBe('1,234,567');
    expect(money(40)).toBe('$40');
    expect(clockText(19 * MIN + 5000)).toBe('19:05');
    expect(clockText(-5)).toBe('0:00');
    expect(spanText(85 * MIN)).toBe('1h 25m');
    expect(spanText(45 * MIN)).toBe('45m');
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(23)).toBe('23rd');
  });
});

describe('init', () => {
  it('everyone starts with the starting stack and one buy-in, as plain JSON', () => {
    const ctx = mk(4);
    const s = init(ctx);
    expect(Object.values(s.players).every((p) => p.stack === 5000 && p.buys.length === 1 && !p.out)).toBe(true);
    expect(paidDollars(s.players[1]!)).toBe(20);
    expect(boughtChips(s.players[1]!)).toBe(5000);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(s.clock.anchor).toBe(T0);
  });
  it('reads the starting stack and buy-in from settings', () => {
    const s = init(mk(2, { startStack: 10000, buyIn: 50 }));
    expect(s.players[1]!.stack).toBe(10000);
    expect(paidDollars(s.players[1]!)).toBe(50);
  });
  it('leaves the clock unstarted when the start time is unknown', () => {
    expect(init(mk(2, {}, null)).clock.anchor).toBeNull();
  });
  it('handles an empty game', () => {
    expect(init(mk(0)).players).toEqual({});
  });
  it('reads a player the state does not know yet as a fresh buy-in', () => {
    const ctx = mk(2);
    expect(pl(init(mk(1)), 2, ctx).stack).toBe(5000);
  });
});

describe('chips and totals', () => {
  it('sets a stack, clamps it, and ignores no-ops and bad numbers', () => {
    const ctx = mk(3);
    const s = init(ctx);
    const a = setStack(s, ctx, 1, 7000, T0);
    expect(a.players[1]!.stack).toBe(7000);
    expect(setStack(a, ctx, 1, 7000, T0)).toBe(a);
    expect(setStack(a, ctx, 1, NaN, T0)).toBe(a);
    expect(setStack(a, ctx, 1, -50, T0).players[1]!.stack).toBe(0);
    expect(setStack(a, ctx, 1, 9e12, T0).players[1]!.stack).toBe(10000000);
    expect(setStack(a, ctx, 99, 10, T0)).toBe(a);
  });
  it('folds quick taps into one history line, and drops it if the chips come back', () => {
    const ctx = mk(2);
    let s = init(ctx);
    s = setStack(s, ctx, 1, 5100, T0);
    s = setStack(s, ctx, 1, 5200, T0 + 1000);
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ from: 5000, to: 5200 });
    s = setStack(s, ctx, 1, 5000, T0 + 2000);
    expect(s.log).toHaveLength(0);
    s = setStack(s, ctx, 1, 5100, T0 + 60000);
    s = setStack(s, ctx, 1, 5300, T0 + 120000);
    expect(s.log).toHaveLength(2);
  });
  it('totals chips on the table against chips bought in', () => {
    const ctx = mk(3);
    let s = init(ctx);
    expect(chipTotals(s, ctx)).toEqual({ onTable: 15000, boughtIn: 15000, diff: 0, dollars: 60, removedChips: 0 });
    s = setStack(s, ctx, 1, 6000, T0);
    expect(chipTotals(s, ctx).diff).toBe(1000);
  });
  it('chip leader scores highest and out players score 0', () => {
    const ctx = mk(3);
    let s = setStack(init(ctx), ctx, 2, 9000, T0);
    s = bust(s, ctx, [3], T0);
    expect(score(s, ctx)).toEqual({ 1: 5000, 2: 9000, 3: 0 });
  });
});

describe('count rounds', () => {
  it('sets everyone and stores a timestamped snapshot', () => {
    const ctx = mk(3);
    const s = recordCount(init(ctx), ctx, { 1: 4000, 2: 6000, 3: 5000 }, T0 + 30 * MIN);
    expect(s.players[1]!.stack).toBe(4000);
    expect(s.snaps).toHaveLength(1);
    expect(s.snaps[0]).toMatchObject({ t: T0 + 30 * MIN, stacks: { 1: 4000, 2: 6000, 3: 5000 } });
    expect(s.log[0]).toMatchObject({ kind: 'count', amount: 15000 });
    expect(s.snaps[0]!.id).toBe(s.log[0]!.id);
  });
  it('keeps unlisted players as they are, and records out players as 0', () => {
    const ctx = mk(3);
    let s = bust(init(ctx), ctx, [3], T0);
    s = recordCount(s, ctx, { 1: 8000 }, T0 + MIN);
    expect(s.snaps[0]!.stacks).toEqual({ 1: 8000, 2: 5000, 3: 0 });
  });
  it('ignores bad numbers and clamps', () => {
    const ctx = mk(2);
    const s = recordCount(init(ctx), ctx, { 1: NaN, 2: -5 }, T0);
    expect(s.snaps[0]!.stacks).toEqual({ 1: 5000, 2: 0 });
  });
  it('is harmless to repeat at the same moment', () => {
    const ctx = mk(2);
    const a = recordCount(init(ctx), ctx, { 1: 6000, 2: 4000 }, T0 + MIN);
    expect(recordCount(a, ctx, { 1: 6000, 2: 4000 }, T0 + MIN)).toBe(a);
  });
  it('keeps only logMax snapshots', () => {
    const ctx = mk(2, { logMax: 50 });
    let s = init(ctx);
    for (let i = 0; i < 60; i++) s = recordCount(s, ctx, { 1: 5000 + i, 2: 5000 - i }, T0 + i * 1000);
    expect(s.snaps).toHaveLength(50);
    expect(s.log).toHaveLength(50);
  });
});

describe('reminders', () => {
  it('is due 30 minutes after the start, then 30 minutes after each count', () => {
    const ctx = mk(2);
    let s = init(ctx);
    expect(countDue(s, ctx, T0 + 29 * MIN).due).toBe(false);
    expect(countDue(s, ctx, T0 + 30 * MIN)).toEqual({ due: true, dueAt: T0 + 30 * MIN });
    s = recordCount(s, ctx, { 1: 5000, 2: 5000 }, T0 + 40 * MIN);
    expect(countDue(s, ctx, T0 + 69 * MIN).due).toBe(false);
    expect(countDue(s, ctx, T0 + 70 * MIN).due).toBe(true);
  });
  it('can be put off for a full interval, and follows the setting', () => {
    const ctx = mk(2, { countEveryMinutes: 10 });
    let s = init(ctx);
    expect(countDue(s, ctx, T0 + 10 * MIN).due).toBe(true);
    s = snoozeCount(s, T0 + 12 * MIN);
    expect(snoozeCount(s, T0 + 12 * MIN)).toBe(s);
    expect(countDue(s, ctx, T0 + 21 * MIN).due).toBe(false);
    expect(countDue(s, ctx, T0 + 22 * MIN).due).toBe(true);
  });
  it('has no reminder before the game has a start time', () => {
    const ctx = mk(2, {}, null);
    expect(countDue(init(ctx), ctx, T0)).toEqual({ due: false, dueAt: null });
    const s = startClock(init(ctx), ctx, T0);
    expect(countDue(s, ctx, T0 + 30 * MIN).due).toBe(true);
  });
});

describe('blind clock', () => {
  it('moves up a level every levelMinutes with no one tapping', () => {
    const ctx = mk(2);
    const s = init(ctx);
    expect(clockInfo(s, ctx, T0).level).toBe(1);
    expect(clockInfo(s, ctx, T0 + 19 * MIN).level).toBe(1);
    expect(clockInfo(s, ctx, T0 + 20 * MIN).level).toBe(2);
    expect(clockInfo(s, ctx, T0 + 65 * MIN).level).toBe(4);
    expect(clockInfo(s, ctx, T0 + 65 * MIN).remainingMs).toBe(15 * MIN);
    expect(clockInfo(s, ctx, T0 + 100 * 60 * MIN).level).toBe(8);
    expect(clockInfo(s, ctx, T0 + 100 * 60 * MIN).remainingMs).toBeNull();
  });
  it('flags a new level until it is acknowledged, and writes each level into the history', () => {
    const ctx = mk(2);
    let s = init(ctx);
    const now = T0 + 45 * MIN;
    expect(clockInfo(s, ctx, now).newLevel).toBe(true);
    s = ackLevels(s, ctx, now);
    expect(clockInfo(s, ctx, now).newLevel).toBe(false);
    expect(s.log.map((e) => [e.level, e.t, e.from, e.to])).toEqual([
      [2, T0 + 20 * MIN, 50, 100],
      [3, T0 + 40 * MIN, 75, 150],
    ]);
    expect(ackLevels(s, ctx, now)).toBe(s);
  });
  it('does not run before it is started, and starting twice does nothing', () => {
    const ctx = mk(2, {}, null);
    let s = init(ctx);
    expect(clockInfo(s, ctx, T0 + 999 * MIN)).toMatchObject({ started: false, level: 1, remainingMs: null });
    s = startClock(s, ctx, T0);
    expect(clockInfo(s, ctx, T0 + 25 * MIN).level).toBe(2);
    expect(startClock(s, ctx, T0 + MIN)).toBe(s);
  });
  it('pauses and resumes without losing time', () => {
    const ctx = mk(2);
    let s = init(ctx);
    s = pauseClock(s, ctx, T0 + 10 * MIN);
    expect(pauseClock(s, ctx, T0 + 11 * MIN)).toBe(s);
    expect(clockInfo(s, ctx, T0 + 500 * MIN)).toMatchObject({ paused: true, level: 1, remainingMs: 10 * MIN });
    s = resumeClock(s, ctx, T0 + 30 * MIN);
    expect(resumeClock(s, ctx, T0 + 31 * MIN)).toBe(s);
    expect(clockInfo(s, ctx, T0 + 30 * MIN).remainingMs).toBe(10 * MIN);
    expect(clockInfo(s, ctx, T0 + 40 * MIN).level).toBe(2);
  });
  it('pausing first records levels already reached', () => {
    const ctx = mk(2);
    const s = pauseClock(init(ctx), ctx, T0 + 25 * MIN);
    expect(s.log.map((e) => e.kind)).toEqual(['blinds', 'clock']);
  });
  it('lets the GM set the level by hand and restarts that level', () => {
    const ctx = mk(2);
    let s = init(ctx);
    s = setLevel(s, ctx, 4, T0 + 5 * MIN);
    expect(clockInfo(s, ctx, T0 + 5 * MIN)).toMatchObject({ level: 4, remainingMs: 20 * MIN, newLevel: false });
    expect(s.log[s.log.length - 1]).toMatchObject({ kind: 'blinds', level: 4, manual: true, from: 100, to: 200 });
    expect(setLevel(s, ctx, 4, T0 + 6 * MIN)).toBe(s);
    expect(clockInfo(setLevel(s, ctx, 99, T0 + 6 * MIN), ctx, T0 + 6 * MIN).level).toBe(8);
    expect(clockInfo(setLevel(s, ctx, -3, T0 + 6 * MIN), ctx, T0 + 6 * MIN).level).toBe(1);
  });
  it('a cash game keeps its blinds until the GM changes them', () => {
    const ctx = mk(2, { format: 1 });
    const s = init(ctx);
    expect(clockInfo(s, ctx, T0 + 500 * MIN)).toMatchObject({ level: 1, remainingMs: null, newLevel: false });
    expect(clockInfo(setLevel(s, ctx, 3, T0), ctx, T0 + 500 * MIN).level).toBe(3);
  });
  it('follows the minutes-per-level setting', () => {
    const ctx = mk(2, { levelMinutes: 10 });
    expect(clockInfo(init(ctx), ctx, T0 + 10 * MIN).level).toBe(2);
  });
});

describe('bust-outs and placements', () => {
  it('latest out places highest; the last player standing wins', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = bust(s, ctx, [4], T0 + MIN);
    s = bust(s, ctx, [2], T0 + 2 * MIN);
    s = bust(s, ctx, [3], T0 + 3 * MIN);
    expect(placements(s, ctx)).toEqual([[1], [3], [2], [4]]);
    expect(status(s, ctx)).toEqual({ alive: [1], winnerId: 1, over: true });
  });
  it('players out on the same hand share a place', () => {
    const ctx = mk(5);
    let s = bust(init(ctx), ctx, [5], T0);
    s = bust(s, ctx, [3, 4], T0 + MIN);
    expect(placements(s, ctx)).toEqual([[1, 2], [3, 4], [5]]);
    expect(recap(s, ctx).map((r) => [r.name, r.place, r.tied])).toEqual([
      ['P1', 1, true], ['P2', 1, true], ['P3', 3, true], ['P4', 3, true], ['P5', 5, false],
    ]);
  });
  it('can move someone into the same hand afterwards', () => {
    const ctx = mk(4);
    let s = bust(init(ctx), ctx, [3], T0);
    s = bust(s, ctx, [4], T0 + MIN);
    expect(placements(s, ctx)).toEqual([[1, 2], [4], [3]]);
    s = mergeBust(s, ctx, 3, 4, T0 + 2 * MIN);
    expect(placements(s, ctx)).toEqual([[1, 2], [3, 4]]);
    expect(mergeBust(s, ctx, 3, 4, T0 + 3 * MIN)).toBe(s);
    expect(mergeBust(s, ctx, 3, 1, T0 + 3 * MIN)).toBe(s);
    expect(mergeBust(s, ctx, 3, 3, T0 + 3 * MIN)).toBe(s);
  });
  it('someone always stays in, and repeats do nothing', () => {
    const ctx = mk(3);
    let s = bust(init(ctx), ctx, [1, 2], T0);
    expect(bustBlock(s, ctx, [3])).toMatch(/stay in/);
    expect(bust(s, ctx, [3], T0)).toBe(s);
    expect(bust(s, ctx, [1], T0)).toBe(s);
    expect(bustBlock(init(ctx), ctx, [])).toBe('Pick who is out.');
    expect(bustBlock(init(ctx), ctx, [1, 2, 3])).toMatch(/stay in/);
    expect(bustBlock(s, ctx, [1])).toMatch(/already out/);
    s = bust(init(ctx), ctx, [1, 1], T0);
    expect(s.players[1]!.out).toBe(true);
  });
  it('ranks the players still in by chips (equal chips tie) above everyone out when time is called', () => {
    const ctx = mk(5);
    let s = bust(init(ctx), ctx, [5], T0);
    s = setStack(s, ctx, 1, 9000, T0);
    s = setStack(s, ctx, 2, 3000, T0);
    s = setStack(s, ctx, 3, 3000, T0);
    s = setStack(s, ctx, 4, 4000, T0);
    expect(placements(s, ctx)).toEqual([[1], [4], [2, 3], [5]]);
    expect(status(s, ctx).over).toBe(false);
  });
  it('a bust-out empties the stack and a restore brings it back', () => {
    const ctx = mk(3);
    let s = setStack(init(ctx), ctx, 2, 1200, T0);
    s = bust(s, ctx, [2], T0 + MIN);
    expect(s.players[2]).toMatchObject({ out: true, stack: 0, backup: 1200, outAt: T0 + MIN });
    expect(setStack(s, ctx, 2, 500, T0)).toBe(s);
    s = restore(s, ctx, 2, T0 + 2 * MIN);
    expect(s.players[2]).toMatchObject({ out: false, stack: 1200, outAt: null, outGroup: null });
    expect(restore(s, ctx, 2, T0)).toBe(s);
  });
  it('a cash game ranks everyone by chips when time is called', () => {
    const ctx = mk(4, { format: 1 });
    let s = init(ctx);
    s = setStack(s, ctx, 1, 2000, T0);
    s = setStack(s, ctx, 2, 9000, T0);
    s = setStack(s, ctx, 3, 2000, T0);
    s = setStack(s, ctx, 4, 7000, T0);
    expect(placements(s, ctx)).toEqual([[2], [4], [1, 3]]);
    expect(status(s, ctx)).toMatchObject({ winnerId: null, over: false });
    s = bust(s, ctx, [1], T0);
    expect(placements(s, ctx)).toEqual([[2], [4], [3], [1]]);
  });
  it('gives every player a place even with one player or none', () => {
    expect(placements(init(mk(1)), mk(1))).toEqual([[1]]);
    expect(status(init(mk(1)), mk(1)).over).toBe(false);
    expect(placements(init(mk(0)), mk(0))).toEqual([]);
  });
});

describe('rebuys', () => {
  it('cost the buy-in, add chips, and count toward the limit', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = setStack(s, ctx, 1, 300, T0);
    s = rebuy(s, ctx, 1, T0 + MIN);
    expect(s.players[1]!.stack).toBe(5300);
    expect(paidDollars(s.players[1]!)).toBe(40);
    expect(chipTotals(s, ctx).dollars).toBe(80);
    s = rebuy(rebuy(s, ctx, 1, T0 + 2 * MIN), ctx, 1, T0 + 3 * MIN);
    expect(paidDollars(s.players[1]!)).toBe(80);
    expect(rebuyBlock(s, ctx, 1, T0 + 4 * MIN)).toBe('P1 has used all 3 rebuys.');
    expect(rebuy(s, ctx, 1, T0 + 4 * MIN)).toBe(s);
  });
  it('bring a player who is out back in without changing the bust order', () => {
    const ctx = mk(4);
    let s = bust(init(ctx), ctx, [3], T0 + MIN);
    s = bust(s, ctx, [4], T0 + 2 * MIN);
    s = rebuy(s, ctx, 3, T0 + 3 * MIN);
    expect(s.players[3]).toMatchObject({ out: false, stack: 5000, outAt: null });
    expect(placements(s, ctx)).toEqual([[1, 2, 3], [4]]);
    s = bust(s, ctx, [3], T0 + 4 * MIN);
    expect(placements(s, ctx)).toEqual([[1, 2], [3], [4]]);
  });
  it('close after the cutoff level and can be turned off', () => {
    const ctx = mk(2);
    const s = init(ctx);
    expect(rebuyBlock(s, ctx, 1, T0 + 79 * MIN)).toBeNull();
    expect(rebuyBlock(s, ctx, 1, T0 + 80 * MIN)).toBe('Rebuys closed after blind level 4.');
    expect(rebuy(s, ctx, 1, T0 + 80 * MIN)).toBe(s);
    expect(rebuyBlock(init(mk(2, { maxRebuys: 0 })), mk(2, { maxRebuys: 0 }), 1, T0)).toMatch(/off/);
    expect(rebuyBlock(s, ctx, 99, T0)).toMatch(/isn.t in this game/);
  });
  it('follow the settings for chips and cost', () => {
    const ctx = mk(2, { rebuyChips: 2500, buyIn: 100 });
    const s = rebuy(init(ctx), ctx, 1, T0);
    expect(s.players[1]!.stack).toBe(7500);
    expect(paidDollars(s.players[1]!)).toBe(200);
  });
  it('can be undone, including one that brought a player back in', () => {
    const ctx = mk(3);
    let s = setStack(init(ctx), ctx, 1, 100, T0);
    s = rebuy(s, ctx, 1, T0);
    s = undoRebuy(s, ctx, 1, T0);
    expect(s.players[1]).toMatchObject({ stack: 100 });
    expect(s.players[1]!.buys).toHaveLength(1);
    expect(undoRebuy(s, ctx, 1, T0).players[1]!.buys).toHaveLength(1);
    expect(undoRebuy(s, ctx, 1, T0)).toEqual(s);
    let b = bust(init(ctx), ctx, [2], T0 + MIN);
    const before = b.players[2]!;
    b = rebuy(b, ctx, 2, T0 + 2 * MIN);
    b = undoRebuy(b, ctx, 2, T0 + 3 * MIN);
    expect(b.players[2]).toEqual(before);
  });
  it('keeps chips bought in matching the table when a rebuy happens', () => {
    const ctx = mk(2);
    let s = init(ctx);
    s = rebuy(s, ctx, 2, T0);
    expect(chipTotals(s, ctx).diff).toBe(0);
  });
});

describe('dealer button', () => {
  it('starts on the first seat, then moves clockwise one seat per hand', () => {
    const ctx = mk(4);
    let s = nextHand(init(ctx), ctx);
    expect(s).toMatchObject({ button: 1, hand: 1 });
    expect(buttonInfo(s, ctx)).toEqual({ dealer: 1, sb: 2, bb: 3, headsUp: false });
    s = nextHand(s, ctx);
    expect(buttonInfo(s, ctx)).toEqual({ dealer: 2, sb: 3, bb: 4, headsUp: false });
    s = nextHand(nextHand(s, ctx), ctx);
    expect(buttonInfo(s, ctx)).toEqual({ dealer: 4, sb: 1, bb: 2, headsUp: false });
    expect(s.hand).toBe(4);
    expect(buttonInfo(nextHand(s, ctx), ctx)!.dealer).toBe(1);
  });
  it('keeps the labels of the hand just played when someone goes out, then skips players who are out', () => {
    const ctx = mk(4);
    let s = setButton(init(ctx), ctx, 2);
    expect(buttonInfo(s, ctx)).toEqual({ dealer: 2, sb: 3, bb: 4, headsUp: false });
    s = bust(s, ctx, [3], T0);
    expect(buttonInfo(s, ctx)).toEqual({ dealer: 2, sb: 3, bb: 4, headsUp: false });
    s = nextHand(s, ctx);
    expect(buttonInfo(s, ctx)).toEqual({ dealer: 4, sb: 1, bb: 2, headsUp: false });
    s = bust(s, ctx, [4], T0);
    expect(buttonInfo(s, ctx)!.dealer).toBe(4);
    expect(buttonInfo(nextHand(s, ctx), ctx)).toEqual({ dealer: 1, sb: 1, bb: 2, headsUp: true });
  });
  it('follows seat numbers, not player ids, and puts unseated players last', () => {
    const ctx = mk(3);
    ctx.players = [player(1, 3), player(2, 1), player(3, null)];
    let s = nextHand(init(ctx), ctx);
    expect(s.button).toBe(2);
    s = nextHand(s, ctx);
    expect(s.button).toBe(1);
    s = nextHand(s, ctx);
    expect(s.button).toBe(3);
  });
  it('heads-up: the dealer posts the small blind (standard rule), or normal rotation when off', () => {
    const ctx = mk(3);
    let s = bust(setButton(init(ctx), ctx, 1), ctx, [3], T0);
    s = nextHand(s, ctx);
    expect(buttonInfo(s, ctx)).toEqual({ dealer: 2, sb: 2, bb: 1, headsUp: true });
    expect(buttonInfo(nextHand(s, ctx), ctx)).toEqual({ dealer: 1, sb: 1, bb: 2, headsUp: true });
    const off = mk(3, { headsUpRule: 0 });
    s = nextHand(bust(setButton(init(off), off, 1), off, [3], T0), off);
    expect(buttonInfo(s, off)).toEqual({ dealer: 2, sb: 1, bb: 2, headsUp: true });
    expect(buttonInfo(nextHand(s, off), off)).toEqual({ dealer: 1, sb: 2, bb: 1, headsUp: true });
  });
  it('never gives anyone the big blind twice in a row when the table goes heads-up', () => {
    const ctx = mk(3);
    let s = nextHand(setButton(init(ctx), ctx, 1), ctx);
    const before = buttonInfo(s, ctx)!;
    s = nextHand(bust(s, ctx, [before.sb], T0), ctx);
    expect(buttonInfo(s, ctx)!.bb).not.toBe(before.bb);
  });
  it('has nothing to show before it is set or when fewer than 2 players can be dealt in', () => {
    const ctx = mk(3);
    expect(buttonInfo(init(ctx), ctx)).toBeNull();
    const s = bust(init(ctx), ctx, [2, 3], T0);
    expect(setButton(s, ctx, 1).deal).toBeNull();
    expect(nextHand(s, ctx)).toBe(s);
  });
  it('only sets the button on a player who is still in', () => {
    const ctx = mk(3);
    const s = bust(init(ctx), ctx, [3], T0);
    expect(setButton(s, ctx, 3)).toBe(s);
    expect(setButton(s, ctx, 99)).toBe(s);
    const b = setButton(s, ctx, 2);
    expect(setButton(b, ctx, 2)).toBe(b);
    expect(b.hand).toBe(1);
  });
});

describe('crown pin', () => {
  it('puts a pinned player in front, and clears back to the chip leader', () => {
    const ctx = mk(3);
    let s = setStack(init(ctx), ctx, 2, 9000, T0);
    s = setPin(s, ctx, 3, T0);
    const sc = score(s, ctx);
    expect(sc[3]).toBe(9001);
    expect(sc[2]).toBe(9000);
    expect(setPin(s, ctx, 3, T0)).toBe(s);
    s = setPin(s, ctx, null, T0 + MIN);
    expect(score(s, ctx)[3]).toBe(5000);
    expect(setPin(s, ctx, null, T0)).toBe(s);
  });
  it('is ignored once the pinned player is out, and only pins players still in', () => {
    const ctx = mk(3);
    let s = setPin(init(ctx), ctx, 3, T0);
    s = bust(s, ctx, [3], T0);
    expect(score(s, ctx)[3]).toBe(0);
    expect(setPin(s, ctx, 3, T0)).toBe(s);
    expect(setPin(s, ctx, 99, T0)).toBe(s);
  });
  it('keeps the pinned score at least their own chips', () => {
    const ctx = mk(2);
    const s = setPin(setStack(init(ctx), ctx, 1, 9000, T0), ctx, 1, T0);
    expect(score(s, ctx)[1]).toBe(9000);
  });
});

describe('notes and history text', () => {
  it('adds, trims and ignores empty notes', () => {
    const ctx = mk(2);
    const s = addNote(init(ctx), ctx, '  big hand  ', 1, T0);
    expect(s.log[0]).toMatchObject({ kind: 'note', text: 'big hand', playerId: 1 });
    expect(addNote(s, ctx, '   ', 1, T0)).toBe(s);
    expect(addNote(s, ctx, 'x'.repeat(999), 77, T0).log[1]!.text).toHaveLength(280);
    expect(addNote(s, ctx, 'x', 77, T0).log[1]!.playerId).toBeNull();
  });
  it('describes every kind of line', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = setStack(s, ctx, 1, 6000, T0);
    s = recordCount(s, ctx, { 1: 6000, 2: 4000, 3: 5000 }, T0 + MIN);
    s = bust(s, ctx, [2], T0 + 2 * MIN);
    s = bust(s, ctx, [3], T0 + 3 * MIN);
    s = mergeBust(s, ctx, 3, 2, T0 + 4 * MIN);
    s = rebuy(s, ctx, 3, T0 + 5 * MIN);
    s = undoRebuy(s, ctx, 3, T0 + 6 * MIN);
    s = restore(s, ctx, 3, T0 + 7 * MIN);
    s = setLevel(s, ctx, 2, T0 + 8 * MIN);
    s = setPin(s, ctx, 1, T0 + 9 * MIN);
    s = setPin(s, ctx, null, T0 + 10 * MIN);
    s = pauseClock(s, ctx, T0 + 11 * MIN);
    s = addNote(s, ctx, 'hello', null, T0 + 12 * MIN);
    const name = (id: number) => `P${id}`;
    expect(s.log.map((e) => describeEntry(e, name))).toEqual([
      'P1: chips 5,000 \u2192 6,000',
      'Chip count taken (15,000 chips on the table)',
      'P2 is out',
      'P3 is out',
      'P3 went out on the same hand as P2',
      'P3 rebought 5,000 chips for $20',
      "P3's last rebuy was undone",
      'P3 is back in (bust-out undone)',
      'Blinds set to level 2: 50/100',
      'Crown pinned on P1',
      'Crown pin removed (the chip leader wears it)',
      'Blind clock paused',
      'hello',
    ]);
    const multi = bust(init(ctx), ctx, [1, 2], T0);
    expect(describeEntry(multi.log[0]!, name)).toBe('P1 and P2 went out on the same hand');
  });
});

describe('recap', () => {
  it('writes a per-player recap with place, chips, buy-in and the night\u2019s trail', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = recordCount(s, ctx, { 1: 7000, 2: 5000, 3: 3000 }, T0 + 30 * MIN);
    s = recordCount(s, ctx, { 1: 6000, 2: 9000, 3: 0 }, T0 + 60 * MIN);
    s = rebuy(s, ctx, 3, T0 + 61 * MIN);
    s = bust(s, ctx, [3], T0 + 85 * MIN);
    s = bust(s, ctx, [1], T0 + 95 * MIN);
    const rows = recap(s, ctx);
    expect(rows.map((r) => [r.name, r.place])).toEqual([['P2', 1], ['P1', 2], ['P3', 3]]);
    expect(rows[0]).toMatchObject({ winner: true, stack: 9000, rebuys: 0, dollars: 20 });
    const p3 = rows[2]!;
    expect(p3).toMatchObject({ out: true, rebuys: 1, dollars: 40, outAfterMs: 85 * MIN });
    expect(p3.trail).toEqual([5000, 3000, 0, 0]);
    expect(recapText(rows[0]!, false)).toContain('1st place');
    expect(recapText(rows[0]!, false)).toContain('Last one standing with 9,000 chips.');
    expect(recapText(p3, false)).toContain('Went out after 1h 25m.');
    expect(recapText(p3, false)).toContain('Bought in for $40 (1 rebuy).');
    expect(recapText(p3, false)).toContain('5,000 \u2192 3,000 \u2192 0 \u2192 0');
    expect(recapText(rows[1]!, false)).toContain('Biggest stack: 7,000 chips (30m in).');
  });
  it('says when time was called, and handles cash games and unknown start times', () => {
    const ctx = mk(2, {}, null);
    const s = setStack(init(ctx), ctx, 1, 8000, T0);
    const rows = recap(s, ctx);
    expect(recapText(rows[0]!, false)).toContain('Still in with 8,000 chips when time was called.');
    const cash = mk(2, { format: 1 });
    expect(recapText(recap(setStack(init(cash), cash, 1, 8000, T0), cash)[0]!, true)).toContain('Finished with 8,000 chips.');
    expect(recapText(recap(bust(init(ctx), ctx, [2], T0), ctx)[1]!, false)).toContain('Went out.');
  });
  it('exposes a text recap through the board definition', () => {
    const ctx = mk(2);
    const out = def.recap!(init(ctx), ctx);
    expect(out.map((r) => r.playerId).sort()).toEqual([1, 2]);
    expect(out[0]!.text).toContain("Texas Hold'em recap");
  });
});

describe('players added after the start', () => {
  it('get a fresh buy-in the first time they are touched', () => {
    const ctx = mk(2);
    const s = init(ctx);
    const bigger = mk(3);
    const a = setStack(s, bigger, 3, 4000, T0);
    expect(a.players[3]).toMatchObject({ stack: 4000 });
    expect(paidDollars(a.players[3]!)).toBe(20);
  });
});

describe('state stays plain JSON through a whole night', () => {
  it('round-trips', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = nextHand(s, ctx);
    s = recordCount(s, ctx, { 1: 6000, 2: 5000, 3: 4000, 4: 5000 }, T0 + 30 * MIN);
    s = rebuy(s, ctx, 3, T0 + 31 * MIN);
    s = bust(s, ctx, [4], T0 + 50 * MIN);
    s = ackLevels(s, ctx, T0 + 60 * MIN);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(typeof (s as PokerState).v).toBe('number');
  });
});


describe('fixes: logic', () => {
  it('a crown pinned on someone who goes out is dropped and does not come back after a rebuy', () => {
    const c = mk(3);
    let s = setPin(init(c), c, 3, T0);
    s = bust(s, c, [3], T0);
    expect(s.pin).toBeNull();
    s = rebuy(s, c, 3, T0 + MIN);
    expect(score(s, c)[3]).toBe(5000);
    expect(s.log.map((e) => e.kind)).toEqual(['pin', 'bust', 'pin', 'rebuy']);
  });
  it('a rebuy that would pass the chip limit is refused, so chips bought stay in step', () => {
    const c = mk(2, { chipMax: 6000 });
    const s = init(c);
    expect(rebuyBlock(s, c, 1, T0)).toMatch(/chip limit \(6,000\)/);
    expect(rebuy(s, c, 1, T0)).toBe(s);
    expect(rebuyBlock(bust(s, c, [2], T0), c, 2, T0)).toBeNull();
    const c2 = mk(2, { chipMax: 4000, startStack: 5000, rebuyChips: 5000 });
    expect(init(c2).players[1]!.stack).toBe(4000);
    expect(boughtChips(init(c2).players[1]!)).toBe(4000);
    expect(rebuyBlock(bust(init(c2), c2, [2], T0), c2, 2, T0)).toMatch(/chip limit/);
  });
  it('changing minutes per level mid-game keeps the level and its time so far', () => {
    const c = mk(2);
    let s = ackLevels(init(c), c, T0 + 100 * MIN);
    const c2 = mk(2, { levelMinutes: 60 });
    s = syncClock(s, c2, T0 + 100 * MIN);
    expect(clockInfo(s, c2, T0 + 100 * MIN).level).toBe(6);
    expect(clockInfo(s, c2, T0 + 100 * MIN).remainingMs).toBe(60 * MIN);
    expect(clockInfo(s, c2, T0 + 130 * MIN).remainingMs).toBe(30 * MIN);
    expect(clockInfo(s, c2, T0 + 160 * MIN).level).toBe(7);
    expect(clockInfo(s, c2, T0 + 160 * MIN).newLevel).toBe(true);
    expect(syncClock(s, c2, T0 + 101 * MIN)).toBe(s);
    expect(s.log[s.log.length - 1]!.text).toBe('Blind level length is now 60 min');
  });
  it('levels reached before a length change are written to the history with their real times', () => {
    const c = mk(2);
    const s = syncClock(init(c), mk(2, { levelMinutes: 60 }), T0 + 45 * MIN);
    expect(s.log.filter((e) => e.kind === 'blinds').map((e) => [e.level, e.t])).toEqual([[2, T0 + 20 * MIN], [3, T0 + 40 * MIN]]);
  });
  it('mid-level changes carry over the time already played; a level already longer than the new length ends at once', () => {
    const c10 = mk(2, { levelMinutes: 10 });
    const s = syncClock(init(mk(2)), c10, T0 + 7 * MIN);
    expect(clockInfo(s, c10, T0 + 7 * MIN)).toMatchObject({ level: 1, remainingMs: 3 * MIN });
    const t = syncClock(init(mk(2)), c10, T0 + 15 * MIN);
    expect(clockInfo(t, c10, T0 + 15 * MIN)).toMatchObject({ level: 1, remainingMs: 1 });
    expect(clockInfo(t, c10, T0 + 15 * MIN + 2).level).toBe(2);
  });
  it('shrinking the number of blind levels brings the running level back in range and keeps alerts working', () => {
    const c = mk(2);
    let s = setLevel(init(c), c, 6, T0);
    const c3 = mk(2, { blindLevels: 3 });
    s = syncClock(s, c3, T0 + MIN);
    expect(s.clock.base).toBe(3);
    expect(s.clock.ackLevel).toBe(3);
    const c5 = mk(2, { blindLevels: 5 });
    expect(clockInfo(s, c5, T0 + 21 * MIN).level).toBe(4);
    expect(clockInfo(s, c5, T0 + 21 * MIN).newLevel).toBe(true);
  });
  it('syncClock is quiet when nothing changed and handles an unstarted clock', () => {
    const c = mk(2);
    const s = init(c);
    expect(syncClock(s, c, T0)).toBe(s);
    const cn = mk(2, {}, null);
    const u = init(cn);
    expect(syncClock(u, cn, T0)).toBe(u);
    expect(syncClock(u, mk(2, { levelMinutes: 5, blindLevels: 2 }, null), T0).clock.per).toBe(5 * MIN);
  });
  it('count reminders stay quiet once the game is over or the clock is paused', () => {
    const c = mk(2);
    expect(countDue(bust(init(c), c, [2], T0), c, T0 + 31 * MIN).due).toBe(false);
    expect(countDue(pauseClock(init(c), c, T0 + MIN), c, T0 + 31 * MIN).due).toBe(false);
    expect(countDue(pauseClock(init(c), c, T0 + MIN), c, T0 + 31 * MIN).dueAt).toBe(T0 + 30 * MIN);
    const s = resumeClock(pauseClock(init(c), c, T0 + MIN), c, T0 + 2 * MIN);
    expect(countDue(s, c, T0 + 31 * MIN).due).toBe(true);
  });
  it('lists players who are still in with 0 chips', () => {
    const c = mk(3);
    let s = setStack(init(c), c, 2, 0, T0);
    expect(zeroChipAlive(s, c)).toEqual([2]);
    s = bust(s, c, [2], T0);
    expect(zeroChipAlive(s, c)).toEqual([]);
  });
  it('flags a blind schedule that is out of order', () => {
    expect(blindProblems(mk(2).settings)).toEqual([]);
    expect(blindProblems(mk(2, { sb1: 900, bb1: 50 }).settings)[0]).toMatch(/Level 1: the small blind is higher/);
    expect(blindProblems(mk(2, { sb3: 10 }).settings).join(' ')).toMatch(/Level 3: the blinds go down/);
    expect(blindProblems(mk(2, { blindLevels: 2, sb3: 1 }).settings)).toEqual([]);
  });
  it('a player who joins late is bought in with a history line, once', () => {
    const s = init(mk(2));
    const c = mk(3);
    const a = syncPlayers(s, c, T0 + MIN);
    expect(a.players[3]).toMatchObject({ stack: 5000 });
    expect(describeEntry(a.log[0]!, (id) => `P${id}`)).toBe('P3: joined the game: bought in $20 for 5,000 chips');
    expect(syncPlayers(a, c, T0 + 2 * MIN)).toBe(a);
  });
  it('reports chips that belong to a player who left the game', () => {
    const s = init(mk(3));
    expect(chipTotals(s, mk(2)).removedChips).toBe(5000);
    expect(chipTotals(bust(s, mk(3), [3], T0), mk(2)).removedChips).toBe(0);
  });
  it('history lines for notes do not repeat the player name', () => {
    const name = (id: number) => (id === 3 ? 'Chris' : '?');
    expect(describeEntry({ id: 1, t: 0, kind: 'note', playerId: 3, text: 'Chris doubled up' }, name)).toBe('Chris doubled up');
    expect(describeEntry({ id: 1, t: 0, kind: 'note', playerId: 3, text: 'big hand' }, name)).toBe('Chris: big hand');
  });
  it('the recap leaves out a "biggest stack" that is only the starting stack', () => {
    const c = mk(2);
    let s = recordCount(init(c), c, { 1: 4000, 2: 6000 }, T0 + 30 * MIN);
    s = recordCount(s, c, { 1: 3000, 2: 7000 }, T0 + 60 * MIN);
    for (const r of recap(s, c)) expect(recapText(r, false)).not.toContain('Biggest stack');
    let q = recordCount(init(c), c, { 1: 9000, 2: 1000 }, T0 + 30 * MIN);
    q = recordCount(q, c, { 1: 4000, 2: 6000 }, T0 + 60 * MIN);
    expect(recapText(recap(q, c).find((x) => x.playerId === 1)!, false)).toContain('Biggest stack: 9,000 chips (30m in).');
  });
  it('a saved chip count can be removed and a note deleted', () => {
    const c = mk(2);
    let s = recordCount(init(c), c, { 1: 6000, 2: 4000 }, T0 + MIN);
    const id = s.snaps[0]!.id;
    s = removeCount(s, c, id, T0 + 2 * MIN);
    expect(s.snaps).toHaveLength(0);
    expect(s.players[1]!.stack).toBe(6000);
    expect(describeEntry(s.log[s.log.length - 1]!, (n) => `P${n}`)).toBe('A saved chip count was removed');
    expect(removeCount(s, c, id, T0)).toBe(s);
    s = addNote(s, c, 'oops', null, T0);
    const nid = s.log[s.log.length - 1]!.id;
    expect(removeNote(s, nid).log.some((e) => e.id === nid)).toBe(false);
    expect(removeNote(s, 999)).toBe(s);
    expect(removeNote(s, id)).toBe(s);
  });
  it('the clock remembers its level length in the saved state', () => {
    const c = mk(2, { levelMinutes: 15 });
    expect(init(c).clock.per).toBe(15 * MIN);
    expect(startClock(init(mk(2, {}, null)), mk(2, { levelMinutes: 12 }, null), T0).clock.per).toBe(12 * MIN);
    expect(setLevel(init(c), c, 3, T0).clock.per).toBe(15 * MIN);
  });
});

describe('fixes: typed chip numbers', () => {
  it('accepts plain, comma, space and k forms', () => {
    expect(parseChips('5000')).toBe(5000);
    expect(parseChips(' 5,000 ')).toBe(5000);
    expect(parseChips('7 000')).toBe(7000);
    expect(parseChips('5k')).toBe(5000);
    expect(parseChips('1.5K')).toBe(1500);
    expect(parseChips('0')).toBe(0);
  });
  it('rejects everything else', () => {
    for (const bad of ['', ' ', 'abc', '0x10', '1e3', '-500', '+5', '4200.7', '5.000', '1.2345k', '5k5', '--1', 'Infinity', 'NaN']) expect(parseChips(bad), bad).toBeNull();
  });
});


// ------------------------------------------------------------------ chips as money: the new rules

/** A context with the real defaults (2,000-point stack = $20, payment required). */
const mkR = (n: number, o: Record<string, number> = {}, startedAt: number | null = T0): BoardContext => ({ ...mk(n, {}, startedAt), settings: { ...realDefaults(), ...o } }) as BoardContext;
const PLAN = [
  { name: 'white', count: 100, value: null },
  { name: 'red', count: 100, value: null },
  { name: 'blue', count: 100, value: null },
  { name: 'green', count: 100, value: null },
];

describe('defaults and settings', () => {
  it('the default stack is worth the default buy-in, and the first blinds are 100 big blinds', () => {
    const st = realDefaults();
    expect(st.startStack! / st.pointsPerUnit!).toBe(st.buyIn);
    expect(st.rebuyChips).toBe(st.startStack);
    expect(blindsFor(1, st)).toMatchObject({ sb: 10, bb: 20 });
    expect(Math.floor(st.startStack! / blindsFor(1, st).bb)).toBe(100);
    expect(blindsFor(8, st)).toMatchObject({ sb: 160, bb: 320 });
    for (let l = 2; l <= 8; l++) expect(blindsFor(l, st).bb).toBeGreaterThanOrEqual(blindsFor(l - 1, st).bb);
  });
  it('currency, payment and share defaults', () => {
    const st = realDefaults();
    expect([st.currency, st.requirePayment, st.pointsPerUnit, st.shareNum, st.shareDen]).toEqual([0, 1, 100, 1, 3]);
  });
  it('every label starts with its group and the settings run in a sensible order', () => {
    const keys = Object.keys(SETTINGS);
    for (const k of keys) expect(SETTINGS[k]!.label, k).toMatch(/^(Game|Money|Chips|Chip plan|Rebuys|Blinds|Dealer|Reminders|Buttons|Limits|History): /);
    expect(keys.slice(0, 3)).toEqual(['format', 'currency', 'requirePayment']);
    expect(keys.indexOf('buyIn')).toBeLessThan(keys.indexOf('maxRebuys'));
    expect(keys.indexOf('maxRebuys')).toBeLessThan(keys.indexOf('levelMinutes'));
    expect(keys.indexOf('sb1')).toBe(keys.indexOf('bb1') - 1);
    expect(keys.indexOf('bb8')).toBeLessThan(keys.indexOf('trackButton'));
    expect(keys.indexOf('trackButton')).toBeLessThan(keys.indexOf('countEveryMinutes'));
  });
});

describe('money words', () => {
  it('shows dollars and gold, with cents only when needed', () => {
    const cash = { currency: 0, pointsPerUnit: 100 };
    const gold = { currency: 1, pointsPerUnit: 100 };
    expect(units(20, cash)).toBe('$20');
    expect(units(18.5, cash)).toBe('$18.50');
    expect(units(1234.5, cash)).toBe('$1,234.50');
    expect(units(0, cash)).toBe('$0');
    expect(units(20, gold)).toBe('20 gold');
    expect(units(0.25, gold)).toBe('0.25 gold');
    expect(units(-3.5, cash)).toBe('-$3.50');
  });
  it('turns chip points into money', () => {
    const cash = { currency: 0, pointsPerUnit: 100 };
    expect(worth(25, cash)).toBe('$0.25');
    expect(worth(2000, cash)).toBe('$20');
    expect(worth(1850, cash)).toBe('$18.50');
    expect(worth(50, { currency: 1, pointsPerUnit: 100 })).toBe('0.50 gold');
    expect(worth(50, { currency: 0, pointsPerUnit: 10 })).toBe('$5');
  });
});

describe('collecting the money before the first hand', () => {
  it('nobody has paid at the start, and the first hand is blocked with a reason', () => {
    const c = mkR(4);
    const s = init(c);
    const info = payInfo(s, c);
    expect(info.rows.map((r) => [r.owed, r.got, r.short])).toEqual([[20, 0, 20], [20, 0, 20], [20, 0, 20], [20, 0, 20]]);
    expect(info.toCollect).toBe(80);
    expect(info.startersShort).toEqual([1, 2, 3, 4]);
    expect(dealBlock(s, c)).toBe('Collect 4 more buy-ins first.');
    expect(nextHand(s, c)).toBe(s);
    expect(setButton(s, c, 1)).toBe(s);
  });
  it('names the players when only a few are left to pay', () => {
    const c = mkR(4);
    let s = recordAllPayments(init(c), c, 'cash', T0);
    s = clearPayment(s, c, 2, T0);
    expect(dealBlock(s, c)).toBe('Collect the buy-in from P2 first.');
  });
  it('is dealt once every buy-in is in, by cash or Venmo', () => {
    const c = mkR(3);
    let s = recordPayment(init(c), c, 1, 'cash', T0);
    s = recordPayment(s, c, 2, 'venmo', T0 + 1);
    expect(dealBlock(s, c)).toMatch(/P3/);
    s = recordPayment(s, c, 3, 'cash', T0 + 2);
    expect(dealBlock(s, c)).toBeNull();
    expect(nextHand(s, c).button).toBe(1);
    expect(payInfo(s, c)).toMatchObject({ owed: 60, got: 60, toCollect: 0, startersShort: [] });
    expect(s.pay![2]).toMatchObject({ got: 20, how: 'venmo' });
  });
  it('real money is cash or Venmo, gold games are gold only', () => {
    expect(payMethods(realDefaults())).toEqual(['cash', 'venmo']);
    expect(payMethods({ ...realDefaults(), currency: 1 })).toEqual(['gold']);
    const c = mkR(2);
    const s = init(c);
    expect(recordPayment(s, c, 1, 'gold', T0)).toBe(s);
    const g = mkR(2, { currency: 1 });
    const t = init(g);
    expect(recordPayment(t, g, 1, 'cash', T0)).toBe(t);
    expect(recordPayment(t, g, 1, 'gold', T0).pay![1]!.got).toBe(20);
  });
  it('a payment is only recorded once, and unknown players are ignored', () => {
    const c = mkR(2);
    const s = recordPayment(init(c), c, 1, 'cash', T0);
    expect(recordPayment(s, c, 1, 'cash', T0 + 1)).toBe(s);
    expect(recordPayment(s, c, 99, 'cash', T0)).toBe(s);
    expect(clearPayment(s, c, 2, T0)).toBe(s);
  });
  it('a rebuy never blocks the game; it just adds to what is still to collect', () => {
    const c = mkR(2);
    let s = recordAllPayments(init(c), c, 'cash', T0);
    s = nextHand(s, c);
    s = rebuy(s, c, 2, T0 + MIN);
    expect(s.players[2]!.buys).toHaveLength(2);
    expect(payInfo(s, c)).toMatchObject({ owed: 60, got: 40, toCollect: 20, startersShort: [] });
    expect(dealBlock(s, c)).toBeNull();
    expect(nextHand(s, c).hand).toBe(2);
    s = recordPayment(s, c, 2, 'venmo', T0 + 2 * MIN);
    expect(payInfo(s, c).toCollect).toBe(0);
    expect(s.pay![2]).toMatchObject({ got: 40, how: 'venmo' });
  });
  it('can be switched off for games without money', () => {
    const c = mkR(3, { requirePayment: 0 });
    const s = init(c);
    expect(dealBlock(s, c)).toBeNull();
    expect(nextHand(s, c).button).toBe(1);
  });
  it('writes each payment into the history, in the right currency', () => {
    const c = mkR(2);
    let s = recordPayment(init(c), c, 1, 'venmo', T0);
    s = clearPayment(s, c, 1, T0 + 1);
    const name = (id: number) => `P${id}`;
    expect(s.log.map((e) => describeEntry(e, name, settingsOf(s, c)))).toEqual(['P1 paid $20 (venmo)', 'P1\u2019s payment of $20 was cleared']);
    const g = mkR(2, { currency: 1 });
    const t = recordPayment(init(g), g, 2, 'gold', T0);
    expect(describeEntry(t.log[0]!, name, g.settings)).toBe('P2 paid 20 gold (gold)');
  });
  it('recordAllPayments records everyone who owes money', () => {
    const c = mkR(3);
    const s = recordAllPayments(recordPayment(init(c), c, 2, 'venmo', T0), c, 'cash', T0 + 1);
    expect(s.pay![1]!.how).toBe('cash');
    expect(s.pay![2]!.how).toBe('venmo');
    expect(s.log).toHaveLength(3);
    expect(recordAllPayments(s, c, 'cash', T0 + 2)).toBe(s);
  });
  it('the first hand is only gated once: after it is dealt the button moves freely', () => {
    const c = mkR(3);
    let s = recordAllPayments(init(c), c, 'cash', T0);
    s = nextHand(s, c);
    s = clearPayment(s, c, 1, T0 + 1);
    expect(dealBlock(s, c)).toBeNull();
    expect(nextHand(s, c).hand).toBe(2);
  });
});

describe('chip plan in the game', () => {
  it('starts empty, with players and buy-in taken from the game and settings', () => {
    const c = mkR(5);
    const s = init(c);
    expect(planResolved(s, c)).toMatchObject({ colours: [], players: 5, buyIn: 20, currency: 0, shareNum: 1, shareDen: 3 });
    expect(computePlan(s, c).status).toBe('empty');
    expect(applyBlock(s, c)).toBeNull();
    expect(applyBlock(setPlan(s, c, { colours: [{ name: 'white', count: 0, value: null }], buyIn: null }), c)).toBeNull();
    expect(isPristine(s)).toBe(true);
  });
  it('keeps what the GM types and tidies nonsense', () => {
    const c = mkR(4);
    let s = setPlan(init(c), c, { colours: [{ name: '  white  ', count: 99.7, value: null }, { name: 'x'.repeat(40), count: -5, value: 0.2 }, { name: 'red', count: NaN, value: 1e12 }], players: 99, buyIn: 500, currency: 7, sharePercent: 3 });
    expect(s.plan!.colours.map((x) => [x.name, x.count, x.value])).toEqual([['white', 100, null], ['x'.repeat(24), 0, null], ['red', 0, 10000000]]);
    expect(s.plan).toMatchObject({ players: 60, buyIn: 100, currency: 1, sharePercent: 10 });
    s = setPlan(s, c, { players: null, buyIn: null, currency: null, sharePercent: null });
    expect(s.plan).toMatchObject({ players: null, buyIn: null, currency: null, sharePercent: null });
    expect(setPlan(s, c, {})).toBe(s);
  });
  it('limits the colours', () => {
    const c = mkR(2);
    const s = setPlan(init(c), c, { colours: Array.from({ length: 12 }, (_, i) => ({ name: `c${i}`, count: 10, value: null })) });
    expect(s.plan!.colours).toHaveLength(8);
  });
  it('turns a typed percent into an exact share', () => {
    const c = mkR(2);
    expect(planResolved(setPlan(init(c), c, { sharePercent: 50 }), c)).toMatchObject({ shareNum: 50, shareDen: 100, sharePercent: 50 });
    expect(planResolved(setPlan(init(c), c, { sharePercent: 33.3 }), c).sharePercent).toBeCloseTo(33.3, 5);
  });
  it('accepting sets every stack, the buy-in, the rebuy chips and the currency for this game only', () => {
    const c = mkR(4);
    let s = setPlan(init(c), c, { colours: PLAN, buyIn: 30, currency: 1 });
    expect(applyBlock(s, c)).toBeNull();
    s = applyPlan(s, c, T0);
    expect(s.applied).toMatchObject({ currency: 1, buyIn: 30, startStack: 3000, rebuyChips: 3000 });
    for (const p of Object.values(s.players)) expect(p).toMatchObject({ stack: 3000 });
    expect(s.players[1]!.buys[0]).toMatchObject({ chips: 3000, dollars: 30 });
    expect(settingsOf(s, c)).toMatchObject({ currency: 1, buyIn: 30, startStack: 3000, rebuyChips: 3000, maxRebuys: 3 });
    expect(c.settings.startStack).toBe(2000);
    expect(effectiveCtx(s, c).settings.currency).toBe(1);
    expect(effectiveCtx(init(c), c)).toBe(c);
    expect(s.log[s.log.length - 1]!.text).toBe('Chip plan set: 30 gold (3,000 chips) per player, buy-in 30 gold');
  });
  it('rebuys then hand out the plan stack for the plan buy-in', () => {
    const c = mkR(4);
    let s = applyPlan(setPlan(init(c), c, { colours: PLAN, buyIn: 30 }), c, T0);
    s = rebuy(s, c, 1, T0 + MIN);
    expect(s.players[1]!.buys[1]).toMatchObject({ chips: 3000, dollars: 30 });
    expect(s.players[1]!.stack).toBe(6000);
    expect(payInfo(s, c).owed).toBe(30 * 5);
  });
  it('late joiners get the planned stack too', () => {
    const c = mkR(2);
    const s = applyPlan(setPlan(init(c), c, { colours: PLAN }), c, T0);
    const t = syncPlayers(s, mkR(3), T0 + MIN);
    expect(t.players[3]).toMatchObject({ stack: 2000 });
    const big = applyPlan(setPlan(init(c), c, { colours: PLAN, buyIn: 40 }), c, T0);
    expect(syncPlayers(big, mkR(3), T0 + MIN).players[3]).toMatchObject({ stack: 4000 });
  });
  it('is refused when the chips cannot make a fair stack', () => {
    const c = mkR(8);
    const s = setPlan(init(c), c, { colours: [{ name: 'white', count: 20, value: null }] });
    expect(applyBlock(s, c)).toMatch(/Not enough chips/);
    expect(applyPlan(s, c, T0)).toBe(s);
  });
  it('accepts an adjusted stack (the nearest one) and says so in the plan', () => {
    const c = mkR(7);
    const s = setPlan(init(c), c, { colours: [{ name: 'white', count: 200, value: null }, { name: 'red', count: 150, value: null }, { name: 'blue', count: 100, value: null }], buyIn: 50 });
    const plan = computePlan(s, c);
    expect(plan.status).toBe('adjusted');
    expect(applyBlock(s, c)).toBeNull();
    const a = applyPlan(s, c, T0);
    expect(a.applied!.startStack).toBe(plan.stack);
    // the buy-in becomes what the stack is worth, so the money collected matches the chips handed out
    expect(a.applied!.buyIn).toBe(plan.stack / 100);
    expect(a.players[1]!.buys[0]).toMatchObject({ chips: plan.stack, dollars: plan.stack / 100 });
    const pay = recordAllPayments(a, c, 'cash', T0);
    expect(payoutTable(pay, c).diff).toBe(0);
    expect(a.log[a.log.length - 1]!.text).toContain(`buy-in $${plan.stack / 100}`);
  });
  it('can be re-run until the first hand, and is then locked', () => {
    const c = mkR(3, { requirePayment: 0 });
    let s = applyPlan(setPlan(init(c), c, { colours: PLAN }), c, T0);
    expect(applyPlan(s, c, T0 + 1)).toBe(s);
    s = applyPlan(setPlan(s, c, { buyIn: 25 }), c, T0 + 2);
    expect(s.applied!.buyIn).toBe(25);
    s = nextHand(s, c);
    expect(isPristine(s)).toBe(false);
    expect(applyBlock(s, c)).toMatch(/locked/);
    expect(setPlan(s, c, { buyIn: 10 })).toBe(s);
    expect(applyPlan(s, c, T0 + 3)).toBe(s);
  });
  it('is locked once chips move or someone rebuys', () => {
    const c = mkR(3, { requirePayment: 0 });
    expect(isPristine(rebuy(init(c), c, 1, T0))).toBe(false);
    expect(isPristine(bust(init(c), c, [1], T0))).toBe(false);
    expect(isPristine(recordCount(init(c), c, { 1: 2000 }, T0))).toBe(false);
  });
});

describe('the bank', () => {
  it('has no figures until a plan is accepted', () => {
    const c = mkR(3);
    expect(bankInfo(init(c), c)).toBeNull();
  });
  it('counts what is left after the first handout and every rebuy', () => {
    const c = mkR(4);
    let s = applyPlan(setPlan(init(c), c, { colours: PLAN }), c, T0);
    const per = s.applied!.rows.map((r) => r.perPlayer);
    let b = bankInfo(s, c)!;
    expect(b.handouts).toBe(4);
    expect(b.rows.map((r) => r.bank)).toEqual(s.applied!.rows.map((r, i) => r.count - 4 * per[i]!));
    expect(b.short).toBe(false);
    const before = b.rebuysLeft;
    s = rebuy(s, c, 1, T0 + MIN);
    b = bankInfo(s, c)!;
    expect(b.handouts).toBe(5);
    expect(b.rebuysLeft).toBe(before - 1);
    s = undoRebuy(s, c, 1, T0 + 2 * MIN);
    expect(bankInfo(s, c)!.rebuysLeft).toBe(before);
  });
  it('says when the bank cannot cover another rebuy', () => {
    const c = mkR(2, { maxRebuys: 10 });
    let s = applyPlan(setPlan(init(c), c, { colours: PLAN, sharePercent: 100 }), c, T0);
    for (let i = 0; i < 12; i++) s = rebuy(s, c, 1 + (i % 2), T0 + MIN + i);
    const b = bankInfo(s, c)!;
    expect(b.rebuysLeft).toBeLessThanOrEqual(0);
  });
});

describe('going out with chips', () => {
  const pick = (c: BoardContext) => {
    let s = init(c);
    s = setStack(s, c, 1, 9000, T0);
    s = setStack(s, c, 2, 1000, T0);
    return s;
  };
  it('hands the chips straight to the winner, so the totals still tally', () => {
    const c = mk(3);
    const s = bust(pick(c), c, [2], T0 + MIN, 1);
    expect(s.players[2]).toMatchObject({ out: true, stack: 0, wonBy: 1, wonAmt: 1000 });
    expect(s.players[1]!.stack).toBe(10000);
    expect(chipTotals(s, c).diff).toBe(0);
    expect(describeEntry(s.log[s.log.length - 1]!, (id) => `P${id}`)).toBe('P2 is out; P1 took 1,000 chips');
  });
  it('without a winner the chips are simply gone from the table (as before)', () => {
    const c = mk(3);
    const s = bust(pick(c), c, [2], T0 + MIN);
    expect(s.players[1]!.stack).toBe(9000);
    expect(chipTotals(s, c).diff).toBe(-1000);
  });
  it('several players out on the same hand give all their chips to one winner', () => {
    const c = mk(4);
    const s = bust(pick(c), c, [2, 3], T0 + MIN, 1);
    expect(s.players[1]!.stack).toBe(9000 + 1000 + 5000);
    expect(s.players[2]!.outGroup).toBe(s.players[3]!.outGroup);
    expect(describeEntry(s.log[s.log.length - 1]!, (id) => `P${id}`)).toBe('P2 and P3 went out on the same hand; P1 took 6,000 chips');
  });
  it('undoing the bust takes the chips back from the winner', () => {
    const c = mk(3);
    let s = bust(pick(c), c, [2], T0 + MIN, 1);
    s = restore(s, c, 2, T0 + 2 * MIN);
    expect(s.players[2]).toMatchObject({ out: false, stack: 1000 });
    expect(s.players[1]!.stack).toBe(9000);
    expect(s.players[2]!.wonBy).toBeNull();
    expect(chipTotals(s, c).diff).toBe(0);
  });
  it('undo is safe when the winner has since gone out or lost chips', () => {
    const c = mk(3);
    let s = bust(pick(c), c, [2], T0 + MIN, 1);
    s = setStack(s, c, 1, 500, T0 + 2 * MIN);
    s = restore(s, c, 2, T0 + 3 * MIN);
    expect(s.players[1]!.stack).toBe(0);
    const t = bust(bust(pick(c), c, [2], T0, 1), c, [1], T0 + 1);
    expect(restore(t, c, 2, T0 + 2).players[1]).toMatchObject({ out: true, stack: 0 });
  });
  it('refuses a winner who is out, is the busted player, or would go over the chip limit', () => {
    const c = mk(3, { chipMax: 3500 });
    let s = setStack(setStack(init(c), c, 1, 3000, T0), c, 2, 1000, T0);
    expect(bustBlock(s, c, [2], 2)).toMatch(/can.t take/);
    expect(bustBlock(s, c, [2], 99)).toMatch(/can.t take/);
    expect(bustBlock(s, c, [2], 1)).toMatch(/over the chip limit \(3,500\)/);
    expect(bust(s, c, [2], T0, 1)).toBe(s);
    s = bust(s, c, [3], T0);
    expect(bustBlock(s, c, [2], 3)).toMatch(/can.t take/);
    const big = mk(3);
    expect(bustBlock(pick(big), big, [2], 3)).toBeNull();
  });
  it('a player with no chips can be marked out with or without a winner and nothing moves', () => {
    const c = mk(3);
    const s = setStack(init(c), c, 2, 0, T0);
    const t = bust(s, c, [2], T0, 1);
    expect(t.players[1]!.stack).toBe(5000);
    expect(t.log[t.log.length - 1]!.amount).toBeUndefined();
  });
});

describe('what everyone receives', () => {
  it('pays exactly what the chips are worth, and the total equals the money put in', () => {
    const c = mkR(3);
    let s = init(c);
    s = setStack(s, c, 1, 3500, T0);
    s = setStack(s, c, 2, 2500, T0);
    s = bust(s, c, [3], T0 + MIN, 1);
    const t = payoutTable(s, c);
    expect(t.rows.map((r) => [r.invested, r.cashOut, r.net])).toEqual([[20, 55, 35], [20, 25, 5], [20, 0, -20]]);
    expect(t.invested).toBe(60);
    expect(t.cashOut).toBe(80);
    expect(t.diff).toBe(20);
  });
  it('the totals match once the stacks are right', () => {
    const c = mkR(3);
    let s = setStack(init(c), c, 1, 3500, T0);
    s = setStack(s, c, 2, 500, T0);
    s = bust(s, c, [3], T0, 2);
    const t = payoutTable(s, c);
    expect(t.diff).toBe(0);
    expect(t.cashOut).toBe(t.invested);
  });
  it('a tournament played to the finish pays the whole pool to the last player', () => {
    const c = mkR(3);
    const s = bust(init(c), c, [2, 3], T0, 1);
    const t = payoutTable(s, c);
    expect(t.rows.map((r) => r.cashOut)).toEqual([60, 0, 0]);
    expect(t.diff).toBe(0);
  });
  it('rebuys add to the pool, and a plan with another stack scales the cash-out', () => {
    const c = mkR(2, { requirePayment: 1 });
    let s = applyPlan(setPlan(init(c), c, { colours: PLAN, buyIn: 30 }), c, T0);
    s = rebuy(s, c, 1, T0 + MIN);
    const t = payoutTable(s, c);
    expect(t.invested).toBe(90);
    expect(t.rows[0]!.invested).toBe(60);
    expect(t.cashOut).toBe(90);
  });
  it('the recap tells each player what they receive, and says nothing about money in a game with none', () => {
    const c = mkR(2);
    const s = bust(init(c), c, [2], T0, 1);
    const rows = recap(s, c);
    expect(rows[0]).toMatchObject({ invested: 20, cashOut: 40 });
    const texts = def.recap!(s, c);
    expect(texts[0]!.text).toContain('Cash-out: $40 for your chips (you put in $20).');
    expect(texts[1]!.text).toContain('Cash-out: $0 for your chips (you put in $20).');
    const free = mkR(2, { requirePayment: 0 });
    expect(def.recap!(init(free), free)[0]!.text).not.toContain('Cash-out');
    const g = mkR(2, { currency: 1 });
    expect(def.recap!(init(g), g)[0]!.text).toContain('Cash-out: 20 gold for your chips (you put in 20 gold).');
  });
});

describe('old saved games still load', () => {
  it('a state saved before these changes works with the new code', () => {
    const c = mkR(3);
    const old = JSON.parse(JSON.stringify(init(c)));
    delete old.plan;
    delete old.applied;
    delete old.pay;
    for (const p of Object.values(old.players) as any[]) {
      delete p.wonBy;
      delete p.wonAmt;
    }
    const s = old as PokerState;
    expect(payInfo(s, c).toCollect).toBe(60);
    expect(bankInfo(s, c)).toBeNull();
    expect(settingsOf(s, c)).toBe(c.settings);
    expect(restore(bust(s, c, [2], T0), c, 2, T0 + 1).players[2]!.stack).toBe(2000);
    expect(recordPayment(s, c, 1, 'cash', T0).pay![1]!.got).toBe(20);
    expect(payoutTable(s, c).diff).toBe(0);
  });
});


describe('money without a chip inventory', () => {
  it('a plan with no chips just sets the money: the stack is the buy-in in points', () => {
    const c = mkR(3);
    let s = setPlan(init(c), c, { buyIn: 35, currency: 1 });
    expect(planOutcome(s, c)).toMatchObject({ stack: 3500, buyIn: 35, currency: 1, rows: [] });
    expect(applyBlock(s, c)).toBeNull();
    s = applyPlan(s, c, T0);
    expect(s.applied).toMatchObject({ startStack: 3500, rebuyChips: 3500, buyIn: 35, currency: 1, rows: [] });
    expect(s.players[2]).toMatchObject({ stack: 3500 });
    expect(bankInfo(s, c)!.rows).toEqual([]);
    expect(units(35, settingsOf(s, c))).toBe('35 gold');
    expect(applyPlan(s, c, T0 + 1)).toBe(s);
  });
  it('an empty plan with the default money is fine too (and changes nothing important)', () => {
    const c = mkR(3);
    const s = applyPlan(init(c), c, T0);
    expect(s.applied).toMatchObject({ startStack: 2000, buyIn: 20, currency: 0 });
  });
  it('is refused for a silly buy-in', () => {
    const c = mkR(3, { pointsPerUnit: 1 });
    expect(planOutcome(setPlan(init(c), c, { buyIn: 5 }), c)).toMatchObject({ stack: 5 });
  });
  it('lets the settings screen change the buy-in or starting stack until the first hand', () => {
    const c = mkR(3);
    const s = init(c);
    const c2 = mkR(3, { buyIn: 30, startStack: 3000 });
    const t = syncStart(s, c2);
    expect(t.players[1]).toMatchObject({ stack: 3000 });
    expect(t.players[1]!.buys[0]).toMatchObject({ chips: 3000, dollars: 30 });
    expect(syncStart(t, c2)).toBe(t);
    expect(syncStart(s, c)).toBe(s);
  });
  it('does not overwrite a stack the GM already changed, a plan in use, or a game in progress', () => {
    const c = mkR(3, { requirePayment: 0 });
    const c2 = mkR(3, { buyIn: 30, startStack: 3000, requirePayment: 0 });
    const edited = setStack(init(c), c, 1, 1500, T0);
    const t = syncStart(edited, c2);
    expect(t.players[1]!.stack).toBe(1500);
    expect(t.players[2]!.stack).toBe(3000);
    const planned = applyPlan(setPlan(init(c), c, { buyIn: 25 }), c, T0);
    expect(syncStart(planned, c2)).toBe(planned);
    const started = nextHand(init(c), c);
    expect(syncStart(started, c2)).toBe(started);
  });
});
