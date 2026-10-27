import { describe, expect, it } from 'vitest';
import { loopIntervalMs, parseTimeScale, scaledClock } from '../src/timeScale';

describe('test-only time scale', () => {
  it('parses', () => {
    expect(parseTimeScale(undefined)).toBe(1);
    expect(parseTimeScale('')).toBe(1);
    expect(parseTimeScale('60')).toBe(60);
    expect(() => parseTimeScale('0.5')).toThrow();
    expect(() => parseTimeScale('abc')).toThrow();
  });
  it('scales from the anchor', () => {
    let real = 1_000_000;
    const now = scaledClock(60, () => real);
    expect(now()).toBe(1_000_000);
    real += 1000;
    expect(now()).toBe(1_060_000);
    real += 8 * 60_000;
    expect(now() - 1_000_000).toBe(8 * 60 * 60_000 + 60_000); // 8 real min = 8 game h (+ the first minute)
  });
  it('scale 1 is the real clock; loop interval floors at 50 ms', () => {
    const real = () => 42;
    expect(scaledClock(1, real)).toBe(real);
    expect(loopIntervalMs(1)).toBe(1000);
    expect(loopIntervalMs(60)).toBe(50);
    expect(loopIntervalMs(10)).toBe(100);
  });
});
