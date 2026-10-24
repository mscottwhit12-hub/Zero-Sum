import { bandAt, type Settings } from '../settings';
import { applyImpulsesAndClamp } from './clamp';
import type { Impulse, PriceRecord, SecurityState } from './types';

/**
 * Dead stock: sits near band min, no drift. High trade impact (cheap to pump).
 * Very weak reversion: pumps persist, then bleed out slowly.
 */
export function tickDead(sec: SecurityState, impulses: Impulse[], settings: Settings): { sec: SecurityState; record: PriceRecord } {
  const s = settings.market.dead;
  const band = settings.market.bands.dead;
  const baseline = bandAt(band, s.baselineFrac);
  const model = sec.price + s.reversion * (baseline - sec.price);
  const c = applyImpulsesAndClamp(sec.price, model, impulses, band, settings.market.maxChangeFrac);
  return {
    sec: { ...sec, price: c.price },
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
        baseline,
      },
    },
  };
}
