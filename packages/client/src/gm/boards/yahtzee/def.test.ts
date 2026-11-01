import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  BOXES,
  SETTINGS,
  addBonus,
  boxHint,
  boxRule,
  canBonus,
  clearBox,
  clock,
  def,
  duration,
  endGame,
  entryText,
  finalMax,
  finishWarnings,
  gameCount,
  gameTotals,
  init,
  markStarted,
  nextAfter,
  ordinal,
  placements,
  progress,
  ranking,
  recap,
  recordReroll,
  redoLast,
  redoNext,
  removeBonus,
  reopenGame,
  score,
  setBox,
  sheetOf,
  sheetTotal,
  sheetsFull,
  totalScore,
  turnOrder,
  undoLast,
  validBox,
  type YahtzeeState,
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

/** Fills every box of one sheet with a legal value; returns the new state. */
function fillSheet(s: YahtzeeState, ctx: BoardContext, pid: number, g = 0, scratch = false): YahtzeeState {
  let cur = s;
  for (const b of BOXES) {
    const r = boxRule(ctx.settings, b);
    const v = r.kind === 'fixed' ? (scratch ? 0 : r.value) : scratch && r.zero ? 0 : r.min;
    cur = setBox(cur, ctx, pid, g, b, v, 1000);
  }
  return cur;
}

describe('settings', () => {
  it('every setting has a default inside its own range', () => {
    for (const v of Object.values(SETTINGS)) expect(v.default >= v.min && v.default <= v.max).toBe(true);
  });
  it('classic defaults', () => {
    const d = defaults();
    expect(d.upperBonusAt).toBe(63);
    expect(d.upperBonus).toBe(35);
    expect(d.yahtzeeBonus).toBe(100);
    expect(d.fullHouse).toBe(25);
    expect(d.smallStraight).toBe(30);
    expect(d.largeStraight).toBe(40);
    expect(d.yahtzee).toBe(50);
    expect(d.games).toBe(1);
    expect(d.tracking).toBe(1);
  });
  it('the board key and label', () => {
    expect(def.key).toBe('yahtzee');
    expect(def.label).toBe('Yahtzee');
  });
});

describe('box rules (smart entry)', () => {
  const c = mk(2);
  it('fixed boxes take their value or a scratch', () => {
    expect(validBox(c.settings, 'fullHouse', 25)).toBe(true);
    expect(validBox(c.settings, 'fullHouse', 0)).toBe(true);
    expect(validBox(c.settings, 'fullHouse', 24)).toBe(false);
    expect(validBox(c.settings, 'largeStraight', 40)).toBe(true);
    expect(validBox(c.settings, 'smallStraight', 40)).toBe(false);
    expect(validBox(c.settings, 'yahtzee', 50)).toBe(true);
    expect(validBox(c.settings, 'yahtzee', 25)).toBe(false);
  });
  it('upper boxes: multiples of the face, up to face x dice', () => {
    expect(validBox(c.settings, 'fours', 12)).toBe(true);
    expect(validBox(c.settings, 'fours', 20)).toBe(true);
    expect(validBox(c.settings, 'fours', 0)).toBe(true);
    expect(validBox(c.settings, 'fours', 13)).toBe(false);
    expect(validBox(c.settings, 'fours', 24)).toBe(false);
    expect(validBox(c.settings, 'sixes', 30)).toBe(true);
    expect(validBox(c.settings, 'sixes', 36)).toBe(false);
    expect(validBox(c.settings, 'ones', 5)).toBe(true);
    expect(validBox(c.settings, 'ones', 6)).toBe(false);
  });
  it('3 / 4 of a kind and chance: dice..max', () => {
    expect(validBox(c.settings, 'threeKind', 30)).toBe(true);
    expect(validBox(c.settings, 'threeKind', 31)).toBe(false);
    expect(validBox(c.settings, 'threeKind', 4)).toBe(false);
    expect(validBox(c.settings, 'threeKind', 5)).toBe(true);
    expect(validBox(c.settings, 'threeKind', 0)).toBe(true);
    expect(validBox(c.settings, 'fourKind', 0)).toBe(true);
    expect(validBox(c.settings, 'chance', 0)).toBe(false);
    expect(validBox(c.settings, 'chance', 22)).toBe(true);
  });
  it('rejects fractions, negatives, NaN', () => {
    expect(validBox(c.settings, 'chance', 22.5)).toBe(false);
    expect(validBox(c.settings, 'chance', -1)).toBe(false);
    expect(validBox(c.settings, 'chance', NaN)).toBe(false);
  });
  it('settings change the rules', () => {
    const k = mk(2, { fullHouse: 30, dice: 6, chanceMax: 36 });
    expect(validBox(k.settings, 'fullHouse', 30)).toBe(true);
    expect(validBox(k.settings, 'fullHouse', 25)).toBe(false);
    expect(validBox(k.settings, 'fours', 24)).toBe(true);
    expect(validBox(k.settings, 'chance', 36)).toBe(true);
  });
  it('hints read well', () => {
    expect(boxHint(c.settings, 'fullHouse')).toBe('25 or scratch (0)');
    expect(boxHint(c.settings, 'fours')).toBe('0 (scratch) or 4 to 20, in steps of 4');
    expect(boxHint(c.settings, 'chance')).toBe('5 to 30');
  });
});

describe('init and seating', () => {
  it('orders by seat, unseated last', () => {
    const c = mk(3);
    c.players[0] = player(1, 3);
    c.players[1] = player(2, null);
    c.players[2] = player(3, 1);
    expect(init(c).order).toEqual([3, 1, 2]);
  });
  it('nextAfter wraps', () => {
    const c = mk(3);
    const s = init(c);
    expect(nextAfter(s, c, 1)).toBe(2);
    expect(nextAfter(s, c, 3)).toBe(1);
  });
  it('a player added later goes last', () => {
    const c = mk(2);
    const s = init(c);
    const c3 = mk(3);
    expect(turnOrder(s, c3)).toEqual([1, 2, 3]);
  });
});

describe('boxes and totals', () => {
  const c = mk(2);
  it('writes a box and counts it', () => {
    let s = init(c);
    s = setBox(s, c, 1, 0, 'threes', 9, 1);
    expect(gameTotals(s, c, 1, 0).upper).toBe(9);
    expect(sheetTotal(s, c, 1)).toBe(9);
    expect(sheetTotal(s, c, 2)).toBe(0);
  });
  it('rejects illegal values and unknown things; returns the same object', () => {
    const s = init(c);
    expect(setBox(s, c, 1, 0, 'fours', 13)).toBe(s);
    expect(setBox(s, c, 99, 0, 'fours', 12)).toBe(s);
    expect(setBox(s, c, 1, 1, 'fours', 12)).toBe(s); // only one game
    expect(setBox(s, c, 1, 0, 'nope' as never, 1)).toBe(s);
  });
  it('writing the same value again changes nothing', () => {
    let s = init(c);
    s = setBox(s, c, 1, 0, 'chance', 20, 1);
    expect(setBox(s, c, 1, 0, 'chance', 20, 2)).toBe(s);
  });
  it('a filled box can be corrected', () => {
    let s = init(c);
    s = setBox(s, c, 1, 0, 'chance', 20, 1);
    s = setBox(s, c, 1, 0, 'chance', 24, 2);
    expect(sheetOf(s, 1, 0).boxes.chance).toBe(24);
    expect(sheetTotal(s, c, 1)).toBe(24);
  });
  it('a scratch is a filled box worth 0', () => {
    let s = init(c);
    s = setBox(s, c, 1, 0, 'yahtzee', 0, 1);
    expect(sheetOf(s, 1, 0).boxes.yahtzee).toBe(0);
    expect(progress(s, c, 1).filled).toBe(1);
  });
  it('clears a box, and clearing an empty box does nothing', () => {
    let s = init(c);
    expect(clearBox(s, c, 1, 0, 'chance')).toBe(s);
    s = setBox(s, c, 1, 0, 'chance', 20, 1);
    s = clearBox(s, c, 1, 0, 'chance', 2);
    expect(sheetOf(s, 1, 0).boxes.chance).toBe(undefined);
    expect(sheetTotal(s, c, 1)).toBe(0);
  });
  it('upper bonus at 63 and not at 62', () => {
    let s = init(c);
    // 3+6+9+12+15+18 = 63 (three of each)
    for (const [b, v] of [['ones', 3], ['twos', 6], ['threes', 9], ['fours', 12], ['fives', 15], ['sixes', 18]] as const) s = setBox(s, c, 1, 0, b, v, 1);
    const t = gameTotals(s, c, 1, 0);
    expect(t.upper).toBe(63);
    expect(t.upperBonus).toBe(35);
    expect(t.total).toBe(98);
    expect(t.toBonus).toBe(0);
    let r = init(c);
    for (const [b, v] of [['ones', 2], ['twos', 6], ['threes', 9], ['fours', 12], ['fives', 15], ['sixes', 18]] as const) r = setBox(r, c, 1, 0, b, v, 1);
    expect(gameTotals(r, c, 1, 0).upperBonus).toBe(0);
    expect(gameTotals(r, c, 1, 0).toBonus).toBe(1);
    expect(gameTotals(r, c, 1, 0).total).toBe(62);
  });
  it('the bonus numbers are settings', () => {
    const k = mk(2, { upperBonusAt: 50, upperBonus: 20 });
    let s = init(k);
    s = setBox(s, k, 1, 0, 'sixes', 30, 1);
    s = setBox(s, k, 1, 0, 'fives', 20, 2);
    expect(gameTotals(s, k, 1, 0).total).toBe(70);
  });
  it('lower section adds up', () => {
    let s = init(c);
    s = setBox(s, c, 1, 0, 'fullHouse', 25, 1);
    s = setBox(s, c, 1, 0, 'largeStraight', 40, 2);
    s = setBox(s, c, 1, 0, 'threeKind', 22, 3);
    expect(gameTotals(s, c, 1, 0).lower).toBe(87);
    expect(sheetTotal(s, c, 1)).toBe(87);
  });
});

describe('Yahtzee bonus (extra Yahtzees)', () => {
  const c = mk(2);
  it('needs a scored Yahtzee first', () => {
    let s = init(c);
    expect(canBonus(s, c, 1, 0)).toBe(false);
    expect(addBonus(s, c, 1, 0, 1)).toBe(s);
    s = setBox(s, c, 1, 0, 'yahtzee', 0, 1);
    expect(canBonus(s, c, 1, 0)).toBe(false); // a scratch is not a Yahtzee
    s = setBox(init(c), c, 1, 0, 'yahtzee', 50, 1);
    expect(canBonus(s, c, 1, 0)).toBe(true);
  });
  it('adds 100 each, with the double tap guarded', () => {
    let s = setBox(init(c), c, 1, 0, 'yahtzee', 50, 1);
    s = addBonus(s, c, 1, 0, 10000);
    expect(sheetTotal(s, c, 1)).toBe(150);
    expect(addBonus(s, c, 1, 0, 10500)).toBe(s); // double tap
    s = addBonus(s, c, 1, 0, 20000);
    expect(sheetTotal(s, c, 1)).toBe(250);
  });
  it('the limit per game is a setting', () => {
    const k = mk(2, { extraYahtzeeMax: 1 });
    let s = setBox(init(k), k, 1, 0, 'yahtzee', 50, 1);
    s = addBonus(s, k, 1, 0, 10000);
    expect(addBonus(s, k, 1, 0, 20000)).toBe(s);
  });
  it('can be taken off again, never below zero', () => {
    let s = setBox(init(c), c, 1, 0, 'yahtzee', 50, 1);
    expect(removeBonus(s, c, 1, 0, 2)).toBe(s);
    s = addBonus(s, c, 1, 0, 10000);
    s = removeBonus(s, c, 1, 0, 20000);
    expect(sheetTotal(s, c, 1)).toBe(50);
  });
  it('the Yahtzee box is locked at 50 while extra Yahtzees are recorded', () => {
    let s = setBox(init(c), c, 1, 0, 'yahtzee', 50, 1);
    s = addBonus(s, c, 1, 0, 10000);
    expect(setBox(s, c, 1, 0, 'yahtzee', 0, 2)).toBe(s);
    expect(clearBox(s, c, 1, 0, 'yahtzee', 2)).toBe(s);
  });
  it('bonus amount is a setting', () => {
    const k = mk(2, { yahtzeeBonus: 200 });
    let s = setBox(init(k), k, 1, 0, 'yahtzee', 50, 1);
    s = addBonus(s, k, 1, 0, 10000);
    expect(sheetTotal(s, k, 1)).toBe(250);
  });
  it('a 0 bonus setting switches the bonus off', () => {
    const k = mk(2, { yahtzeeBonus: 0 });
    const s = setBox(init(k), k, 1, 0, 'yahtzee', 50, 1);
    expect(canBonus(s, k, 1, 0)).toBe(false);
  });
});

describe('undo and redo', () => {
  const c = mk(2);
  it('undo takes the sums back too', () => {
    let s = init(c);
    s = setBox(s, c, 1, 0, 'chance', 20, 1);
    s = setBox(s, c, 1, 0, 'chance', 24, 2);
    s = undoLast(s);
    expect(sheetTotal(s, c, 1)).toBe(20);
    s = undoLast(s);
    expect(sheetTotal(s, c, 1)).toBe(0);
  });
  it('redo puts it back; a new entry clears redo', () => {
    let s = setBox(init(c), c, 1, 0, 'chance', 20, 1);
    s = undoLast(s);
    expect(redoNext(s)?.value).toBe(20);
    const back = redoLast(s);
    expect(sheetTotal(back, c, 1)).toBe(20);
    const other = setBox(s, c, 1, 0, 'chance', 18, 2);
    expect(redoNext(other)).toBeNull();
  });
  it('nothing to undo returns the same object', () => {
    const s = init(c);
    expect(undoLast(s)).toBe(s);
    expect(redoLast(s)).toBe(s);
  });
  it('undoing an extra Yahtzee takes the 100 off', () => {
    let s = setBox(init(c), c, 1, 0, 'yahtzee', 50, 1);
    s = addBonus(s, c, 1, 0, 10000);
    s = undoLast(s);
    expect(sheetTotal(s, c, 1)).toBe(50);
  });
});

describe('several games per sitting', () => {
  it('one game by default', () => {
    expect(gameCount(init(mk(2)), mk(2))).toBe(1);
  });
  it('games add up', () => {
    const c = mk(2, { games: 3 });
    let s = init(c);
    s = setBox(s, c, 1, 0, 'chance', 20, 1);
    s = setBox(s, c, 1, 1, 'chance', 10, 2);
    s = setBox(s, c, 1, 2, 'chance', 5, 3);
    expect(gameCount(s, c)).toBe(3);
    expect(sheetTotal(s, c, 1)).toBe(35);
    expect(setBox(s, c, 1, 3, 'chance', 5)).toBe(s);
  });
  it('lowering the setting never hides entered games', () => {
    const c3 = mk(2, { games: 3 });
    let s = setBox(init(c3), c3, 1, 2, 'chance', 20, 1);
    const c1 = mk(2, { games: 1 });
    expect(gameCount(s, c1)).toBe(3);
    expect(sheetTotal(s, c1, 1)).toBe(20);
    s = setBox(s, c1, 1, 2, 'chance', 21, 2);
    expect(sheetTotal(s, c1, 1)).toBe(21);
  });
  it('each game has its own upper bonus and its own extra Yahtzees', () => {
    const c = mk(2, { games: 2 });
    let s = init(c);
    s = setBox(s, c, 1, 0, 'yahtzee', 50, 1);
    s = addBonus(s, c, 1, 0, 10000);
    expect(canBonus(s, c, 1, 1)).toBe(false);
    expect(gameTotals(s, c, 1, 1).total).toBe(0);
  });
  it('progress counts boxes over all games', () => {
    const c = mk(2, { games: 2 });
    const s = setBox(init(c), c, 1, 0, 'chance', 20, 1);
    expect(progress(s, c, 1)).toEqual({ filled: 1, of: 26 });
  });
});

describe('crown (score)', () => {
  it('everyone is 0 until the game is over', () => {
    const c = mk(3);
    let s = init(c);
    s = setBox(s, c, 1, 0, 'yahtzee', 50, 1);
    s = setBox(s, c, 2, 0, 'chance', 20, 2);
    expect(score(s, c)).toEqual({ 1: 0, 2: 0, 3: 0 });
  });
  it('shows the totals once the game is ended', () => {
    const c = mk(2);
    let s = init(c);
    s = setBox(s, c, 1, 0, 'yahtzee', 50, 1);
    s = setBox(s, c, 2, 0, 'chance', 20, 2);
    s = endGame(s, c, {}, 3);
    expect(score(s, c)).toEqual({ 1: 50, 2: 20 });
  });
  it('shows the totals once every sheet is full', () => {
    const c = mk(2);
    let s = init(c);
    s = fillSheet(s, c, 1);
    expect(sheetsFull(s, c)).toBe(false);
    expect(score(s, c)[1]).toBe(0);
    s = fillSheet(s, c, 2, 0, true);
    expect(sheetsFull(s, c)).toBe(true);
    expect(score(s, c)[1]).toBe(sheetTotal(s, c, 1));
    expect(score(s, c)[2]).toBe(5);
  });
  it('with tracking off the sheets being full does not matter', () => {
    const c = mk(2, { tracking: 0 });
    let s = init(c);
    s = fillSheet(s, c, 1);
    s = fillSheet(s, c, 2);
    expect(sheetsFull(s, c)).toBe(false);
    expect(score(s, c)).toEqual({ 1: 0, 2: 0 });
  });
  it('every player present in the result, also with no entries', () => {
    const c = mk(3);
    const s = endGame(init(c), c, {}, 1);
    expect(Object.keys(score(s, c))).toEqual(['1', '2', '3']);
  });
});

describe('ending the game with typed totals', () => {
  it('a typed total beats the sheet', () => {
    const c = mk(2);
    let s = setBox(init(c), c, 1, 0, 'chance', 20, 1);
    s = endGame(s, c, { 1: 210, 2: 180 }, 5);
    expect(totalScore(s, c, 1)).toBe(210);
    expect(totalScore(s, c, 2)).toBe(180);
    expect(score(s, c)).toEqual({ 1: 210, 2: 180 });
  });
  it('a player without a typed total uses the sheet', () => {
    const c = mk(2);
    let s = setBox(init(c), c, 1, 0, 'chance', 20, 1);
    s = endGame(s, c, { 2: 180 }, 5);
    expect(totalScore(s, c, 1)).toBe(20);
  });
  it('rejects totals that are too big, fractions, negatives', () => {
    const c = mk(2);
    const s = endGame(init(c), c, { 1: 1601, 2: -4 }, 5);
    expect(s.over?.finals).toEqual({});
    expect(finalMax(init(c), c)).toBe(1600);
    expect(endGame(init(c), c, { 1: 1600 }, 1).over?.finals[1]).toBe(1600);
    expect(endGame(init(c), c, { 1: 10.5 }, 1).over?.finals[1]).toBe(undefined);
  });
  it('the limit grows with the number of games', () => {
    const c = mk(2, { games: 3 });
    expect(finalMax(init(c), c)).toBe(4800);
  });
  it('ending twice returns the same object; reopen takes it back', () => {
    const c = mk(2);
    let s = endGame(init(c), c, { 1: 100 }, 1);
    expect(endGame(s, c, { 1: 200 }, 2)).toBe(s);
    s = reopenGame(s);
    expect(s.over).toBeNull();
    expect(reopenGame(s)).toBe(s);
  });
  it('no entries once ended', () => {
    const c = mk(2);
    const s = endGame(init(c), c, {}, 1);
    expect(setBox(s, c, 1, 0, 'chance', 20)).toBe(s);
    expect(undoLast(s)).toBe(s);
    expect(addBonus(s, c, 1, 0)).toBe(s);
  });
});

describe('placements and ranking', () => {
  const c = mk(4);
  it('highest first', () => {
    const s = endGame(init(c), c, { 1: 100, 2: 250, 3: 180, 4: 90 }, 1);
    expect(placements(s, c)).toEqual([[2], [3], [1], [4]]);
  });
  it('ties share the place (no tie-break)', () => {
    const s = endGame(init(c), c, { 1: 200, 2: 200, 3: 180, 4: 180 }, 1);
    expect(placements(s, c)).toEqual([[1, 2], [3, 4]]);
    const rows = ranking(s, c);
    expect(rows.map((r) => r.place)).toEqual([1, 1, 3, 3]);
    expect(rows.every((r) => r.tied)).toBe(true);
  });
  it('a game that was never ended ranks by the running totals', () => {
    let s = init(c);
    s = setBox(s, c, 3, 0, 'yahtzee', 50, 1);
    s = setBox(s, c, 1, 0, 'chance', 20, 2);
    expect(placements(s, c)).toEqual([[3], [1], [2, 4]]);
  });
  it('an empty game is one big tie', () => {
    expect(placements(init(c), c)).toEqual([[1, 2, 3, 4]]);
  });
  it('every player appears exactly once', () => {
    const s = endGame(init(c), c, { 1: 5 }, 1);
    expect(placements(s, c).flat().sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('recap', () => {
  it('one message per player with place and total', () => {
    const c = mk(2);
    let s = init(c);
    s = setBox(s, c, 1, 0, 'yahtzee', 50, 1);
    s = endGame(s, c, {}, 2);
    const r = recap(s, c);
    expect(r).toHaveLength(2);
    expect(r[0]!.text.includes('1st')).toBe(true);
    expect(r[0]!.text.includes('You won!')).toBe(true);
    expect(r[0]!.text.includes('1 Yahtzee')).toBe(true);
    expect(r[1]!.text.includes('2nd')).toBe(true);
    expect(r[1]!.text.includes('Winner: P1')).toBe(true);
  });
  it('shared win and re-rolls are mentioned', () => {
    const c = mk(2);
    let s = endGame(init(c), c, { 1: 100, 2: 100 }, 1);
    s = recordReroll(s, c, 2);
    const r = recap(s, c);
    expect(r[0]!.text.includes('share the win')).toBe(true);
    expect(r.find((x) => x.playerId === 2)!.text.includes('Re-rolls used: 1')).toBe(true);
  });
  it('typed totals get no sheet details', () => {
    const c = mk(2);
    const s = endGame(init(c), c, { 1: 200, 2: 100 }, 1);
    expect(recap(s, c)[0]!.text.includes('Yahtzee,')).toBe(false);
  });
});

describe('re-rolls', () => {
  it('counts a re-roll for a known player only', () => {
    const c = mk(2);
    const s = init(c);
    const a = recordReroll(s, c, 1);
    expect(a.rerolls[1]).toBe(1);
    expect(recordReroll(a, c, 1).rerolls[1]).toBe(2);
    expect(recordReroll(s, c, 99)).toBe(s);
  });
});

describe('clock', () => {
  it('uses the host start and planned end', () => {
    const c = { ...mk(2), startedAt: 1000, endsAt: 1000 + 3600000 };
    const s = init(c);
    const k = clock(s, c, 1000 + 600000)!;
    expect(k.elapsedMs).toBe(600000);
    expect(k.remainingMs).toBe(3000000);
    expect(k.over).toBe(false);
    expect(k.source).toBe('host');
  });
  it('falls back to the board start, and stops when ended', () => {
    const c = mk(2);
    let s = markStarted(init(c), 5000);
    expect(markStarted(s, 9000)).toBe(s);
    s = endGame(s, c, {}, 65000);
    const k = clock(s, c, 999999)!;
    expect(k.finished).toBe(true);
    expect(k.elapsedMs).toBe(60000);
    expect(k.source).toBe('board');
  });
  it('null without any start', () => {
    expect(clock(init(mk(2)), mk(2), 1)).toBeNull();
  });
  it('duration text', () => {
    expect(duration(10000)).toBe('under a minute');
    expect(duration(28 * 60000)).toBe('28 min');
    expect(duration(72 * 60000)).toBe('1h 12m');
    expect(duration(120 * 60000)).toBe('2h');
  });
});

describe('text', () => {
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
  it('history lines', () => {
    const c = mk(2, { games: 2 });
    let s = init(c);
    s = setBox(s, c, 1, 1, 'fullHouse', 25, 1);
    s = setBox(s, c, 1, 0, 'yahtzee', 0, 2);
    s = clearBox(s, c, 1, 0, 'yahtzee', 3);
    expect(entryText(s.entries[0]!, 2)).toBe('game 2: Full house 25');
    expect(entryText(s.entries[1]!, 2)).toBe('game 1: scratched Yahtzee');
    expect(entryText(s.entries[2]!, 1)).toBe('cleared Yahtzee');
  });
  it('warnings', () => {
    const c = mk(2);
    expect(finishWarnings(init(c), c).length).toBe(2);
    let s = fillSheet(init(c), c, 1);
    s = fillSheet(s, c, 2);
    expect(finishWarnings(s, c)).toEqual([]);
    const half = setBox(init(c), c, 1, 0, 'chance', 20, 1);
    expect(finishWarnings(half, c).some((w) => w.includes('not full'))).toBe(true);
    const done = endGame(init(c), c, { 1: 10, 2: 20 }, 1);
    expect(finishWarnings(done, c)).toEqual([]);
  });
});
