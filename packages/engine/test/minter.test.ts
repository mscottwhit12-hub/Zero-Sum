import { describe, expect, it } from 'vitest';
import { advanceMinter, applyMinterSync, boostMinter, claimableInvestors, cycleTime, emptyMinter, MINTER_RULES, MINTER_TIERS, minterRate, tierCost, type MinterState } from '../src';

const live = { active: true };
const T = (id: string) => MINTER_TIERS.find((t) => t.id === id)!;
const rich = (credits: number, extra: Partial<MinterState> = {}): MinterState => ({ ...emptyMinter(), credits, ...extra });

describe('NFT minter (Adventure Capitalist style)', () => {
  it('starts with one Laptop, idle until tapped; a tap runs one cycle that pays when it fills', () => {
    let s = emptyMinter();
    expect(s.tiers).toEqual({ laptop: 1 });
    expect(advanceMinter(s, 10).credits).toBe(0); // idle
    s = applyMinterSync(s, { buys: ['run:laptop'] }, 0, live).state;
    expect(s.prog).toEqual({ laptop: 0 });
    expect(applyMinterSync(s, { buys: ['run:laptop'] }, 0.5, live).rejected).toEqual(['run:laptop']); // already running
    s = advanceMinter(s, 5);
    expect(s.credits).toBe(1); // one cycle only
    expect(s.prog).toEqual({});
  });

  it('more units pay more per cycle; prices grow; the next business unlocks when affordable', () => {
    let s = rich(100);
    s = applyMinterSync(s, { buys: ['laptop', 'laptop', 'rig', 'quantum'] }, 0, live).state;
    expect(s.tiers).toEqual({ laptop: 3, rig: 1 });
    expect(s.credits).toBeCloseTo(100 - tierCost(T('laptop'), 1) - tierCost(T('laptop'), 2) - 60);
    s = applyMinterSync(s, { buys: ['run:laptop', 'run:rig'] }, 0, live).state;
    s = advanceMinter(s, 3);
    expect(s.credits).toBeCloseTo(100 - tierCost(T('laptop'), 1) - tierCost(T('laptop'), 2) - 60 + 3 + 60);
  });

  it('milestones halve the cycle time at 25/50/100…', () => {
    expect(cycleTime(T('rig'), 24)).toBe(3);
    expect(cycleTime(T('rig'), 25)).toBe(1.5);
    expect(cycleTime(T('rig'), 50)).toBe(0.75);
  });

  it('managers run a business nonstop (any amount of time) and need the business first', () => {
    expect(applyMinterSync(rich(1e6), { buys: ['mgr:rig'] }, 0, live).rejected).toEqual(['mgr:rig']);
    let s = applyMinterSync(rich(1000), { buys: ['mgr:laptop'] }, 0, live).state;
    expect(s.credits).toBe(0);
    expect(minterRate(s)).toBe(1);
    s = advanceMinter(s, 3600);
    expect(s.credits).toBe(3600);
    expect(applyMinterSync(s, { buys: ['run:laptop'] }, 0, live).rejected).toEqual(['run:laptop']);
  });

  it('paused or over: nothing advances and nothing can be bought', () => {
    const s = applyMinterSync(rich(1000, { managers: ['laptop'] }), { buys: ['laptop'] }, 600, { active: false });
    expect(s.state.credits).toBe(1000);
    expect(s.rejected).toEqual(['laptop']);
  });

  it('overclock ×3 a business once', () => {
    let s = rich(5000 + 5000, { managers: ['laptop'] });
    s = applyMinterSync(s, { buys: ['up:oc-laptop', 'up:oc-laptop'] }, 0, live).state;
    expect(s.upgrades).toEqual(['oc-laptop']);
    expect(minterRate(s)).toBe(3);
  });

  it('boost: ×10 for 5 minutes of clock, then normal; stacks in time', () => {
    let s = boostMinter(rich(0, { managers: ['laptop'] }));
    expect(s.boost).toBe(MINTER_RULES.boostSeconds);
    s = advanceMinter(s, 400);
    expect(s.credits).toBe(300 * 10 + 100);
    expect(s.boost).toBe(0);
    expect(boostMinter(boostMinter(emptyMinter())).boost).toBe(600);
    // A tapped cycle finishing inside the boost pays ×10.
    const t = advanceMinter(boostMinter(applyMinterSync(emptyMinter(), { buys: ['run:laptop'] }, 0, live).state), 2);
    expect(t.credits).toBe(10);
  });

  it('rebrand: resets to one Laptop for investors; lifetime minted stays', () => {
    const s = rich(5, { minted: MINTER_RULES.investorUnit * 4, tiers: { laptop: 30, rig: 5 }, managers: ['laptop'] });
    expect(claimableInvestors(s)).toBe(2);
    const r = applyMinterSync(s, { buys: ['rebrand'] }, 0, live).state;
    expect(r).toMatchObject({ credits: 0, tiers: { laptop: 1 }, managers: [], investors: 2, rebrands: 1, minted: MINTER_RULES.investorUnit * 4 });
    expect(applyMinterSync(r, { buys: ['rebrand'] }, 0, live).rejected).toEqual(['rebrand']);
  });
});
