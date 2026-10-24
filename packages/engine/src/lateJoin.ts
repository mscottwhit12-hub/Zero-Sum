import { toH, type GoldH } from './money';
import { bandWidth, type Settings } from './settings';
import { clampTo, round4 } from './market/clamp';

/**
 * Late-joiner stake (locked #4): computed ONCE at approval and stored as a system adjustment.
 * It never recomputes on re-score. stake = fraction × average earned gold of active players − penalty, ≥ 0.
 */
export function lateJoinStakeH(activeEarnedH: GoldH[], settings: Settings): GoldH {
  if (activeEarnedH.length === 0) return toH(settings.stake.startingGold);
  const avg = activeEarnedH.reduce((a, b) => a + b, 0) / activeEarnedH.length;
  return Math.max(0, Math.round(avg * settings.lateJoin.goldFraction) - toH(settings.lateJoin.goldPenalty));
}

/** Late joiner's stock starts at the average player price minus a penalty (band units), clamped to band. */
export function lateJoinStartPrice(playerPrices: number[], settings: Settings): number {
  const band = settings.market.bands.player;
  if (playerPrices.length === 0) return (band.min + band.max) / 2;
  const avg = playerPrices.reduce((a, b) => a + b, 0) / playerPrices.length;
  return round4(clampTo(avg - settings.lateJoin.stockPenalty * bandWidth(band), band));
}
