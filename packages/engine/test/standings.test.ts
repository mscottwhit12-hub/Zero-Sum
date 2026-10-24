import { describe, expect, it } from 'vitest';
import { computeStandings, deriveLedger, formatGold, leaders, toH, type LedgerInput } from '../src';
import { spec } from './fixtures';

// Worked examples use the original spec values (game gold ×1).
const x1 = spec;

const S = x1();

const base: LedgerInput = {
  players: [
    { id: 'a', gotStake: true },
    { id: 'b', gotStake: true },
    { id: 'late', gotStake: false },
  ],
  results: [
    {
      id: 'g1',
      mode: 'competitive',
      actualHours: 1,
      participants: [
        { playerId: 'a', placement: 1 },
        { playerId: 'b', placement: 2 },
      ],
    },
  ],
  adjustments: [{ playerId: 'late', goldH: 1500 }], // frozen late-join stake (system adjustment)
  bounties: [{ playerId: 'b', goldH: 200 }],
  achievements: [{ playerId: 'a', goldH: 200 }],
  tradeFlows: [{ playerId: 'a', cashH: -1000 }],
};

describe('ledger', () => {
  it('earned = stake + results + adjustments + bounties + achievements; trades excluded (locked #1)', () => {
    const l = deriveLedger(base, S);
    const a = l.get('a')!;
    expect(a.stakeH).toBe(2000);
    expect(a.resultsH).toBe(200); // 1h × 2 × 1.0
    expect(a.earnedH).toBe(2000 + 200 + 200);
    expect(a.cashH).toBe(2400 - 1000);
    expect(l.get('b')!.earnedH).toBe(2000 + 100 + 200);
    expect(l.get('late')!.earnedH).toBe(1500);
  });

  it('buying does not change earned gold (no invest penalty on own fair)', () => {
    const without = deriveLedger({ ...base, tradeFlows: [] }, S).get('a')!.earnedH;
    expect(deriveLedger(base, S).get('a')!.earnedH).toBe(without);
  });

  it('live settings change re-derives results but the frozen late-join stake stays put', () => {
    const s2 = x1({ stake: { startingGold: 30 }, scoring: { placementMults: [2, 1] } });
    const l = deriveLedger(base, s2);
    expect(l.get('a')!.resultsH).toBe(400);
    expect(l.get('a')!.stakeH).toBe(3000);
    expect(l.get('late')!.earnedH).toBe(1500);
  });
});

describe('standings', () => {
  it('ranks by net worth = cash + sell value of holdings', () => {
    const l = deriveLedger(base, S);
    // a: cash 14.00 + 0.40 shares × 50 = 20.00 → 34.00; b: 23.00; late: 15.00
    const st = computeStandings(l, [{ playerId: 'a', securityId: 'x', sharesH: 40 }], new Map([['x', 50]]), S);
    expect(st.map((r) => [r.playerId, r.netWorthH, r.rank])).toEqual([
      ['a', 3400, 1],
      ['b', 2300, 2],
      ['late', 1500, 3],
    ]);
    expect(leaders(st)).toEqual(['a']);
  });

  it('net worth uses sell value net of fee', () => {
    const s = x1({ market: { feeFrac: 0.1 } });
    const l = deriveLedger(base, s);
    const st = computeStandings(l, [{ playerId: 'a', securityId: 'x', sharesH: 40 }], new Map([['x', 50]]), s);
    expect(st.find((r) => r.playerId === 'a')!.holdingsH).toBe(1800);
  });

  it('ties share rank', () => {
    const l = deriveLedger({ ...base, results: [], bounties: [], achievements: [], tradeFlows: [], adjustments: [] }, S);
    const st = computeStandings(l, [], new Map(), S);
    expect(st.map((r) => r.rank)).toEqual([1, 1, 3]);
  });
});

describe('money', () => {
  it('display to 1 decimal', () => {
    expect(formatGold(toH(12.34))).toBe('12.3');
    expect(formatGold(1255)).toBe('12.6');
  });
});
