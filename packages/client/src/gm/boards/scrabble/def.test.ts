import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  SETTINGS,
  addExchange,
  addLostChallenge,
  addPass,
  addPenalty,
  addPlay,
  adjustment,
  DOUBLE_TAP_MS,
  overtimeApplied,
  redoLast,
  redoNext,
  bagCount,
  baseScore,
  challengeOff,
  clock,
  currentPlayer,
  def,
  duration,
  endGame,
  entryText,
  finishWarnings,
  init,
  markStarted,
  ordinal,
  placements,
  ranking,
  recap,
  recordReroll,
  reopenGame,
  scorelessRun,
  score,
  setBag,
  setFirst,
  statsOf,
  totalScore,
  turnClock,
  turnOrder,
  undoLast,
  type ScrabbleState,
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

describe('settings', () => {
  it('every setting has a default inside its own range', () => {
    for (const [k, v] of Object.entries(SETTINGS)) {
      expect(v.default >= v.min && v.default <= v.max).toBe(true);
      expect(k.length > 0).toBe(true);
    }
  });
  it('classic defaults', () => {
    expect(SETTINGS.bingoBonus!.default).toBe(50);
    expect(SETTINGS.rackSize!.default).toBe(7);
    expect(SETTINGS.tilesTotal!.default).toBe(100);
    expect(SETTINGS.scorelessLimit!.default).toBe(6);
    expect(SETTINGS.challengeRule!.default).toBe(2);
    expect(SETTINGS.endAdjust!.default).toBe(1);
    expect(SETTINGS.turnSeconds!.default).toBe(0);
  });
  it('the def exposes them', () => {
    expect(def.key).toBe('scrabble');
    expect(def.settings).toBe(SETTINGS);
  });
});

describe('init and turn order', () => {
  it('starts empty, seat order first', () => {
    const ctx = mk(3);
    ctx.players[0]!.seat = 3;
    ctx.players[1]!.seat = 1;
    ctx.players[2]!.seat = null;
    const s = init(ctx);
    expect(s.order).toEqual([2, 1, 3]);
    expect(s.entries).toEqual([]);
    expect(s.over).toBeNull();
    expect(currentPlayer(s, ctx)).toBe(2);
  });
  it('goes round the table', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = addPlay(s, ctx, 1, 20);
    expect(currentPlayer(s, ctx)).toBe(2);
    s = addPlay(s, ctx, 2, 12);
    s = addPass(s, ctx, 3);
    expect(currentPlayer(s, ctx)).toBe(1);
  });
  it('follows the player who actually played (out of order entry)', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = addPlay(s, ctx, 2, 10);
    expect(currentPlayer(s, ctx)).toBe(3);
  });
  it('a player added later goes last; a missing one is skipped', () => {
    const ctx = mk(3);
    const s = init(ctx);
    const more = { ...ctx, players: [...ctx.players, player(9, null)] };
    expect(turnOrder(s, more)).toEqual([1, 2, 3, 9]);
    const fewer = { ...ctx, players: ctx.players.slice(0, 2) };
    expect(turnOrder(s, fewer)).toEqual([1, 2]);
  });
  it('no players: nobody is up', () => {
    const ctx = mk(0);
    expect(currentPlayer(init(ctx), ctx)).toBeNull();
  });
  it('setFirst rotates the order, only before the first entry', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = setFirst(s, ctx, 3);
    expect(s.order).toEqual([3, 4, 1, 2]);
    expect(currentPlayer(s, ctx)).toBe(3);
    expect(setFirst(s, ctx, 3)).toBe(s);
    s = addPlay(s, ctx, 3, 8);
    expect(setFirst(s, ctx, 1)).toBe(s);
    expect(setFirst(init(ctx), ctx, 99)).toEqual(init(ctx));
  });
});

describe('plays', () => {
  it('adds the word score to the total', () => {
    const ctx = mk(2);
    let s = init(ctx);
    s = addPlay(s, ctx, 1, 24, { word: ' quiz ' });
    s = addPlay(s, ctx, 2, 18);
    s = addPlay(s, ctx, 1, 6);
    expect(baseScore(s, 1)).toBe(30);
    expect(baseScore(s, 2)).toBe(18);
    expect(s.entries[0]!.word).toBe('QUIZ');
  });
  it('bingo adds the bonus from the setting, stored with the entry', () => {
    const ctx = mk(2, { bingoBonus: 35 });
    let s = addPlay(init(ctx), ctx, 1, 70, { bingo: true });
    expect(baseScore(s, 1)).toBe(105);
    expect(s.entries[0]!.bonus).toBe(35);
    const later = { ...ctx, settings: { ...ctx.settings, bingoBonus: 50 } };
    expect(baseScore(s, 1)).toBe(105);
    s = addPlay(s, later, 2, 10, { bingo: true });
    expect(baseScore(s, 2)).toBe(60);
  });
  it('rejects bad numbers and unknown players (same object back)', () => {
    const ctx = mk(2);
    const s = init(ctx);
    expect(addPlay(s, ctx, 1, 0)).toBe(s);
    expect(addPlay(s, ctx, 1, -4)).toBe(s);
    expect(addPlay(s, ctx, 1, NaN)).toBe(s);
    expect(addPlay(s, ctx, 1, 501)).toBe(s);
    expect(addPlay(s, ctx, 99, 10)).toBe(s);
  });
  it('the biggest turn is a setting', () => {
    const ctx = mk(2, { turnMax: 100 });
    const s = init(ctx);
    expect(addPlay(s, ctx, 1, 101)).toBe(s);
    expect(addPlay(s, ctx, 1, 100)).not.toBe(s);
  });
  it('rounds a decimal score', () => {
    const ctx = mk(2);
    expect(baseScore(addPlay(init(ctx), ctx, 1, 12.6), 1)).toBe(13);
  });
  it('a long word is cut and the timestamp is kept', () => {
    const ctx = mk(2);
    const s = addPlay(init(ctx), ctx, 1, 5, { word: 'a'.repeat(80) }, 1234);
    expect(s.entries[0]!.word).toHaveLength(30);
    expect(s.entries[0]!.at).toBe(1234);
    expect(addPlay(init(ctx), ctx, 1, 5).entries[0]!.at).toBeNull();
  });
});

describe('pass, exchange, undo', () => {
  it('pass and exchange use the turn and score nothing', () => {
    const ctx = mk(2);
    let s = addPass(init(ctx), ctx, 1);
    s = addExchange(s, ctx, 2);
    expect(baseScore(s, 1)).toBe(0);
    expect(currentPlayer(s, ctx)).toBe(1);
    expect(s.entries.map((e) => e.kind)).toEqual(['pass', 'exchange']);
  });
  it('undo removes only the last entry and gives the turn back', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = addPlay(s, ctx, 1, 10);
    s = addPlay(s, ctx, 2, 20);
    s = undoLast(s);
    expect(s.entries).toHaveLength(1);
    expect(currentPlayer(s, ctx)).toBe(2);
    s = undoLast(s);
    expect(currentPlayer(s, ctx)).toBe(1);
    expect(undoLast(s)).toBe(s);
  });
  it('undo and new entries are blocked while the game is ended', () => {
    const ctx = mk(2);
    let s = addPlay(init(ctx), ctx, 1, 10);
    s = endGame(s, ctx, 'time', null, {});
    expect(undoLast(s)).toBe(s);
    expect(addPlay(s, ctx, 2, 5)).toBe(s);
    expect(addPass(s, ctx, 2)).toBe(s);
    expect(addExchange(s, ctx, 2)).toBe(s);
    expect(addLostChallenge(s, ctx, 2)).toBe(s);
    expect(addPenalty(s, ctx, 2, 5, 'x')).toBe(s);
    expect(challengeOff(s, ctx)).toBe(s);
    const back = reopenGame(s);
    expect(back.over).toBeNull();
    expect(undoLast(back).entries).toHaveLength(0);
    expect(reopenGame(back)).toBe(back);
  });
});

describe('challenges', () => {
  it('double (default): the failed challenger loses the turn, no points', () => {
    const ctx = mk(3);
    let s = addPlay(init(ctx), ctx, 1, 30, { word: 'jazz' });
    s = addLostChallenge(s, ctx, 2);
    expect(baseScore(s, 2)).toBe(0);
    expect(currentPlayer(s, ctx)).toBe(3);
    expect(s.entries[1]!.turn).toBe(true);
  });
  it('single: the failed challenger loses points and still plays', () => {
    const ctx = mk(3, { challengeRule: 1, challengePenalty: 10 });
    let s = addPlay(init(ctx), ctx, 1, 30);
    s = addLostChallenge(s, ctx, 2);
    expect(baseScore(s, 2)).toBe(-10);
    expect(currentPlayer(s, ctx)).toBe(2);
    expect(s.entries[1]!.turn).toBe(false);
  });
  it('single with no penalty points, and free challenge, record nothing', () => {
    const a = mk(2, { challengeRule: 1, challengePenalty: 0 });
    const sa = init(a);
    expect(addLostChallenge(sa, a, 1)).toBe(sa);
    const b = mk(2, { challengeRule: 0 });
    const sb = init(b);
    expect(addLostChallenge(sb, b, 1)).toBe(sb);
  });
  it('a play challenged off scores nothing, keeps the turn used and gives the tiles back', () => {
    const ctx = mk(2);
    let s = addPlay(init(ctx), ctx, 1, 40, { word: 'zzzz', bingo: true });
    const bagBefore = bagCount(s, ctx);
    s = challengeOff(s, ctx);
    expect(baseScore(s, 1)).toBe(0);
    expect(s.entries[0]!.kind).toBe('challengedOff');
    expect(s.entries[0]!.word).toBe('ZZZZ');
    expect(currentPlayer(s, ctx)).toBe(2);
    expect(bagCount(s, ctx)).toBe(bagBefore + 7);
    expect(challengeOff(s, ctx)).toBe(s);
    expect(challengeOff(init(ctx), ctx).entries).toHaveLength(0);
  });
  it('penalty takes points off without using the turn', () => {
    const ctx = mk(2);
    let s = addPlay(init(ctx), ctx, 1, 20);
    s = addPenalty(s, ctx, 2, 3, 'overtime');
    expect(baseScore(s, 2)).toBe(-3);
    expect(currentPlayer(s, ctx)).toBe(2);
    expect(addPenalty(s, ctx, 2, 0, 'x')).toBe(s);
    expect(addPenalty(s, ctx, 2, NaN, 'x')).toBe(s);
  });
});

describe('scoreless turns', () => {
  it('counts passes, exchanges, challenged-off plays and lost-challenge turns; a play resets it', () => {
    const ctx = mk(2);
    let s = init(ctx);
    expect(scorelessRun(s)).toBe(0);
    s = addPass(s, ctx, 1);
    s = addExchange(s, ctx, 2);
    expect(scorelessRun(s)).toBe(2);
    s = addPenalty(s, ctx, 1, 2, 'x');
    expect(scorelessRun(s)).toBe(2);
    s = addPass(s, ctx, 1);
    s = addLostChallenge(s, ctx, 2);
    expect(scorelessRun(s)).toBe(4);
    s = addPlay(s, ctx, 1, 9);
    expect(scorelessRun(s)).toBe(0);
    s = addPlay(s, ctx, 2, 9);
    s = challengeOff(s, ctx);
    expect(scorelessRun(s)).toBe(1);
  });
  it('a single-challenge loss does not count as a scoreless turn', () => {
    const ctx = mk(2, { challengeRule: 1 });
    let s = addPass(init(ctx), ctx, 1);
    s = addLostChallenge(s, ctx, 2);
    expect(scorelessRun(s)).toBe(1);
  });
});

describe('the bag', () => {
  it('starts at the total minus the racks', () => {
    expect(bagCount(init(mk(4)), mk(4))).toBe(72);
    expect(bagCount(init(mk(2)), mk(2))).toBe(86);
  });
  it('plays take tiles out; passes and exchanges do not', () => {
    const ctx = mk(2);
    let s = init(ctx);
    s = addPlay(s, ctx, 1, 10, { tiles: 4 });
    s = addPlay(s, ctx, 2, 10);
    s = addPass(s, ctx, 1);
    s = addExchange(s, ctx, 2);
    expect(bagCount(s, ctx)).toBe(86 - 4 - 3);
  });
  it('a bingo takes a full rack; tiles are kept between 1 and the rack size', () => {
    const ctx = mk(2);
    expect(bagCount(addPlay(init(ctx), ctx, 1, 80, { bingo: true, tiles: 2 }), ctx)).toBe(79);
    expect(bagCount(addPlay(init(ctx), ctx, 1, 8, { tiles: 50 }), ctx)).toBe(79);
    expect(bagCount(addPlay(init(ctx), ctx, 1, 8, { tiles: 0 }), ctx)).toBe(85);
  });
  it('undo puts the tiles back; the bag never goes below 0', () => {
    const ctx = mk(2, { tilesTotal: 20 });
    let s = init(ctx);
    for (let i = 0; i < 5; i++) s = addPlay(s, ctx, 1, 5, { tiles: 7 });
    expect(bagCount(s, ctx)).toBe(0);
    s = undoLast(s);
    expect(bagCount(s, ctx)).toBe(0);
    while (s.entries.length) s = undoLast(s);
    expect(bagCount(s, ctx)).toBe(6);
  });
  it('setBag shows exactly the typed number, also when the count had run out', () => {
    const ctx = mk(2);
    let s = addPlay(init(ctx), ctx, 1, 10);
    s = setBag(s, ctx, 40);
    expect(bagCount(s, ctx)).toBe(40);
    expect(setBag(s, ctx, 40)).toBe(s);
    s = addPlay(s, ctx, 2, 10);
    expect(bagCount(s, ctx)).toBe(37);
    expect(bagCount(setBag(s, ctx, -5), ctx)).toBe(0);
    expect(bagCount(setBag(s, ctx, 999), ctx)).toBe(100);
    expect(setBag(s, ctx, NaN)).toBe(s);
    const empty = mk(2, { tilesTotal: 20 });
    let t = init(empty);
    for (let i = 0; i < 4; i++) t = addPlay(t, empty, 1, 5, { tiles: 7 });
    expect(bagCount(setBag(t, empty, 3), empty)).toBe(3);
  });
});

describe('end of the game', () => {
  const played = (ctx: BoardContext) => {
    let s = init(ctx);
    s = addPlay(s, ctx, 1, 100);
    s = addPlay(s, ctx, 2, 90);
    s = addPlay(s, ctx, 3, 80);
    return s;
  };
  it('out: others lose their rack, the player who went out gets the sum', () => {
    const ctx = mk(3);
    const s = endGame(played(ctx), ctx, 'out', 3, { 1: 5, 2: 12, 3: 99 });
    expect(adjustment(s, ctx, 1)).toBe(-5);
    expect(adjustment(s, ctx, 2)).toBe(-12);
    expect(adjustment(s, ctx, 3)).toBe(17);
    expect(totalScore(s, ctx, 3)).toBe(97);
    expect(s.over!.racks[3]).toBe(0);
  });
  it('blocked: everyone loses their rack, nobody gets any', () => {
    const ctx = mk(2);
    let s = addPlay(addPlay(init(ctx), ctx, 1, 50), ctx, 2, 40);
    s = endGame(s, ctx, 'blocked', null, { 1: 3, 2: 8 });
    expect(totalScore(s, ctx, 1)).toBe(47);
    expect(totalScore(s, ctx, 2)).toBe(32);
  });
  it('time: no adjustment at all', () => {
    const ctx = mk(2);
    let s = addPlay(addPlay(init(ctx), ctx, 1, 50), ctx, 2, 40);
    s = endGame(s, ctx, 'time', null, { 1: 3, 2: 8 });
    expect(totalScore(s, ctx, 1)).toBe(50);
    expect(totalScore(s, ctx, 2)).toBe(40);
  });
  it('the adjustment can be switched off', () => {
    const ctx = mk(2, { endAdjust: 0 });
    let s = addPlay(addPlay(init(ctx), ctx, 1, 50), ctx, 2, 40);
    s = endGame(s, ctx, 'out', 1, { 2: 9 });
    expect(totalScore(s, ctx, 1)).toBe(50);
    expect(totalScore(s, ctx, 2)).toBe(40);
  });
  it('racks are limited by rack size times the biggest tile', () => {
    const ctx = mk(2);
    const s = endGame(init(ctx), ctx, 'blocked', null, { 1: 500, 2: -4 });
    expect(s.over!.racks[1]).toBe(70);
    expect(s.over!.racks[2]).toBe(0);
    const small = mk(2, { rackSize: 3, tileMax: 4 });
    expect(endGame(init(small), small, 'blocked', null, { 1: 500 }).over!.racks[1]).toBe(12);
  });
  it('out needs a known player; a second end does nothing', () => {
    const ctx = mk(2);
    const s = init(ctx);
    expect(endGame(s, ctx, 'out', null, {})).toBe(s);
    expect(endGame(s, ctx, 'out', 77, {})).toBe(s);
    const e = endGame(s, ctx, 'time', null, {}, 5);
    expect(e.over!.at).toBe(5);
    expect(endGame(e, ctx, 'blocked', null, { 1: 2 })).toBe(e);
  });
  it('the adjustment only counts once the game is ended', () => {
    const ctx = mk(2);
    const s = addPlay(init(ctx), ctx, 1, 50);
    expect(adjustment(s, ctx, 1)).toBe(0);
  });
});

describe('crown (score)', () => {
  it('no live leader: everyone is 0 until the game is ended', () => {
    const ctx = mk(2);
    let s = addPlay(addPlay(init(ctx), ctx, 1, 90), ctx, 2, 10);
    expect(score(s, ctx)).toEqual({ 1: 0, 2: 0 });
    s = endGame(s, ctx, 'out', 2, { 1: 6 });
    expect(score(s, ctx)).toEqual({ 1: 84, 2: 16 });
    expect(score(reopenGame(s), ctx)).toEqual({ 1: 0, 2: 0 });
  });
});

describe('placements', () => {
  it('highest total first, with the end adjustment', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = addPlay(s, ctx, 1, 100);
    s = addPlay(s, ctx, 2, 95);
    s = addPlay(s, ctx, 3, 60);
    s = endGame(s, ctx, 'out', 2, { 1: 20, 3: 4 });
    expect(placements(s, ctx)).toEqual([[2], [1], [3]]);
    expect(totalScore(s, ctx, 2)).toBe(119);
  });
  it('not ended: running totals, no adjustment', () => {
    const ctx = mk(2);
    const s = addPlay(addPlay(init(ctx), ctx, 1, 10), ctx, 2, 30);
    expect(placements(s, ctx)).toEqual([[2], [1]]);
  });
  it('a tie is split by the higher score before the adjustment', () => {
    const ctx = mk(2);
    let s = addPlay(addPlay(init(ctx), ctx, 1, 100), ctx, 2, 90);
    s = endGame(s, ctx, 'out', 2, { 1: 0 });
    // totals 100 and 90: no tie; make a real one
    let t = addPlay(addPlay(init(ctx), ctx, 1, 100), ctx, 2, 90);
    t = endGame(t, ctx, 'blocked', null, { 1: 10, 2: 0 });
    expect(totalScore(t, ctx, 1)).toBe(90);
    expect(totalScore(t, ctx, 2)).toBe(90);
    expect(placements(t, ctx)).toEqual([[1], [2]]);
    expect(ranking(t, ctx).map((r) => r.tied)).toEqual([false, false]);
    void s;
  });
  it('with that rule off (or still level) a tie is shared', () => {
    const off = mk(2, { tieHigherBefore: 0 });
    let t = addPlay(addPlay(init(off), off, 1, 100), off, 2, 90);
    t = endGame(t, off, 'blocked', null, { 1: 10, 2: 0 });
    expect(placements(t, off)).toEqual([[1, 2]]);
    expect(ranking(t, off).every((r) => r.tied && r.place === 1)).toBe(true);
    const ctx = mk(3);
    const u = addPlay(addPlay(addPlay(init(ctx), ctx, 1, 50), ctx, 2, 50), ctx, 3, 20);
    expect(placements(u, ctx)).toEqual([[1, 2], [3]]);
    expect(ranking(u, ctx).map((r) => r.place)).toEqual([1, 1, 3]);
  });
  it('nothing entered: everyone shares first', () => {
    const ctx = mk(3);
    expect(placements(init(ctx), ctx)).toEqual([[1, 2, 3]]);
  });
  it('no players: no groups', () => {
    const ctx = mk(0);
    expect(placements(init(ctx), ctx)).toEqual([]);
  });
});

describe('stats and recap', () => {
  it('statsOf counts the right things', () => {
    const ctx = mk(2, { challengeRule: 1 });
    let s = init(ctx);
    s = addPlay(s, ctx, 1, 20, { word: 'oxen' });
    s = addPlay(s, ctx, 2, 70, { word: 'quizzed', bingo: true });
    s = addPass(s, ctx, 1);
    s = addLostChallenge(s, ctx, 2);
    s = addPenalty(s, ctx, 2, 1, 'overtime');
    expect(statsOf(s, 1)).toEqual({ plays: 1, best: 20, bestWord: 'OXEN', bingos: 0, passes: 1, exchanges: 0, lostChallenges: 0, penalties: 0 });
    expect(statsOf(s, 2)).toEqual({ plays: 1, best: 120, bestWord: 'QUIZZED', bingos: 1, passes: 0, exchanges: 0, lostChallenges: 1, penalties: 1 });
  });
  it('one message per player: place, score, winner, end tiles, best play', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = addPlay(s, ctx, 1, 100, { word: 'jazzy' });
    s = addPlay(s, ctx, 2, 80);
    s = addPlay(s, ctx, 3, 80);
    s = endGame(s, ctx, 'out', 1, { 2: 4, 3: 4 });
    const r = recap(s, ctx);
    expect(r.map((x) => x.playerId)).toEqual([1, 2, 3]);
    expect(r[0]!.text.includes('1st')).toBe(true);
    expect(r[0]!.text.includes('You won!')).toBe(true);
    expect(r[0]!.text.includes('+8')).toBe(true);
    expect(r[0]!.text.includes('best JAZZY for 100')).toBe(true);
    expect(r[1]!.text.includes('2nd (tied)')).toBe(true);
    expect(r[1]!.text.includes('Winner: P1 with 108 points')).toBe(true);
    expect(r[1]!.text.includes('−4')).toBe(true);
  });
  it('a shared win names the others; re-rolls are mentioned only when used', () => {
    const ctx = mk(2, { tieHigherBefore: 0 });
    let s = addPlay(addPlay(init(ctx), ctx, 1, 50), ctx, 2, 50);
    s = recordReroll(s, ctx, 2);
    expect(recordReroll(s, ctx, 99)).toBe(s);
    const r = recap(s, ctx);
    expect(r[0]!.text.includes('You share the win with P2')).toBe(true);
    expect(r[0]!.text.includes('Re-rolls')).toBe(false);
    expect(r[1]!.text.includes('Re-rolls used: 1.')).toBe(true);
  });
  it('a player with no plays still gets a message', () => {
    const ctx = mk(2);
    const r = recap(addPlay(init(ctx), ctx, 1, 10), ctx);
    expect(r).toHaveLength(2);
    expect(r[1]!.text.startsWith('Scrabble: you finished 2nd with 0 points.')).toBe(true);
  });
});

describe('history text and warnings', () => {
  it('describes every kind', () => {
    const ctx = mk(2, { challengeRule: 1 });
    let s = init(ctx);
    s = addPlay(s, ctx, 1, 20, { word: 'cab' });
    s = addPlay(s, ctx, 2, 70, { bingo: true });
    s = addPass(s, ctx, 1);
    s = addExchange(s, ctx, 2);
    s = addLostChallenge(s, ctx, 1);
    s = addPenalty(s, ctx, 1, 2, 'overtime');
    s = challengeOff(addPlay(s, ctx, 2, 9, { word: 'zz' }), ctx);
    const t = s.entries.map(entryText);
    expect(t[0]).toBe('CAB for 20');
    expect(t[1]).toBe('scored 120 (incl. bingo +50)');
    expect(t[2]).toBe('passed');
    expect(t[3]).toBe('exchanged tiles');
    expect(t[4]).toBe('lost a challenge −5');
    expect(t[5]).toBe('penalty −2 (OVERTIME)');
    expect(t[6]).toBe('play challenged off (ZZ): no score, turn used');
    const d = mk(2);
    expect(entryText(addLostChallenge(init(d), d, 1).entries[0]!)).toBe('lost a challenge: turn skipped');
  });
  it('warns about an empty or unfinished game', () => {
    const ctx = mk(2);
    expect(finishWarnings(init(ctx), ctx).length).toBe(2);
    let s = addPlay(init(ctx), ctx, 1, 10);
    expect(finishWarnings(s, ctx).some((w) => w.includes('not been ended'))).toBe(true);
    s = endGame(s, ctx, 'out', 1, { 2: 3 });
    expect(finishWarnings(s, ctx)).toEqual([]);
    expect(finishWarnings(endGame(addPlay(init(ctx), ctx, 1, 10), ctx, 'time', null, {}), ctx).some((w) => w.includes('stopped early'))).toBe(true);
  });
});

describe('turn timer', () => {
  it('off by default', () => {
    const ctx = mk(2);
    expect(turnClock(init(ctx), ctx, 1000)).toBeNull();
  });
  it('counts from the last turn and prices overtime by started minutes', () => {
    const ctx = mk(2, { turnSeconds: 60, overtimePenalty: 2 });
    let s = markStarted(init(ctx), 0);
    expect(turnClock(s, ctx, 30_000)).toEqual({ limitSec: 60, elapsedSec: 30, remainingSec: 30, over: false, overMinutes: 0, penalty: 0 });
    s = addPlay(s, ctx, 1, 10, {}, 100_000);
    const c = turnClock(s, ctx, 100_000 + 61_000)!;
    expect(c.over).toBe(true);
    expect(c.overMinutes).toBe(1);
    expect(c.penalty).toBe(2);
    expect(turnClock(s, ctx, 100_000 + 130_000)!.penalty).toBe(4);
  });
  it('a penalty entry does not restart the timer; no start time = no timer', () => {
    const ctx = mk(2, { turnSeconds: 60 });
    let s = markStarted(init(ctx), 0);
    s = addPlay(s, ctx, 1, 10, {}, 10_000);
    s = addPenalty(s, ctx, 2, 1, 'x', 50_000);
    expect(turnClock(s, ctx, 70_000)!.elapsedSec).toBe(60);
    expect(turnClock(init(ctx), ctx, 70_000)).toBeNull();
  });
  it('stops when the game is ended', () => {
    const ctx = mk(2, { turnSeconds: 60 });
    const s = endGame(markStarted(init(ctx), 0), ctx, 'time', null, {});
    expect(turnClock(s, ctx, 5000)).toBeNull();
  });
  it('overtime with the penalty off costs nothing', () => {
    const ctx = mk(2, { turnSeconds: 30, overtimePenalty: 0 });
    expect(turnClock(markStarted(init(ctx), 0), ctx, 120_000)!.penalty).toBe(0);
  });
});

describe('game clock and small helpers', () => {
  it('markStarted keeps the first time and returns the same object', () => {
    const ctx = mk(2);
    const s = markStarted(init(ctx), 5);
    expect(s.startedAt).toBe(5);
    expect(markStarted(s, 9)).toBe(s);
    expect(markStarted(init(ctx), NaN).startedAt).toBeNull();
  });
  it('clock prefers the host start, freezes when ended', () => {
    const ctx = { ...mk(2), startedAt: 1000, endsAt: 61_000 };
    let s = markStarted(init(ctx), 5);
    expect(clock(init(mk(2)), mk(2), 10)).toBeNull();
    const c = clock(s, ctx, 31_000)!;
    expect(c.source).toBe('host');
    expect(c.elapsedMs).toBe(30_000);
    expect(c.remainingMs).toBe(30_000);
    s = endGame(s, ctx, 'time', null, {}, 41_000);
    const f = clock(s, ctx, 99_000)!;
    expect(f.finished).toBe(true);
    expect(f.elapsedMs).toBe(40_000);
    expect(clock(s, { ...ctx, endsAt: 500 }, 5000)!.endsAt).toBeNull();
  });
  it('duration and ordinal', () => {
    expect(duration(10_000)).toBe('under a minute');
    expect(duration(28 * 60_000)).toBe('28 min');
    expect(duration(72 * 60_000)).toBe('1h 12m');
    expect(duration(120 * 60_000)).toBe('2h');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});

describe('safeguards against accidents', () => {
  it('a double tap on Pass / Exchange / Lost challenge / Penalty / the same score is ignored', () => {
    const ctx = mk(3);
    const s0 = init(ctx);
    const a = addPass(s0, ctx, 1, 10_000);
    expect(addPass(a, ctx, 1, 10_000 + 200)).toBe(a);
    const b = addExchange(a, ctx, 2, 11_000);
    expect(addExchange(b, ctx, 2, 11_300)).toBe(b);
    const c = addLostChallenge(b, ctx, 3, 12_000);
    expect(addLostChallenge(c, ctx, 3, 12_100)).toBe(c);
    const d = addPenalty(c, ctx, 1, 2, 'x', 13_000);
    expect(addPenalty(d, ctx, 1, 2, 'x', 13_100)).toBe(d);
    const e = addPlay(d, ctx, 1, 24, { word: 'cab' }, 14_000);
    expect(addPlay(e, ctx, 1, 24, { word: 'cab' }, 14_050)).toBe(e);
  });
  it('the same action a little later, or a different one, still counts', () => {
    const ctx = mk(2);
    let s = addPass(init(ctx), ctx, 1, 10_000);
    const later = addPass(s, ctx, 1, 10_000 + DOUBLE_TAP_MS + 1);
    expect(later.entries).toHaveLength(2);
    s = addPlay(s, ctx, 1, 20, {}, 10_100);
    expect(s.entries).toHaveLength(2);
    expect(addPlay(s, ctx, 1, 21, {}, 10_200).entries).toHaveLength(3);
    expect(addPass(addPass(init(ctx), ctx, 1, 5000), ctx, 2, 5100).entries).toHaveLength(2);
  });
  it('without timestamps nothing is treated as a double tap', () => {
    const ctx = mk(2);
    const s = addPass(addPass(init(ctx), ctx, 1), ctx, 1);
    expect(s.entries).toHaveLength(2);
  });
  it('a mis-tapped undo can be put back, once per undo, in order', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = addPlay(s, ctx, 1, 10);
    s = addPlay(s, ctx, 2, 20);
    s = addPlay(s, ctx, 3, 30);
    const full = s;
    s = undoLast(undoLast(s));
    expect(s.entries).toHaveLength(1);
    expect(redoNext(s)!.points).toBe(20);
    s = redoLast(redoLast(s));
    expect(s.entries).toEqual(full.entries);
    expect(redoLast(s)).toBe(s);
    expect(redoNext(s)).toBeNull();
    expect(currentPlayer(s, ctx)).toBe(1);
  });
  it('a new entry clears the put-back list; so does a challenge-off', () => {
    const ctx = mk(2);
    let s = addPlay(addPlay(init(ctx), ctx, 1, 10), ctx, 2, 20);
    s = undoLast(s);
    expect(redoNext(s)).not.toBeNull();
    expect(redoNext(addPass(s, ctx, 2))).toBeNull();
    let t = addPlay(addPlay(init(ctx), ctx, 1, 10), ctx, 2, 20);
    t = undoLast(t);
    t = addPlay(t, ctx, 2, 5);
    expect(redoNext(challengeOff(t, ctx))).toBeNull();
  });
  it('put-back is blocked while the game is ended, and old saves without the list still work', () => {
    const ctx = mk(2);
    let s = undoLast(addPlay(init(ctx), ctx, 1, 10));
    const ended = endGame(s, ctx, 'time', null, {});
    expect(redoLast(ended)).toBe(ended);
    expect(redoNext(ended)).toBeNull();
    const old = { ...init(ctx) } as Partial<ScrabbleState> as ScrabbleState;
    delete old.redo;
    delete (old as Partial<ScrabbleState>).rerolls;
    expect(redoLast(old)).toBe(old);
    expect(undoLast(addPlay(old, ctx, 1, 4)).entries).toHaveLength(0);
    expect(recordReroll(old, ctx, 1).rerolls).toEqual({ 1: 1 });
    s = addPlay(old, ctx, 1, 4);
    expect(recap(s, ctx)).toHaveLength(2);
  });
  it('undoing a challenged-off play brings the play back with its score, bingo and tiles', () => {
    const ctx = mk(2);
    let s = addPlay(init(ctx), ctx, 1, 40, { word: 'zzzz', bingo: true });
    const original = s.entries[0]!;
    const bag = bagCount(s, ctx);
    s = challengeOff(s, ctx);
    expect(baseScore(s, 1)).toBe(0);
    s = undoLast(s);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toEqual(original);
    expect(baseScore(s, 1)).toBe(90);
    expect(bagCount(s, ctx)).toBe(bag);
    expect(currentPlayer(s, ctx)).toBe(2);
    expect(redoNext(s)).toBeNull();
  });
  it('overtime can only be charged once per turn', () => {
    const ctx = mk(2, { turnSeconds: 60, overtimePenalty: 2 });
    let s = markStarted(init(ctx), 0);
    s = addPlay(s, ctx, 1, 10, {}, 100_000);
    expect(overtimeApplied(s)).toBe(false);
    const now = 100_000 + 200_000;
    const pen = turnClock(s, ctx, now)!.penalty;
    expect(pen > 0).toBe(true);
    s = addPenalty(s, ctx, 2, pen, 'overtime', now);
    expect(overtimeApplied(s)).toBe(true);
    expect(turnClock(s, ctx, now + 60_000)!.penalty).toBe(0);
    s = addPlay(s, ctx, 2, 5, {}, now + 61_000);
    expect(overtimeApplied(s)).toBe(false);
  });
  it('a bad number for tiles, bag or racks can never poison a total', () => {
    const ctx = mk(2);
    const s = addPlay(init(ctx), ctx, 1, 10, { tiles: NaN });
    expect(bagCount(s, ctx)).toBe(85);
    expect(bagCount(addPlay(init(ctx), ctx, 1, 10, { tiles: Infinity }), ctx)).toBe(79);
    const e = endGame(s, ctx, 'blocked', null, { 1: NaN, 2: Infinity });
    expect(totalScore(e, ctx, 1)).toBe(10);
    expect(totalScore(e, ctx, 2)).toBe(0);
  });
  it('a saved game goes through JSON and back unchanged', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = addPlay(s, ctx, 1, 33, { word: 'ox', bingo: true }, 1);
    s = challengeOff(s, ctx);
    s = undoLast(addPlay(s, ctx, 2, 9, {}, 5));
    s = endGame(s, ctx, 'out', 1, { 2: 3, 3: 4 }, 9);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
