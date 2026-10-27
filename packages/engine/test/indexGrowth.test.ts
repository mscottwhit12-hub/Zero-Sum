import { describe, expect, it } from 'vitest';
import { createRng, expectedGameGoldH, indexExtra, resolveSettings, tickCrypto, tickIndex } from '../src';

const S = resolveSettings({});

describe('index growth', () => {
  it('expected gold: 4p 1.5h Catan = 1.5×4×3×1.925 = 34.65 gold', () => expect(expectedGameGoldH(4, 4, 1.5, S)).toBe(3465));
  it('start drop ≈ 0.5 for Catan, ≈ 2.7 for 6p 4h Risk (linear curve) (10 night players)', () => {
    expect(indexExtra([{ status: 'active', players: 4, plannedHours: 1.5, elapsedHours: 0 }], 10, S).drop).toBeCloseTo(0.52, 2);
    expect(indexExtra([{ status: 'active', players: 6, plannedHours: 4, elapsedHours: 0 }], 10, S).drop).toBeCloseTo(2.7, 2);
  });
  it('growth: 30 gold per player ≈ +6.9; drop returned at the end', () => {
    const fin = indexExtra([{ status: 'final', players: 10, plannedHours: 1, elapsedHours: 1, paidH: 30000 }], 10, S);
    expect(fin).toEqual({ growth: 6.9, drop: 0, extra: 6.9 });
  });
  it('wobble stays small and mean-reverting; extra lifts the target', () => {
    const rng = createRng(1);
    let sec = { id: 'index', kind: 'index' as const, ticker: 'IDX', price: 55, gmOffset: 0 };
    const seen: number[] = [];
    for (let i = 0; i < 2000; i++) {
      sec = tickIndex(sec, [55, 55], S, 5, rng).sec as typeof sec;
      seen.push(sec.price);
    }
    const tail = seen.slice(200);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    expect(mean).toBeGreaterThan(59);
    expect(mean).toBeLessThan(61);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(60 * 0.1);
  });
});

describe('crypto downward trend', () => {
  it('holding all night loses on average; volatility unchanged', () => {
    let total = 0;
    const runs = 300;
    for (let r = 0; r < runs; r++) {
      const rng = createRng(1000 + r);
      let sec = { id: 'crypto', kind: 'crypto' as const, ticker: 'COIN', price: 41.25, baseline: 41.25, gmOffset: 0 };
      for (let t = 0; t < 1350; t++) sec = tickCrypto(sec, [], S, rng).sec as typeof sec;
      total += sec.price / 41.25;
    }
    expect(total / runs).toBeLessThan(0.9);
  });
});
