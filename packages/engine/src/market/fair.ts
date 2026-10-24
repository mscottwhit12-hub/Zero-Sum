import type { GoldH } from '../money';
import { bandAt, type Band } from '../settings';

/**
 * Rank-based fair price on EARNED gold (locked #1: stake + results + adjustments + bounties + achievements;
 * trading P&L ignored). Ranks are spread evenly across the inner range of the band.
 * Ties share the average of the ranks they span. All tied (or one player) = band midpoint.
 */
export function computeFair(
  earned: { playerId: string; earnedH: GoldH }[],
  band: Band,
  innerLo: number,
  innerHi: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const n = earned.length;
  if (n === 0) return out;
  const mid = (band.min + band.max) / 2;
  const sorted = [...earned].sort((a, b) => b.earnedH - a.earnedH);
  if (n === 1 || sorted[0]!.earnedH === sorted[n - 1]!.earnedH) {
    for (const e of earned) out.set(e.playerId, mid);
    return out;
  }
  const posForRank = (r: number) => innerHi - ((r - 1) / (n - 1)) * (innerHi - innerLo);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && sorted[j]!.earnedH === sorted[i]!.earnedH) j++;
    // ranks i+1 .. j; position is linear in rank so average rank → average position
    const avgRank = (i + 1 + j) / 2;
    const price = bandAt(band, posForRank(avgRank));
    for (let k = i; k < j; k++) out.set(sorted[k]!.playerId, price);
    i = j;
  }
  return out;
}
