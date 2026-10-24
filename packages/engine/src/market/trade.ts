import { toH, valueH, type GoldH, type SharesH } from '../money';
import type { Settings } from '../settings';
import { tradeImpulse } from './tick';
import type { Impulse, SecurityState } from './types';

export interface Lot {
  id: string;
  playerId: string;
  securityId: string;
  sharesH: SharesH;
  costBasisH: GoldH;
  /** Night-clock ms. */
  createdAt: number;
  unlockAt: number;
}

export interface TradeRecord {
  playerId: string;
  securityId: string;
  side: 'buy' | 'sell';
  sharesH: SharesH;
  price: number;
  /** Cash change for the player: negative on buy, positive on sell. Fee included. */
  cashH: GoldH;
  feeH: GoldH;
  /** Sell only: cost basis removed from lots, and realized P&L. */
  basisH?: GoldH;
  realizedH?: GoldH;
  forced?: boolean;
}

export type TradeError =
  | 'market_closed'
  | 'rate_limited'
  | 'below_minimum'
  | 'insufficient_gold'
  | 'over_cap'
  | 'too_small'
  | 'no_shares'
  | 'locked';

export interface TradeGate {
  /** False while paused or after trading closes. */
  marketOpen: boolean;
  /** Current tick number. */
  tick: number;
  /** Last tick this player traded this security, if any (max 1 trade per stock per player per tick). */
  lastTradeTick?: number | null;
  /** Night-clock ms. */
  now: number;
}

type Fail = { ok: false; error: TradeError };

function gateCheck(g: TradeGate): Fail | null {
  if (!g.marketOpen) return { ok: false, error: 'market_closed' };
  if (g.lastTradeTick != null && g.lastTradeTick === g.tick) return { ok: false, error: 'rate_limited' };
  return null;
}

export function openCostBasisH(lots: Lot[], playerId: string): GoldH {
  return lots.filter((l) => l.playerId === playerId && l.sharesH > 0).reduce((a, l) => a + l.costBasisH, 0);
}

/** How much more the player may invest under the cap. */
export function capRemainingH(lots: Lot[], playerId: string, settings: Settings): GoldH {
  return Math.max(0, toH(settings.market.investCap) - openCostBasisH(lots, playerId));
}

export interface BuyInput {
  playerId: string;
  security: SecurityState;
  /** Gold the player wants to spend (hundredths), fee included. */
  goldH: GoldH;
  cashH: GoldH;
  /** All of this player's lots (all securities) for the cap check. */
  lots: Lot[];
  gate: TradeGate;
  lotId: string;
}

export type BuyResult = { ok: true; lot: Lot; trade: TradeRecord; impulse: Impulse | null } | Fail;

/**
 * Buy by gold amount. Shares are floored to 0.01; the player is charged only for shares received plus fee,
 * so the charge is ≤ the requested amount. Cost basis includes the fee.
 */
export function buy(input: BuyInput, settings: Settings): BuyResult {
  const g = gateCheck(input.gate);
  if (g) return g;
  const m = settings.market;
  if (input.goldH < toH(m.minTrade)) return { ok: false, error: 'below_minimum' };
  if (input.goldH > input.cashH) return { ok: false, error: 'insufficient_gold' };
  const price = input.security.price;
  const feeOnRequest = Math.round(input.goldH * m.feeFrac);
  const sharesH = Math.floor((input.goldH - feeOnRequest) / price);
  if (sharesH <= 0) return { ok: false, error: 'too_small' };
  const costH = valueH(sharesH, price);
  const feeH = Math.round(costH * m.feeFrac);
  const totalH = costH + feeH;
  if (openCostBasisH(input.lots, input.playerId) + totalH > toH(m.investCap)) return { ok: false, error: 'over_cap' };
  const now = input.gate.now;
  const lot: Lot = {
    id: input.lotId,
    playerId: input.playerId,
    securityId: input.security.id,
    sharesH,
    costBasisH: totalH,
    createdAt: now,
    unlockAt: now + m.lockoutMinutes * 60_000,
  };
  return {
    ok: true,
    lot,
    trade: { playerId: input.playerId, securityId: input.security.id, side: 'buy', sharesH, price, cashH: -totalH, feeH },
    impulse: tradeImpulse(input.security, 'buy', settings),
  };
}

export interface SellInput {
  playerId: string;
  security: SecurityState;
  /** Shares to sell (hundredths), or 'all' for every unlocked share. */
  sharesH: SharesH | 'all';
  /** This player's lots for this security. */
  lots: Lot[];
  gate: TradeGate;
}

export type SellResult = { ok: true; lots: Lot[]; trade: TradeRecord; impulse: Impulse | null } | Fail;

export function unlockedSharesH(lots: Lot[], now: number): SharesH {
  return lots.filter((l) => l.unlockAt <= now).reduce((a, l) => a + l.sharesH, 0);
}

/** Sell FIFO across unlocked lots. Cost basis is removed pro rata per lot. Returns updated lots (emptied lots removed). */
export function sell(input: SellInput, settings: Settings): SellResult {
  const g = gateCheck(input.gate);
  if (g) return g;
  const now = input.gate.now;
  const mine = input.lots.filter((l) => l.playerId === input.playerId && l.securityId === input.security.id && l.sharesH > 0);
  const total = mine.reduce((a, l) => a + l.sharesH, 0);
  if (total === 0) return { ok: false, error: 'no_shares' };
  const unlocked = unlockedSharesH(mine, now);
  const want = input.sharesH === 'all' ? unlocked : input.sharesH;
  if (want <= 0) return { ok: false, error: unlocked === 0 ? 'locked' : 'too_small' };
  if (want > unlocked) return { ok: false, error: want > total ? 'no_shares' : 'locked' };

  const price = input.security.price;
  const grossH = valueH(want, price);
  if (grossH < toH(settings.market.minTrade) && want !== unlocked) return { ok: false, error: 'below_minimum' };
  const feeH = Math.round(grossH * settings.market.feeFrac);
  const r = consumeFifo(mine, want, now, false);
  const cashH = grossH - feeH;
  return {
    ok: true,
    lots: r.lots,
    trade: {
      playerId: input.playerId,
      securityId: input.security.id,
      side: 'sell',
      sharesH: want,
      price,
      cashH,
      feeH,
      basisH: r.basisH,
      realizedH: cashH - r.basisH,
    },
    impulse: tradeImpulse(input.security, 'sell', settings),
  };
}

function consumeFifo(lots: Lot[], sharesH: SharesH, now: number, ignoreLock: boolean): { lots: Lot[]; basisH: GoldH } {
  const ordered = [...lots].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  let left = sharesH;
  let basisH = 0;
  const out: Lot[] = [];
  for (const l of ordered) {
    if (left === 0 || (!ignoreLock && l.unlockAt > now)) {
      out.push(l);
      continue;
    }
    const take = Math.min(left, l.sharesH);
    const basis = take === l.sharesH ? l.costBasisH : Math.round((l.costBasisH * take) / l.sharesH);
    basisH += basis;
    left -= take;
    const rest = l.sharesH - take;
    if (rest > 0) out.push({ ...l, sharesH: rest, costBasisH: l.costBasisH - basis });
  }
  return { lots: out, basisH };
}

/**
 * Night end: every lot auto-sells at full pre-crash price, ignoring lockout and fee.
 * Returns one forced sell trade per (player, security).
 */
export function liquidateAll(lots: Lot[], priceBySecurity: Map<string, number>): TradeRecord[] {
  const groups = new Map<string, Lot[]>();
  for (const l of lots) {
    if (l.sharesH <= 0) continue;
    const k = `${l.playerId}\u0000${l.securityId}`;
    const g = groups.get(k) ?? [];
    g.push(l);
    groups.set(k, g);
  }
  const trades: TradeRecord[] = [];
  for (const g of groups.values()) {
    const first = g[0]!;
    const price = priceBySecurity.get(first.securityId);
    if (price === undefined) throw new Error(`no price for ${first.securityId}`);
    const sharesH = g.reduce((a, l) => a + l.sharesH, 0);
    const basisH = g.reduce((a, l) => a + l.costBasisH, 0);
    const cashH = valueH(sharesH, price);
    trades.push({
      playerId: first.playerId,
      securityId: first.securityId,
      side: 'sell',
      sharesH,
      price,
      cashH,
      feeH: 0,
      basisH,
      realizedH: cashH - basisH,
      forced: true,
    });
  }
  return trades;
}
