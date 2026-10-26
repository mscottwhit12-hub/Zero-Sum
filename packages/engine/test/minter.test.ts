import { describe, expect, it } from 'vitest';
import { applyMinterSync, emptyMinter, minterRate, tierCost, MINTER_TIERS } from '../src';

describe('NFT minter', () => {
  it('taps mint 1 each, clamped to a human rate', () => {
    expect(applyMinterSync(emptyMinter(), { taps: 10, buys: [] }, 2, { paused: false, mult: 2 }).state.minted).toBe(10);
    expect(applyMinterSync(emptyMinter(), { taps: 1000, buys: [] }, 2, { paused: false, mult: 2 }).state.minted).toBe(30);
  });
  it('buys in order when affordable; costs grow; passive accrues', () => {
    let s = applyMinterSync(emptyMinter(), { taps: 30, buys: ['laptop', 'laptop'] }, 2, { paused: false, mult: 2 }).state;
    expect(s.tiers.laptop).toBe(1); // 15 then 18 > 15 left
    expect(s.credits).toBe(15);
    expect(tierCost(MINTER_TIERS[0]!, 1)).toBe(18);
    s = applyMinterSync(s, { taps: 0, buys: [] }, 10, { paused: false, mult: 2 }).state;
    expect(s.minted).toBeCloseTo(32); // 0.2/s × 10 s
    expect(minterRate(s.tiers)).toBeCloseTo(0.2);
  });
  it('intermission: 2× minting and the exclusive tier', () => {
    const rich = { ...emptyMinter(), credits: 1000, minted: 1000 };
    expect(applyMinterSync(rich, { taps: 0, buys: ['breakroom'] }, 1, { paused: false, mult: 2 }).rejected).toEqual(['breakroom']);
    const r = applyMinterSync(rich, { taps: 10, buys: ['breakroom'] }, 1, { paused: true, mult: 2 });
    expect(r.state.tiers.breakroom).toBe(1);
    expect(r.state.minted).toBe(1020);
  });
  it('idle accrual is capped', () => {
    const s = { ...emptyMinter(), tiers: { rig: 1 } };
    expect(applyMinterSync(s, { taps: 0, buys: [] }, 99_999, { paused: false, mult: 2 }).state.minted).toBe(600);
  });
});
