import type { Settings } from '../settings';
import { applyImpulsesAndClamp } from './clamp';
import type { PriceRecord, SecurityState } from './types';

/**
 * Index: equal-weighted average of player stock prices × scale, smoothed (low volatility).
 * No trade impact and no GM offset (locked #6), so it can't be pumped directly.
 */
export function tickIndex(sec: SecurityState, playerPrices: number[], settings: Settings): { sec: SecurityState; record: PriceRecord } {
  const s = settings.market.index;
  const band = settings.market.bands.index;
  const target = playerPrices.length ? (playerPrices.reduce((a, b) => a + b, 0) / playerPrices.length) * s.scale : sec.price;
  const model = sec.price + s.smoothing * (target - sec.price);
  const c = applyImpulsesAndClamp(sec.price, model, [], band, settings.market.maxChangeFrac);
  return {
    sec: { ...sec, price: c.price },
    record: {
      securityId: sec.id,
      price: c.price,
      fair: null,
      target,
      causes: { prev: sec.price, model, impulses: [], clampedChange: c.clampedChange, clampedBand: c.clampedBand },
    },
  };
}
