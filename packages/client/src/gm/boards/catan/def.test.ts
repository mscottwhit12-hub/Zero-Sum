import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  AWARDS,
  NOTE_MAX,
  SETTINGS,
  addNote,
  breakdown,
  canUpgrade,
  def,
  describeEntry,
  ensure,
  holder,
  init,
  ordinal,
  placements,
  recap,
  recapText,
  recordReroll,
  score,
  setAward,
  setCities,
  setSettlements,
  status,
  upgradeToCity,
  type CatanState,
} from './def';

const player = (id: number, seat: number | null = id): BoardPlayer => ({ id, name: `P${id}`, color: null, avatarPath: null, seat });
const defaults = () => Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));
const mk = (n: number, settings: Record<string, number> = {}): BoardContext => ({
  players: Array.from({ length: n }, (_, i) => player(i + 1)),
  table: { name: 'T1', seats: 4, w: 0.3, h: 0.15 },
  rerollsAllowed: true,
  rerollsLeft: {},
  useReroll: async () => undefined,
  settings: { ...defaults(), ...settings },
});
const T = 1_000_000;

describe('settings', () => {
  it('has the classic base-game defaults and sane ranges', () => {
    const d = defaults();
    expect(d).toMatchObject({ targetPoints: 10, startSettlements: 2, settlementPoints: 1, cityPoints: 2, longestRoadPoints: 2, largestArmyPoints: 2, maxSettlements: 5, maxCities: 4 });
    for (const [k, s] of Object.entries(SETTINGS)) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.min).toBeLessThanOrEqual(s.default);
      expect(s.default).toBeLessThanOrEqual(s.max);
      expect(k.length).toBeGreaterThan(0);
    }
  });
  it('every setting is used by the def (no orphan numbers) and the def is wired to the contract', () => {
    expect(def.key).toBe('catan');
    expect(def.label).toBe('Catan');
    expect(def.settings).toBe(SETTINGS);
    expect(AWARDS.map((a) => a.setting).every((k) => k in SETTINGS)).toBe(true);
    expect(AWARDS.map((a) => a.short)).toEqual(['LR', 'LA']);
  });
});

describe('init', () => {
  it('everyone starts on the configured settlements, nobody holds an award', () => {
    const s = init(mk(3));
    expect(s.players[1]).toEqual({ settlements: 2, cities: 0, rerollsUsed: 0 });
    expect(s).toMatchObject({ longestRoad: null, largestArmy: null, log: [], seq: 0, v: 1 });
    expect(score(s, mk(3))).toEqual({ 1: 2, 2: 2, 3: 2 });
  });
  it('starting settlements respect the piece limit', () => {
    expect(init(mk(2, { startSettlements: 9, maxSettlements: 3 })).players[1]!.settlements).toBe(3);
  });
  it('is plain JSON', () => {
    const s = init(mk(4));
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('points', () => {
  it('adds up and shows where the points come from', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = upgradeToCity(s, ctx, 1, T);
    s = setAward(s, ctx, 'longestRoad', 1, T);
    s = setAward(s, ctx, 'largestArmy', 2, T);
    expect(breakdown(s, ctx, 1)).toEqual({ settlements: 1, cities: 1, settlementPts: 1, cityPts: 2, longestRoad: 2, largestArmy: 0, total: 5 });
    expect(breakdown(s, ctx, 2)).toMatchObject({ settlementPts: 2, largestArmy: 2, total: 4 });
    expect(score(s, ctx)).toEqual({ 1: 5, 2: 4, 3: 2 });
  });
  it('every point value comes from the settings', () => {
    const ctx = mk(2, { settlementPoints: 2, cityPoints: 3, longestRoadPoints: 1, largestArmyPoints: 5, startSettlements: 1 });
    let s = init(ctx);
    s = upgradeToCity(s, ctx, 1, T);
    s = setAward(s, ctx, 'longestRoad', 1, T);
    s = setAward(s, ctx, 'largestArmy', 1, T);
    expect(score(s, ctx)[1]).toBe(3 + 1 + 5);
  });
  it('an award held by someone who is not in this game counts for nobody', () => {
    const ctx = mk(2);
    const s = { ...init(ctx), longestRoad: 99 } as CatanState;
    expect(holder(s, ctx, 'longestRoad')).toBeNull();
    expect(score(s, ctx)).toEqual({ 1: 2, 2: 2 });
  });
  it('a player the state has not met yet reads as a fresh start', () => {
    const ctx = mk(3);
    const s = init(mk(2));
    expect(score(s, ctx)[3]).toBe(2);
  });
});

describe('pieces', () => {
  it('set, clamp to the piece limits, ignore junk', () => {
    const ctx = mk(2);
    let s = init(ctx);
    s = setSettlements(s, ctx, 1, 99, T);
    expect(s.players[1]!.settlements).toBe(5);
    s = setSettlements(s, ctx, 1, -4, T + 10_000);
    expect(s.players[1]!.settlements).toBe(0);
    s = setCities(s, ctx, 1, 99, T);
    expect(s.players[1]!.cities).toBe(4);
    expect(setCities(s, ctx, 1, NaN, T)).toBe(s);
    expect(setCities(s, ctx, 1, Infinity, T)).toBe(s);
    expect(setSettlements(s, ctx, 42, 3, T)).toBe(s); // not a player
  });
  it('the piece limits are settings', () => {
    const ctx = mk(2, { maxSettlements: 3, maxCities: 1 });
    let s = init(ctx);
    s = setSettlements(s, ctx, 1, 9, T);
    s = setCities(s, ctx, 1, 9, T);
    expect(s.players[1]).toMatchObject({ settlements: 3, cities: 1 });
  });
  it('repeating an operation returns the same object', () => {
    const ctx = mk(2);
    const s = setSettlements(init(ctx), ctx, 1, 4, T);
    expect(setSettlements(s, ctx, 1, 4, T + 1)).toBe(s);
    expect(setCities(s, ctx, 1, 0, T)).toBe(s);
  });
  it('upgrade moves a piece; no-ops (same object) when it cannot', () => {
    const ctx = mk(2, { startSettlements: 1, maxCities: 1 });
    let s = init(ctx);
    expect(canUpgrade(s, ctx, 1)).toBe(true);
    s = upgradeToCity(s, ctx, 1, T);
    expect(s.players[1]).toMatchObject({ settlements: 0, cities: 1 });
    expect(canUpgrade(s, ctx, 1)).toBe(false);
    expect(upgradeToCity(s, ctx, 1, T)).toBe(s); // no settlement left
    const more = setSettlements(s, ctx, 1, 2, T);
    expect(canUpgrade(more, ctx, 1)).toBe(false); // city pieces used up
    expect(upgradeToCity(more, ctx, 1, T)).toBe(more);
    expect(upgradeToCity(s, ctx, 77, T)).toBe(s);
  });
});

describe('awards', () => {
  it('give, transfer, release; each real change is logged once; repeats are harmless', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = setAward(s, ctx, 'longestRoad', 1, T);
    expect(setAward(s, ctx, 'longestRoad', 1, T + 1)).toBe(s); // double tap
    s = setAward(s, ctx, 'longestRoad', 2, T + 2); // transfer
    s = setAward(s, ctx, 'largestArmy', 3, T + 3);
    s = setAward(s, ctx, 'longestRoad', null, T + 4); // road cut, nobody holds it
    expect(setAward(s, ctx, 'longestRoad', null, T + 5)).toBe(s);
    expect(s.longestRoad).toBeNull();
    expect(s.largestArmy).toBe(3);
    const awards = s.log.filter((e) => e.kind === 'award').map((e) => [e.award, e.fromHolder, e.toHolder]);
    expect(awards).toEqual([
      ['longestRoad', null, 1],
      ['longestRoad', 1, 2],
      ['largestArmy', null, 3],
      ['longestRoad', 2, null],
    ]);
  });
  it('refuses a player who is not in the game, a bad award name, and text ids', () => {
    const ctx = mk(2);
    const s = init(ctx);
    expect(setAward(s, ctx, 'longestRoad', 99, T)).toBe(s);
    expect(setAward(s, ctx, 'bogus' as never, 1, T)).toBe(s);
    expect(setAward(s, ctx, 'largestArmy', '1' as unknown as number, T)).toBe(s);
    expect(setAward(s, ctx, 'largestArmy', NaN, T)).toBe(s);
  });
  it('a stale saved holder being cleared is not logged as a transfer', () => {
    const ctx = mk(2);
    const s = { ...init(ctx), longestRoad: 99 } as CatanState;
    expect(setAward(s, ctx, 'longestRoad', null, T)).toBe(s);
  });
  it('taking an award straight from another player moves the points', () => {
    const ctx = mk(2);
    let s = setAward(init(ctx), ctx, 'largestArmy', 1, T);
    expect(score(s, ctx)).toEqual({ 1: 4, 2: 2 });
    s = setAward(s, ctx, 'largestArmy', 2, T + 1);
    expect(score(s, ctx)).toEqual({ 1: 2, 2: 4 });
  });
});

describe('standings and the end', () => {
  it('placements: best first, equal points share a place, unfinished games rank by current points', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = setSettlements(s, ctx, 3, 4, T); // 4
    s = setAward(s, ctx, 'longestRoad', 1, T); // 4
    expect(placements(s, ctx)).toEqual([[1, 3], [2, 4]]);
    expect(placements(init(ctx), ctx)).toEqual([[1, 2, 3, 4]]);
    expect(placements(init(mk(0)), mk(0))).toEqual([]);
  });
  it('status: reaches the target only at the points to win; the target is a setting', () => {
    const ctx = mk(3);
    let s = init(ctx);
    expect(status(s, ctx)).toMatchObject({ target: 10, top: 2, reached: false, winners: [] });
    s = setSettlements(s, ctx, 2, 5, T);
    s = setCities(s, ctx, 2, 2, T); // 5 + 4 = 9
    s = setAward(s, ctx, 'longestRoad', 2, T); // 11
    expect(status(s, ctx)).toMatchObject({ top: 11, reached: true, winners: [2], leaders: [2] });
    const low = mk(3, { targetPoints: 12 });
    expect(status(s, low).reached).toBe(false);
    expect(status(init(mk(0)), mk(0)).reached).toBe(false);
  });
});

describe('roster and re-rolls', () => {
  it('a late joiner is added with a fresh start; nothing to add returns the same object', () => {
    const s = init(mk(2));
    expect(ensure(s, mk(2))).toBe(s);
    const s2 = setSettlements(s, mk(3), 3, 4, T);
    expect(s2.players[3]!.settlements).toBe(4);
    expect(s2.players[1]).toEqual(s.players[1]);
  });
  it('records re-rolls in the history', () => {
    const ctx = mk(2);
    const s = recordReroll(recordReroll(init(ctx), ctx, 1, T), ctx, 1, T + 1);
    expect(s.players[1]!.rerollsUsed).toBe(2);
    expect(s.log.filter((e) => e.kind === 'reroll')).toHaveLength(2);
    expect(recordReroll(s, ctx, 99, T)).toBe(s);
  });
});

describe('history', () => {
  it('quick taps on the same number merge into one entry; tapping back removes it', () => {
    const ctx = mk(2);
    let s = init(ctx);
    s = setSettlements(s, ctx, 1, 3, T);
    s = setSettlements(s, ctx, 1, 4, T + 1000);
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ kind: 'settlements', from: 2, to: 4 });
    s = setSettlements(s, ctx, 1, 2, T + 2000);
    expect(s.log).toHaveLength(0);
  });
  it('slow taps, other players and other numbers do not merge; the merge window is a setting', () => {
    const ctx = mk(2);
    let s = setSettlements(init(ctx), ctx, 1, 3, T);
    s = setSettlements(s, ctx, 1, 4, T + 60_000);
    s = setSettlements(s, ctx, 2, 3, T + 60_500);
    s = setCities(s, ctx, 2, 1, T + 60_900);
    expect(s.log).toHaveLength(4);
    const off = mk(2, { mergeSeconds: 0 });
    let q = setSettlements(init(off), off, 1, 3, T);
    q = setSettlements(q, off, 1, 4, T + 1);
    expect(q.log).toHaveLength(2);
  });
  it('keeps only the newest entries (a setting) and ids never repeat', () => {
    const ctx = mk(2, { logMax: 50, mergeSeconds: 0 });
    let s = init(ctx);
    for (let i = 0; i < 80; i++) s = setSettlements(s, ctx, 1, i % 2 ? 3 : 4, T + i);
    expect(s.log.length).toBe(50);
    expect(new Set(s.log.map((e) => e.id)).size).toBe(50);
    expect(s.log[s.log.length - 1]!.id).toBe(s.seq);
  });
  it('notes: trimmed, capped, optional player, empty ignored', () => {
    const ctx = mk(2);
    const s = init(ctx);
    expect(addNote(s, ctx, '   ', null, T)).toBe(s);
    const n = addNote(s, ctx, `  ${'x'.repeat(NOTE_MAX + 50)}  `, 2, T);
    expect(n.log[0]!.text!.length).toBe(NOTE_MAX);
    expect(n.log[0]!.playerId).toBe(2);
    expect(addNote(s, ctx, 'hi', 99, T).log[0]!.playerId).toBeNull();
  });
  it('describes every kind of entry in words', () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = setSettlements(s, ctx, 1, 3, T);
    s = setCities(s, ctx, 1, 1, T + 10_000);
    s = upgradeToCity(s, ctx, 1, T + 20_000);
    s = setAward(s, ctx, 'longestRoad', 1, T + 30_000);
    s = setAward(s, ctx, 'longestRoad', 2, T + 40_000);
    s = setAward(s, ctx, 'longestRoad', null, T + 50_000);
    s = recordReroll(s, ctx, 3, T + 60_000);
    s = addNote(s, ctx, 'Robber on the 6', 3, T + 70_000);
    s = addNote(s, ctx, 'Dinner break', null, T + 80_000);
    const nameOf = (id: number) => `P${id}`;
    expect(s.log.map((e) => describeEntry(e, nameOf))).toEqual([
      'P1: settlements 2 → 3',
      'P1: cities 0 → 1',
      'P1 upgraded a settlement to a city',
      'P1 takes Longest Road',
      'Longest Road passes from P1 to P2',
      'Longest Road released (P2 no longer holds it)',
      'P3 used a re-roll',
      'P3: Robber on the 6',
      'Dinner break',
    ]);
  });
});

describe('recap', () => {
  const finished = () => {
    const ctx = mk(3);
    let s = init(ctx);
    s = setSettlements(s, ctx, 1, 3, T);
    s = upgradeToCity(s, ctx, 1, T + 10_000);
    s = setAward(s, ctx, 'longestRoad', 2, T + 20_000);
    s = setAward(s, ctx, 'longestRoad', 1, T + 30_000); // P2 loses it to P1
    s = setAward(s, ctx, 'largestArmy', 1, T + 40_000);
    s = recordReroll(s, ctx, 3, T + 50_000);
    return { ctx, s };
  };
  it('rows best first with the numbers behind each place', () => {
    const { ctx, s } = finished();
    const rows = recap(s, ctx);
    expect(rows.map((r) => [r.playerId, r.place, r.points])).toEqual([[1, 1, 2 * 1 + 2 + 2 + 2], [2, 2, 2], [3, 2, 2]]);
    expect(rows[0]).toMatchObject({ settlements: 2, cities: 1, awards: ['Longest Road', 'Largest Army'] });
    expect(rows[1]).toMatchObject({ tied: true, lost: [{ label: 'Longest Road', to: 'P1' }] });
    expect(rows[2]!.rerollsUsed).toBe(1);
  });
  it('one private message per player, each in plain words', () => {
    const { ctx, s } = finished();
    const out = def.recap!(s, ctx);
    expect(out.map((m) => m.playerId)).toEqual([1, 2, 3]);
    expect(out[0]!.text).toContain('Catan recap for P1: 8 points on the board.');
    for (const m of out) expect(m.text).not.toMatch(/\b(1st|2nd|3rd|4th)\b|place/); // the board never claims a place in the message
    expect(out[0]!.text).toContain('2 settlements and 1 city, plus Longest Road and Largest Army.');
    expect(out[1]!.text).toContain('You held Longest Road for a while before P1 took it.');
    expect(out[2]!.text).toContain('Re-rolls used: 1.');
    expect(out[0]!.text).toContain('Board points (hidden cards not counted): P1 8, P2 2, P3 2.');
  });
  it('wording: singular and plural, ordinals (used by the standings table), a released award', () => {
    const ctx = mk(2, { startSettlements: 1 });
    let s = init(ctx);
    s = setAward(s, ctx, 'largestArmy', 2, T);
    s = setAward(s, ctx, 'largestArmy', null, T + 1);
    const rows = recap(s, ctx);
    expect(recapText(rows[1]!, rows)).toContain('1 settlement and 0 cities');
    expect(recapText(rows[1]!, rows)).toContain('before it was released');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
  });
});

describe('invariants under random play (seeded)', () => {
  it('state stays valid, JSON-safe and consistent over thousands of random operations', () => {
    let seed = 20261028;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const junk = () => [NaN, Infinity, -Infinity, -5, 0, 1, 2.6, 3, 99, 1e9][ri(0, 9)]!;
    for (let game = 0; game < 200; game++) {
      const ctx = mk(ri(0, 4), { maxSettlements: ri(1, 6), maxCities: ri(1, 5), mergeSeconds: ri(0, 10), logMax: 50 });
      let s = init(ctx);
      let t = T;
      for (let i = 0; i < 40; i++) {
        t += ri(0, 15_000);
        const id = rnd() < 0.1 ? 99 : ri(1, 4);
        const before = s;
        const op = ri(0, 6);
        if (op === 0) s = setSettlements(s, ctx, id, junk(), t);
        else if (op === 1) s = setCities(s, ctx, id, junk(), t);
        else if (op === 2) s = upgradeToCity(s, ctx, id, t);
        else if (op === 3) s = setAward(s, ctx, rnd() < 0.5 ? 'longestRoad' : 'largestArmy', rnd() < 0.2 ? null : id, t);
        else if (op === 4) s = recordReroll(s, ctx, id, t);
        else if (op === 5) s = addNote(s, ctx, rnd() < 0.3 ? '' : 'n', rnd() < 0.5 ? null : id, t);
        else s = ensure(s, ctx);
        const again = JSON.parse(JSON.stringify(s));
        expect(again).toEqual(s);
        for (const p of Object.values(s.players)) {
          expect(Number.isInteger(p.settlements) && p.settlements >= 0 && p.settlements <= cfgMax(ctx, 'maxSettlements')).toBe(true);
          expect(Number.isInteger(p.cities) && p.cities >= 0 && p.cities <= cfgMax(ctx, 'maxCities')).toBe(true);
        }
        expect(s.log.length).toBeLessThanOrEqual(50);
        const pts = score(s, ctx);
        for (const p of ctx.players) expect(pts[p.id]).toBe(breakdown(s, ctx, p.id).total);
        const groups = placements(s, ctx);
        expect(groups.flat().sort()).toEqual(ctx.players.map((p) => p.id).sort());
        if (before !== s) expect(s).not.toEqual(before);
      }
    }
  });
});

const cfgMax = (ctx: BoardContext, key: string) => ctx.settings[key]!;
