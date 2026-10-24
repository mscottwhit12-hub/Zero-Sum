import { describe, expect, it } from 'vitest';
import { buy, capRemainingH, liquidateAll, resolveSettings, sell, type Lot, type SecurityState, type TradeGate } from '../src';

const S = resolveSettings();
const sec = (price: number, kind: SecurityState['kind'] = 'player'): SecurityState => ({
  id: 'x',
  kind,
  ticker: 'XXX',
  price,
  gmOffset: 0,
});
const gate: TradeGate = { marketOpen: true, tick: 10, lastTradeTick: null, now: 0 };
const MIN = 60_000;
const lot = (id: string, sharesH: number, costBasisH: number, createdAt: number): Lot => ({
  id,
  playerId: 'a',
  securityId: 'x',
  sharesH,
  costBasisH,
  createdAt,
  unlockAt: createdAt + 5 * MIN,
});

describe('buy', () => {
  it('10 gold at 50 → 0.20 shares, charged 10.00, locked 5 min', () => {
    const r = buy({ playerId: 'a', security: sec(50), goldH: 1000, cashH: 2000, lots: [], gate, lotId: 'l1' }, S);
    if (!r.ok) throw new Error(r.error);
    expect(r.lot.sharesH).toBe(20);
    expect(r.trade.cashH).toBe(-1000);
    expect(r.lot.unlockAt).toBe(5 * MIN);
    expect(r.impulse?.frac).toBe(0.02);
  });
  it('shares floor to 0.01; charge is only what was bought (10 gold at 33 → 0.30 sh, 9.90)', () => {
    const r = buy({ playerId: 'a', security: sec(33), goldH: 1000, cashH: 2000, lots: [], gate, lotId: 'l1' }, S);
    if (!r.ok) throw new Error(r.error);
    expect(r.lot.sharesH).toBe(30);
    expect(r.trade.cashH).toBe(-990);
    expect(r.lot.costBasisH).toBe(990);
  });
  it('fee 5%: 10 gold at 50 → 0.19 sh, cost 9.50 + fee 0.48 = 9.98', () => {
    const s = resolveSettings({ market: { feeFrac: 0.05 } });
    const r = buy({ playerId: 'a', security: sec(50), goldH: 1000, cashH: 2000, lots: [], gate, lotId: 'l1' }, s);
    if (!r.ok) throw new Error(r.error);
    expect(r.lot.sharesH).toBe(19);
    expect(r.trade.feeH).toBe(48);
    expect(r.trade.cashH).toBe(-998);
  });
  it('rejects: below minimum, insufficient gold, over cap, closed, rate limit', () => {
    const b = (over: Partial<Parameters<typeof buy>[0]>) =>
      buy({ playerId: 'a', security: sec(50), goldH: 1000, cashH: 2000, lots: [], gate, lotId: 'l', ...over }, S);
    expect(b({ goldH: 50 })).toEqual({ ok: false, error: 'below_minimum' });
    expect(b({ cashH: 500 })).toEqual({ ok: false, error: 'insufficient_gold' });
    expect(b({ lots: [lot('o', 90, 4500, 0)] })).toEqual({ ok: false, error: 'over_cap' });
    expect(b({ gate: { ...gate, marketOpen: false } })).toEqual({ ok: false, error: 'market_closed' });
    expect(b({ gate: { ...gate, lastTradeTick: 10 } })).toEqual({ ok: false, error: 'rate_limited' });
    expect(b({ gate: { ...gate, lastTradeTick: 9 } }).ok).toBe(true);
  });
  it('cap counts open cost basis across all securities', () => {
    expect(capRemainingH([lot('o', 90, 4500, 0)], 'a', S)).toBe(500);
  });
  it('index is buyable but has no impact', () => {
    const r = buy({ playerId: 'a', security: sec(50, 'index'), goldH: 1000, cashH: 2000, lots: [], gate, lotId: 'l' }, S);
    expect(r.ok && r.impulse).toBeNull();
  });
});

describe('sell', () => {
  const lots = [lot('A', 20, 1000, 0), lot('B', 20, 800, 1 * MIN)];
  const at = (now: number): TradeGate => ({ ...gate, now });

  it('locked lots cannot be sold', () => {
    expect(sell({ playerId: 'a', security: sec(60), sharesH: 10, lots, gate: at(4 * MIN) }, S)).toEqual({ ok: false, error: 'locked' });
  });
  it("'all' sells only unlocked lots (A unlocks at 5m, B at 6m)", () => {
    const r = sell({ playerId: 'a', security: sec(60), sharesH: 'all', lots, gate: at(5 * MIN) }, S);
    if (!r.ok) throw new Error(r.error);
    expect(r.trade.sharesH).toBe(20);
    expect(r.lots.map((l) => l.id)).toEqual(['B']);
  });
  it('FIFO partial: sell 0.30 at 60 → A fully + half of B; basis 10.00 + 4.00; realized +4.00', () => {
    const r = sell({ playerId: 'a', security: sec(60), sharesH: 30, lots, gate: at(6 * MIN) }, S);
    if (!r.ok) throw new Error(r.error);
    expect(r.trade.cashH).toBe(1800);
    expect(r.trade.basisH).toBe(1400);
    expect(r.trade.realizedH).toBe(400);
    expect(r.lots).toEqual([{ ...lots[1], sharesH: 10, costBasisH: 400 }]);
    expect(r.impulse?.frac).toBe(-0.02);
  });
  it('rejects selling more than held', () => {
    expect(sell({ playerId: 'a', security: sec(60), sharesH: 50, lots, gate: at(10 * MIN) }, S)).toEqual({ ok: false, error: 'no_shares' });
    expect(sell({ playerId: 'a', security: sec(60), sharesH: 10, lots: [], gate: at(10 * MIN) }, S)).toEqual({ ok: false, error: 'no_shares' });
  });
});

describe('liquidateAll', () => {
  it('sells everything at full price ignoring lockout and fee', () => {
    const t = liquidateAll([lot('A', 20, 1000, 0), lot('B', 20, 800, 0)], new Map([['x', 70]]));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ sharesH: 40, cashH: 2800, feeH: 0, basisH: 1800, realizedH: 1000, forced: true });
  });
});
