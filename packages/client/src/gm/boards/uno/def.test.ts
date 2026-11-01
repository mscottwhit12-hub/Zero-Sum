import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  SETTINGS,
  addRound,
  clock,
  cfg,
  def,
  duration,
  endGame,
  finishWarnings,
  handsTotal,
  houseRules,
  init,
  markStarted,
  ordinal,
  placements,
  ranking,
  recap,
  redoLast,
  redoNext,
  reopenGame,
  roundLine,
  roundsWon,
  score,
  targetWinner,
  toGo,
  totalOf,
  turnOrder,
  undoLast,
  type UnoState,
} from './def';

const player = (id: number, seat: number | null = id): BoardPlayer => ({ id, name: `P${id} Last`, color: null, avatarPath: null, seat });
const defaults = () => Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));
const mk = (n: number, settings: Record<string, number> = {}): BoardContext => ({
  players: Array.from({ length: n }, (_, i) => player(i + 1)),
  table: { name: 'T1', seats: 4, w: 0.3, h: 0.15 },
  rerollsAllowed: false,
  rerollsLeft: {},
  useReroll: async () => undefined,
  settings: { ...defaults(), ...settings },
});

let clockT = 1000;
const tick = () => (clockT += 5000);
const rounds = (s: UnoState, ctx: BoardContext, list: [number, number][]): UnoState => {
  let cur = s;
  for (const [w, p] of list) cur = addRound(cur, ctx, w, p, null, tick());
  return cur;
};

describe('settings', () => {
  it('every setting has a default inside its own range', () => {
    for (const v of Object.values(SETTINGS)) expect(v.default >= v.min && v.default <= v.max).toBe(true);
  });
  it('classic values', () => {
    const d = defaults();
    expect(d.target).toBe(500);
    expect(d.actionValue).toBe(20);
    expect(d.wildValue).toBe(50);
  });
  it('key and label', () => {
    expect(def.key).toBe('uno');
    expect(def.label).toBe('Uno');
  });
  it('house rules are off and only labels', () => {
    expect(houseRules(mk(2).settings)).toEqual([]);
    expect(houseRules(mk(2, { stacking: 1, jumpIn: 1 }).settings)).toEqual(['Stacking +2 / +4', 'Jump-in']);
    const c = mk(2, { stacking: 1, sevenZero: 1 });
    expect(totalOf(rounds(init(c), c, [[1, 40]]), 1)).toBe(40);
  });
  it('cfg falls back to the default', () => {
    expect(cfg(undefined, 'target')).toBe(500);
    expect(cfg({ target: NaN }, 'target')).toBe(500);
  });
});

describe('init and seating', () => {
  it('everyone starts on 0', () => {
    const c = mk(3);
    expect(score(init(c), c)).toEqual({ 1: 0, 2: 0, 3: 0 });
  });
  it('orders by seat, unseated last, later players last', () => {
    const c = mk(3);
    c.players[0] = player(1, 3);
    c.players[1] = player(2, null);
    c.players[2] = player(3, 1);
    expect(init(c).order).toEqual([3, 1, 2]);
    expect(turnOrder(init(c), mk(4)).includes(4)).toBe(true);
  });
});

describe('rounds', () => {
  const c = mk(3);
  it('the winner scores the points', () => {
    const s = rounds(init(c), c, [[1, 84], [2, 30], [1, 16]]);
    expect(totalOf(s, 1)).toBe(100);
    expect(totalOf(s, 2)).toBe(30);
    expect(totalOf(s, 3)).toBe(0);
    expect(roundsWon(s, 1)).toBe(2);
  });
  it('rejects bad numbers and unknown players; returns the same object', () => {
    const s = init(c);
    expect(addRound(s, c, 99, 10)).toBe(s);
    expect(addRound(s, c, 1, -5)).toBe(s);
    expect(addRound(s, c, 1, 10.5)).toBe(s);
    expect(addRound(s, c, 1, NaN)).toBe(s);
    expect(addRound(s, c, 1, 1001)).toBe(s);
    expect(addRound(s, c, 1, 1000, null, 1)).not.toBe(s);
  });
  it('the round limit is a setting', () => {
    const k = mk(3, { roundMax: 100 });
    const s = init(k);
    expect(addRound(s, k, 1, 101)).toBe(s);
    expect(addRound(s, k, 1, 100, null, 1)).not.toBe(s);
  });
  it('a double tap does not add the round twice', () => {
    let s = addRound(init(c), c, 1, 50, null, 100000);
    expect(addRound(s, c, 1, 50, null, 100500)).toBe(s);
    s = addRound(s, c, 1, 50, null, 103000);
    expect(totalOf(s, 1)).toBe(100);
  });
  it('a round can score 0', () => {
    const s = addRound(init(c), c, 1, 0, null, 1);
    expect(s.rounds).toHaveLength(1);
  });
  it('toGo counts down to the target', () => {
    const s = rounds(init(c), c, [[1, 120]]);
    expect(toGo(s, c, 1)).toBe(380);
    expect(toGo(s, c, 2)).toBe(500);
  });
});

describe('per-player breakdown', () => {
  const c = mk(3);
  it('the round is worth the sum of the others\' hands', () => {
    const s = addRound(init(c), c, 1, 999, { 2: 30, 3: 54 }, 1);
    expect(totalOf(s, 1)).toBe(84);
    expect(s.rounds[0]!.hands).toEqual({ 2: 30, 3: 54 });
    expect(handsTotal(s.rounds[0]!.hands!)).toBe(84);
  });
  it('a missing hand counts 0; the winner\'s own entry is ignored', () => {
    const s = addRound(init(c), c, 1, 0, { 1: 77, 2: 30 }, 1);
    expect(totalOf(s, 1)).toBe(30);
    expect(s.rounds[0]!.hands).toEqual({ 2: 30, 3: 0 });
  });
  it('rejects a hand over the limit or a fraction', () => {
    const s = init(c);
    expect(addRound(s, c, 1, 0, { 2: 301 }, 1)).toBe(s);
    expect(addRound(s, c, 1, 0, { 2: 10.5 }, 1)).toBe(s);
    expect(addRound(s, c, 1, 0, { 2: -1 }, 1)).toBe(s);
  });
  it('the hand limit is a setting', () => {
    const k = mk(3, { handMax: 500 });
    expect(addRound(init(k), k, 1, 0, { 2: 400 }, 1).rounds).toHaveLength(1);
  });
});

describe('target and finish', () => {
  const c = mk(3, { target: 100 });
  it('the first to reach the target wins and the game locks', () => {
    let s = rounds(init(c), c, [[2, 90], [1, 60]]);
    expect(targetWinner(s, c)).toBeNull();
    s = rounds(s, c, [[2, 15]]);
    expect(targetWinner(s, c)).toBe(2);
    expect(addRound(s, c, 1, 10, null, tick())).toBe(s);
    expect(toGo(s, c, 2)).toBe(0);
  });
  it('undo of the winning round opens the game again', () => {
    let s = rounds(init(c), c, [[2, 120]]);
    expect(targetWinner(s, c)).toBe(2);
    s = undoLast(s);
    expect(targetWinner(s, c)).toBeNull();
    expect(addRound(s, c, 1, 10, null, tick())).not.toBe(s);
  });
  it('exactly the target counts', () => {
    expect(targetWinner(rounds(init(c), c, [[1, 100]]), c)).toBe(1);
  });
  it('a target of 1 is a single hand', () => {
    const k = mk(3, { target: 1 });
    expect(targetWinner(rounds(init(k), k, [[3, 25]]), k)).toBe(3);
  });
  it('placements: the target winner first, then by points, ties share', () => {
    const k = mk(4, { target: 200 });
    const s = rounds(init(k), k, [[1, 50], [2, 50], [3, 120], [4, 30], [1, 160]]);
    expect(targetWinner(s, k)).toBe(1);
    expect(placements(s, k)).toEqual([[1], [3], [2], [4]]);
    const t = rounds(init(k), k, [[1, 50], [2, 50]]);
    expect(placements(t, k)).toEqual([[1, 2], [3, 4]]);
  });
  it('call time ranks by points so far', () => {
    const k = mk(3);
    const s = endGame(rounds(init(k), k, [[2, 90], [1, 40]]), 5);
    expect(placements(s, k)).toEqual([[2], [1], [3]]);
    expect(ranking(s, k).map((r) => r.place)).toEqual([1, 2, 3]);
  });
  it('ties share the place (1, 1, 3)', () => {
    const k = mk(3);
    const s = rounds(init(k), k, [[1, 50], [2, 50]]);
    expect(ranking(s, k).map((r) => r.place)).toEqual([1, 1, 3]);
    expect(ranking(s, k).filter((r) => r.tied).length).toBe(3 - 1);
  });
  it('an empty game is one big tie; every player once', () => {
    const k = mk(3);
    expect(placements(init(k), k)).toEqual([[1, 2, 3]]);
    expect(placements(rounds(init(k), k, [[2, 10]]), k).flat().sort()).toEqual([1, 2, 3]);
  });
});

describe('crown (score)', () => {
  it('is live: everyone\'s points', () => {
    const c = mk(3);
    expect(score(rounds(init(c), c, [[1, 60], [2, 20], [1, 15]]), c)).toEqual({ 1: 75, 2: 20, 3: 0 });
  });
  it('goes down again after an undo', () => {
    const c = mk(2);
    let s = rounds(init(c), c, [[1, 60]]);
    s = undoLast(s);
    expect(score(s, c)).toEqual({ 1: 0, 2: 0 });
  });
});

describe('undo and redo', () => {
  const c = mk(2);
  it('undo takes the points back; redo puts them back', () => {
    let s = rounds(init(c), c, [[1, 60], [2, 30]]);
    s = undoLast(s);
    expect(totalOf(s, 2)).toBe(0);
    expect(redoNext(s)?.points).toBe(30);
    s = redoLast(s);
    expect(totalOf(s, 2)).toBe(30);
  });
  it('a new round clears redo', () => {
    let s = undoLast(rounds(init(c), c, [[1, 60]]));
    s = rounds(s, c, [[2, 5]]);
    expect(redoNext(s)).toBeNull();
  });
  it('nothing to undo returns the same object', () => {
    const s = init(c);
    expect(undoLast(s)).toBe(s);
    expect(redoLast(s)).toBe(s);
  });
});

describe('ending', () => {
  const c = mk(2);
  it('ends once; reopen takes it back', () => {
    let s = endGame(init(c), 5);
    expect(endGame(s, 9)).toBe(s);
    s = reopenGame(s);
    expect(s.over).toBeNull();
    expect(reopenGame(s)).toBe(s);
  });
  it('locks entries while ended', () => {
    const s = rounds(init(c), c, [[1, 10]]);
    const e = endGame(s, 5);
    expect(addRound(e, c, 1, 10, null, 1)).toBe(e);
    expect(undoLast(e)).toBe(e);
    expect(redoNext(undoLast(e))).toBeNull();
  });
});

describe('recap', () => {
  it('one message per player', () => {
    const c = mk(3, { target: 100 });
    const s = rounds(init(c), c, [[2, 40], [1, 120]]);
    const r = recap(s, c);
    expect(r).toHaveLength(3);
    const p1 = r.find((x) => x.playerId === 1)!.text;
    expect(p1.includes('1st')).toBe(true);
    expect(p1.includes('reached 100 points first and won!')).toBe(true);
    expect(p1.includes('went out in 1 of 2 rounds')).toBe(true);
    expect(p1.includes('best round was 120')).toBe(true);
    const p2 = r.find((x) => x.playerId === 2)!.text;
    expect(p2.includes('2nd')).toBe(true);
    expect(p2.includes('Winner: P1')).toBe(true);
    const p3 = r.find((x) => x.playerId === 3)!.text;
    expect(p3.includes('did not go out in any of the 2 rounds')).toBe(true);
  });
  it('call time and shared lead', () => {
    const c = mk(2);
    const s = endGame(rounds(init(c), c, [[1, 50], [2, 50]]), 5);
    const r = recap(s, c);
    expect(r[0]!.text.includes('share the lead')).toBe(true);
    const t = rounds(init(c), c, [[1, 50]]);
    expect(recap(t, c)[0]!.text.includes('ahead when the game ended')).toBe(true);
  });
  it('no rounds: still one message each', () => {
    const c = mk(2);
    expect(recap(init(c), c)).toHaveLength(2);
  });
});

describe('clock', () => {
  it('host start and planned end', () => {
    const c = { ...mk(2), startedAt: 1000, endsAt: 1000 + 3600000 };
    const k = clock(init(c), c, 1000 + 600000)!;
    expect(k.elapsedMs).toBe(600000);
    expect(k.remainingMs).toBe(3000000);
    expect(k.source).toBe('host');
  });
  it('board start fallback; stops when ended; null without a start', () => {
    const c = mk(2);
    let s = markStarted(init(c), 5000);
    expect(markStarted(s, 9000)).toBe(s);
    s = endGame(s, 65000);
    expect(clock(s, c, 999999)!.elapsedMs).toBe(60000);
    expect(clock(init(c), c, 1)).toBeNull();
  });
  it('duration text', () => {
    expect(duration(10000)).toBe('under a minute');
    expect(duration(72 * 60000)).toBe('1h 12m');
  });
});

describe('text', () => {
  const names: Record<number, string> = { 1: 'Sam Lee', 2: 'Alex Kim', 3: 'Jo Fox' };
  const nameOf = (id: number) => names[id] ?? 'A player';
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st']);
  });
  it('round lines', () => {
    const c = mk(3);
    let s = addRound(init(c), c, 1, 84, null, 1);
    s = addRound(s, c, 2, 0, { 1: 30, 3: 54 }, 9000);
    expect(roundLine(s.rounds[0]!, 1, nameOf)).toBe('Round 1: Sam went out for 84');
    expect(roundLine(s.rounds[1]!, 2, nameOf)).toBe('Round 2: Alex went out for 84 (Sam 30, Jo 54)');
  });
  it('warnings', () => {
    const c = mk(2, { target: 100 });
    expect(finishWarnings(init(c), c).length).toBe(1);
    expect(finishWarnings(rounds(init(c), c, [[1, 40]]), c)[0]!.includes('Nobody has reached 100')).toBe(true);
    expect(finishWarnings(rounds(init(c), c, [[1, 140]]), c)).toEqual([]);
  });
});
