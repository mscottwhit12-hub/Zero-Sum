import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings';
import { liveLevels } from '../src/market/live';

const S = DEFAULT_SETTINGS;
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe('liveLevels', () => {
  it('is empty under 2 scored players', () => expect(liveLevels(new Map([['a', 5]]), false, S).size).toBe(0));
  it('2 players: leader up, other down, zero-sum', () => {
    const m = liveLevels(new Map([['a', 5], ['b', 3]]), false, S);
    expect(m.get('a')).toBeCloseTo(S.market.player.liveMax);
    expect(sum(m)).toBeCloseTo(0);
  });
  it('8 players: top 4 taper, middle 2 zero, bottom 2 negative (last worst), zero-sum', () => {
    const m = liveLevels(new Map(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k, i) => [k, 80 - i * 10])), false, S);
    const v = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => m.get(k)!);
    expect(v[0]).toBeGreaterThan(v[1]!);
    expect(v[3]).toBeGreaterThan(0);
    expect(v[4]).toBe(0);
    expect(v[5]).toBe(0);
    expect(v[7]).toBeLessThan(v[6]!);
    expect(v[6]).toBeLessThan(0);
    expect(sum(m)).toBeCloseTo(0);
  });
  it('lower-is-better flips the order', () => {
    const m = liveLevels(new Map([['a', 5], ['b', 3]]), true, S);
    expect(m.get('b')!).toBeGreaterThan(0);
  });
  it('ties share their places', () => {
    const m = liveLevels(new Map([['a', 5], ['b', 5], ['c', 1], ['d', 0]]), false, S);
    expect(m.get('a')).toBeCloseTo(m.get('b')!);
    expect(sum(m)).toBeCloseTo(0);
  });
});
