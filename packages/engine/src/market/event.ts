import { bandAt, type Settings } from '../settings';
import { applyImpulsesAndClamp, clampTo, round4 } from './clamp';
import type { Impulse, PriceRecord, SecurityState } from './types';

/**
 * Event stock (Second Chance = re-roll spends, Shadow Logistics = espionage completions).
 * Baseline decays slowly toward a floor; each driver event bumps baseline and price by +bump.
 * Price reverts toward baseline (normal reversion), so trade pumps fade but driver moves persist.
 */
export function tickEvent(sec: SecurityState, impulses: Impulse[], settings: Settings): { sec: SecurityState; record: PriceRecord } {
  const s = settings.market.event;
  const band = settings.market.bands.event;
  const floor = bandAt(band, s.floorFrac);
  let baseline = sec.baseline ?? sec.price;
  baseline = floor + (baseline - floor) * (1 - s.decay);
  for (const i of impulses) if (i.moveBaseline) baseline *= 1 + i.frac;
  baseline = round4(clampTo(baseline, band));
  const model = sec.price + s.reversion * (baseline - sec.price);
  const c = applyImpulsesAndClamp(sec.price, model, impulses, band, settings.market.maxChangeFrac);
  return {
    sec: { ...sec, price: c.price, baseline },
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
