/**
 * Hint rewards: players earn tips about hidden mechanics. Higher tier = a more secret, more valuable mechanic.
 * Texts live in copy (hints.<id>); numbers in them come from live settings (hintVars).
 */
import type { Settings } from './settings';

export type HintTier = 'common' | 'rarer' | 'rarest';
export const HINT_TIERS: readonly HintTier[] = ['common', 'rarer', 'rarest'];

export interface HintDef {
  id: string;
  tier: HintTier;
}

/** Pool v1 (Decisions Log). More hints will be added, especially common ones. */
export const HINT_POOL: readonly HintDef[] = [
  { id: 'trade_impact', tier: 'common' },
  { id: 'index_dip', tier: 'rarer' },
  { id: 'scic_driver', tier: 'rarer' },
  { id: 'shdw_driver', tier: 'rarer' },
  { id: 'event_decay', tier: 'rarer' },
  { id: 'dead_memory', tier: 'rarer' },
  { id: 'coin_leak', tier: 'rarer' },
  { id: 'mood', tier: 'rarer' },
  { id: 'kingfall', tier: 'rarest' },
  { id: 'index_scale', tier: 'rarest' },
];

/** Values substituted into hint texts. */
export function hintVars(settings: Settings): Record<string, string | number> {
  return { holdMinutes: settings.market.crypto.kingfallHoldMinutes };
}

/**
 * Pick a hint: an unseen one from the tier; if the tier is used up, an unseen one from the next tier down; if nothing is
 * unseen at or below the tier, a repeat from the tier. `pick` is 0..1 (deterministic per grant).
 */
export function drawHint(tier: HintTier, seen: ReadonlySet<string>, pick: number, pool: readonly HintDef[] = HINT_POOL): HintDef {
  const from = HINT_TIERS.indexOf(tier);
  for (let t = from; t >= 0; t--) {
    const unseen = pool.filter((h) => h.tier === HINT_TIERS[t] && !seen.has(h.id));
    if (unseen.length) return unseen[Math.min(unseen.length - 1, Math.floor(pick * unseen.length))]!;
  }
  for (let t = from; t >= 0; t--) {
    const any = pool.filter((h) => h.tier === HINT_TIERS[t]);
    if (any.length) return any[Math.min(any.length - 1, Math.floor(pick * any.length))]!;
  }
  return pool[0]!;
}

/**
 * Game-result hint tier (wins and last places): eligible if ≥ minMinutesLarge with 4+ players or ≥ minMinutesSmall with
 * 2–3 players; rarer past rarerMinutes, rarest past rarestMinutes. null = not eligible.
 */
export function gameHintTier(players: number, hours: number, settings: Settings): HintTier | null {
  const g = settings.hints.games;
  const min = hours * 60;
  if (players < 2) return null;
  if (players >= 4 ? min < g.minMinutesLarge : min < g.minMinutesSmall) return null;
  if (min > g.rarestMinutes) return 'rarest';
  if (min > g.rarerMinutes) return 'rarer';
  return 'common';
}

/** Minter milestone tiers: first purchase of each big machine. */
export const MINTER_HINT_TIERS: Readonly<Record<string, HintTier>> = { rack: 'common', datacenter: 'rarer', orbital: 'rarest' };
