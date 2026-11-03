import { describe, expect, it } from 'vitest';
import { COLOUR_NAMES, MAX_COLOURS, ladder, niceAt, niceIndexAtMost, planChips, suggestBlinds, type ChipColour, type PlanInput } from './chips';

const fmt = (p: number) => `$${(p / 100).toFixed(2)}`;
const set = (names: string[], counts: number[], values: (number | null)[] = []): ChipColour[] => names.map((name, i) => ({ name, count: counts[i]!, value: values[i] ?? null }));
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  colours: set(['white', 'red', 'blue', 'green', 'black'], [100, 100, 100, 100, 100]),
  players: 5,
  buyIn: 20,
  pointsPerUnit: 100,
  shareNum: 1,
  shareDen: 3,
  fmt,
  ...over,
});
const stackOf = (p: ReturnType<typeof planChips>) => p.rows.reduce((n, r) => n + r.perPlayer * r.value, 0);

describe('nice numbers', () => {
  it('runs 1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000 ...', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(niceAt)).toEqual([1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000]);
  });
  it('finds the largest nice value at or below a number', () => {
    expect(niceAt(niceIndexAtMost(0.4))).toBe(1);
    expect(niceAt(niceIndexAtMost(10))).toBe(10);
    expect(niceAt(niceIndexAtMost(24))).toBe(10);
    expect(niceAt(niceIndexAtMost(25))).toBe(25);
    expect(niceAt(niceIndexAtMost(2400))).toBe(1000);
  });
  it('offers colour names for suggestions', () => {
    expect(COLOUR_NAMES.length).toBeGreaterThanOrEqual(MAX_COLOURS);
  });
});

describe('suggested chip values', () => {
  it('depend on how many colours there are', () => {
    expect(ladder(1, 2000)).toEqual([10]);
    expect(ladder(2, 2000)).toEqual([10, 50]);
    expect(ladder(3, 2000)).toEqual([10, 50, 250]);
    expect(ladder(4, 2000)).toEqual([10, 50, 250, 1000]);
    expect(ladder(4, 5000)).toEqual([25, 100, 500, 2500]);
    expect(ladder(5, 5000)).toEqual([10, 50, 250, 1000, 2500]);
  });
  it('always go up, are nice numbers, and never put more than half the stack in one chip', () => {
    for (const stack of [500, 1000, 2000, 5000, 10000, 100000]) {
      for (let k = 1; k <= MAX_COLOURS; k++) {
        const v = ladder(k, stack);
        expect(v).toHaveLength(k);
        for (let i = 1; i < k; i++) expect(v[i]!).toBeGreaterThan(v[i - 1]!);
        const nice = new Set(Array.from({ length: 30 }, (_, i) => niceAt(i)));
        for (const x of v) expect(nice.has(x)).toBe(true);
        if (v[0] !== 1) expect(v[k - 1]!).toBeLessThanOrEqual(stack / 2);
      }
    }
  });
  it('clamps the colour count', () => {
    expect(ladder(0, 2000)).toEqual(ladder(1, 2000));
    expect(ladder(99, 2000)).toHaveLength(MAX_COLOURS);
  });
});

describe('suggested first blinds', () => {
  it('give about 100 big blinds', () => {
    expect(suggestBlinds(2000, 10)).toEqual({ sb: 10, bb: 20, bigBlinds: 100 });
    expect(suggestBlinds(5000, 25)).toEqual({ sb: 25, bb: 50, bigBlinds: 100 });
    expect(suggestBlinds(10000, 50)).toEqual({ sb: 50, bb: 100, bigBlinds: 100 });
  });
  it('are payable with the smallest chip', () => {
    expect(suggestBlinds(2000, 25)).toEqual({ sb: 25, bb: 50, bigBlinds: 40 });
    expect(suggestBlinds(2000, 20)!.sb % 20).toBe(0);
  });
  it('are null for no stack', () => {
    expect(suggestBlinds(0, 10)).toBeNull();
  });
});

describe('chip plan: normal cases', () => {
  it('gives every player exactly the buy-in in chips when the chips allow it', () => {
    const p = planChips(input());
    expect(p.status).toBe('exact');
    expect(p.stack).toBe(2000);
    expect(stackOf(p)).toBe(2000);
    expect(p.notes.filter((n) => /can't make exactly/.test(n))).toEqual([]);
  });
  it('uses the suggested values for the number of colours, lowest first', () => {
    const p = planChips(input());
    expect(p.rows.map((r) => r.value)).toEqual(ladder(5, 2000));
    expect(p.rows.every((r) => !r.typed)).toBe(true);
  });
  it('hands out at most the share to players and keeps the rest in the bank', () => {
    const p = planChips(input());
    for (const r of p.rows) {
      expect(r.perPlayer * 5).toBeLessThanOrEqual(Math.floor(r.count / 3));
      expect(r.bankLeft).toBe(r.count - r.perPlayer * 5);
      expect(r.bankLeft).toBeGreaterThanOrEqual(0);
    }
    expect(p.bankValue).toBe(p.rows.reduce((n, r) => n + r.bankLeft * r.value, 0));
  });
  it('counts how many more full handouts the bank covers', () => {
    const p = planChips(input());
    const min = Math.min(...p.rows.filter((r) => r.perPlayer > 0).map((r) => Math.floor(r.bankLeft / r.perPlayer)));
    expect(p.rebuys).toBe(min);
    expect(p.rebuys).toBeGreaterThanOrEqual(2 * 5);
  });
  it('suggests first blinds worth about 100 big blinds', () => {
    expect(planChips(input()).blinds).toEqual({ sb: 10, bb: 20, bigBlinds: 100 });
  });
  it('works the same for gold (the units are only words)', () => {
    const a = planChips(input());
    const b = planChips(input({ fmt: (p) => `${p / 100} gold` }));
    expect(b.stack).toBe(a.stack);
    expect(b.rows.map((r) => r.perPlayer)).toEqual(a.rows.map((r) => r.perPlayer));
  });
  it('scales with the buy-in', () => {
    for (const buyIn of [5, 10, 20, 50, 100]) {
      const p = planChips(input({ buyIn, colours: set(['white', 'red', 'blue', 'green'], [400, 300, 200, 100]), players: 4, shareNum: 1, shareDen: 1 }));
      expect(p.target).toBe(buyIn * 100);
      expect(p.status === 'exact' || p.status === 'adjusted').toBe(true);
      expect(stackOf(p)).toBe(p.stack);
    }
  });
  it('handles a buy-in with cents', () => {
    const p = planChips(input({ buyIn: 12.5, colours: set(['a', 'b', 'c'], [300, 200, 100]), players: 4, shareNum: 1, shareDen: 2 }));
    expect(p.target).toBe(1250);
    expect(stackOf(p)).toBe(p.stack);
  });
  it('lets the GM type values; typed values are used as they are', () => {
    const p = planChips(input({ colours: set(['white', 'red', 'blue'], [90, 90, 60], [25, 50, 100]), players: 3, shareNum: 1, shareDen: 1 }));
    expect(p.rows.map((r) => [r.value, r.typed])).toEqual([[25, true], [50, true], [100, true]]);
    expect(p.status).toBe('exact');
    expect(stackOf(p)).toBe(2000);
  });
  it('mixes typed and suggested values', () => {
    const p = planChips(input({ colours: set(['white', 'red', 'blue'], [200, 200, 200], [null, 50, null]), players: 4, shareNum: 1, shareDen: 1 }));
    expect(p.rows[1]!.typed).toBe(true);
    expect(p.rows[0]!.typed).toBe(false);
  });
  it('skips colours with 0 chips and ignores their position', () => {
    const p = planChips(input({ colours: set(['white', 'red', 'blue'], [100, 0, 100]), players: 4, shareNum: 1, shareDen: 1 }));
    expect(p.rows.map((r) => r.name)).toEqual(['white', 'blue']);
  });
  it('gives the same answer every time', () => {
    expect(planChips(input())).toEqual(planChips(input()));
  });
  it('is quick even with 8 colours and a $100 buy-in', () => {
    const t = Date.now();
    const p = planChips(input({ buyIn: 100, players: 6, colours: set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], [300, 300, 300, 300, 200, 200, 100, 100]) }));
    expect(Date.now() - t).toBeLessThan(1500);
    expect(p.status).toBe('exact');
  });
});

describe('chip plan: bank share', () => {
  it('a bigger share gives players more to build the stack from', () => {
    const colours = set(['white', 'red', 'blue'], [60, 40, 20]);
    const lo = planChips(input({ colours, players: 4, buyIn: 50, shareNum: 1, shareDen: 3 }));
    const hi = planChips(input({ colours, players: 4, buyIn: 50, shareNum: 1, shareDen: 1 }));
    expect(hi.stack).toBeGreaterThanOrEqual(lo.stack);
    expect(hi.rebuys).toBeLessThanOrEqual(lo.rebuys);
  });
  it('100% to players leaves an empty bank and no rebuys', () => {
    const p = planChips(input({ colours: set(['a', 'b'], [100, 100]), players: 2, shareNum: 1, shareDen: 1 }));
    expect(p.rows.every((r) => r.bankLeft >= 0)).toBe(true);
    expect(p.share.percent).toBe(100);
  });
  it('keeps the share between 10% and 100%', () => {
    expect(planChips(input({ shareNum: 1, shareDen: 100 })).share.percent).toBe(10);
    expect(planChips(input({ shareNum: 5, shareDen: 3 })).share.percent).toBe(100);
    expect(planChips(input({ shareNum: 1, shareDen: 2 })).share.percent).toBe(50);
    expect(planChips(input({ shareNum: 0, shareDen: 0 })).share.percent).toBe(10);
  });
});

describe('chip plan: when it cannot be exact', () => {
  it('suggests the nearest stack, says what changed, and what share would work', () => {
    const p = planChips(input({ colours: set(['white', 'red', 'blue'], [200, 150, 100]), players: 7, buyIn: 50 }));
    expect(p.status).toBe('adjusted');
    expect(p.stack).toBeLessThan(p.target);
    expect(p.notes[0]).toMatch(/can't make exactly \$50\.00 .* nearest stack is \$/);
    expect(p.notes.join(' ')).toMatch(/Exactly \$50\.00 works if \d+% of the chips go to players/);
    expect(stackOf(p)).toBe(p.stack);
  });
  it('the share it names really makes the exact stack', () => {
    const colours = set(['white', 'red', 'blue'], [200, 150, 100]);
    const p = planChips(input({ colours, players: 7, buyIn: 50 }));
    const pct = Number(/works if (\d+)%/.exec(p.notes.join(' '))![1]);
    const q = planChips(input({ colours, players: 7, buyIn: 50, shareNum: pct, shareDen: 100 }));
    expect(q.status).toBe('exact');
    const r = planChips(input({ colours, players: 7, buyIn: 50, shareNum: pct - 1, shareDen: 100 }));
    expect(r.status).not.toBe('exact');
  });
  it('says so when the chip values cannot add up to the buy-in', () => {
    const p = planChips(input({ colours: set(['a', 'b'], [90, 90], [30, 70]), players: 4, buyIn: 20 }));
    expect(p.status).not.toBe('exact');
    expect(p.stack).toBeLessThan(2000);
  });
  it('is impossible when the nearest stack is under half the buy-in', () => {
    const p = planChips(input({ colours: set(['white', 'red'], [200, 100]), players: 4, buyIn: 10 }));
    expect(p.status).toBe('impossible');
    expect(p.notes.join(' ')).toMatch(/under half/);
  });
  it('is impossible when there are too few chips for everyone', () => {
    const p = planChips(input({ colours: set(['white', 'red'], [20, 10]), players: 8 }));
    expect(p.status).toBe('impossible');
    expect(p.problems[0]).toMatch(/Not enough chips/);
    expect(p.stack).toBe(0);
  });
  it('never hands out more than the bank share allows, in any case', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let n = 0; n < 150; n++) {
      const k = 1 + Math.floor(rnd() * 6);
      const colours = Array.from({ length: k }, (_, i) => ({ name: `c${i}`, count: Math.floor(rnd() * 250), value: rnd() < 0.3 ? niceAt(i * 2 + Math.floor(rnd() * 2)) : null }));
      const players = 1 + Math.floor(rnd() * 10);
      const shareDen = 1 + Math.floor(rnd() * 5);
      const buyIn = 5 * (1 + Math.floor(rnd() * 20));
      const p = planChips(input({ colours, players, buyIn, shareNum: 1, shareDen }));
      if (p.status === 'empty') continue;
      for (const r of p.rows) {
        expect(r.perPlayer).toBeGreaterThanOrEqual(0);
        expect(r.bankLeft).toBeGreaterThanOrEqual(0);
        expect(r.perPlayer * players).toBeLessThanOrEqual(r.count / shareDen + 1e-9);
      }
      if (p.status === 'exact') expect(stackOf(p)).toBe(p.target);
      if (p.status !== 'impossible' && p.rows.length) expect(stackOf(p)).toBe(p.stack);
      expect(p.stack).toBeLessThanOrEqual(p.target);
    }
  });
});

describe('chip plan: bad input', () => {
  it('asks for chips when there are none', () => {
    const p = planChips(input({ colours: [] }));
    expect(p.status).toBe('empty');
    expect(p.problems[0]).toMatch(/Add at least one colour/);
    expect(planChips(input({ colours: set(['a'], [0]) })).status).toBe('empty');
  });
  it('asks for a buy-in and players', () => {
    expect(planChips(input({ buyIn: 0 })).problems.join(' ')).toMatch(/buy-in above 0/);
    expect(planChips(input({ players: 0 })).problems.join(' ')).toMatch(/at least 1 player/);
    expect(planChips(input({ buyIn: NaN })).status).toBe('empty');
  });
  it('wants the colours listed from lowest to highest value', () => {
    const p = planChips(input({ colours: set(['a', 'b'], [100, 100], [50, 25]) }));
    expect(p.status).toBe('impossible');
    expect(p.problems[0]).toMatch(/lowest value to the highest: b \(\$0\.25\) is not worth more than a \(\$0\.50\)/);
  });
  it('ignores colours past the limit', () => {
    const p = planChips(input({ colours: Array.from({ length: 12 }, (_, i) => ({ name: `c${i}`, count: 300, value: null })), players: 2, shareNum: 1, shareDen: 1 }));
    expect(p.rows.length).toBeLessThanOrEqual(MAX_COLOURS);
  });
  it('one player gets a stack and the bank covers many rebuys', () => {
    const p = planChips(input({ players: 1 }));
    expect(p.status).toBe('exact');
    expect(p.rebuys).toBeGreaterThan(5);
  });
  it('uses plain points in messages when no formatter is given', () => {
    const p = planChips(input({ fmt: undefined, colours: set(['white', 'red'], [20, 10]), players: 8 }));
    expect(p.problems[0]).toMatch(/points/);
  });
});
