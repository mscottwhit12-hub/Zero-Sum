import { describe, expect, it } from 'vitest';
import {
  computeFair,
  createRng,
  createSecurities,
  espionageImpulses,
  kingfallImpulse,
  rerollImpulse,
  resolveSettings,
  tickCrypto,
  tickDead,
  tickEvent,
  tickIndex,
  tickMarket,
  tickPlayer,
  tradeImpulse,
  type Rng,
  type SecurityState,
} from '../src';

const S = resolveSettings();
const band = S.market.bands.player; // 30–80

const player = (price: number, extra: Partial<SecurityState> = {}): SecurityState => ({
  id: 'p:a',
  kind: 'player',
  ticker: 'AAA',
  playerId: 'a',
  price,
  gmOffset: 0,
  ...extra,
});
const zeroRng: Rng = { next: () => 0.5, normal: () => 0, int: (a) => a, pick: (x) => x[0]! };

describe('rank-based fair', () => {
  const e = (id: string, g: number) => ({ playerId: id, earnedH: g });
  it('5 distinct ranks spread over 15–85% of 30–80', () => {
    const f = computeFair([e('a', 500), e('b', 400), e('c', 300), e('d', 200), e('e', 100)], band, 0.15, 0.85);
    expect(f.get('a')).toBeCloseTo(72.5);
    expect(f.get('b')).toBeCloseTo(63.75);
    expect(f.get('c')).toBeCloseTo(55);
    expect(f.get('e')).toBeCloseTo(37.5);
  });
  it('ties share the average rank', () => {
    const f = computeFair([e('a', 500), e('b', 500), e('c', 300), e('d', 200), e('e', 100)], band, 0.15, 0.85);
    // avg rank 1.5 → .85 − .5/4 × .7 = .7625 → 68.125
    expect(f.get('a')).toBeCloseTo(68.125);
    expect(f.get('b')).toBeCloseTo(68.125);
  });
  it('all tied or one player → band midpoint', () => {
    expect(computeFair([e('a', 1), e('b', 1)], band, 0.15, 0.85).get('a')).toBe(55);
    expect(computeFair([e('a', 1)], band, 0.15, 0.85).get('a')).toBe(55);
    expect(computeFair([e('a', 1), e('b', 1)], band, 0.1, 0.6).get('a')).toBe(55);
  });
});

describe('player tick', () => {
  const none = { drift: 0, mood: 0, impulses: [] };
  it('reverts 10% toward target: 55 → 56.75 when fair 72.5', () => {
    expect(tickPlayer(player(55), { ...none, fair: 72.5 }, S).sec.price).toBeCloseTo(56.75);
  });
  it('target terms are additive in band units', () => {
    // offset .1 band = +5 → target 77.5 → 55 + 2.25
    const r = tickPlayer(player(55, { gmOffset: 0.1 }), { ...none, fair: 72.5 }, S);
    expect(r.record.target).toBeCloseTo(77.5);
    expect(r.sec.price).toBeCloseTo(57.25);
    // drift −.05 and mood +.02 → net −.03 = −1.5
    const r2 = tickPlayer(player(55), { fair: 55, drift: -0.05, mood: 0.02, impulses: [] }, S);
    expect(r2.record.target).toBeCloseTo(53.5);
  });
  it('trade impulse applies multiplicatively after reversion', () => {
    const imp = tradeImpulse(player(55), 'buy', S)!;
    expect(imp.frac).toBe(0.02);
    expect(tickPlayer(player(55), { ...none, fair: 72.5, impulses: [imp] }, S).sec.price).toBeCloseTo(57.885);
  });
  it('clamps change to 30% then to band', () => {
    const big = [{ securityId: 'p:a', frac: 0.5, cause: 'trade_buy' as const }];
    const r = tickPlayer(player(50), { ...none, fair: 50, impulses: big }, S);
    expect(r.sec.price).toBe(65);
    expect(r.record.causes.clampedChange).toBe(true);
    const r2 = tickPlayer(player(79), { ...none, fair: 79, impulses: [{ securityId: 'p:a', frac: 0.05, cause: 'trade_buy' }] }, S);
    expect(r2.sec.price).toBe(80);
    expect(r2.record.causes.clampedBand).toBe(true);
  });
  it('leaver fair decays 2% of the gap to band min per tick', () => {
    const r = tickPlayer(player(60, { left: true, lastFair: 60 }), { ...none, fair: undefined }, S);
    expect(r.record.fair).toBeCloseTo(59.4);
    expect(r.sec.leaverFair).toBeCloseTo(59.4);
    const r2 = tickPlayer(r.sec, { ...none, fair: undefined }, S);
    expect(r2.record.fair).toBeCloseTo(59.4 - 0.02 * 29.4);
  });
});

describe('index', () => {
  it('smooths toward the average player price × scale; never impacted', () => {
    const idx: SecurityState = { id: 'index', kind: 'index', ticker: 'IDX', price: 50, gmOffset: 0 };
    expect(tickIndex(idx, [50, 60], S).sec.price).toBeCloseTo(51.5);
    expect(tradeImpulse(idx, 'buy', S)).toBeNull();
  });
});

describe('crypto', () => {
  const c: SecurityState = { id: 'crypto', kind: 'crypto', ticker: 'COIN', price: 40, baseline: 40, gmOffset: 0 };
  it('no shock + no gap = flat; kingfall +20%', () => {
    expect(tickCrypto(c, [], S, zeroRng).sec.price).toBe(40);
    const k = kingfallImpulse([c], S)!;
    expect(tickCrypto(c, [k], S, zeroRng).sec.price).toBe(48);
  });
  it('mean |log return| ≈ σ·√(2/π) over a long run', () => {
    const rng = createRng(42);
    let sec = c;
    let total = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const next = tickCrypto(sec, [], S, rng).sec;
      total += Math.abs(Math.log(next.price / sec.price));
      sec = next;
    }
    const mean = total / N;
    expect(mean).toBeGreaterThan(0.06);
    expect(mean).toBeLessThan(0.1);
  });
  it('baseline follows price slowly', () => {
    const r = tickCrypto({ ...c, price: 50 }, [], S, zeroRng);
    expect(r.sec.baseline!).toBeGreaterThan(40);
    expect(r.sec.baseline!).toBeLessThan(40.2);
  });
});

describe('event stock', () => {
  const ev: SecurityState = { id: 'event-reroll', kind: 'event', ticker: 'SCIC', driver: 'reroll', price: 41.5, baseline: 41.5, gmOffset: 0 };
  it('baseline decays 0.5% of its gap to the floor; price follows', () => {
    // floor = 10 + .1×90 = 19; baseline = 19 + 22.5×.995 = 41.3875
    const r = tickEvent(ev, [], S);
    expect(r.sec.baseline).toBeCloseTo(41.3875, 3);
    expect(r.sec.price).toBeCloseTo(41.5 + 0.1 * (41.3875 - 41.5), 3);
  });
  it('re-roll spend bumps baseline and price by +8%', () => {
    const imp = rerollImpulse([ev], S)!;
    const r = tickEvent(ev, [imp], S);
    expect(r.sec.baseline).toBeCloseTo(41.3875 * 1.08, 3);
    expect(r.sec.price).toBeGreaterThan(44);
  });
  it('espionage success moves Shadow Logistics and the agent; fail only dips the agent', () => {
    const secs = createSecurities({ players: [{ id: 'a', ticker: 'AAA' }] }, S);
    const ok = espionageImpulses(secs, 'a', 'success', S);
    expect(ok.map((i) => [i.securityId, i.frac])).toEqual([
      ['p:a', 0.03],
      ['event-espionage', 0.08],
    ]);
    expect(espionageImpulses(secs, 'a', 'fail', S).map((i) => [i.securityId, i.frac])).toEqual([['p:a', -0.03]]);
  });
});

describe('dead stock', () => {
  const d: SecurityState = { id: 'dead', kind: 'dead', ticker: 'DEAD', price: 2.95, gmOffset: 0 };
  it('cheap to pump (+8%), pump bleeds out at 1% of the gap per tick', () => {
    const pumped = tickDead(d, [tradeImpulse(d, 'buy', S)!], S).sec;
    expect(pumped.price).toBeCloseTo(3.186);
    const bled = tickDead(pumped, [], S).sec;
    expect(bled.price).toBeCloseTo(3.186 + 0.01 * (2.95 - 3.186), 3);
  });
});

describe('tickMarket', () => {
  it('creates securities; player stocks start at band midpoint; prices move toward fair', () => {
    const secs = createSecurities(
      {
        players: [
          { id: 'a', ticker: 'AAA' },
          { id: 'b', ticker: 'BBB' },
          { id: 'c', ticker: 'CCC' },
        ],
      },
      S,
    );
    expect(secs.map((s) => s.kind)).toEqual(['player', 'player', 'player', 'index', 'crypto', 'event', 'event', 'dead']);
    expect(secs[0]!.price).toBe(55);
    const r = tickMarket(
      secs,
      {
        earned: [
          { playerId: 'a', earnedH: 3000 },
          { playerId: 'b', earnedH: 2000 },
          { playerId: 'c', earnedH: 1000 },
        ],
        drift: new Map(),
        mood: new Map(),
        impulses: [],
      },
      S,
      createRng(1),
    );
    const p = Object.fromEntries(r.securities.map((s) => [s.id, s.price]));
    expect(p['p:a']).toBeCloseTo(56.75); // fair 72.5
    expect(p['p:b']).toBeCloseTo(55);
    expect(p['p:c']).toBeCloseTo(53.25); // fair 37.5
    expect(r.records).toHaveLength(8);
    expect(r.records.every((x) => x.price >= 1)).toBe(true);
  });

  it('GM offset is ignored for non-player securities (locked #6)', () => {
    const d: SecurityState = { id: 'dead', kind: 'dead', ticker: 'DEAD', price: 2.95, gmOffset: 0.5 };
    expect(tickDead(d, [], S).sec.price).toBeCloseTo(2.95);
  });
});
