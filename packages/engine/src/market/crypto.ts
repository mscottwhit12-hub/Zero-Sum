import type { Rng } from '../rng';
import type { Settings } from '../settings';
import { applyImpulsesAndClamp, clampTo, round4 } from './clamp';
import type { Impulse, PriceRecord, SecurityState } from './types';

/**
 * Crypto: log random walk (σ per tick) with weak reversion to a slow baseline.
 * The baseline follows price by baselineAlpha per tick. Kingfall arrives as an impulse.
 */
export function tickCrypto(
  sec: SecurityState,
  impulses: Impulse[],
  settings: Settings,
  rng: Rng,
): { sec: SecurityState; record: PriceRecord } {
  const s = settings.market.crypto;
  const band = settings.market.bands.crypto;
  const baseline = sec.baseline ?? sec.price;
  const shock = s.sigma * rng.normal();
  const logRet = shock + s.reversion * Math.log(baseline / sec.price);
  const model = sec.price * Math.exp(logRet);
  const c = applyImpulsesAndClamp(sec.price, model, impulses, band, settings.market.maxChangeFrac);
  const nextBaseline = round4(clampTo(baseline + s.baselineAlpha * (c.price - baseline), band));
  return {
    sec: { ...sec, price: c.price, baseline: nextBaseline },
    record: {
      securityId: sec.id,
      price: c.price,
      fair: null,
      target: baseline,
      causes: {
        prev: sec.price,
        model,
        impulses: impulses.map((i) => ({ cause: i.cause, frac: i.frac })),
        clampedChange: c.clampedChange,
        clampedBand: c.clampedBand,
        shock,
        baseline: nextBaseline,
      },
    },
  };
}
