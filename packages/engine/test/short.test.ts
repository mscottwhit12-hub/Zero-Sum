import { describe, expect, it } from 'vitest';
import { computeStandings, coverShort, liquidateAll, openShort, sell, type SecurityState, type TradeGate } from '../src';
import { spec } from './fixtures';

const S = spec();
const sec = (price: number, playerId?: string): SecurityState => ({ id: 'x', kind: 'player', ticker: 'XXX', price, gmOffset: 0, ...(playerId ? { playerId } : {}) });
const gate: TradeGate = { marketOpen: true, tick: 10, lastTradeTick: null, now: 0 };
const later: TradeGate = { ...gate, tick: 99, now: 60 * 60_000 };

const open = (price = 50) => {
  const r = openShort({ playerId: 'a', security: sec(price), goldH: 1000, cashH: 2000, lots: [], gate, lotId: 's1' }, S);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('short (inverse share)', () => {
  it('opens like a buy: stake charged, short lot at entry, sale-sized impact down', () => {
    const r = open();
    expect(r.lot.short).toBe(true);
    expect(r.lot.entry).toBe(50);
    expect(r.trade.cashH).toBeLessThan(0);
    expect(r.impulse!.frac).toBeLessThan(0);
  });
  it("can't short your own stock", () => {
    const r = openShort({ playerId: 'a', security: sec(50, 'a'), goldH: 1000, cashH: 2000, lots: [], gate, lotId: 's1' }, S);
    expect(r.ok).toBe(false);
  });
  it('20% drop → stake gains ~20%; 20% rise → loses ~20%', () => {
    const { lot } = open();
    const down = coverShort({ playerId: 'a', security: sec(40), sharesH: 'all', lots: [lot], gate: later }, S);
    const up = coverShort({ playerId: 'a', security: sec(60), sharesH: 'all', lots: [lot], gate: later }, S);
    if (!down.ok || !up.ok) throw new Error('cover failed');
    const stake = lot.costBasisH;
    expect(down.trade.cashH / stake).toBeGreaterThan(1.15);
    expect(up.trade.cashH / stake).toBeLessThan(0.85);
  });
  it('loss is capped at the stake (price doubles → worth 0, never negative)', () => {
    const { lot } = open();
    const r = coverShort({ playerId: 'a', security: sec(150), sharesH: 'all', lots: [lot], gate: later }, S);
    if (!r.ok) throw new Error(r.error);
    expect(r.trade.cashH).toBe(0);
  });
  it('a normal sell ignores short lots', () => {
    const { lot } = open();
    expect(sell({ playerId: 'a', security: sec(50), sharesH: 'all', lots: [lot], gate: later }, S).ok).toBe(false);
  });
  it('net worth and end-of-night auto-close value the short as an inverse share', () => {
    const { lot } = open();
    const ledger = new Map([['a', { playerId: 'a', cashH: 0 } as never]]);
    const [row] = computeStandings(ledger, [{ playerId: 'a', securityId: 'x', sharesH: lot.sharesH, short: true, entry: 50 }], new Map([['x', 40]]), S);
    expect(row!.holdingsH).toBeGreaterThan(lot.costBasisH);
    const [t] = liquidateAll([lot], new Map([['x', 40]]), 0.1);
    expect(t!.short).toBe(true);
    expect(t!.cashH).toBeGreaterThan(lot.costBasisH);
  });
});
