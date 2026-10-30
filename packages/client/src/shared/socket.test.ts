import { describe, expect, it } from 'vitest';
import { secondsToNextTick } from './socket';

const live = { status: 'live', tradingClosed: false, lastTickAt: 100_000, tickSeconds: 20 };

describe('secondsToNextTick', () => {
  it('counts down from the last tick using the GM tick setting', () => {
    expect(secondsToNextTick(live, 100_000)).toBe(20);
    expect(secondsToNextTick(live, 105_000)).toBe(15);
    expect(secondsToNextTick(live, 105_001)).toBe(15); // rounds up: never shows 0 before the tick is due
    expect(secondsToNextTick({ ...live, tickSeconds: 15 }, 105_000)).toBe(10);
    expect(secondsToNextTick({ ...live, tickSeconds: 30 }, 105_000)).toBe(25);
  });
  it('stops at 0 when a tick is a moment late', () => {
    expect(secondsToNextTick(live, 120_000)).toBe(0);
    expect(secondsToNextTick(live, 130_000)).toBe(0);
  });
  it('is hidden when ticks are not running', () => {
    expect(secondsToNextTick({ ...live, status: 'paused' }, 105_000)).toBeNull();
    expect(secondsToNextTick({ ...live, status: 'ended' }, 105_000)).toBeNull();
    expect(secondsToNextTick({ ...live, tradingClosed: true }, 105_000)).toBeNull();
    expect(secondsToNextTick({ ...live, lastTickAt: null }, 105_000)).toBeNull();
    expect(secondsToNextTick(null, 105_000)).toBeNull();
  });
});
