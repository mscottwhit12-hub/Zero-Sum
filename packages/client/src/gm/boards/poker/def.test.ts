import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  SETTINGS, ackLevels, addNote, blindProblems, blindText, blindsFor, boughtChips, bust, bustBlock, buttonInfo, chipTotals, chips, clockInfo, clockText,
  countDue, def, describeEntry, init, mergeBust, money, nextHand, ordinal, paidDollars, parseChips, pauseClock, placements, pl, rebuy, rebuyBlock, recap,
  recapText, recordCount, removeCount, removeNote, restore, resumeClock, score, setButton, setLevel, setPin, setStack, snoozeCount, spanText, startClock, status,
  syncClock, syncPlayers, undoRebuy, zeroChipAlive, type PokerState,
} from './def';

const T0 = 1_000_000_000_000;
const MIN = 60000;
const player = (id: number, seat: number | null = id): BoardPlayer => ({ id, name: `P${id}`, color: null, avatarPath: null, seat });
const defaults = () => Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));
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
    expect(SETTINGS.startStack!.default).toBe(5000);
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
