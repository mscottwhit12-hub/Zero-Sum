import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  SETTINGS,
  bumpPawn,
  clock,
  def,
  duration,
  endGame,
  entryLine,
  finishWarnings,
  init,
  isFinished,
  markStarted,
  movePawn,
  ordinal,
  placements,
  ranking,
  recap,
  redoLast,
  redoNext,
  reopenGame,
  score,
  statsOf,
  turnOrder,
  undoLast,
  zonesOf,
  type SorryState,
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
/** Several moves in a row (each at its own time, so none looks like a double tap). */
const run = (s: SorryState, ctx: BoardContext, pid: number, steps: [Parameters<typeof movePawn>[3], Parameters<typeof movePawn>[4]][]): SorryState => {
  let cur = s;
  for (const [f, t] of steps) cur = movePawn(cur, ctx, pid, f, t, tick());
  return cur;
};
const allHome = (s: SorryState, ctx: BoardContext, pid: number, n = 4): SorryState => {
  let cur = s;
  for (let i = 0; i < n; i++) cur = run(cur, ctx, pid, [['start', 'board'], ['board', 'home']]);
  return cur;
};

describe('settings', () => {
  it('every setting has a default inside its own range', () => {
    for (const v of Object.values(SETTINGS)) expect(v.default >= v.min && v.default <= v.max).toBe(true);
  });
  it('classic is 4 pawns', () => {
    expect(defaults().pawns).toBe(4);
  });
  it('key and label', () => {
    expect(def.key).toBe('sorry');
    expect(def.label).toBe('Sorry!');
  });
});

describe('init', () => {
  it('everything starts in Start', () => {
    const c = mk(3);
    expect(zonesOf(init(c), c, 1)).toEqual({ start: 4, board: 0, safety: 0, home: 0 });
  });
  it('the pawns setting changes Start', () => {
    const c = mk(2, { pawns: 3 });
    expect(zonesOf(init(c), c, 1).start).toBe(3);
  });
  it('orders by seat, unseated last', () => {
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
  it('out of Start, into Safety, Home', () => {
    let s = init(c);
    s = movePawn(s, c, 1, 'start', 'board', tick());
    expect(zonesOf(s, c, 1)).toEqual({ start: 3, board: 1, safety: 0, home: 0 });
    s = movePawn(s, c, 1, 'board', 'safety', tick());
    expect(zonesOf(s, c, 1)).toEqual({ start: 3, board: 0, safety: 1, home: 0 });
    s = movePawn(s, c, 1, 'safety', 'home', tick());
    expect(zonesOf(s, c, 1)).toEqual({ start: 3, board: 0, safety: 0, home: 1 });
  });
  it('a pawn can go straight from the board to Home', () => {
    let s = run(init(c), c, 1, [['start', 'board'], ['board', 'home']]);
    expect(zonesOf(s, c, 1).home).toBe(1);
  });
  it('rejects a move with no pawn to take; returns the same object', () => {
    const s = init(c);
    expect(movePawn(s, c, 1, 'board', 'safety', 1)).toBe(s);
    expect(movePawn(s, c, 1, 'safety', 'home', 1)).toBe(s);
    expect(movePawn(s, c, 1, 'home', 'board', 1)).toBe(s);
  });
  it('rejects bad input', () => {
    const s = init(c);
    expect(movePawn(s, c, 99, 'start', 'board', 1)).toBe(s);
    expect(movePawn(s, c, 1, 'start', 'start', 1)).toBe(s);
    expect(movePawn(s, c, 1, 'nope' as never, 'board', 1)).toBe(s);
  });
  it('no more than all the pawns come out of Start', () => {
    let s = init(c);
    for (let i = 0; i < 4; i++) s = movePawn(s, c, 1, 'start', 'board', tick());
    expect(zonesOf(s, c, 1).start).toBe(0);
    expect(movePawn(s, c, 1, 'start', 'board', tick())).toBe(s);
  });
  it('a double tap does not move two pawns', () => {
    let s = movePawn(init(c), c, 1, 'start', 'board', 10000);
    expect(movePawn(s, c, 1, 'start', 'board', 10500)).toBe(s);
    s = movePawn(s, c, 1, 'start', 'board', 12000);
    expect(zonesOf(s, c, 1).board).toBe(2);
  });
  it('one player never changes another', () => {
    let s = movePawn(init(c), c, 1, 'start', 'board', 1);
    expect(zonesOf(s, c, 2)).toEqual({ start: 4, board: 0, safety: 0, home: 0 });
  });
  it('a correction can move a pawn backwards', () => {
    let s = run(init(c), c, 1, [['start', 'board'], ['board', 'safety']]);
    s = movePawn(s, c, 1, 'safety', 'board', tick());
    expect(zonesOf(s, c, 1)).toEqual({ start: 3, board: 1, safety: 0, home: 0 });
  });
});

describe('bumps', () => {
  const c = mk(3);
  it('sends a pawn from the board back to Start and logs who did it', () => {
    let s = movePawn(init(c), c, 2, 'start', 'board', 1);
    s = bumpPawn(s, c, 2, 1, tick());
    expect(zonesOf(s, c, 2)).toEqual({ start: 4, board: 0, safety: 0, home: 0 });
    expect(statsOf(s, 1)).toEqual({ bumpsMade: 1, bumpsTaken: 0, ownBumps: 0 });
    expect(statsOf(s, 2)).toEqual({ bumpsMade: 0, bumpsTaken: 1, ownBumps: 0 });
  });
  it('needs a pawn on the board (not Start, not Safety)', () => {
    const s = init(c);
    expect(bumpPawn(s, c, 2, 1, 1)).toBe(s);
    const safe = run(s, c, 2, [['start', 'board'], ['board', 'safety']]);
    expect(bumpPawn(safe, c, 2, 1, tick())).toBe(safe);
  });
  it('own slide and unknown bumper', () => {
    let s = run(init(c), c, 1, [['start', 'board'], ['start', 'board']]);
    s = bumpPawn(s, c, 1, 1, tick());
    expect(statsOf(s, 1)).toEqual({ bumpsMade: 0, bumpsTaken: 1, ownBumps: 1 });
    s = bumpPawn(s, c, 1, null, tick());
    expect(statsOf(s, 1).bumpsTaken).toBe(2);
    expect(zonesOf(s, c, 1).board).toBe(0);
  });
  it('rejects unknown players', () => {
    const s = movePawn(init(c), c, 2, 'start', 'board', 1);
    expect(bumpPawn(s, c, 99, 1, 5000)).toBe(s);
    expect(bumpPawn(s, c, 2, 99, 5000)).toBe(s);
  });
  it('a double tap does not bump twice', () => {
    let s = run(init(c), c, 2, [['start', 'board'], ['start', 'board']]);
    s = bumpPawn(s, c, 2, 1, 100000);
    expect(bumpPawn(s, c, 2, 1, 100400)).toBe(s);
    expect(zonesOf(s, c, 2).board).toBe(1);
  });
});

describe('undo and redo', () => {
  const c = mk(2);
  it('undo takes the counts back', () => {
    let s = run(init(c), c, 1, [['start', 'board'], ['board', 'safety']]);
    s = undoLast(s);
    expect(zonesOf(s, c, 1)).toEqual({ start: 3, board: 1, safety: 0, home: 0 });
    s = undoLast(s);
    expect(zonesOf(s, c, 1).start).toBe(4);
  });
  it('undoing a bump puts the pawn back on the board', () => {
    let s = movePawn(init(c), c, 2, 'start', 'board', 1);
    s = bumpPawn(s, c, 2, 1, tick());
    s = undoLast(s);
    expect(zonesOf(s, c, 2).board).toBe(1);
  });
  it('redo puts it back; a new entry clears redo', () => {
    let s = movePawn(init(c), c, 1, 'start', 'board', 1);
    s = undoLast(s);
    expect(redoNext(s)?.to).toBe('board');
    expect(zonesOf(redoLast(s), c, 1).board).toBe(1);
    const other = movePawn(s, c, 2, 'start', 'board', tick());
    expect(redoNext(other)).toBeNull();
  });
  it('nothing to undo returns the same object', () => {
    const s = init(c);
    expect(undoLast(s)).toBe(s);
    expect(redoLast(s)).toBe(s);
  });
  it('an undo of an early move cannot leave a later one counted wrongly', () => {
    // replaying skips a move with nothing to take
    let s = run(init(c), c, 1, [['start', 'board'], ['board', 'safety']]);
    const broken = { ...s, entries: s.entries.slice(1) };
    expect(zonesOf(broken, c, 1)).toEqual({ start: 4, board: 0, safety: 0, home: 0 });
  });
});

describe('crown (score)', () => {
  it('is live: home first, then Safety', () => {
    const c = mk(3);
    let s = init(c);
    s = run(s, c, 1, [['start', 'board'], ['board', 'home']]);
    s = run(s, c, 2, [['start', 'board'], ['board', 'safety']]);
    expect(score(s, c)).toEqual({ 1: 5, 2: 1, 3: 0 });
  });
  it('one pawn home beats any number in Safety', () => {
    const c = mk(2);
    let s = init(c);
    for (let i = 0; i < 4; i++) s = run(s, c, 2, [['start', 'board'], ['board', 'safety']]);
    s = run(s, c, 1, [['start', 'board'], ['board', 'home']]);
    expect(score(s, c)[1]! > score(s, c)[2]!).toBe(true);
  });
  it('does not move when pawns only move around the board or get bumped', () => {
    const c = mk(2);
    let s = run(init(c), c, 1, [['start', 'board']]);
    const before = score(s, c);
    s = bumpPawn(s, c, 1, 2, tick());
    expect(score(s, c)).toEqual(before);
  });
  it('follows the pawns setting', () => {
    const c = mk(2, { pawns: 3 });
    const s = run(init(c), c, 1, [['start', 'board'], ['board', 'home']]);
    expect(score(s, c)[1]).toBe(4);
  });
  it('every player present', () => {
    const c = mk(3);
    expect(Object.keys(score(init(c), c))).toEqual(['1', '2', '3']);
  });
});

describe('finish and placements', () => {
  it('the first with every pawn home wins', () => {
    const c = mk(3);
    let s = allHome(init(c), c, 2);
    expect(isFinished(zonesOf(s, c, 2), c)).toBe(true);
    expect(placements(s, c)[0]).toEqual([2]);
    expect(ranking(s, c)[0]!.finished).toBe(true);
  });
  it('the rest rank by home, then Safety, then out of Start', () => {
    const c = mk(4);
    let s = init(c);
    s = allHome(s, c, 1);
    s = run(s, c, 2, [['start', 'board'], ['board', 'home']]); // 1 home
    s = run(s, c, 3, [['start', 'board'], ['board', 'home']]); // 1 home
    s = run(s, c, 3, [['start', 'board'], ['board', 'safety']]); // + 1 safety
    s = run(s, c, 4, [['start', 'board'], ['start', 'board'], ['start', 'board']]); // 3 out, none home
    expect(placements(s, c)).toEqual([[1], [3], [2], [4]]);
  });
  it('equal on home and Safety: more out of Start ranks higher', () => {
    const c = mk(3);
    let s = init(c);
    s = run(s, c, 1, [['start', 'board'], ['start', 'board']]);
    s = run(s, c, 2, [['start', 'board']]);
    expect(placements(s, c)).toEqual([[1], [2], [3]]);
  });
  it('equal on all three share the place', () => {
    const c = mk(4);
    let s = run(init(c), c, 1, [['start', 'board'], ['board', 'home']]);
    s = run(s, c, 2, [['start', 'board'], ['board', 'home']]);
    expect(placements(s, c)).toEqual([[1, 2], [3, 4]]);
    const rows = ranking(s, c);
    expect(rows.map((r) => r.place)).toEqual([1, 1, 3, 3]);
  });
  it('an empty game is one big tie', () => {
    const c = mk(3);
    expect(placements(init(c), c)).toEqual([[1, 2, 3]]);
  });
  it('every player exactly once', () => {
    const c = mk(4);
    const s = allHome(init(c), c, 3);
    expect(placements(s, c).flat().sort()).toEqual([1, 2, 3, 4]);
  });
  it('3 pawns: finished at 3', () => {
    const c = mk(2, { pawns: 3 });
    const s = allHome(init(c), c, 1, 3);
    expect(isFinished(zonesOf(s, c, 1), c)).toBe(true);
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
    expect(movePawn(s, c, 1, 'start', 'board', 1)).toBe(s);
    expect(bumpPawn(s, c, 1, 2, 1)).toBe(s);
    expect(undoLast(s)).toBe(s);
  });
});

describe('recap', () => {
  it('one message per player', () => {
    const c = mk(2);
    let s = allHome(init(c), c, 1);
    s = movePawn(s, c, 2, 'start', 'board', tick());
    s = bumpPawn(s, c, 2, 1, tick());
    const r = recap(s, c);
    expect(r).toHaveLength(2);
    expect(r[0]!.text.includes('1st')).toBe(true);
    expect(r[0]!.text.includes('You won!')).toBe(true);
    expect(r[0]!.text.includes('You sent 1 pawn back')).toBe(true);
    expect(r[1]!.text.includes('2nd')).toBe(true);
    expect(r[1]!.text.includes('Winner: P1')).toBe(true);
    expect(r[1]!.text.includes('You were sent back 1 time.')).toBe(true);
  });
  it('nobody finished: says so', () => {
    const c = mk(2);
    const s = run(init(c), c, 1, [['start', 'board'], ['board', 'home']]);
    expect(recap(s, c)[0]!.text.includes('Nobody got every pawn home')).toBe(true);
  });
  it('shared win', () => {
    const c = mk(2);
    const s = allHome(allHome(init(c), c, 1), c, 2);
    expect(recap(s, c)[0]!.text.includes('share the win')).toBe(true);
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
  it('board start fallback; stops when ended', () => {
    const c = mk(2);
    let s = markStarted(init(c), 5000);
    expect(markStarted(s, 9000)).toBe(s);
    s = endGame(s, 65000);
    const k = clock(s, c, 999999)!;
    expect(k.finished).toBe(true);
    expect(k.elapsedMs).toBe(60000);
  });
  it('null without a start', () => {
    expect(clock(init(mk(2)), mk(2), 1)).toBeNull();
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
    let s = run(init(c), c, 2, [['start', 'board'], ['start', 'board'], ['board', 'safety'], ['safety', 'home'], ['start', 'board']]);
    s = bumpPawn(s, c, 2, 1, tick());
    s = bumpPawn(s, c, 2, null, tick());
    const lines = s.entries.map((e) => entryLine(e, nameOf));
    expect(lines[0]).toBe('Alex brought a pawn out of Start');
    expect(lines[2]).toBe('Alex moved a pawn into the Safety zone');
    expect(lines[3]).toBe('Alex got a pawn Home from the Safety zone');
    expect(lines[5]).toBe('Sam sent Alex\'s pawn back to Start');
    expect(lines[6]).toBe('Alex\'s pawn was sent back to Start');
  });
  it('warnings', () => {
    const c = mk(2);
    expect(finishWarnings(init(c), c).length).toBe(1);
    const mid = movePawn(init(c), c, 1, 'start', 'board', 1);
    expect(finishWarnings(mid, c)[0]!.includes('Nobody has all 4')).toBe(true);
    expect(finishWarnings(allHome(init(c), c, 1), c)).toEqual([]);
  });
});
