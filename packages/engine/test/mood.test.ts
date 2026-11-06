import { describe, expect, it } from 'vitest';
import { createRng, createSecurities, DEFAULT_SETTINGS, drawNoise, moodBias, moodJitter, tickMarket, type MoodReading } from '../src';

const S = DEFAULT_SETTINGS;
const read = (mood: number, self: number, tick = 0): MoodReading => ({ playerId: '1', mood, selfAssessment: self, tick });

describe('mood rework: GM reported mood → jitter, reported mood → push', () => {
  it('push comes from reported mood only (±10% of the band)', () => {
    expect(moodBias(read(1, 3), 0, S)).toBe(0);
    expect(moodBias(read(5, 5), 0, S)).toBeCloseTo(0.1);
    expect(moodBias(read(1, 1), 0, S)).toBeCloseTo(-0.1);
  });
  it('jitter: ±3 at most upset, background ±0.30 when calm or unrated, fading back', () => {
    expect(moodJitter(undefined, 0, S)).toBeCloseTo(0.3);
    expect(moodJitter(read(5, 1), 0, S)).toBeCloseTo(0.3);
    expect(moodJitter(read(1, 5), 0, S)).toBeCloseTo(3);
    expect(moodJitter(read(3, 3), 0, S)).toBeCloseTo(0.91, 1);
    expect(moodJitter(read(4, 3), 0, S)).toBeCloseTo(0.44, 1);
    const later = moodJitter(read(1, 3, 0), 100, S);
    expect(later).toBeLessThan(1.5);
    expect(later).toBeGreaterThan(0.3);
  });
  it('noise mostly stays within its ± size', () => {
    const rng = createRng(7);
    let drift = 0;
    const xs: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const n = drawNoise(drift, 0.3, S, rng);
      drift = n.drift;
      xs.push(n.nz);
    }
    const sd = Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length);
    expect(sd).toBeGreaterThan(0.12);
    expect(sd).toBeLessThan(0.18);
  });
  it('every stock gets noise; an upset player jitters more; models run on the noise-free price', () => {
    const secs = createSecurities({ players: [{ id: '1', ticker: 'AAA' }, { id: '2', ticker: 'BBB' }] }, S);
    let cur = secs;
    const dev = { a: 0, b: 0 };
    const rng = createRng(3);
    for (let t = 0; t < 300; t++) {
      const r = tickMarket(cur, { earned: [{ playerId: '1', earnedH: 0 }, { playerId: '2', earnedH: 0 }], drift: new Map(), mood: new Map(), impulses: [], jitter: new Map([['1', 3]]) }, S, rng);
      cur = r.securities;
      for (const rec of r.records) expect(rec.causes.noise).not.toBeUndefined();
      dev.a += Math.abs(cur.find((s) => s.playerId === '1')!.nz ?? 0);
      dev.b += Math.abs(cur.find((s) => s.playerId === '2')!.nz ?? 0);
    }
    expect(dev.a / 300).toBeGreaterThan(0.6);
    expect(dev.b / 300).toBeLessThan(0.2);
    // price = model price + nz, and the next tick starts from the model price
    const p1 = cur.find((s) => s.playerId === '1')!;
    expect(Math.abs(p1.price - 55)).toBeLessThan(6);
  });
});
