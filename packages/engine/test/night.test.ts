import { describe, expect, it } from 'vitest';
import {
  ballotWeight,
  centeredMood,
  computeStandings,
  DEFAULT_SETTINGS,
  DUMMY_ACHIEVEMENTS,
  EMPTY_CROWN,
  endNight,
  evaluateAchievements,
  lateJoinStakeH,
  lateJoinStartPrice,
  moodBias,
  moodBiasMap,
  nightClockMs,
  quarterAt,
  quarterSchedule,
  rankBy,
  resolveQuarter,
  resolveSettings,
  tapLeader,
  tradingClosePromptAt,
  validateSettings,
  voteDrift,
  type GameResult,
  type StandingRow,
} from '../src';

const S = resolveSettings();
const MIN = 60_000;

describe('settings', () => {
  it('defaults are valid', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
  });
  it('partial override merges deeply; arrays replace', () => {
    const s = resolveSettings({ market: { bands: { crypto: { min: 2, max: 200 } } }, scoring: { placementMults: [1] } });
    expect(s.market.bands.crypto).toEqual({ min: 2, max: 200 });
    expect(s.market.bands.player).toEqual({ min: 30, max: 80 });
    expect(s.scoring.placementMults).toEqual([1]);
    expect(DEFAULT_SETTINGS.scoring.placementMults).toEqual([1, 0.5, 0.25]);
  });
  it('flags invalid values', () => {
    const s = resolveSettings({ market: { bands: { dead: { min: 40, max: 1 } }, tickSeconds: 5 }, votes: { quarterCount: 0 } });
    expect(validateSettings(s).map((i) => i.path)).toEqual(['market.tickSeconds', 'market.bands.dead', 'votes.quarterCount']);
  });
});

describe('night clock (paused time excluded)', () => {
  it('100 min wall, closed 10-min pause + open pause since 90 → 80 min', () => {
    expect(
      nightClockMs(0, 100 * MIN, [
        { start: 10 * MIN, end: 20 * MIN },
        { start: 90 * MIN, end: null },
      ]),
    ).toBe(80 * MIN);
  });
});

describe('quarters (locked #7)', () => {
  it('5h, 4 quarters: 30-min buffers, four 60-min quarters, 5-min windows', () => {
    const q = quarterSchedule(300, S.votes);
    expect(q.map((x) => [x.n, x.startMin, x.endMin, x.windowEndMin])).toEqual([
      [1, 30, 90, 35],
      [2, 90, 150, 95],
      [3, 150, 210, 155],
      [4, 210, 270, 215],
    ]);
  });
  it('GM picks 3 quarters: 80-min quarters', () => {
    const q = quarterSchedule(300, { ...S.votes, quarterCount: 3 });
    expect(q.map((x) => [x.startMin, x.endMin])).toEqual([
      [30, 110],
      [110, 190],
      [190, 270],
    ]);
  });
  it('phases', () => {
    const q = quarterSchedule(300, S.votes);
    expect(quarterAt(q, 10).phase).toBe('pre');
    expect(quarterAt(q, 32)).toMatchObject({ phase: 'window', quarter: { n: 1 } });
    expect(quarterAt(q, 40)).toMatchObject({ phase: 'drift', quarter: { n: 1 } });
    expect(quarterAt(q, 90)).toMatchObject({ phase: 'window', quarter: { n: 2 } });
    expect(quarterAt(q, 280).phase).toBe('post');
  });
  it('trading-close prompt 15 min before the last planned end', () => {
    expect(tradingClosePromptAt(270, S)).toBe(255);
  });
});

describe('votes', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const ballots = [
    { voterId: 'a', targetId: 'b', weight: 1 },
    { voterId: 'c', targetId: 'b', weight: 1 },
    { voterId: 'b', targetId: 'b', weight: 1 }, // self-vote counts
    { voterId: 'd', targetId: 'a', weight: 1 },
    { voterId: 'd', targetId: 'd', weight: 1 }, // last ballot wins
  ];
  it('drift = 0.15 × (share − 1/N)', () => {
    const d = voteDrift(ballots, ids, S);
    expect(d.get('b')).toBeCloseTo(0.15 * (0.75 - 0.25));
    expect(d.get('d')).toBeCloseTo(0);
    expect(d.get('a')).toBeCloseTo(-0.0375);
    expect(d.get('c')).toBeCloseTo(-0.0375);
  });
  it('no ballots → no drift', () => {
    expect([...voteDrift([], ids, S).values()]).toEqual([0, 0, 0, 0]);
  });
  it('net-worth weighting', () => {
    expect(ballotWeight(2500, resolveSettings({ votes: { weighting: 'netWorth' } }))).toBe(25);
    expect(ballotWeight(2500, S)).toBe(1);
  });
  const st = (nw: Record<string, number>): StandingRow[] =>
    rankBy(
      Object.entries(nw).map(([playerId, netWorthH]) => ({ playerId, netWorthH, cashH: netWorthH, holdingsH: 0, rank: 0 })),
      (r) => r.netWorthH,
    );
  it('bounty pays voters who picked the net-worth leader', () => {
    const r = resolveQuarter(ballots, st({ a: 1000, b: 3000, c: 2000, d: 500 }), S);
    expect(r.winners).toEqual(['b']);
    expect(r.payouts.map((p) => p.playerId).sort()).toEqual(['a', 'b', 'c']);
    expect(r.payouts[0]!.goldH).toBe(200);
  });
  it('tied leaders both count; top 2 counts at ≥16 players', () => {
    expect(resolveQuarter(ballots, st({ a: 1000, b: 3000, c: 2000, d: 3000 }), S).winners.sort()).toEqual(['b', 'd']);
    const s = resolveSettings({ votes: { topTwoMinPlayers: 4 } });
    const r = resolveQuarter(ballots, st({ a: 1000, b: 3000, c: 2000, d: 500 }), s);
    expect(r.winners).toEqual(['b', 'c']);
  });
});

describe('mood', () => {
  it('centered average', () => {
    expect(centeredMood(5, 5)).toBe(1);
    expect(centeredMood(1, 1)).toBe(-1);
    expect(centeredMood(4, 2)).toBe(0);
    expect(centeredMood(5, 3)).toBe(0.5);
  });
  it('bias = 0.06 × centered, decays 1%/tick', () => {
    const r = { playerId: 'a', mood: 5, selfAssessment: 5, tick: 0 };
    expect(moodBias(r, 0, S)).toBeCloseTo(0.06);
    expect(moodBias(r, 10, S)).toBeCloseTo(0.06 * 0.99 ** 10);
    expect(moodBias(undefined, 10, S)).toBe(0);
  });
  it('latest reading wins', () => {
    const m = moodBiasMap(
      [
        { playerId: 'a', mood: 5, selfAssessment: 5, tick: 0 },
        { playerId: 'a', mood: 1, selfAssessment: 1, tick: 5 },
      ],
      5,
      S,
    );
    expect(m.get('a')).toBeCloseTo(-0.06);
  });
});

describe('kingfall', () => {
  it('dethrone after <15 min = no kingfall; after ≥15 min = kingfall', () => {
    let t = tapLeader(EMPTY_CROWN, 'a', 0, S);
    expect(t).toMatchObject({ dethroned: null, kingfall: false });
    t = tapLeader(t.state, 'b', 10 * MIN, S);
    expect(t).toMatchObject({ dethroned: { from: 'a', to: 'b' }, kingfall: false });
    const same = tapLeader(t.state, 'b', 20 * MIN, S);
    expect(same.state.since).toBe(10 * MIN);
    t = tapLeader(t.state, 'c', 25 * MIN, S);
    expect(t).toMatchObject({ dethroned: { from: 'b', to: 'c' }, kingfall: true });
  });
});

describe('late joiner (locked #4)', () => {
  it('stake = 0.75 × avg earned − 2, frozen value', () => {
    expect(lateJoinStakeH([2000, 3000, 4000], S)).toBe(2050);
    expect(lateJoinStakeH([100], S)).toBe(0);
  });
  it('stock = avg player price − 0.05 band', () => {
    expect(lateJoinStartPrice([50, 60], S)).toBe(52.5);
    expect(lateJoinStartPrice([30, 30], S)).toBe(30);
  });
});

describe('achievements', () => {
  const win = (id: string, w: string, others: string[]): GameResult => ({
    id,
    mode: 'competitive',
    actualHours: 1,
    participants: [{ playerId: w, placement: 1 }, ...others.map((o, i) => ({ playerId: o, placement: i + 2 }))],
  });
  it('first_blood once per night; hat_trick at 3 wins; regular at 4 games; oracle gold hidden', () => {
    const results = [win('1', 'a', ['b']), win('2', 'b', ['a']), win('3', 'a', ['b']), win('4', 'a', ['b'])];
    const first = evaluateAchievements({ results: results.slice(0, 1), correctVotes: new Map(), awarded: new Set() }, DUMMY_ACHIEVEMENTS, S);
    expect(first.map((a) => `${a.achievementId}:${a.playerId}`)).toEqual(['first_blood:a']);
    const all = evaluateAchievements(
      { results, correctVotes: new Map([['c', 2]]), awarded: new Set(['first_blood:a']) },
      DUMMY_ACHIEVEMENTS,
      S,
    );
    expect(all.map((a) => `${a.achievementId}:${a.playerId}`)).toEqual(['hat_trick:a', 'regular:a', 'regular:b', 'oracle:c']);
    expect(all.find((a) => a.achievementId === 'oracle')).toMatchObject({ goldHidden: true, goldH: 100 });
    expect(all.find((a) => a.achievementId === 'hat_trick')).toMatchObject({ goldHidden: false, goldH: 500 });
  });
});

describe('end night (locked #3)', () => {
  it('force-resolves the open quarter on net worth BEFORE auto-sell, then podium by gold', () => {
    const r = endNight(
      {
        ledger: {
          players: [
            { id: 'a', gotStake: true },
            { id: 'b', gotStake: true },
          ],
          results: [],
          adjustments: [{ playerId: 'b', goldH: 500 }],
          bounties: [],
          achievements: [],
          tradeFlows: [{ playerId: 'a', cashH: -1000 }],
        },
        // a: cash 10.00 + 0.40 sh × 50 = 30.00 net worth; b: 25.00 cash
        lots: [{ id: 'l', playerId: 'a', securityId: 'crypto', sharesH: 40, costBasisH: 1000, createdAt: 0, unlockAt: 1e12 }],
        securities: [{ id: 'crypto', kind: 'crypto', ticker: 'COIN', price: 50, gmOffset: 0 }],
        activePlayerIds: ['a', 'b'],
        openQuarter: { ballots: [{ voterId: 'b', targetId: 'a', weight: 1 }] },
      },
      S,
    );
    expect(r.quarter!.winners).toEqual(['a']);
    expect(r.quarter!.payouts).toEqual([{ playerId: 'b', goldH: 200 }]);
    expect(r.liquidations[0]).toMatchObject({ cashH: 2000, forced: true });
    expect(r.podium.map((p) => [p.playerId, p.goldH, p.rank])).toEqual([
      ['a', 3000, 1],
      ['b', 2700, 2],
    ]);
  });

  it('no open quarter → just liquidate', () => {
    const r = endNight(
      {
        ledger: { players: [{ id: 'a', gotStake: true }], results: [], adjustments: [], bounties: [], achievements: [], tradeFlows: [] },
        lots: [],
        securities: [],
        activePlayerIds: ['a'],
        openQuarter: null,
      },
      S,
    );
    expect(r.quarter).toBeNull();
    expect(r.podium[0]!.goldH).toBe(2000);
  });
});

describe('standings sanity', () => {
  it('computeStandings throws on unknown price', () => {
    expect(() =>
      computeStandings(new Map(), [{ playerId: 'a', securityId: 'zz', sharesH: 1 }], new Map(), S),
    ).toThrow(/no price/);
  });
});
