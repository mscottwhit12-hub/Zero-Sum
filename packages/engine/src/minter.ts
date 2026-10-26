/**
 * NFT Minter (spec §15.4): an idle clicker for fun only. Its own fake currency ("credits"),
 * with ZERO link to gold, the market, or scoring. Tier numbers are placeholders.
 * Self-contained so more fun apps can be added later. The server is authoritative:
 * clients report taps and purchases; passive minting is computed from elapsed time.
 */

export interface MinterTier {
  id: string;
  name: string;
  /** Base price in credits; each one owned raises the next price by `costGrowth`. */
  cost: number;
  /** NFTs minted per second per unit owned. */
  rate: number;
  /** Only purchasable while the night is paused (intermission bonus tier). */
  intermissionOnly?: boolean;
}

export const MINTER_TIERS: MinterTier[] = [
  { id: 'laptop', name: 'Laptop', cost: 15, rate: 0.2 },
  { id: 'rig', name: 'Gaming Rig', cost: 100, rate: 1 },
  { id: 'rack', name: 'Server Rack', cost: 600, rate: 5 },
  { id: 'datacenter', name: 'Data Center', cost: 4_000, rate: 30 },
  { id: 'orbital', name: 'Orbital Array', cost: 30_000, rate: 200 },
  { id: 'breakroom', name: 'Break-Room Farm', cost: 400, rate: 8, intermissionOnly: true },
];

export const MINTER_RULES = {
  costGrowth: 1.15,
  /** Max taps per second accepted from a phone (anti-autoclicker, generous for humans). */
  maxTapsPerSecond: 15,
  /** Passive minting accrues for at most this long between syncs (phone asleep, etc.). */
  maxIdleSeconds: 600,
};

export interface MinterState {
  /** Lifetime NFTs minted tonight (leaderboard). */
  minted: number;
  /** Credits on hand (1 per NFT minted, spent on tiers). */
  credits: number;
  tiers: Record<string, number>;
  taps: number;
}

export const emptyMinter = (): MinterState => ({ minted: 0, credits: 0, tiers: {}, taps: 0 });

export const tierCost = (t: MinterTier, owned: number) => Math.ceil(t.cost * Math.pow(MINTER_RULES.costGrowth, owned));

/** Passive NFTs per second (before any intermission multiplier). */
export function minterRate(tiers: Record<string, number>): number {
  return MINTER_TIERS.reduce((a, t) => a + t.rate * (tiers[t.id] ?? 0), 0);
}

export interface MinterSync {
  /** Taps since the last sync. */
  taps: number;
  /** Tier ids to buy, in order. */
  buys: string[];
}

/**
 * Apply one sync: passive minting for the elapsed time, clamped taps, then purchases.
 * `mult` is the intermission multiplier (applies to taps and passive) when paused, else 1.
 */
export function applyMinterSync(prev: MinterState, sync: MinterSync, elapsedSec: number, opts: { paused: boolean; mult: number }): { state: MinterState; rejected: string[] } {
  const dt = Math.max(0, Math.min(elapsedSec, MINTER_RULES.maxIdleSeconds));
  const mult = opts.paused ? Math.max(1, opts.mult) : 1;
  const taps = Math.max(0, Math.min(Math.floor(Number(sync.taps) || 0), Math.ceil(MINTER_RULES.maxTapsPerSecond * Math.max(dt, 1))));
  const gained = (taps + minterRate(prev.tiers) * dt) * mult;
  const s: MinterState = { minted: prev.minted + gained, credits: prev.credits + gained, tiers: { ...prev.tiers }, taps: prev.taps + taps };
  const rejected: string[] = [];
  for (const id of (sync.buys ?? []).slice(0, 50)) {
    const t = MINTER_TIERS.find((x) => x.id === id);
    if (!t || (t.intermissionOnly && !opts.paused)) {
      rejected.push(id);
      continue;
    }
    const c = tierCost(t, s.tiers[id] ?? 0);
    if (c > s.credits) {
      rejected.push(id);
      continue;
    }
    s.credits -= c;
    s.tiers[id] = (s.tiers[id] ?? 0) + 1;
  }
  return { state: s, rejected };
}
