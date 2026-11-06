/**
 * Simple tuning dials for the GM Settings screen (QoL list): plain-language knobs, each a multiplier on one or more
 * default settings, changed with − / + buttons. Every setting is still under "Advanced".
 */
import { DEFAULT_SETTINGS } from '@gn/engine';

export interface Dial {
  id: string;
  label: string;
  help: string;
  /** Setting paths moved together; `x.y.*` = every key under x.y. */
  paths: string[];
  /** Lowest step allowed (the server refuses 0 for some settings). */
  minFactor?: number;
}
export interface DialGroup {
  title: string;
  help: string;
  dials: Dial[];
}

export const DIAL_GROUPS: DialGroup[] = [
  {
    title: 'Where gold comes from',
    help: 'Raise one source to make it matter more next to the others.',
    dials: [
      { id: 'games', label: 'Games', help: 'Gold each game pays by finishing place.', paths: ['scoring.goldScale'], minFactor: 0.25 },
      { id: 'achievements', label: 'Achievements', help: 'Gold for every achievement.', paths: ['achievements.gold.*'] },
      { id: 'bounty', label: 'Quarter picks', help: 'Gold for picking the quarter’s leader.', paths: ['votes.bountyGold'] },
      { id: 'espionage', label: 'Espionage memos', help: 'Default gold for a completed memo.', paths: ['espionage.goldReward'] },
    ],
  },
  {
    title: 'How much stocks move (gold from stocks)',
    help: 'Bigger moves mean more to win (and lose) by trading.',
    dials: [
      { id: 'standings', label: 'Game standings', help: 'How much a player’s live place in a game nudges their stock.', paths: ['market.player.liveMax'] },
      { id: 'mood', label: 'Reported mood push', help: 'How far reported mood pushes a player’s price up or down.', paths: ['mood.moodMax'] },
      { id: 'jitter', label: 'GM reported mood jitter', help: 'How much an upset player’s stock jitters.', paths: ['mood.jitterMax'] },
      { id: 'noise', label: 'Background noise', help: 'The small jiggle every stock has.', paths: ['market.noise.base'] },
      { id: 'kingfall', label: 'Kingfall jump', help: 'How hard crypto jumps when a long-reigning leader falls.', paths: ['market.crypto.kingfallFrac'] },
      { id: 'impact', label: 'Trades move prices', help: 'How much buying and selling pushes a price.', paths: ['market.impact.player', 'market.impact.crypto', 'market.impact.event', 'market.impact.dead'] },
      { id: 'crypto', label: 'Crypto swings', help: 'How wild COIN moves on its own.', paths: ['market.crypto.sigma'] },
      { id: 'index', label: 'Index growth', help: 'How fast the index grows while games run.', paths: ['market.index.growthPerGold'] },
    ],
  },
  {
    title: 'Trading rules',
    help: '',
    dials: [
      { id: 'fee', label: 'Trading fee', help: 'The cut taken on every trade.', paths: ['market.feeFrac'] },
      { id: 'cap', label: 'Investment cap', help: 'How much gold a player can have in the market.', paths: ['market.investCap'], minFactor: 0.25 },
    ],
  },
];

/** The steps the − / + buttons move through. */
export const STEPS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

const at = (obj: unknown, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

/** Expand `x.y.*` into the concrete paths present in the defaults. */
export function expand(paths: string[]): string[] {
  return paths.flatMap((p) => {
    if (!p.endsWith('.*')) return [p];
    const base = p.slice(0, -2);
    const o = at(DEFAULT_SETTINGS, base);
    return o && typeof o === 'object' ? Object.keys(o).map((k) => `${base}.${k}`) : [];
  });
}

/** Where a dial sits now: the multiplier of its first non-zero default (1 when it can't tell). */
export function dialFactor(d: Dial, resolved: unknown): number {
  for (const p of expand(d.paths)) {
    const def = at(DEFAULT_SETTINGS, p);
    const cur = at(resolved, p);
    if (typeof def === 'number' && def !== 0 && typeof cur === 'number') return cur / def;
  }
  return 1;
}

/** The nearest step index for a multiplier. */
export const nearestStep = (f: number) => STEPS.reduce((best, s, i) => (Math.abs(s - f) < Math.abs(STEPS[best]! - f) ? i : best), 0);

/** A settings PATCH body setting every path of the dial to default × factor (1 = back to defaults: null). */
export function dialPatch(d: Dial, factor: number): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const p of expand(d.paths)) {
    const def = at(DEFAULT_SETTINGS, p);
    if (typeof def !== 'number') continue;
    const v = factor === 1 ? null : Math.round(def * factor * 1e6) / 1e6;
    const parts = p.split('.');
    let o = body;
    for (const k of parts.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
    o[parts[parts.length - 1]!] = v;
  }
  return body;
}

export const factorText = (f: number) => (f === 0 ? 'Off' : f === 1 ? '×1 normal' : `×${+f.toFixed(2)}`);
