import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  CONTINENTS,
  NOTE_MAX,
  SETTINGS,
  addNote,
  def,
  describeEntry,
  eliminate,
  init,
  ordinal,
  placements,
  pl,
  recap,
  recapText,
  recordReroll,
  reinforcements,
  restore,
  score,
  setArmies,
  setContinent,
  setTerritories,
  status,
  type RiskState,
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

describe('settings', () => {
  it('has the official defaults and sane ranges', () => {
    expect(SETTINGS.territoryTotal!.default).toBe(42);
    expect(SETTINGS.reinforceDivisor!.default).toBe(3);
    expect(SETTINGS.reinforceMin!.default).toBe(3);
    const bonus = Object.fromEntries(CONTINENTS.map((c) => [c.key, SETTINGS[c.setting]!.default]));
    expect(bonus).toEqual({ northAmerica: 5, southAmerica: 2, europe: 5, africa: 3, asia: 7, australia: 2 });
    for (const s of Object.values(SETTINGS)) {
      expect(s.min).toBeLessThanOrEqual(s.default);
      expect(s.default).toBeLessThanOrEqual(s.max);
    }
  });
  it('matches the key and label the pack points at', () => {
    expect(def.key).toBe('risk');
    expect(def.label).toBe('Risk');
  });
});

describe('init', () => {
  it('deals the map evenly (extras to the first seats) and gives starting armies', () => {
    const ctx = mk(4);
    const s = init(ctx);
    expect(Object.values(s.players).map((p) => p.territories)).toEqual([11, 11, 10, 10]);
    expect(Object.values(s.players).every((p) => p.armies === 30)).toBe(true);
    expect(Object.values(s.players).reduce((a, p) => a + p.territories, 0)).toBe(42);
  });
  it('uses the 5 and 6 player armies', () => {
    expect(pl(init(mk(5)), 1).armies).toBe(25);
    expect(pl(init(mk(6)), 1).armies).toBe(20);
  });
  it('follows seat order for the extra territories, and copes with unseated players', () => {
    const ctx = mk(4);
    ctx.players = [player(1, 4), player(2, 3), player(3, null), player(4, 1)];
    const s = init(ctx);
    expect(pl(s, 4).territories).toBe(11); // seat 1
    expect(pl(s, 3).territories).toBe(10); // unseated goes last
  });
  it('reads every number from settings', () => {
    const s = init(mk(4, { territoryTotal: 40, startArmies4: 12 }));
    expect(pl(s, 1).territories).toBe(10);
    expect(pl(s, 1).armies).toBe(12);
  });
  it('is plain JSON', () => {
    const s = init(mk(4));
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  it('handles an empty game', () => {
    expect(init({ ...mk(0) }).players).toEqual({});
  });
});

describe('reinforcements and score', () => {
  it('is territories / 3 (rounded down), at least 3', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = setTerritories(s, ctx, 1, 2, 0);
    expect(reinforcements(pl(s, 1), ctx.settings)).toBe(3);
    s = setTerritories(s, ctx, 1, 14, 0);
    expect(reinforcements(pl(s, 1), ctx.settings)).toBe(4);
    s = setTerritories(s, ctx, 1, 0, 0);
    expect(reinforcements(pl(s, 1), ctx.settings)).toBe(3);
  });
  it('adds continent bonuses', () => {
    const ctx = mk(4);
    let s = setTerritories(init(ctx), ctx, 1, 12, 0);
    s = setContinent(s, ctx, 1, 'asia', true, 0);
    s = setContinent(s, ctx, 1, 'australia', true, 0);
    expect(score(s, ctx)[1]).toBe(4 + 7 + 2);
  });
  it('uses the settings, not hardcoded numbers', () => {
    const ctx = mk(4, { reinforceDivisor: 2, reinforceMin: 5, bonusAsia: 10 });
    let s = setTerritories(init(ctx), ctx, 1, 12, 0);
    expect(score(s, ctx)[1]).toBe(6);
    s = setTerritories(s, ctx, 1, 4, 0);
    expect(score(s, ctx)[1]).toBe(5);
    s = setContinent(s, ctx, 1, 'asia', true, 0);
    expect(score(s, ctx)[1]).toBe(15);
  });
  it('gives eliminated players 0 and a score to every player', () => {
    const ctx = mk(4);
    const s = eliminate(init(ctx), ctx, 2, 1, 0);
    const sc = score(s, ctx);
    expect(Object.keys(sc)).toHaveLength(4);
    expect(sc[2]).toBe(0);
    expect(sc[1]).toBeGreaterThan(0);
  });
});

describe('editing', () => {
  const ctx = mk(4);
  it('clamps territories and armies to the settings', () => {
    let s = init(ctx);
    s = setTerritories(s, ctx, 1, 500, 0);
    expect(pl(s, 1).territories).toBe(42);
    s = setTerritories(s, ctx, 1, -4, 0);
    expect(pl(s, 1).territories).toBe(0);
    s = setArmies(s, ctx, 1, 100000, 0);
    expect(pl(s, 1).armies).toBe(999);
  });
  it('ignores NaN and unknown players', () => {
    const s = init(ctx);
    expect(setTerritories(s, ctx, 1, NaN, 0)).toBe(s);
    expect(setArmies(s, ctx, 99, 5, 0)).toBe(s);
  });
  it('is idempotent: repeating an edit changes nothing the second time', () => {
    const once = setTerritories(init(ctx), ctx, 1, 15, 100);
    const twice = setTerritories(once, ctx, 1, 15, 100);
    expect(twice).toBe(once);
    const c1 = setContinent(once, ctx, 1, 'europe', true, 100);
    expect(setContinent(c1, ctx, 1, 'europe', true, 100)).toBe(c1);
    const a1 = setArmies(c1, ctx, 1, 50, 100);
    expect(setArmies(a1, ctx, 1, 50, 100)).toBe(a1);
  });
  it('never mutates the state it was given', () => {
    const s = init(ctx);
    const copy = JSON.stringify(s);
    setTerritories(s, ctx, 1, 20, 0);
    setContinent(s, ctx, 1, 'asia', true, 0);
    eliminate(s, ctx, 2, 1, 0);
    addNote(s, ctx, 'hi', null, 0);
    expect(JSON.stringify(s)).toBe(copy);
  });
  it('keeps continents in map order', () => {
    let s = init(ctx);
    s = setContinent(s, ctx, 1, 'asia', true, 0);
    s = setContinent(s, ctx, 1, 'northAmerica', true, 0);
    expect(pl(s, 1).continents).toEqual(['northAmerica', 'asia']);
  });
  it('adds a player the state does not know yet', () => {
    const s = init(ctx);
    const bigger = { ...ctx, players: [...ctx.players, player(9)] };
    const s2 = setTerritories(s, bigger, 9, 3, 0);
    expect(pl(s2, 9).territories).toBe(3);
    expect(score(s, bigger)[9]).toBe(3); // reads as blank until edited
  });
  it('blocks edits to eliminated players', () => {
    const s = eliminate(init(ctx), ctx, 2, 1, 0);
    expect(setTerritories(s, ctx, 2, 9, 1)).toBe(s);
    expect(setContinent(s, ctx, 2, 'asia', true, 1)).toBe(s);
  });
});

describe('history', () => {
  const ctx = mk(4);
  it('logs changes with their time', () => {
    let s = init(ctx);
    s = setTerritories(s, ctx, 1, 12, 1000);
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ kind: 'territories', playerId: 1, from: 11, to: 12, t: 1000 });
  });
  it('merges quick taps on the same number into one entry', () => {
    let s = init(ctx);
    s = setTerritories(s, ctx, 1, 12, 1000);
    s = setTerritories(s, ctx, 1, 13, 2000);
    s = setTerritories(s, ctx, 1, 14, 3000);
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ from: 11, to: 14, t: 3000 });
  });
  it('does not merge after the window, or across players or numbers', () => {
    let s = init(ctx);
    s = setTerritories(s, ctx, 1, 12, 0);
    s = setTerritories(s, ctx, 1, 13, 6000); // 6 s > 5 s
    s = setTerritories(s, ctx, 2, 9, 6500);
    s = setArmies(s, ctx, 2, 20, 7000);
    expect(s.log).toHaveLength(4);
  });
  it('drops an entry whose merged change nets to nothing', () => {
    let s = init(ctx);
    s = setTerritories(s, ctx, 1, 12, 0);
    s = setTerritories(s, ctx, 1, 11, 1000);
    expect(s.log).toHaveLength(0);
    s = setContinent(s, ctx, 1, 'asia', true, 2000);
    s = setContinent(s, ctx, 1, 'asia', false, 2500);
    expect(s.log).toHaveLength(0);
  });
  it('merging can be switched off by the setting', () => {
    const c = mk(4, { mergeSeconds: 0 });
    let s = init(c);
    s = setTerritories(s, c, 1, 12, 1000);
    s = setTerritories(s, c, 1, 13, 2000);
    expect(s.log).toHaveLength(2);
  });
  it('gives entries unique rising ids and keeps only the newest logMax', () => {
    const c = mk(4, { logMax: 50, mergeSeconds: 0 });
    let s = init(c);
    for (let i = 0; i < 70; i++) s = addNote(s, c, `n${i}`, null, i);
    expect(s.log).toHaveLength(50);
    expect(s.log[0]!.text).toBe('n20');
    expect(s.log[49]!.id).toBe(70);
    expect(new Set(s.log.map((e) => e.id)).size).toBe(50);
  });
  it('records typed notes, trimmed and length-limited, about a player or the whole game', () => {
    let s = init(ctx);
    s = addNote(s, ctx, '  deal: P1 and P2 ally  ', 1, 5);
    s = addNote(s, ctx, 'x'.repeat(NOTE_MAX + 50), null, 6);
    expect(s.log[0]).toMatchObject({ kind: 'note', playerId: 1, text: 'deal: P1 and P2 ally' });
    expect(s.log[1]!.text).toHaveLength(NOTE_MAX);
    expect(addNote(s, ctx, '   ', null, 7)).toBe(s);
    expect(addNote(s, ctx, 'hi', 99, 8).log.at(-1)!.playerId).toBeNull();
  });
  it('describes entries in words', () => {
    const name = (id: number) => `P${id}`;
    let s = init(ctx);
    s = setTerritories(s, ctx, 1, 12, 0);
    s = setContinent(s, ctx, 1, 'asia', true, 10000);
    s = eliminate(s, ctx, 2, 1, 20000);
    s = eliminate(s, ctx, 3, null, 30000);
    s = restore(s, ctx, 3, 40000);
    s = recordReroll(s, ctx, 4, 50000);
    s = addNote(s, ctx, 'peace', 1, 60000);
    expect(s.log.map((e) => describeEntry(e, name))).toEqual([
      'P1: territories 11 → 12',
      'P1 holds Asia',
      'P2 was eliminated by P1 (11 territories to P1)',
      'P3 was eliminated',
      'P3 is back in (elimination undone)',
      'P4 used a re-roll',
      'P1: peace',
    ]);
  });
});

describe('elimination', () => {
  const ctx = mk(4);
  it('zeroes the player, records who did it, and keeps a backup', () => {
    let s = setContinent(init(ctx), ctx, 2, 'africa', true, 0);
    s = eliminate(s, ctx, 2, 1, 5000);
    expect(pl(s, 2)).toMatchObject({ eliminated: true, eliminatedBy: 1, eliminatedAt: 5000, order: 1, territories: 0, armies: 0, continents: [] });
    expect(pl(s, 2).backup).toEqual({ territories: 11, armies: 30, continents: ['africa'], gave: 11, gaveTo: 1 });
    expect(s.log.at(-1)).toMatchObject({ kind: 'eliminate', playerId: 2, by: 1 });
  });
  it('is idempotent', () => {
    const once = eliminate(init(ctx), ctx, 2, 1, 5000);
    expect(eliminate(once, ctx, 2, 3, 6000)).toBe(once);
  });
  it('treats self or unknown eliminators as unknown', () => {
    expect(pl(eliminate(init(ctx), ctx, 2, 2, 0), 2).eliminatedBy).toBeNull();
    expect(pl(eliminate(init(ctx), ctx, 2, 99, 0), 2).eliminatedBy).toBeNull();
    expect(pl(eliminate(init(ctx), ctx, 2, null, 0), 2).eliminatedBy).toBeNull();
  });
  it('will not eliminate the last player standing', () => {
    let s = init(ctx);
    s = eliminate(s, ctx, 2, 1, 1);
    s = eliminate(s, ctx, 3, 1, 2);
    s = eliminate(s, ctx, 4, 1, 3);
    expect(status(s, ctx)).toEqual({ alive: [1], winnerId: 1, over: true });
    expect(eliminate(s, ctx, 1, null, 4)).toBe(s);
  });
  it('can be undone, restoring the numbers; restoring twice is harmless', () => {
    let s = setContinent(init(ctx), ctx, 2, 'africa', true, 0);
    const before = pl(s, 2);
    s = eliminate(s, ctx, 2, 1, 100);
    const back = restore(s, ctx, 2, 200);
    expect(pl(back, 2)).toMatchObject({ eliminated: false, order: null, eliminatedBy: null, territories: 11, armies: 30, continents: ['africa'], backup: null });
    expect(pl(back, 2).territories).toBe(before.territories);
    expect(restore(back, ctx, 2, 300)).toBe(back);
  });
  it('keeps order unique after an undo', () => {
    let s = init(ctx);
    s = eliminate(s, ctx, 2, 1, 1);
    s = eliminate(s, ctx, 3, 1, 2);
    s = restore(s, ctx, 2, 3);
    s = eliminate(s, ctx, 2, 1, 4);
    expect(pl(s, 3).order).toBe(2);
    expect(pl(s, 2).order).toBe(3);
  });
});

describe('status', () => {
  it('has no winner while two or more are in, and no winner in a one-player game', () => {
    expect(status(init(mk(4)), mk(4))).toMatchObject({ winnerId: null, over: false });
    expect(status(init(mk(1)), mk(1)).over).toBe(false);
  });
});

describe('placements', () => {
  it('ranks survivors by territories, then armies; still tied = shared place', () => {
    const ctx = mk(5);
    let s = init(ctx);
    s = setTerritories(s, ctx, 1, 10, 0);
    s = setTerritories(s, ctx, 2, 10, 0);
    s = setTerritories(s, ctx, 3, 14, 0);
    s = setTerritories(s, ctx, 4, 8, 0);
    s = setTerritories(s, ctx, 5, 8, 0);
    s = setArmies(s, ctx, 1, 30, 0);
    s = setArmies(s, ctx, 2, 41, 0);
    s = setArmies(s, ctx, 4, 20, 0);
    s = setArmies(s, ctx, 5, 20, 0);
    expect(placements(s, ctx)).toEqual([[3], [2], [1], [4, 5]]);
  });
  it('puts the eliminated behind the survivors, latest eliminated first', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = eliminate(s, ctx, 3, 1, 1);
    s = eliminate(s, ctx, 2, 1, 2);
    s = setTerritories(s, ctx, 1, 30, 3);
    s = setTerritories(s, ctx, 4, 12, 3);
    expect(placements(s, ctx)).toEqual([[1], [4], [2], [3]]);
  });
  it('finished game: last player standing is first', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = eliminate(s, ctx, 4, 2, 1);
    s = eliminate(s, ctx, 1, 2, 2);
    s = eliminate(s, ctx, 3, 2, 3);
    expect(placements(s, ctx)).toEqual([[2], [3], [1], [4]]);
  });
  it('includes every player exactly once', () => {
    const ctx = mk(6);
    let s = init(ctx);
    s = eliminate(s, ctx, 5, 1, 1);
    const flat = placements(s, ctx).flat().sort();
    expect(flat).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('works with players the state has not seen', () => {
    const ctx = mk(3);
    expect(placements({ v: 1, players: {}, log: [], seq: 0, elimCount: 0 }, ctx)).toEqual([[1, 2, 3]]);
  });
});

describe('recap', () => {
  const ctx = mk(4);
  const build = (): RiskState => {
    let s = init(ctx);
    s = setTerritories(s, ctx, 1, 25, 0);
    s = setContinent(s, ctx, 1, 'asia', true, 0);
    s = recordReroll(s, ctx, 1, 0);
    s = eliminate(s, ctx, 2, 1, 1);
    s = eliminate(s, ctx, 3, 1, 2);
    s = eliminate(s, ctx, 4, 1, 3);
    return s;
  };
  it('lists every player best first with shared-place numbering', () => {
    const r = recap(build(), ctx);
    expect(r.map((x) => [x.playerId, x.place])).toEqual([[1, 1], [4, 2], [3, 3], [2, 4]]);
  });
  it('fills in the stats', () => {
    const [w, , , out] = recap(build(), ctx);
    // P1 takes over each eliminated player's territories, capped at the 42-territory map.
    expect(w).toMatchObject({ name: 'P1', territories: 42, continents: ['Asia'], knockouts: 3, rerollsUsed: 1, peakTerritories: 42, reinforcements: 14 + 7, eliminated: false });
    expect(out).toMatchObject({ name: 'P2', eliminated: true, eliminatedBy: 'P1', peakTerritories: 11 });
  });
  it('numbers tied players the same and skips ahead', () => {
    let s = init(ctx);
    s = setTerritories(s, ctx, 1, 20, 0);
    s = setTerritories(s, ctx, 2, 20, 0);
    s = setTerritories(s, ctx, 3, 10, 0);
    s = setTerritories(s, ctx, 4, 10, 0);
    const r = recap(s, ctx);
    expect(r.map((x) => x.place)).toEqual([1, 1, 3, 3]);
    expect(r.map((x) => x.tied)).toEqual([true, true, true, true]);
  });
  it('writes plain text', () => {
    const rows = recap(build(), ctx);
    expect(recapText(rows[0]!)).toContain('1st place');
    expect(recapText(rows[0]!)).toContain('Continents held at the end: Asia.');
    expect(recapText(rows[3]!)).toContain('Eliminated by P1.');
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
  });
});

describe('re-rolls', () => {
  it('counts a re-roll that was spent', () => {
    const ctx = mk(4);
    const s = recordReroll(init(ctx), ctx, 3, 9);
    expect(pl(s, 3).rerollsUsed).toBe(1);
    expect(s.log.at(-1)).toMatchObject({ kind: 'reroll', playerId: 3 });
    expect(recordReroll(s, ctx, 99, 9)).toBe(s);
  });
});

describe('state is plain JSON throughout', () => {
  it('survives a save and load after a whole game', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = setTerritories(s, ctx, 1, 20, 1);
    s = setContinent(s, ctx, 1, 'asia', true, 2);
    s = eliminate(s, ctx, 2, 1, 3);
    s = addNote(s, ctx, 'treaty', 1, 4);
    s = recordReroll(s, ctx, 1, 5);
    const loaded = JSON.parse(JSON.stringify(s)) as RiskState;
    expect(loaded).toEqual(s);
    expect(placements(loaded, ctx)).toEqual(placements(s, ctx));
    expect(score(loaded, ctx)).toEqual(score(s, ctx));
  });
});

describe('territory transfer on elimination (manager follow-up)', () => {
  const T = 1_000;
  it("gives the eliminated player's territories to a known eliminator; armies are lost", () => {
    const ctx = mk(4);
    let s = init(ctx); // 42 / 4: 11, 11, 10, 10
    s = eliminate(s, ctx, 3, 1, T);
    expect(pl(s, 1).territories).toBe(21);
    expect(pl(s, 3)).toMatchObject({ territories: 0, armies: 0, eliminated: true });
    expect(s.log.at(-1)).toMatchObject({ kind: 'eliminate', by: 1, moved: 10 });
    expect(describeEntry(s.log.at(-1)!, (id) => `P${id}`)).toBe('P3 was eliminated by P1 (10 territories to P1)');
  });
  it('unknown eliminator: territories are just freed', () => {
    const ctx = mk(4);
    const s = eliminate(init(ctx), ctx, 3, null, T);
    expect([1, 2, 4].map((id) => pl(s, id).territories)).toEqual([11, 11, 10]);
  });
  it('undo takes exactly those territories back, never below 0', () => {
    const ctx = mk(4);
    let s = eliminate(init(ctx), ctx, 3, 1, T); // P1 21
    s = restore(s, ctx, 3, T + 1);
    expect(pl(s, 1).territories).toBe(11);
    expect(pl(s, 3).territories).toBe(10);
    s = eliminate(s, ctx, 3, 1, T + 2); // P1 21 again
    s = setTerritories(s, ctx, 1, 4, T + 3); // P1 lost most of them since
    s = restore(s, ctx, 3, T + 100);
    expect(pl(s, 1).territories).toBe(0);
    expect(pl(s, 3).territories).toBe(10);
    expect(s.log.at(-1)).toMatchObject({ kind: 'restore', moved: 4 });
  });
  it('never pushes the eliminator past the map size', () => {
    const ctx = mk(2, { territoryTotal: 42 });
    let s = setTerritories(init(ctx), ctx, 1, 40, T);
    s = eliminate(s, ctx, 2, 1, T + 1);
    expect(pl(s, 1).territories).toBe(42);
  });
  it('recap: one text per player via def.recap', () => {
    const ctx = mk(3);
    const s = eliminate(init(ctx), ctx, 2, 1, T);
    const r = def.recap!(s, ctx);
    expect(r.map((x) => x.playerId).sort()).toEqual([1, 2, 3]);
    expect(r.find((x) => x.playerId === 2)!.text).toContain('Eliminated by P1');
  });
});

import { battle as doBattle, describeEntry as describe2, init as init2, pl as pl2 } from './def';

describe('battle', () => {
  it('moves territories defender → attacker, takes optional casualties, logs one line', () => {
    const ctx = mk(4);
    const s0 = init2(ctx);
    const a0 = pl2(s0, 1);
    const d0 = pl2(s0, 2);
    const s1 = doBattle(s0, ctx, { attackerId: 1, defenderId: 2, territories: 3, attackerLosses: 2, defenderLosses: 4, rounds: 5 }, 1000);
    expect(pl2(s1, 1).territories).toBe(a0.territories + 3);
    expect(pl2(s1, 2).territories).toBe(d0.territories - 3);
    expect(pl2(s1, 1).armies).toBe(a0.armies - 2);
    expect(pl2(s1, 2).armies).toBe(d0.armies - 4);
    const last = s1.log[s1.log.length - 1]!;
    expect(last.kind).toBe('battle');
    expect(describe2(last, (id) => `P${id}`)).toContain('P1 attacked P2: took 3 territories');
  });
  it('never takes more than the defender holds and keeps the map total', () => {
    const ctx = mk(4);
    const s0 = init2(ctx);
    const s1 = doBattle(s0, ctx, { attackerId: 1, defenderId: 2, territories: 999 }, 1000);
    expect(pl2(s1, 2).territories).toBe(0);
    const total = ctx.players.reduce((n, p) => n + pl2(s1, p.id).territories, 0);
    expect(total).toBe(ctx.players.reduce((n, p) => n + pl2(s0, p.id).territories, 0));
  });
  it('ignores self-attacks', () => {
    const ctx = mk(4);
    const s0 = init2(ctx);
    expect(doBattle(s0, ctx, { attackerId: 1, defenderId: 1, territories: 2 }, 1)).toBe(s0);
  });
});
