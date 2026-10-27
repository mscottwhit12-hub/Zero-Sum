/**
 * Handicaps (Smash-style): struggling players get quiet help. Pure maths; the server stores levels and delivers help.
 * Level 1 = none. Top 50% by composite score get level 1; the bottom 50% scale 2..5 by how far they trail the median.
 */
import type { HintTier } from './hints';
import type { Settings } from './settings';

export interface HandicapPlayer {
  id: string;
  netWorthH: number;
  /** Net worth at the previous evaluation (trajectory). */
  prevNetWorthH: number;
  /** Average normalised placement over the night's games: 1 = always won, 0 = always last. null = no games yet. */
  placementScore: number | null;
  /** Was in at least one game (active or finished) during the interval. */
  playedInInterval: boolean;
}

export interface HandicapLevel {
  id: string;
  level: number;
  score: number;
  /** Parts of the composite score (0..1, higher = doing better) and what changed the level. */
  reasons: { netWorth: number; placement: number; trajectory: number; idle: boolean; bottomHalf: boolean };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Automatic levels. Composite score = 40% net-worth rank, 35% placements, 25% trajectory vs the table's average growth. */
export function autoLevels(players: HandicapPlayer[], settings: Settings): HandicapLevel[] {
  const n = players.length;
  if (n < 2) return players.map((p) => ({ id: p.id, level: 1, score: 1, reasons: { netWorth: 1, placement: 1, trajectory: 1, idle: false, bottomHalf: false } }));
  const byNw = [...players].sort((a, b) => a.netWorthH - b.netWorthH);
  const nwPct = new Map<string, number>();
  byNw.forEach((p, i) => nwPct.set(p.id, i / (n - 1)));
  // Ties in net worth share the average percentile.
  for (const p of players) {
    const same = byNw.filter((q) => q.netWorthH === p.netWorthH).map((q) => nwPct.get(q.id)!);
    nwPct.set(p.id, same.reduce((a, b) => a + b, 0) / same.length);
  }
  const growth = players.map((p) => p.netWorthH - p.prevNetWorthH);
  const mean = growth.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(growth.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  const placed = players.filter((p) => p.placementScore != null);
  const avgPlace = placed.length ? placed.reduce((a, p) => a + p.placementScore!, 0) / placed.length : 0.5;
  const scored = players.map((p, i) => {
    const netWorth = nwPct.get(p.id)!;
    const placement = p.placementScore ?? avgPlace;
    const trajectory = clamp01(0.5 + (growth[i]! - mean) / (4 * sd));
    return { p, netWorth, placement, trajectory, score: 0.4 * netWorth + 0.35 * placement + 0.25 * trajectory };
  });
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const topCount = Math.ceil(n / 2);
  const median = sorted[topCount - 1]!.score;
  const min = sorted[n - 1]!.score;
  // A tight pack gets small levels: the gap is measured against at least 0.15 of the score scale.
  const span = Math.max(median - min, 0.15);
  const out = new Map<string, HandicapLevel>();
  sorted.forEach((x, rank) => {
    const bottomHalf = rank >= topCount;
    let level = 1;
    if (bottomHalf) {
      level = 2 + Math.round(3 * clamp01((median - x.score) / span));
      if (!x.p.playedInInterval) level = Math.max(2, level - settings.handicap.idlePenaltyLevels);
    }
    out.set(x.p.id, {
      id: x.p.id,
      level,
      score: Math.round(x.score * 1000) / 1000,
      reasons: {
        netWorth: Math.round(x.netWorth * 100) / 100,
        placement: Math.round(x.placement * 100) / 100,
        trajectory: Math.round(x.trajectory * 100) / 100,
        idle: !x.p.playedInInterval,
        bottomHalf,
      },
    });
  });
  return players.map((p) => out.get(p.id)!);
}

/** Auto level + the GM's manual offset, clamped to 1..5. */
export function effectiveLevel(auto: number, offset: number): number {
  return Math.max(1, Math.min(5, Math.round(auto + offset)));
}

/**
 * Help for one interval at `level`: gain(level) × projected night gold × interval / night length.
 * Projection: stake + (earned − stake) scaled to the full night, floored at half the table's projection.
 */
export function intervalHelpH(level: number, projectedH: number, settings: Settings, nightMinutes: number): { giftH: number; hintCreditH: number } {
  const gain = settings.handicap.gainByLevel[Math.max(1, Math.min(5, level)) - 1] ?? 0;
  if (gain <= 0 || nightMinutes <= 0) return { giftH: 0, hintCreditH: 0 };
  const budget = gain * projectedH * (settings.handicap.intervalMinutes / nightMinutes);
  const giftH = Math.round(budget * settings.handicap.goldShare);
  return { giftH, hintCreditH: Math.round(budget - giftH) };
}

export function projectNightGoldH(earnedH: number, stakeH: number, elapsedMin: number, nightMinutes: number): number {
  const won = Math.max(0, earnedH - stakeH);
  return stakeH + won * (nightMinutes / Math.max(elapsedMin, 30));
}

/** Spend hint credit (gold hundredths) on tips: the best tier affordable each time. Returns tiers granted and leftover. */
export function spendHintCredit(creditH: number, settings: Settings): { tiers: HintTier[]; leftH: number } {
  const v = settings.hints.value;
  const price: [HintTier, number][] = [
    ['rarest', v.rarest * 100],
    ['rarer', v.rarer * 100],
    ['common', v.common * 100],
  ];
  const tiers: HintTier[] = [];
  let left = creditH;
  for (let guard = 0; guard < 20; guard++) {
    const t = price.find(([, c]) => left >= c);
    if (!t) break;
    tiers.push(t[0]);
    left -= t[1];
  }
  return { tiers, leftH: left };
}
