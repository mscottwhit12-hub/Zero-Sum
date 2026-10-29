import type { Settings } from '../settings';

/**
 * Live-standings bias for one scored game (band units, zero-sum across the game's scored players).
 * `scores`: player → current score. `lower`: lower score leads. Ties share the average of their places' levels.
 * N scored players: top floor(N/2) get liveMax × (k − i + 1)/k (1st = liveMax); bottom max(1, floor(N/4)) get a
 * negative share weighted toward last place that cancels the top's total; everyone else 0. Fewer than 2 → empty.
 */
export function liveLevels(scores: Map<string, number>, lower: boolean, settings: Settings): Map<string, number> {
  const ids = [...scores.keys()];
  const n = ids.length;
  const out = new Map<string, number>();
  if (n < 2) return out;
  const max = settings.market.player.liveMax;
  const k = Math.floor(n / 2);
  const b = Math.min(n - k, Math.max(1, Math.floor(n / 4)));
  const byPlace: number[] = [];
  for (let i = 1; i <= n; i++) {
    if (i <= k) byPlace.push((max * (k - i + 1)) / k);
    else if (i > n - b) {
      const w = i - (n - b); // 1 … b, last place heaviest
      const pos = (max * (k + 1)) / 2;
      byPlace.push((-pos * w) / ((b * (b + 1)) / 2));
    } else byPlace.push(0);
  }
  const sorted = ids.slice().sort((a, c) => (lower ? scores.get(a)! - scores.get(c)! : scores.get(c)! - scores.get(a)!));
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && scores.get(sorted[j + 1]!) === scores.get(sorted[i]!)) j++;
    let sum = 0;
    for (let x = i; x <= j; x++) sum += byPlace[x]!;
    for (let x = i; x <= j; x++) out.set(sorted[x]!, sum / (j - i + 1));
    i = j + 1;
  }
  return out;
}
