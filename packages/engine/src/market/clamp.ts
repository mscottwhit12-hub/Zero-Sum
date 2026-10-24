import type { Band } from '../settings';
import type { Impulse } from './types';

export interface ClampResult {
  price: number;
  clampedChange: boolean;
  clampedBand: boolean;
}

/** Applies summed impulses to the model price, then clamps |Δ| ≤ maxChange × prev, then clamps to band. */
export function applyImpulsesAndClamp(
  prev: number,
  model: number,
  impulses: Impulse[],
  band: Band,
  maxChangeFrac: number,
): ClampResult {
  const total = impulses.reduce((a, i) => a + i.frac, 0);
  let p = model * (1 + total);
  let clampedChange = false;
  const lo = prev * (1 - maxChangeFrac);
  const hi = prev * (1 + maxChangeFrac);
  if (p > hi) {
    p = hi;
    clampedChange = true;
  } else if (p < lo) {
    p = lo;
    clampedChange = true;
  }
  let clampedBand = false;
  if (p > band.max) {
    p = band.max;
    clampedBand = true;
  } else if (p < band.min) {
    p = band.min;
    clampedBand = true;
  }
  return { price: round4(p), clampedChange, clampedBand };
}

export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export function clampTo(x: number, band: Band): number {
  return Math.min(band.max, Math.max(band.min, x));
}
