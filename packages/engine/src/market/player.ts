import { bandWidth, type Settings } from '../settings';
import { applyImpulsesAndClamp } from './clamp';
import type { Impulse, PriceRecord, SecurityState } from './types';

export interface PlayerTickInput {
  /** Rank fair for active players (from computeFair). Leavers are not in this map. */
  fair: number | undefined;
  /** Hidden vote drift, band units. */
  drift: number;
  /** Mood bias, band units. */
  mood: number;
  /** Live-standings bias summed over the night's scored games, band units (optional; 0 when absent). */
  live?: number;
  impulses: Impulse[];
}

/**
 * §7.3 player stock tick.
 * target = fair + (gm_offset + vote_drift + mood_bias) × band width
 * price += reversion × (target − price); then impulses; clamp ≤ maxChange; clamp to band.
 * Leaver: fair decays toward band min at leaverDecay per tick.
 */
export function tickPlayer(sec: SecurityState, input: PlayerTickInput, settings: Settings): { sec: SecurityState; record: PriceRecord } {
  const band = settings.market.bands.player;
  const ps = settings.market.player;
  const next: SecurityState = { ...sec };
  let fair: number;
  if (sec.left) {
    const start = sec.leaverFair ?? sec.lastFair ?? sec.price;
    fair = start + ps.leaverDecay * (band.min - start);
    next.leaverFair = fair;
  } else {
    fair = input.fair ?? sec.lastFair ?? sec.price;
  }
  next.lastFair = fair;
  const terms = sec.gmOffset + input.drift + input.mood + (input.live ?? 0);
  const target = fair + terms * bandWidth(band);
  const model = sec.price + ps.reversion * (target - sec.price);
  const c = applyImpulsesAndClamp(sec.price, model, input.impulses, band, settings.market.maxChangeFrac);
  next.price = c.price;
  return {
    sec: next,
    record: {
      securityId: sec.id,
      price: c.price,
      fair,
      target,
      causes: {
        prev: sec.price,
        model,
        impulses: input.impulses.map((i) => ({ cause: i.cause, frac: i.frac })),
        clampedChange: c.clampedChange,
        clampedBand: c.clampedBand,
        offset: sec.gmOffset,
        drift: input.drift,
        mood: input.mood,
      },
    },
  };
}
