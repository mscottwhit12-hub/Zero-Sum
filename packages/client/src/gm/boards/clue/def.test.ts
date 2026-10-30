import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  ROOMS,
  SETTINGS,
  SUSPECTS,
  WEAPONS,
  accText,
  accuseBlock,
  addNote,
  assignSuspect,
  cleanAcc,
  correctAccusation,
  def,
  describeEntry,
  firstPlayer,
  init,
  ordinal,
  placements,
  pl,
  recap,
  recapText,
  recordReroll,
  score,
  setLeader,
  status,
  suspectBlock,
  suspectName,
  suspectShort,
  undoBlock,
  undoLast,
  wrongAccusation,
  wrongLimit,
  NOTE_MAX,
  type ClueState,
} from './def';

const player = (id: number, seat: number | null = id): BoardPlayer => ({ id, name: `P${id}`, color: null, avatarPath: null, seat });
const defaults = () => Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));
const mk = (n: number, settings: Record<string, number> = {}): BoardContext => ({
  players: Array.from({ length: n }, (_, i) => player(i + 1)),
  table: { name: 'T1', seats: 6, w: 0.3, h: 0.15 },
  rerollsAllowed: true,
  rerollsLeft: {},
  useReroll: async () => undefined,
  settings: { ...defaults(), ...settings },
});
const fresh = (n = 4, settings: Record<string, number> = {}) => {
  const ctx = mk(n, settings);
  return { ctx, s: init(ctx) };
};

describe('data and settings', () => {
  it('has the US edition: 6 suspects, 6 weapons, 9 rooms, unique keys', () => {
    expect(SUSPECTS.map((c) => c.name)).toEqual(['Miss Scarlett', 'Colonel Mustard', 'Mrs. White', 'Mr. Green', 'Mrs. Peacock', 'Professor Plum']);
    expect(WEAPONS.map((c) => c.name)).toEqual(['Candlestick', 'Dagger', 'Lead Pipe', 'Revolver', 'Rope', 'Wrench']);
    expect(ROOMS).toHaveLength(9);
    for (const list of [SUSPECTS, WEAPONS, ROOMS]) expect(new Set(list.map((c) => c.key)).size).toBe(list.length);
  });
  it('every setting has a default inside its own range, and the classic wrong-accusation default is 1', () => {
    for (const [k, v] of Object.entries(SETTINGS)) {
      expect(v.default, k).toBeGreaterThanOrEqual(v.min);
      expect(v.default, k).toBeLessThanOrEqual(v.max);
      expect(v.label.length, k).toBeGreaterThan(0);
    }
    expect(SETTINGS.wrongLimit!.default).toBe(1);
  });
  it('def exposes the settings and has no planned-length setting', () => {
    expect(def.key).toBe('clue');
    expect(def.settings).toBe(SETTINGS);
    expect(Object.keys(SETTINGS).join(' ')).not.toMatch(/length|hours|duration/i);
  });
  it('wrongLimit falls back to the default and never goes below 1', () => {
    expect(wrongLimit(undefined)).toBe(1);
    expect(wrongLimit({ wrongLimit: 3 })).toBe(3);
    expect(wrongLimit({ wrongLimit: 0 })).toBe(1);
    expect(wrongLimit({ wrongLimit: Number.NaN })).toBe(1);
  });
  it('suspect names', () => {
    expect(suspectName('plum')).toBe('Professor Plum');
    expect(suspectName(null)).toBe('No suspect');
    expect(suspectShort('mustard')).toBe('Mustard');
    expect(suspectShort(null)).toBe('');
  });
});

describe('init', () => {
  it('starts everyone in, no winner, no crown, empty history, and is plain JSON', () => {
    const { ctx, s } = fresh(4);
    expect(Object.keys(s.players)).toHaveLength(4);
    expect(s.winnerId).toBeNull();
    expect(s.leader).toBeNull();
    expect(s.log).toEqual([]);
    expect(pl(s, 1)).toEqual({ suspect: null, wrong: 0, out: false, outAt: null, order: null, rerollsUsed: 0 });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(status(s, ctx)).toEqual({ alive: [1, 2, 3, 4], winnerId: null, nobodyWins: false, over: false });
  });
  it('never stores anything about the solution', () => {
    const { s } = fresh(4);
    expect(Object.keys(s).sort()).toEqual(['leader', 'log', 'outCount', 'players', 'seq', 'v', 'winnerId']);
  });
  it('unknown players read as blank', () => {
    const { s } = fresh(2);
    expect(pl(s, 99).wrong).toBe(0);
  });
});

describe('suspects and first player', () => {
  it('assigns a suspect, logs it, and repeating changes nothing', () => {
    const { ctx, s } = fresh();
    const a = assignSuspect(s, ctx, 1, 'mustard', 10);
    expect(pl(a, 1).suspect).toBe('mustard');
    expect(a.log).toHaveLength(1);
    expect(assignSuspect(a, ctx, 1, 'mustard', 11)).toBe(a);
  });
  it('a suspect can only be held by one player', () => {
    const { ctx, s } = fresh();
    const a = assignSuspect(s, ctx, 1, 'plum', 1);
    expect(suspectBlock(a, ctx, 2, 'plum')).toMatch(/Professor Plum is already P1/);
    expect(assignSuspect(a, ctx, 2, 'plum', 2)).toBe(a);
    expect(suspectBlock(a, ctx, 1, 'plum')).toBeNull();
  });
  it('clears a suspect, rejects unknown suspects and unknown players', () => {
    const { ctx, s } = fresh();
    const a = assignSuspect(s, ctx, 1, 'white', 1);
    const b = assignSuspect(a, ctx, 1, null, 2);
    expect(pl(b, 1).suspect).toBeNull();
    expect(assignSuspect(s, ctx, 1, 'nobody', 1)).toBe(s);
    expect(assignSuspect(s, ctx, 99, 'white', 1)).toBe(s);
    expect(assignSuspect(s, ctx, 1, null, 1)).toBe(s);
  });
  it('Miss Scarlett\u2019s player goes first', () => {
    const { ctx, s } = fresh(4);
    let a = assignSuspect(s, ctx, 3, 'scarlett', 1);
    a = assignSuspect(a, ctx, 1, 'mustard', 2);
    expect(firstPlayer(a, ctx)).toEqual({ id: 3, suspect: 'scarlett' });
  });
  it('without Scarlett, the earliest token in the classic order goes first', () => {
    const { ctx, s } = fresh(4);
    let a = assignSuspect(s, ctx, 1, 'plum', 1);
    a = assignSuspect(a, ctx, 2, 'green', 2);
    expect(firstPlayer(a, ctx)).toEqual({ id: 2, suspect: 'green' });
  });
  it('with no tokens, the lowest seat goes first (unseated players last)', () => {
    const ctx = mk(3);
    ctx.players = [player(1, null), player(2, 4), player(3, 2)];
    expect(firstPlayer(init(ctx), ctx)).toEqual({ id: 3, suspect: null });
  });
  it('nobody to go first in an empty game', () => {
    const ctx = mk(0);
    expect(firstPlayer(init(ctx), ctx)).toBeNull();
  });
});

describe('accusations', () => {
  it('a wrong accusation puts the player out at the default limit of 1, and logs what was said', () => {
    const { ctx, s } = fresh();
    const a = wrongAccusation(s, ctx, 2, { suspect: 'mustard', weapon: 'rope', room: 'library' }, 100);
    expect(pl(a, 2)).toMatchObject({ wrong: 1, out: true, outAt: 100, order: 1 });
    expect(a.log[0]).toMatchObject({ kind: 'wrong', playerId: 2, out: true, acc: { suspect: 'mustard', weapon: 'rope', room: 'library' } });
    expect(describeEntry(a.log[0]!, (id) => `P${id}`)).toBe('P2 made a wrong accusation (Colonel Mustard, Rope, Library) and is out (still shows cards)');
    expect(status(a, ctx).alive).toEqual([1, 3, 4]);
  });
  it('the wrong-accusation limit is a setting: at 2, the first wrong keeps the player in', () => {
    const { ctx, s } = fresh(4, { wrongLimit: 2 });
    const a = wrongAccusation(s, ctx, 1, undefined, 1);
    expect(pl(a, 1)).toMatchObject({ wrong: 1, out: false, order: null });
    expect(a.log[0]!.out).toBe(false);
    expect(describeEntry(a.log[0]!, (id) => `P${id}`)).toBe('P1 made a wrong accusation');
    const b = wrongAccusation(a, ctx, 1, undefined, 2);
    expect(pl(b, 1)).toMatchObject({ wrong: 2, out: true, order: 1 });
  });
  it('players go out in order, numbered 1, 2, 3, \u2026', () => {
    const { ctx, s } = fresh();
    let a = wrongAccusation(s, ctx, 3, undefined, 1);
    a = wrongAccusation(a, ctx, 1, undefined, 2);
    expect(pl(a, 3).order).toBe(1);
    expect(pl(a, 1).order).toBe(2);
    expect(a.outCount).toBe(2);
  });
  it('a player who is out cannot accuse again; unknown players cannot accuse', () => {
    const { ctx, s } = fresh();
    const a = wrongAccusation(s, ctx, 1, undefined, 1);
    expect(accuseBlock(a, ctx, 1)).toMatch(/already out/);
    expect(wrongAccusation(a, ctx, 1, undefined, 2)).toBe(a);
    expect(correctAccusation(a, ctx, 1, undefined, 2)).toBe(a);
    expect(accuseBlock(a, ctx, 99)).toMatch(/isn.t in this game/);
    expect(wrongAccusation(a, ctx, 99, undefined, 2)).toBe(a);
  });
  it('a correct accusation ends the game with that winner, and blocks further accusations', () => {
    const { ctx, s } = fresh();
    const a = correctAccusation(s, ctx, 4, { suspect: 'plum', weapon: 'wrench', room: 'study' }, 50);
    expect(a.winnerId).toBe(4);
    expect(status(a, ctx)).toMatchObject({ winnerId: 4, over: true, nobodyWins: false });
    expect(describeEntry(a.log[0]!, (id) => `P${id}`)).toBe('P4 solved the case: Professor Plum, Wrench, Study');
    expect(accuseBlock(a, ctx, 1)).toMatch(/already solved/);
    expect(wrongAccusation(a, ctx, 1, undefined, 60)).toBe(a);
    expect(correctAccusation(a, ctx, 1, undefined, 60)).toBe(a);
  });
  it('if everyone accuses wrong, nobody wins and the game is over', () => {
    const { ctx, s } = fresh(3);
    let a = s;
    for (const id of [2, 3, 1]) a = wrongAccusation(a, ctx, id, undefined, id);
    expect(status(a, ctx)).toMatchObject({ alive: [], winnerId: null, nobodyWins: true, over: true });
  });
  it('the last player in is not made the winner automatically', () => {
    const { ctx, s } = fresh(3);
    let a = wrongAccusation(s, ctx, 1, undefined, 1);
    a = wrongAccusation(a, ctx, 2, undefined, 2);
    expect(status(a, ctx)).toMatchObject({ alive: [3], winnerId: null, over: false });
  });
  it('cleanAcc keeps only valid keys, and nothing when empty', () => {
    expect(cleanAcc({ suspect: 'bogus', weapon: 'rope' })).toEqual({ weapon: 'rope' });
    expect(cleanAcc({ suspect: 'bogus' })).toBeUndefined();
    expect(cleanAcc(undefined)).toBeUndefined();
    expect(accText({ room: 'hall' })).toBe('Hall');
    expect(accText(undefined)).toBe('');
  });
  it('invalid accusation details are dropped from the history', () => {
    const { ctx, s } = fresh();
    const a = wrongAccusation(s, ctx, 1, { suspect: 'bogus' }, 1);
    expect(a.log[0]!.acc).toBeUndefined();
  });
});

describe('undo', () => {
  it('undoes a wrong accusation that put the player out: back in, order cleared', () => {
    const { ctx, s } = fresh();
    const a = wrongAccusation(s, ctx, 2, undefined, 1);
    const b = undoLast(a, ctx, 2, 2);
    expect(pl(b, 2)).toMatchObject({ wrong: 0, out: false, outAt: null, order: null });
    expect(b.log[b.log.length - 1]).toMatchObject({ kind: 'undo', undone: 'wrong' });
    expect(describeEntry(b.log[b.log.length - 1]!, (id) => `P${id}`)).toBe('P2: last wrong accusation undone');
  });
  it('out numbers stay unique after an undo', () => {
    const { ctx, s } = fresh();
    let a = wrongAccusation(s, ctx, 1, undefined, 1);
    a = wrongAccusation(a, ctx, 2, undefined, 2);
    a = undoLast(a, ctx, 1, 3);
    a = wrongAccusation(a, ctx, 3, undefined, 4);
    a = wrongAccusation(a, ctx, 1, undefined, 5);
    const orders = [1, 2, 3].map((id) => pl(a, id).order);
    expect(new Set(orders).size).toBe(3);
    expect(pl(a, 1).order).toBe(4);
  });
  it('undoes one of several wrong accusations without changing in/out status when still below the limit', () => {
    const { ctx, s } = fresh(4, { wrongLimit: 3 });
    let a = wrongAccusation(s, ctx, 1, undefined, 1);
    a = wrongAccusation(a, ctx, 1, undefined, 2);
    const b = undoLast(a, ctx, 1, 3);
    expect(pl(b, 1)).toMatchObject({ wrong: 1, out: false });
  });
  it('undoes the solved case', () => {
    const { ctx, s } = fresh();
    const a = correctAccusation(s, ctx, 1, undefined, 1);
    const b = undoLast(a, ctx, 1, 2);
    expect(b.winnerId).toBeNull();
    expect(describeEntry(b.log[b.log.length - 1]!, (id) => `P${id}`)).toBe('P1: undid the solved case');
    expect(status(b, ctx).over).toBe(false);
  });
  it('does nothing when there is nothing to undo', () => {
    const { ctx, s } = fresh();
    expect(undoBlock(s, ctx, 1)).toMatch(/Nothing to undo/);
    expect(undoLast(s, ctx, 1, 1)).toBe(s);
    expect(undoLast(s, ctx, 99, 1)).toBe(s);
  });
});

describe('fixes after the bug test', () => {
  it('a winner who has left the game does not block everyone from accusing', () => {
    const c3 = mk(3);
    const s = correctAccusation(init(c3), c3, 3, undefined, 1);
    const c2 = mk(2);
    expect(status(s, c2).over).toBe(false);
    expect(accuseBlock(s, c2, 1)).toBeNull();
  });
  it('undoing a solved case removes what was said from that history entry', () => {
    const { ctx, s } = fresh();
    const a = correctAccusation(s, ctx, 1, { suspect: 'plum', weapon: 'rope', room: 'hall' }, 1);
    const b = undoLast(a, ctx, 1, 2);
    const e = b.log.find((x) => x.kind === 'correct')!;
    expect(e.acc).toBeUndefined();
    expect(JSON.stringify(b)).not.toMatch(/plum|rope|hall/);
    expect(describeEntry(e, (id) => `P${id}`)).toBe('P1 solved the case');
  });
});

describe('crown (manual)', () => {
  it('scores 1 for the crowned player, 0 for everyone else, in plain numbers for every player', () => {
    const { ctx, s } = fresh();
    expect(score(s, ctx)).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
    const a = setLeader(s, ctx, 3, 5);
    expect(score(a, ctx)).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0 });
    expect(a.log[0]).toMatchObject({ kind: 'crown', playerId: 3 });
    expect(describeEntry(a.log[0]!, (id) => `P${id}`)).toBe('P3 is closest to solving (crown)');
  });
  it('crowning the same player again, or null, clears it; clearing nothing changes nothing', () => {
    const { ctx, s } = fresh();
    const a = setLeader(s, ctx, 3, 1);
    const b = setLeader(a, ctx, 3, 2);
    expect(b.leader).toBeNull();
    expect(describeEntry(b.log[b.log.length - 1]!, (id) => `P${id}`)).toBe('Crown cleared');
    expect(setLeader(a, ctx, null, 3).leader).toBeNull();
    expect(setLeader(s, ctx, null, 3)).toBe(s);
  });
  it('moves the crown from one player to another', () => {
    const { ctx, s } = fresh();
    const a = setLeader(setLeader(s, ctx, 1, 1), ctx, 2, 2);
    expect(a.leader).toBe(2);
    expect(score(a, ctx)[1]).toBe(0);
  });
  it('players who are out cannot be crowned, and lose the crown when they go out', () => {
    const { ctx, s } = fresh();
    const a = setLeader(s, ctx, 1, 1);
    const b = wrongAccusation(a, ctx, 1, undefined, 2);
    expect(b.leader).toBeNull();
    expect(score(b, ctx)[1]).toBe(0);
    expect(setLeader(b, ctx, 1, 3)).toBe(b);
    expect(setLeader(s, ctx, 99, 3)).toBe(s);
  });
  it('whoever solved the case scores highest', () => {
    const { ctx, s } = fresh();
    let a = setLeader(s, ctx, 1, 1);
    a = correctAccusation(a, ctx, 2, undefined, 2);
    expect(score(a, ctx)).toEqual({ 1: 1, 2: 2, 3: 0, 4: 0 });
  });
});

describe('placements', () => {
  it('nothing has happened: everyone ties for 1st', () => {
    const { ctx, s } = fresh(4);
    expect(placements(s, ctx)).toEqual([[1, 2, 3, 4]]);
  });
  it('winner first, then everyone still in (tied), then the players out with the latest out highest', () => {
    const { ctx, s } = fresh(6);
    let a = s;
    a = wrongAccusation(a, ctx, 5, undefined, 1);
    a = wrongAccusation(a, ctx, 2, undefined, 2);
    a = wrongAccusation(a, ctx, 6, undefined, 3);
    a = correctAccusation(a, ctx, 4, undefined, 4);
    expect(placements(a, ctx)).toEqual([[4], [1, 3], [6], [2], [5]]);
  });
  it('time called with nobody solved: those still in tie for 1st, the out are below, latest out first', () => {
    const { ctx, s } = fresh(4);
    let a = wrongAccusation(s, ctx, 1, undefined, 1);
    a = wrongAccusation(a, ctx, 3, undefined, 2);
    expect(placements(a, ctx)).toEqual([[2, 4], [3], [1]]);
  });
  it('everyone accused wrong: the last player out is 1st', () => {
    const { ctx, s } = fresh(3);
    let a = wrongAccusation(s, ctx, 2, undefined, 1);
    a = wrongAccusation(a, ctx, 3, undefined, 2);
    a = wrongAccusation(a, ctx, 1, undefined, 3);
    expect(placements(a, ctx)).toEqual([[1], [3], [2]]);
  });
  it('covers every player exactly once in every state', () => {
    const { ctx, s } = fresh(5);
    const a = correctAccusation(wrongAccusation(s, ctx, 3, undefined, 1), ctx, 2, undefined, 2);
    const flat = placements(a, ctx).flat().sort();
    expect(flat).toEqual([1, 2, 3, 4, 5]);
  });
  it('is the same through def.placements, and ignores a winner who has left the game', () => {
    const { ctx, s } = fresh(3);
    const a: ClueState = { ...s, winnerId: 99 };
    expect(def.placements!(a, ctx)).toEqual([[1, 2, 3]]);
    expect(status(a, ctx).winnerId).toBeNull();
  });
  it('shows a player undone from out back in the tie', () => {
    const { ctx, s } = fresh(3);
    const a = undoLast(wrongAccusation(s, ctx, 2, undefined, 1), ctx, 2, 2);
    expect(placements(a, ctx)).toEqual([[1, 2, 3]]);
  });
});

describe('re-rolls, notes, history', () => {
  it('records a re-roll', () => {
    const { ctx, s } = fresh();
    const a = recordReroll(s, ctx, 2, 9);
    expect(pl(a, 2).rerollsUsed).toBe(1);
    expect(describeEntry(a.log[0]!, (id) => `P${id}`)).toBe('P2 used a re-roll');
    expect(recordReroll(s, ctx, 99, 9)).toBe(s);
  });
  it('adds a note, trims it, cuts it to NOTE_MAX, ignores empty and unknown players', () => {
    const { ctx, s } = fresh();
    expect(addNote(s, ctx, '   ', null, 1)).toBe(s);
    const a = addNote(s, ctx, '  Mustard looks nervous  ', 2, 1);
    expect(describeEntry(a.log[0]!, (id) => `P${id}`)).toBe('P2: Mustard looks nervous');
    const b = addNote(s, ctx, 'x'.repeat(NOTE_MAX + 50), 99, 1);
    expect(b.log[0]!.text).toHaveLength(NOTE_MAX);
    expect(b.log[0]!.playerId).toBeNull();
    expect(describeEntry(addNote(s, ctx, 'whole game', null, 1).log[0]!, () => 'x')).toBe('whole game');
  });
  it('describes suspect assignments', () => {
    const { ctx, s } = fresh();
    const a = assignSuspect(s, ctx, 1, 'peacock', 1);
    const b = assignSuspect(a, ctx, 1, null, 2);
    expect(describeEntry(a.log[0]!, (id) => `P${id}`)).toBe('P1 is Mrs. Peacock');
    expect(describeEntry(b.log[1]!, (id) => `P${id}`)).toBe('P1 no longer has a suspect');
  });
  it('log ids are unique and increasing, and the log is capped by the logMax setting', () => {
    const { ctx, s } = fresh(4, { logMax: 50 });
    let a = s;
    for (let i = 0; i < 80; i++) a = addNote(a, ctx, `n${i}`, null, i);
    expect(a.log).toHaveLength(50);
    expect(a.log[0]!.text).toBe('n30');
    expect(a.seq).toBe(80);
    const ids = a.log.map((e) => e.id);
    expect(new Set(ids).size).toBe(50);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
  });
  it('a player added after the game started is handled everywhere', () => {
    const ctx = mk(3);
    const s = init(mk(2));
    expect(pl(s, 3).wrong).toBe(0);
    const a = wrongAccusation(s, ctx, 3, undefined, 1);
    expect(pl(a, 3)).toMatchObject({ wrong: 1, out: true });
    expect(score(s, ctx)).toEqual({ 1: 0, 2: 0, 3: 0 });
    expect(placements(s, ctx)).toEqual([[1, 2, 3]]);
  });
});

describe('same-state safety', () => {
  it('applying the same operation to the same state twice gives equal states', () => {
    const { ctx, s } = fresh();
    expect(wrongAccusation(s, ctx, 1, undefined, 1)).toEqual(wrongAccusation(s, ctx, 1, undefined, 1));
    expect(setLeader(s, ctx, 1, 1)).toEqual(setLeader(s, ctx, 1, 1));
  });
  it('operations never change the state they are given', () => {
    const { ctx, s } = fresh();
    const before = JSON.stringify(s);
    wrongAccusation(s, ctx, 1, undefined, 1);
    correctAccusation(s, ctx, 2, undefined, 1);
    assignSuspect(s, ctx, 1, 'plum', 1);
    setLeader(s, ctx, 1, 1);
    addNote(s, ctx, 'hi', null, 1);
    recordReroll(s, ctx, 1, 1);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('works with no table and unseated players', () => {
    const ctx: BoardContext = { ...mk(3), table: null, players: [player(1, null), player(2, null), player(3, null)] };
    const a = wrongAccusation(init(ctx), ctx, 2, undefined, 1);
    expect(placements(a, ctx)).toEqual([[1, 3], [2]]);
    expect(firstPlayer(a, ctx)).toEqual({ id: 1, suspect: null });
  });
});

describe('recap', () => {
  const names = (id: number) => `P${id}`;
  it('has one row per player, best first, with places and ties', () => {
    const { ctx, s } = fresh(4);
    let a = wrongAccusation(s, ctx, 2, undefined, 1);
    a = correctAccusation(a, ctx, 3, undefined, 2);
    const rows = recap(a, ctx);
    expect(rows.map((r) => [r.playerId, r.place, r.tied])).toEqual([
      [3, 1, false],
      [1, 2, true],
      [4, 2, true],
      [2, 4, false],
    ]);
    expect(rows[0]).toMatchObject({ solved: true, out: false });
    expect(rows[3]).toMatchObject({ solved: false, out: true, wrong: 1 });
    expect(names(1)).toBe('P1');
  });
  it('sends one private message per player', () => {
    const { ctx, s } = fresh(3);
    const a = correctAccusation(s, ctx, 1, undefined, 1);
    const msgs = def.recap!(a, ctx);
    expect(msgs.map((m) => m.playerId).sort()).toEqual([1, 2, 3]);
    expect(new Set(msgs.map((m) => m.text)).size).toBe(3);
  });
  it('tells the winner what they solved, and others who solved it', () => {
    const { ctx, s } = fresh(3);
    let a = assignSuspect(s, ctx, 2, 'green', 1);
    a = wrongAccusation(a, ctx, 3, undefined, 2);
    a = correctAccusation(a, ctx, 1, { suspect: 'plum', weapon: 'rope', room: 'hall' }, 3);
    const rows = recap(a, ctx);
    const text = (id: number) => recapText(rows.find((r) => r.playerId === id)!, a, ctx);
    expect(text(1)).toContain('1st place');
    expect(text(1)).toContain('You solved the case: Professor Plum, Rope, Hall.');
    expect(text(2)).toContain('2nd place');
    expect(text(2)).toContain('You were Mr. Green.');
    expect(text(2)).toContain('P1 solved the case: Professor Plum, Rope, Hall.');
    expect(text(2)).toContain('You were still in when the game ended.');
    expect(text(3)).toContain('3rd place');
    expect(text(3)).toContain('You went out after 1 wrong accusation.');
  });
  it('handles nobody solving it, and everyone accusing wrong', () => {
    const { ctx, s } = fresh(3);
    const t = recapText(recap(s, ctx)[0]!, s, ctx);
    expect(t).toContain('Nobody solved the case.');
    let a = s;
    for (const id of [1, 2, 3]) a = wrongAccusation(a, ctx, id, undefined, id);
    const r = recap(a, ctx);
    expect(r[0]!.playerId).toBe(3);
    expect(recapText(r[0]!, a, ctx)).toContain('Everyone accused wrong, so nobody solved the case.');
    expect(recapText(r[0]!, a, ctx)).toContain('1st place');
  });
  it('mentions re-rolls only when used', () => {
    const { ctx, s } = fresh(3);
    const a = recordReroll(recordReroll(s, ctx, 1, 1), ctx, 1, 2);
    const rows = recap(a, ctx);
    expect(recapText(rows.find((r) => r.playerId === 1)!, a, ctx)).toContain('Re-rolls used: 2.');
    expect(recapText(rows.find((r) => r.playerId === 2)!, a, ctx)).not.toContain('Re-rolls');
  });
  it('never mentions the solution unless a player said it in an accusation', () => {
    const { ctx, s } = fresh(3);
    const a = correctAccusation(s, ctx, 1, undefined, 1);
    for (const m of def.recap!(a, ctx)) expect(m.text).toContain('solved the case.');
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
  });
});
