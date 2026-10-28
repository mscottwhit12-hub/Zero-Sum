import { describe, expect, it } from 'vitest';
import { applyMinterSync, claimableInvestors, emptyMinter, managerCost, milestoneMult, minterRate, tapValue, tierCost, MINTER_RULES, MINTER_TIERS } from '../src';

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
    s = applyMinterSync(s, { taps: 0, buys: [] }, 5, { paused: false, mult: 2 }).state;
    expect(s.minted).toBeCloseTo(31); // 0.2/s × 5 s (app open: syncs are seconds apart)
    expect(minterRate(s.tiers)).toBeCloseTo(0.2);
  });
  it('intermission: 2× minting and the exclusive tier', () => {
    const rich = { ...emptyMinter(), credits: 1000, minted: 1000 };
    expect(applyMinterSync(rich, { taps: 0, buys: ['breakroom'] }, 1, { paused: false, mult: 2 }).rejected).toEqual(['breakroom']);
    const r = applyMinterSync(rich, { taps: 10, buys: ['breakroom'] }, 1, { paused: true, mult: 2 });
    expect(r.state.tiers.breakroom).toBe(1);
    expect(r.state.minted).toBe(1020);
  });
  it('away from the Minter: only managed generators keep minting, and only up to the idle cap', () => {
    const s = { ...emptyMinter(), tiers: { rig: 1 } };
    expect(applyMinterSync(s, { taps: 0, buys: [] }, 99_999, { paused: false, mult: 2 }).state.minted).toBe(MINTER_RULES.unmanagedSeconds);
    const managed = { ...s, managers: ['rig'] };
    expect(applyMinterSync(managed, { taps: 0, buys: [] }, 99_999, { paused: false, mult: 2 }).state.minted).toBe(600);
  });
  it('milestones double a generator at 10/25/50/100/200 owned', () => {
    expect(milestoneMult(9)).toBe(1);
    expect(milestoneMult(10)).toBe(2);
    expect(milestoneMult(50)).toBe(8);
    expect(minterRate({ ...emptyMinter(), tiers: { laptop: 10 } })).toBeCloseTo(0.2 * 10 * 2);
  });
  it('upgrades: overclock ×3 a generator, mouse ×2 taps; once each', () => {
    const rich = { ...emptyMinter(), credits: 10_000, tiers: { laptop: 1 } };
    const r = applyMinterSync(rich, { taps: 0, buys: ['up:mouse', 'up:mouse', 'up:oc-laptop'] }, 0, { paused: false, mult: 1 });
    expect(r.state.upgrades).toEqual(['mouse', 'oc-laptop']);
    expect(r.rejected).toEqual(['up:mouse']);
    expect(tapValue(r.state)).toBe(2);
    expect(minterRate(r.state)).toBeCloseTo(0.6);
  });
  it('managers need the generator first and cost a multiple of its base price', () => {
    const rig = MINTER_TIERS.find((t) => t.id === 'rig')!;
    const s = { ...emptyMinter(), credits: managerCost(rig) * 2 };
    expect(applyMinterSync(s, { taps: 0, buys: ['mgr:rig'] }, 0, { paused: false, mult: 1 }).rejected).toEqual(['mgr:rig']);
    const r = applyMinterSync({ ...s, tiers: { rig: 1 } }, { taps: 0, buys: ['mgr:rig'] }, 0, { paused: false, mult: 1 });
    expect(r.state.managers).toEqual(['rig']);
    expect(r.state.credits).toBe(managerCost(rig));
  });
  it('rebrand: resets the run for investors; lifetime minted (leaderboard) stays', () => {
    const s = { ...emptyMinter(), minted: 20_000, credits: 5_000, tiers: { rig: 4 }, upgrades: ['mouse'], managers: ['rig'] };
    expect(claimableInvestors(s)).toBe(3); // sqrt(20000/2000) = 3.16
    const r = applyMinterSync(s, { taps: 0, buys: ['rebrand'] }, 0, { paused: false, mult: 1 });
    expect(r.state).toMatchObject({ minted: 20_000, credits: 0, tiers: {}, upgrades: [], managers: [], investors: 3, rebrands: 1 });
    expect(tapValue(r.state)).toBeCloseTo(1 + 3 * MINTER_RULES.investorBonus);
    expect(applyMinterSync(r.state, { taps: 0, buys: ['rebrand'] }, 0, { paused: false, mult: 1 }).rejected).toEqual(['rebrand']); // nothing new to claim
  });
});
