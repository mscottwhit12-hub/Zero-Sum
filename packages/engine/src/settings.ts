/**
 * Every gameplay number lives here as a tunable GM setting with a default.
 * Units:
 *  - gold values are plain gold (e.g. 20 = 20.0 gold); the engine converts to hundredths.
 *  - "frac" values are fractions (0.02 = 2%).
 *  - "band units" are fractions of a security's band width.
 *  - time values are night-clock (pause excluded) unless noted.
 */

export type SecurityKind = 'player' | 'index' | 'crypto' | 'event' | 'dead';
export const SECURITY_KINDS: SecurityKind[] = ['player', 'index', 'crypto', 'event', 'dead'];

export interface Band {
  min: number;
  max: number;
}

export type TieRule = 'average' | 'best' | 'worst';
export type VoteWeighting = 'equal' | 'netWorth';

export interface Settings {
  scoring: {
    /** Multipliers for 1st, 2nd, 3rd… Places past the list continue with tailFactor. */
    placementMults: number[];
    /** Each place past the list = previous × tailFactor ("keep halving"). */
    tailFactor: number;
    tieRule: TieRule;
    dnfMult: number;
    coopLossMult: number;
  };
  stake: {
    startingGold: number;
  };
  lateJoin: {
    /** Stake = goldFraction × average earned gold of active players − goldPenalty (floored at 0). Frozen at approval. */
    goldFraction: number;
    goldPenalty: number;
    /** Start price = average player price − stockPenalty × player band width. */
    stockPenalty: number;
  };
  market: {
    tickSeconds: number;
    /** Max |Δprice| per tick as a fraction of the previous price. */
    maxChangeFrac: number;
    feeFrac: number;
    investCap: number;
    minTrade: number;
    lockoutMinutes: number;
    bands: Record<SecurityKind, Band>;
    /** Trade impact per trade, fraction of price. Index ignores this (never impacted). */
    impact: Record<SecurityKind, number>;
    player: {
      /** Rank fair is spread across this sub-range of the band (fractions of width). */
      fairInnerLo: number;
      fairInnerHi: number;
      reversion: number;
      /** Leaver's fair moves this fraction of the gap toward band min each tick. */
      leaverDecay: number;
      /** Espionage success +frac / fail −frac. */
      espionageFrac: number;
    };
    index: {
      scale: number;
      /** Fraction of the gap to (average × scale) closed per tick. Low = low volatility. */
      smoothing: number;
    };
    crypto: {
      /** Std dev of log return per tick. */
      sigma: number;
      /** Pull toward baseline per tick (log space). Weak. */
      reversion: number;
      /** Baseline follows price by this fraction per tick (slow). */
      baselineAlpha: number;
      /** Start price as a fraction of band. */
      startFrac: number;
      kingfallFrac: number;
      kingfallHoldMinutes: number;
    };
    event: {
      startFrac: number;
      /** Baseline floor as a fraction of band. */
      floorFrac: number;
      /** Baseline decays this fraction of its gap to floor per tick. */
      decay: number;
      /** +frac per driver event (re-roll spend / espionage success). */
      bump: number;
      reversion: number;
    };
    dead: {
      /** Baseline as a fraction of band ("near band_min"). */
      baselineFrac: number;
      /** Very weak reversion: pumps persist then bleed out. */
      reversion: number;
    };
  };
  votes: {
    /** Number of quarters per night (Q1..Qn). */
    quarterCount: number;
    /** Buffer before Q1 and after Qn, each as a fraction of night length. */
    bufferFrac: number;
    windowMinutes: number;
    weighting: VoteWeighting;
    bountyGold: number;
    /** At or above this many eligible players, the top 2 by net worth both pay. */
    topTwoMinPlayers: number;
    /** vote_drift = driftMax × (share − 1/N), band units. */
    driftMax: number;
  };
  mood: {
    /** mood_bias = moodMax × centered average, band units. */
    moodMax: number;
    /** Bias multiplies by (1 − decayPerTick) each tick after a reading. */
    decayPerTick: number;
  };
  rerolls: {
    perPlayer: number;
  };
  achievements: {
    /** Gold per achievement id. */
    gold: Record<string, number>;
  };
  prompts: {
    tradingCloseMinutesBefore: number;
  };
  minter: {
    /** Mint rate multiplier while the night is paused. */
    pauseMultiplier: number;
    tvCrawlMinutes: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  scoring: {
    placementMults: [1.0, 0.5, 0.25],
    tailFactor: 0.5,
    tieRule: 'average',
    dnfMult: 0,
    coopLossMult: 0.25,
  },
  stake: { startingGold: 20 },
  lateJoin: { goldFraction: 0.75, goldPenalty: 2, stockPenalty: 0.05 },
  market: {
    tickSeconds: 20,
    maxChangeFrac: 0.3,
    feeFrac: 0,
    investCap: 50,
    minTrade: 1,
    lockoutMinutes: 5,
    bands: {
      player: { min: 30, max: 80 },
      index: { min: 30, max: 80 },
      crypto: { min: 5, max: 150 },
      event: { min: 10, max: 100 },
      dead: { min: 1, max: 40 },
    },
    impact: { player: 0.02, index: 0, crypto: 0.06, event: 0.02, dead: 0.08 },
    player: {
      fairInnerLo: 0.15,
      fairInnerHi: 0.85,
      reversion: 0.1,
      leaverDecay: 0.02,
      espionageFrac: 0.03,
    },
    index: { scale: 1, smoothing: 0.3 },
    crypto: {
      sigma: 0.1,
      reversion: 0.03,
      baselineAlpha: 0.01,
      startFrac: 0.25,
      kingfallFrac: 0.2,
      kingfallHoldMinutes: 15,
    },
    event: { startFrac: 0.35, floorFrac: 0.1, decay: 0.005, bump: 0.08, reversion: 0.1 },
    dead: { baselineFrac: 0.05, reversion: 0.01 },
  },
  votes: {
    quarterCount: 4,
    bufferFrac: 0.1,
    windowMinutes: 5,
    weighting: 'equal',
    bountyGold: 2,
    topTwoMinPlayers: 16,
    driftMax: 0.15,
  },
  mood: { moodMax: 0.06, decayPerTick: 0.01 },
  rerolls: { perPlayer: 3 },
  achievements: {
    gold: { first_blood: 2, hat_trick: 5, regular: 2, oracle: 1 },
  },
  prompts: { tradingCloseMinutesBefore: 15 },
  minter: { pauseMultiplier: 2, tvCrawlMinutes: 10 },
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/** Defaults overlaid with a (possibly partial) override. Arrays are replaced, not merged. */
export function resolveSettings(patch?: DeepPartial<Settings>, base: Settings = DEFAULT_SETTINGS): Settings {
  return deepMerge(structuredClone(base), patch ?? {});
}

export interface SettingsIssue {
  path: string;
  message: string;
}

/** Returns an empty array when valid. */
export function validateSettings(s: Settings): SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  const need = (ok: boolean, path: string, message: string) => {
    if (!ok) issues.push({ path, message });
  };
  const frac = (v: number, path: string) => need(Number.isFinite(v) && v >= 0 && v <= 1, path, 'must be between 0 and 1');
  const nonNeg = (v: number, path: string) => need(Number.isFinite(v) && v >= 0, path, 'must be ≥ 0');
  const pos = (v: number, path: string) => need(Number.isFinite(v) && v > 0, path, 'must be > 0');

  need(s.scoring.placementMults.length > 0, 'scoring.placementMults', 'needs at least one value');
  s.scoring.placementMults.forEach((m, i) => nonNeg(m, `scoring.placementMults.${i}`));
  frac(s.scoring.tailFactor, 'scoring.tailFactor');
  need(['average', 'best', 'worst'].includes(s.scoring.tieRule), 'scoring.tieRule', 'unknown rule');
  nonNeg(s.scoring.dnfMult, 'scoring.dnfMult');
  nonNeg(s.scoring.coopLossMult, 'scoring.coopLossMult');
  nonNeg(s.stake.startingGold, 'stake.startingGold');
  frac(s.lateJoin.goldFraction, 'lateJoin.goldFraction');
  nonNeg(s.lateJoin.goldPenalty, 'lateJoin.goldPenalty');
  frac(s.lateJoin.stockPenalty, 'lateJoin.stockPenalty');

  const m = s.market;
  need(m.tickSeconds >= 15 && m.tickSeconds <= 30, 'market.tickSeconds', 'must be 15–30');
  frac(m.maxChangeFrac, 'market.maxChangeFrac');
  frac(m.feeFrac, 'market.feeFrac');
  pos(m.investCap, 'market.investCap');
  pos(m.minTrade, 'market.minTrade');
  nonNeg(m.lockoutMinutes, 'market.lockoutMinutes');
  for (const k of Object.keys(m.bands) as SecurityKind[]) {
    const b = m.bands[k];
    need(b.min > 0 && b.max > b.min, `market.bands.${k}`, 'need 0 < min < max');
    frac(m.impact[k], `market.impact.${k}`);
  }
  frac(m.player.fairInnerLo, 'market.player.fairInnerLo');
  frac(m.player.fairInnerHi, 'market.player.fairInnerHi');
  need(m.player.fairInnerLo < m.player.fairInnerHi, 'market.player.fairInnerHi', 'must be above fairInnerLo');
  frac(m.player.reversion, 'market.player.reversion');
  frac(m.player.leaverDecay, 'market.player.leaverDecay');
  frac(m.player.espionageFrac, 'market.player.espionageFrac');
  pos(m.index.scale, 'market.index.scale');
  frac(m.index.smoothing, 'market.index.smoothing');
  frac(m.crypto.sigma, 'market.crypto.sigma');
  frac(m.crypto.reversion, 'market.crypto.reversion');
  frac(m.crypto.baselineAlpha, 'market.crypto.baselineAlpha');
  frac(m.crypto.startFrac, 'market.crypto.startFrac');
  frac(m.crypto.kingfallFrac, 'market.crypto.kingfallFrac');
  nonNeg(m.crypto.kingfallHoldMinutes, 'market.crypto.kingfallHoldMinutes');
  frac(m.event.startFrac, 'market.event.startFrac');
  frac(m.event.floorFrac, 'market.event.floorFrac');
  frac(m.event.decay, 'market.event.decay');
  frac(m.event.bump, 'market.event.bump');
  frac(m.event.reversion, 'market.event.reversion');
  frac(m.dead.baselineFrac, 'market.dead.baselineFrac');
  frac(m.dead.reversion, 'market.dead.reversion');

  const v = s.votes;
  need(Number.isInteger(v.quarterCount) && v.quarterCount >= 1, 'votes.quarterCount', 'must be a whole number ≥ 1');
  need(v.bufferFrac >= 0 && v.bufferFrac < 0.5, 'votes.bufferFrac', 'must be 0 to <0.5');
  pos(v.windowMinutes, 'votes.windowMinutes');
  need(['equal', 'netWorth'].includes(v.weighting), 'votes.weighting', 'unknown weighting');
  nonNeg(v.bountyGold, 'votes.bountyGold');
  need(Number.isInteger(v.topTwoMinPlayers) && v.topTwoMinPlayers >= 2, 'votes.topTwoMinPlayers', 'must be a whole number ≥ 2');
  frac(v.driftMax, 'votes.driftMax');
  frac(s.mood.moodMax, 'mood.moodMax');
  frac(s.mood.decayPerTick, 'mood.decayPerTick');
  need(Number.isInteger(s.rerolls.perPlayer) && s.rerolls.perPlayer >= 0, 'rerolls.perPlayer', 'must be a whole number ≥ 0');
  for (const [id, g] of Object.entries(s.achievements.gold)) nonNeg(g, `achievements.gold.${id}`);
  nonNeg(s.prompts.tradingCloseMinutesBefore, 'prompts.tradingCloseMinutesBefore');
  need(s.minter.pauseMultiplier >= 1, 'minter.pauseMultiplier', 'must be ≥ 1');
  pos(s.minter.tvCrawlMinutes, 'minter.tvCrawlMinutes');
  return issues;
}

export function bandWidth(b: Band): number {
  return b.max - b.min;
}

export function bandAt(b: Band, frac: number): number {
  return b.min + frac * (b.max - b.min);
}
