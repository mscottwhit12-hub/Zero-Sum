import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  SETTINGS,
  bonusOf,
  capturePawn,
  clock,
  def,
  doublesPenalty,
  duration,
  endGame,
  entryLine,
  finishWarnings,
  init,
  isFinished,
  lastBonus,
  markStarted,
  movePawn,
  ordinal,
  placements,
  ranking,
  recap,
  recordReroll,
  redoLast,
  redoNext,
  reopenGame,
  score,
  statsOf,
  turnOrder,
  undoLast,
  zonesOf,
  type ParcheesiState,
} from './def';

const player = (id: number, seat: number | null = id): BoardPlayer => ({ id, name: `P${id} Last`, color: null, avatarPath: null, seat });
const defaults = () => Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));
const mk = (n: number, settings: Record<string, number> = {}): BoardContext => ({
  players: Array.from({ length: n }, (_, i) => player(i + 1)),
  table: { name: 'T1', seats: 4, w: 0.3, h: 0.15 },
  rerollsAllowed: true,
  rerollsLeft: {},
  useReroll: async () => undefined,
  settings: { ...defaults(), ...settings },
});

let clockT = 1000;
const tick = () => (clockT += 5000);
type Z = Parameters<typeof movePawn>[3];
const run = (s: ParcheesiState, ctx: BoardContext, pid: number, steps: [Z, Z][]): ParcheesiState => {
  let cur = s;
  for (const [f, t] of steps) cur = movePawn(cur, ctx, pid, f, t, tick());
  return cur;
};
const allHome = (s: ParcheesiState, ctx: BoardContext, pid: number, n = 4): ParcheesiState => {
  let cur = s;
  for (let i = 0; i < n; i++) cur = run(cur, ctx, pid, [['nest', 'board'], ['board', 'home']]);
  return cur;
};

describe('settings', () => {
  it('every setting has a default inside its own range', () => {
    for (const v of Object.values(SETTINGS)) expect(v.default >= v.min && v.default <= v.max).toBe(true);
  });
  it('classic values', () => {
    const d = defaults();
    expect(d.pawns).toBe(4);
    expect(d.captureBonus).toBe(20);
    expect(d.homeBonus).toBe(10);
    expect(d.doublesLimit).toBe(3);
    expect(d.enterRoll).toBe(5);
  });
  it('key and label', () => {
    expect(def.key).toBe('parcheesi');
    expect(def.label).toBe('Parcheesi');
  });
});

describe('init', () => {
  it('everything starts in the Nest', () => {
    const c = mk(3);
    expect(zonesOf(init(c), c, 1)).toEqual({ nest: 4, board: 0, path: 0, home: 0 });
  });
  it('pawns is a setting', () => {
    const c = mk(2, { pawns: 3 });
    expect(zonesOf(init(c), c, 1).nest).toBe(3);
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

describe('moving pawns', () => {
  const c = mk(2);
  it('out of the Nest, onto the Home path, Home', () => {
    let s = movePawn(init(c), c, 1, 'nest', 'board', tick());
    expect(zonesOf(s, c, 1)).toEqual({ nest: 3, board: 1, path: 0, home: 0 });
    s = movePawn(s, c, 1, 'board', 'path', tick());
    expect(zonesOf(s, c, 1)).toEqual({ nest: 3, board: 0, path: 1, home: 0 });
    s = movePawn(s, c, 1, 'path', 'home', tick());
    expect(zonesOf(s, c, 1)).toEqual({ nest: 3, board: 0, path: 0, home: 1 });
  });
  it('a pawn can go straight from the board to Home', () => {
    expect(zonesOf(run(init(c), c, 1, [['nest', 'board'], ['board', 'home']]), c, 1).home).toBe(1);
  });
  it('rejects a move with no pawn to take; returns the same object', () => {
    const s = init(c);
    expect(movePawn(s, c, 1, 'board', 'path', 1)).toBe(s);
    expect(movePawn(s, c, 1, 'path', 'home', 1)).toBe(s);
    expect(movePawn(s, c, 1, 'home', 'board', 1)).toBe(s);
  });
  it('rejects bad input', () => {
    const s = init(c);
    expect(movePawn(s, c, 99, 'nest', 'board', 1)).toBe(s);
    expect(movePawn(s, c, 1, 'nest', 'nest', 1)).toBe(s);
    expect(movePawn(s, c, 1, 'nope' as never, 'board', 1)).toBe(s);
  });
  it('no more than all the pawns leave the Nest', () => {
    let s = init(c);
    for (let i = 0; i < 4; i++) s = movePawn(s, c, 1, 'nest', 'board', tick());
    expect(movePawn(s, c, 1, 'nest', 'board', tick())).toBe(s);
  });
  it('a double tap does not move two pawns', () => {
    let s = movePawn(init(c), c, 1, 'nest', 'board', 10000);
    expect(movePawn(s, c, 1, 'nest', 'board', 10500)).toBe(s);
    s = movePawn(s, c, 1, 'nest', 'board', 12000);
    expect(zonesOf(s, c, 1).board).toBe(2);
  });
  it('one player never changes another', () => {
    const s = movePawn(init(c), c, 1, 'nest', 'board', 1);
    expect(zonesOf(s, c, 2)).toEqual({ nest: 4, board: 0, path: 0, home: 0 });
  });
});

describe('captures', () => {
  const c = mk(3);
  it('sends the pawn back to the Nest and logs who did it', () => {
    let s = movePawn(init(c), c, 2, 'nest', 'board', 1);
    s = capturePawn(s, c, 2, 1, tick());
    expect(zonesOf(s, c, 2)).toEqual({ nest: 4, board: 0, path: 0, home: 0 });
    expect(statsOf(s, 1)).toEqual({ captures: 1, captured: 0, tripleDoubles: 0 });
    expect(statsOf(s, 2)).toEqual({ captures: 0, captured: 1, tripleDoubles: 0 });
  });
  it('needs a pawn on the board (not in the Nest, not on the Home path)', () => {
    const s = init(c);
    expect(capturePawn(s, c, 2, 1, 1)).toBe(s);
    const safe = run(s, c, 2, [['nest', 'board'], ['board', 'path']]);
    expect(capturePawn(safe, c, 2, 1, tick())).toBe(safe);
  });
  it('you cannot capture your own pawn', () => {
    const s = movePawn(init(c), c, 2, 'nest', 'board', 1);
    expect(capturePawn(s, c, 2, 2, 5000)).toBe(s);
  });
  it('capturer not known is fine; unknown players are rejected', () => {
    let s = movePawn(init(c), c, 2, 'nest', 'board', 1);
    expect(capturePawn(s, c, 99, 1, 5000)).toBe(s);
    expect(capturePawn(s, c, 2, 99, 5000)).toBe(s);
    s = capturePawn(s, c, 2, null, 6000);
    expect(statsOf(s, 2).captured).toBe(1);
  });
  it('a double tap does not capture twice', () => {
    let s = run(init(c), c, 2, [['nest', 'board'], ['nest', 'board']]);
    s = capturePawn(s, c, 2, 1, 100000);
    expect(capturePawn(s, c, 2, 1, 100400)).toBe(s);
    expect(zonesOf(s, c, 2).board).toBe(1);
  });
});

describe('three doubles', () => {
  const c = mk(2);
  it('sends a pawn from the board back to the Nest', () => {
    let s = run(init(c), c, 1, [['nest', 'board'], ['nest', 'board']]);
    s = doublesPenalty(s, c, 1, tick());
    expect(zonesOf(s, c, 1)).toEqual({ nest: 3, board: 1, path: 0, home: 0 });
    expect(statsOf(s, 1).tripleDoubles).toBe(1);
    expect(statsOf(s, 2).tripleDoubles).toBe(0);
  });
  it('nothing happens with no pawn on the board', () => {
    const s = init(c);
    expect(doublesPenalty(s, c, 1, 1)).toBe(s);
    const path = run(s, c, 1, [['nest', 'board'], ['board', 'path']]);
    expect(doublesPenalty(path, c, 1, tick())).toBe(path);
  });
  it('a double tap does not send two pawns back', () => {
    let s = run(init(c), c, 1, [['nest', 'board'], ['nest', 'board']]);
    s = doublesPenalty(s, c, 1, 200000);
    expect(doublesPenalty(s, c, 1, 200300)).toBe(s);
  });
  it('unknown player', () => {
    const s = init(c);
    expect(doublesPenalty(s, c, 99, 1)).toBe(s);
  });
});

describe('bonus moves (a reminder only)', () => {
  const c = mk(2);
  it('capture 20 for the capturer, a pawn home 10 for its owner', () => {
    let s = run(init(c), c, 2, [['nest', 'board']]);
    s = capturePawn(s, c, 2, 1, tick());
    expect(lastBonus(s, c)).toEqual({ pid: 1, spaces: 20, why: 'capture' });
    s = run(s, c, 2, [['nest', 'board'], ['board', 'home']]);
    expect(lastBonus(s, c)).toEqual({ pid: 2, spaces: 10, why: 'home' });
  });
  it('nothing for ordinary moves, or an unknown capturer, or the penalty', () => {
    let s = run(init(c), c, 1, [['nest', 'board']]);
    expect(lastBonus(s, c)).toBeNull();
    s = capturePawn(s, c, 1, null, tick());
    expect(lastBonus(s, c)).toBeNull();
    s = run(s, c, 1, [['nest', 'board']]);
    s = doublesPenalty(s, c, 1, tick());
    expect(lastBonus(s, c)).toBeNull();
    expect(lastBonus(init(c), c)).toBeNull();
  });
  it('amounts are settings; zero means none', () => {
    const k = mk(2, { captureBonus: 25, homeBonus: 0 });
    let s = movePawn(init(k), k, 2, 'nest', 'board', 1);
    s = capturePawn(s, k, 2, 1, tick());
    expect(bonusOf(s.entries[1]!, k.settings)).toBe(25);
    s = run(s, k, 1, [['nest', 'board'], ['board', 'home']]);
    expect(lastBonus(s, k)).toBeNull();
  });
  it('an undone entry no longer reminds', () => {
    let s = run(init(c), c, 2, [['nest', 'board']]);
    s = capturePawn(s, c, 2, 1, tick());
    s = undoLast(s);
    expect(lastBonus(s, c)).toBeNull();
  });
});

describe('undo and redo', () => {
  const c = mk(2);
  it('undo takes the counts back', () => {
    let s = run(init(c), c, 1, [['nest', 'board'], ['board', 'path']]);
    s = undoLast(s);
    expect(zonesOf(s, c, 1)).toEqual({ nest: 3, board: 1, path: 0, home: 0 });
  });
  it('undoing a capture puts the pawn back; so does undoing three doubles', () => {
    let s = movePawn(init(c), c, 2, 'nest', 'board', 1);
    s = capturePawn(s, c, 2, 1, tick());
    expect(zonesOf(undoLast(s), c, 2).board).toBe(1);
    let d = movePawn(init(c), c, 1, 'nest', 'board', 1);
    d = doublesPenalty(d, c, 1, tick());
    expect(zonesOf(undoLast(d), c, 1).board).toBe(1);
  });
  it('redo puts it back; a new entry clears redo', () => {
    let s = undoLast(movePawn(init(c), c, 1, 'nest', 'board', 1));
    expect(redoNext(s)?.to).toBe('board');
    expect(zonesOf(redoLast(s), c, 1).board).toBe(1);
    expect(redoNext(movePawn(s, c, 2, 'nest', 'board', tick()))).toBeNull();
  });
  it('nothing to undo returns the same object', () => {
    const s = init(c);
    expect(undoLast(s)).toBe(s);
    expect(redoLast(s)).toBe(s);
  });
});

describe('crown (score)', () => {
  it('home first, then the Home path', () => {
    const c = mk(3);
    let s = run(init(c), c, 1, [['nest', 'board'], ['board', 'home']]);
    s = run(s, c, 2, [['nest', 'board'], ['board', 'path']]);
    expect(score(s, c)).toEqual({ 1: 5, 2: 1, 3: 0 });
  });
  it('one pawn home beats any number on the path', () => {
    const c = mk(2);
    let s = init(c);
    for (let i = 0; i < 4; i++) s = run(s, c, 2, [['nest', 'board'], ['board', 'path']]);
    s = run(s, c, 1, [['nest', 'board'], ['board', 'home']]);
    expect(score(s, c)[1]! > score(s, c)[2]!).toBe(true);
  });
  it('does not move on captures, doubles, or pawns moving out of the Nest', () => {
    const c = mk(2);
    let s = run(init(c), c, 1, [['nest', 'board'], ['nest', 'board']]);
    const before = score(s, c);
    s = capturePawn(s, c, 1, 2, tick());
    s = doublesPenalty(s, c, 1, tick());
    expect(score(s, c)).toEqual(before);
  });
  it('follows the pawns setting; every player present', () => {
    const c = mk(2, { pawns: 3 });
    expect(score(run(init(c), c, 1, [['nest', 'board'], ['board', 'home']]), c)[1]).toBe(4);
    expect(Object.keys(score(init(mk(3)), mk(3)))).toEqual(['1', '2', '3']);
  });
});

describe('finish and placements', () => {
  it('the first with every pawn home wins', () => {
    const c = mk(3);
    const s = allHome(init(c), c, 2);
    expect(isFinished(zonesOf(s, c, 2), c)).toBe(true);
    expect(placements(s, c)[0]).toEqual([2]);
  });
  it('the rest rank by home, then path, then out of the Nest', () => {
    const c = mk(4);
    let s = allHome(init(c), c, 1);
    s = run(s, c, 2, [['nest', 'board'], ['board', 'home']]);
    s = run(s, c, 3, [['nest', 'board'], ['board', 'home'], ['nest', 'board'], ['board', 'path']]);
    s = run(s, c, 4, [['nest', 'board'], ['nest', 'board'], ['nest', 'board']]);
    expect(placements(s, c)).toEqual([[1], [3], [2], [4]]);
  });
  it('equal on home and path: more out of the Nest ranks higher', () => {
    const c = mk(3);
    let s = run(init(c), c, 1, [['nest', 'board'], ['nest', 'board']]);
    s = run(s, c, 2, [['nest', 'board']]);
    expect(placements(s, c)).toEqual([[1], [2], [3]]);
  });
  it('equal on all three share the place', () => {
    const c = mk(4);
    let s = run(init(c), c, 1, [['nest', 'board'], ['board', 'home']]);
    s = run(s, c, 2, [['nest', 'board'], ['board', 'home']]);
    expect(placements(s, c)).toEqual([[1, 2], [3, 4]]);
    expect(ranking(s, c).map((r) => r.place)).toEqual([1, 1, 3, 3]);
  });
  it('an empty game is one big tie; every player once', () => {
    const c = mk(3);
    expect(placements(init(c), c)).toEqual([[1, 2, 3]]);
    expect(placements(allHome(init(c), c, 3), c).flat().sort()).toEqual([1, 2, 3]);
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
    const s = endGame(init(c), 5);
    expect(movePawn(s, c, 1, 'nest', 'board', 1)).toBe(s);
    expect(capturePawn(s, c, 1, 2, 1)).toBe(s);
    expect(doublesPenalty(s, c, 1, 1)).toBe(s);
    expect(undoLast(s)).toBe(s);
  });
});

describe('re-rolls and recap', () => {
  it('counts a re-roll for a known player only', () => {
    const c = mk(2);
    const s = init(c);
    const a = recordReroll(s, c, 1);
    expect(a.rerolls[1]).toBe(1);
    expect(recordReroll(a, c, 1).rerolls[1]).toBe(2);
    expect(recordReroll(s, c, 99)).toBe(s);
  });
  it('one message per player', () => {
    const c = mk(2);
    let s = allHome(init(c), c, 1);
    s = movePawn(s, c, 2, 'nest', 'board', tick());
    s = capturePawn(s, c, 2, 1, tick());
    s = recordReroll(s, c, 2);
    const r = recap(s, c);
    expect(r).toHaveLength(2);
    expect(r[0]!.text.includes('1st')).toBe(true);
    expect(r[0]!.text.includes('You won!')).toBe(true);
    expect(r[0]!.text.includes('You captured 1 pawn.')).toBe(true);
    expect(r[1]!.text.includes('Winner: P1')).toBe(true);
    expect(r[1]!.text.includes('You were captured 1 time.')).toBe(true);
    expect(r[1]!.text.includes('Re-rolls used: 1.')).toBe(true);
  });
  it('nobody finished; shared win; doubles mentioned', () => {
    const c = mk(2);
    let s = run(init(c), c, 1, [['nest', 'board'], ['board', 'home']]);
    expect(recap(s, c)[0]!.text.includes('Nobody got every pawn home')).toBe(true);
    s = movePawn(s, c, 2, 'nest', 'board', tick());
    s = doublesPenalty(s, c, 2, tick());
    expect(recap(s, c).find((x) => x.playerId === 2)!.text.includes('Too many doubles')).toBe(true);
    const both = allHome(allHome(init(c), c, 1), c, 2);
    expect(recap(both, c)[0]!.text.includes('share the win')).toBe(true);
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
  const names: Record<number, string> = { 1: 'Sam Lee', 2: 'Alex Kim' };
  const nameOf = (id: number) => names[id] ?? 'A player';
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st']);
  });
  it('history lines', () => {
    const c = mk(2);
    let s = run(init(c), c, 2, [['nest', 'board'], ['nest', 'board'], ['nest', 'board'], ['board', 'path'], ['path', 'home'], ['nest', 'board']]);
    s = capturePawn(s, c, 2, 1, tick());
    s = capturePawn(s, c, 2, null, tick());
    s = doublesPenalty(s, c, 2, tick());
    const lines = s.entries.map((e) => entryLine(e, nameOf));
    expect(lines[0]).toBe('Alex brought a pawn out of the Nest');
    expect(lines[3]).toBe('Alex moved a pawn onto the Home path');
    expect(lines[4]).toBe('Alex got a pawn Home from the Home path');
    expect(lines[6]).toBe("Sam captured Alex's pawn");
    expect(lines[7]).toBe("Alex's pawn was captured");
    expect(lines[8]).toBe('Alex rolled doubles too often: a pawn went back to the Nest');
  });
  it('warnings', () => {
    const c = mk(2);
    expect(finishWarnings(init(c), c).length).toBe(1);
    expect(finishWarnings(movePawn(init(c), c, 1, 'nest', 'board', 1), c)[0]!.includes('Nobody has all 4')).toBe(true);
    expect(finishWarnings(allHome(init(c), c, 1), c)).toEqual([]);
  });
});
