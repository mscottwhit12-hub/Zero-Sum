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
    /** Game gold multiplier: gold = hours × players × place mult × goldScale. Other gold sources are unaffected. */
    goldScale: number;
    /**
     * 'linear' (default): from 3rd place down, payouts step evenly from 2nd's multiplier to `floorMult` at last place
     * (so bigger games spread wider), never below the classic curve. 'classic': placementMults + tailFactor only.
     */
    curve: 'linear' | 'classic';
    /** Last place's multiplier on the linear curve. */
    floorMult: number;
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
    /** Night-end auto-sell: fee on profit only, per position (player × security). Losing positions pay nothing. */
    endSellProfitFeeFrac: number;
    investCap: number;
    minTrade: number;
    lockoutMinutes: number;
    bands: Record<SecurityKind, Band>;
    /** Trade impact per trade, fraction of price. Index ignores this (never impacted). */
    impact: Record<SecurityKind, number>;
    /**
     * Fraction of a trade's own impact the trader pays at execution (buy fills at price × (1 + slippage × impact),
     * sell at price × (1 − slippage × impact)). 0 = spec behavior: fill at the current price, nudge next tick.
     */
    slippage: number;
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
      /** Price added per gold earned per player (hidden from players). Growth only while games run. */
      growthPerGold: number;
      /** Price dropped at a game's start per gold that game is expected to pay per player; returned when it ends. */
      startDropPerGold: number;
      /** Size of the gentle wobble around the trend, as a fraction of price (std dev). */
      noiseFrac: number;
      /** How fast the wobble pulls back to the trend per tick. */
      noiseReversion: number;
    };
    crypto: {
      /** Std dev of log return per tick. */
      sigma: number;
      /** Pull toward baseline per tick (log space). Weak. */
      reversion: number;
      /** Baseline follows price by this fraction per tick (slow). */
      baselineAlpha: number;
      /** Expected change per hour of market time (negative = downward trend, so holding all night loses). */
      driftPerHour: number;
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
  espionage: {
    /** Default gold reward for a successful challenge (the GM can set any amount per challenge). */
    goldReward: number;
    /** TV reveals "accepted/rejected" after a random delay in this range (seconds). */
    revealDelayMinSec: number;
    revealDelayMaxSec: number;
  };
  achievements: {
    /** Gold per achievement id. */
    gold: Record<string, number>;
  };
  prompts: {
    tradingCloseMinutesBefore: number;
  };
  /** End-of-night TV sequence timing (seconds). Phones unlock when it finishes. */
  finale: {
    collapseSeconds: number;
    podiumStepSeconds: number;
    recapSlideSeconds: number;
  };
  minter: {
    /** Mint rate multiplier while the night is paused. */
    pauseMultiplier: number;
    tvCrawlMinutes: number;
  };
  hints: {
    /** Master switch for all hint rewards. */
    enabled: boolean;
    games: {
      /** Winners and last places of qualifying games get a tip. */
      win: boolean;
      lastPlace: boolean;
      /** Minimum length with 4+ players / with 2–3 players. */
      minMinutesLarge: number;
      minMinutesSmall: number;
      /** Longer than this → rarer tip; longer than rarestMinutes → rarest tip. */
      rarerMinutes: number;
      rarestMinutes: number;
    };
    /** Two correct quarter picks in a row → a rarer tip. */
    streak: boolean;
    /** First Server Rack / Data Center / Orbital Array in the NFT Minter → common / rarer / rarest tip. */
    minter: boolean;
    /** Players may buy tips with gold (off by default). Prices in gold per tier. */
    buy: { enabled: boolean; priceCommon: number; priceRarer: number; priceRarest: number };
    /** Trade an unused re-roll token for a common tip, at most once per cooldown (night minutes). */
    rerollTradeIn: { enabled: boolean; cooldownMinutes: number };
    /** Gold-equivalent value of a tip per tier (used by handicaps). */
    value: { common: number; rarer: number; rarest: number };
  };
  handicap: {
    /** Automatic handicap (Master only). Off by default; manual levels work either way. */
    autoEnabled: boolean;
    /** How often the automatic level is recalculated (night minutes). */
    intervalMinutes: number;
    /** Target extra gold by the end of the night at each level, as a fraction (levels 1–5). */
    gainByLevel: number[];
    /** Share of the help delivered as anonymous gold gifts; the rest as tips. */
    goldShare: number;
    /** Players who weren't in any game during the interval get this many levels less (never below 2 if struggling). */
    idlePenaltyLevels: number;
  };
}

/**
 * Defaults = the simulation-tuned market (Phase 2, approved Oct 24 2026; subject to change).
 * Original spec §20 values are kept in the sim as the 'spec-original' parameter set.
 */
export const DEFAULT_SETTINGS: Settings = {
  scoring: {
    placementMults: [1.0, 0.5, 0.25],
    tailFactor: 0.5,
    tieRule: 'average',
    dnfMult: 0,
    coopLossMult: 0.25,
    goldScale: 3,
    curve: 'linear',
    floorMult: 0.1,
  },
  stake: { startingGold: 20 },
  lateJoin: { goldFraction: 0.75, goldPenalty: 2, stockPenalty: 0.05 },
  market: {
    tickSeconds: 20,
    maxChangeFrac: 0.3,
    feeFrac: 0.03,
    endSellProfitFeeFrac: 0.1,
    investCap: 25,
    minTrade: 1,
    lockoutMinutes: 5,
    bands: {
      player: { min: 30, max: 80 },
      index: { min: 30, max: 80 },
      crypto: { min: 5, max: 150 },
      event: { min: 10, max: 100 },
      dead: { min: 1, max: 40 },
    },
    impact: { player: 0.02, index: 0, crypto: 0.06, event: 0.02, dead: 0.06 },
    slippage: 0,
    player: {
      fairInnerLo: 0.15,
      fairInnerHi: 0.85,
      reversion: 0.2,
      leaverDecay: 0.02,
      espionageFrac: 0.03,
    },
    index: { scale: 1, smoothing: 0.3, growthPerGold: 0.23, startDropPerGold: 0.15, noiseFrac: 0.01, noiseReversion: 0.1 },
    crypto: {
      sigma: 0.07,
      reversion: 0.05,
      baselineAlpha: 0.002, driftPerHour: -0.03,
      startFrac: 0.25,
      kingfallFrac: 0.1,
      kingfallHoldMinutes: 15,
    },
    event: { startFrac: 0.35, floorFrac: 0.1, decay: 0.005, bump: 0.08, reversion: 0.1 },
    dead: { baselineFrac: 0.05, reversion: 0.02 },
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
  espionage: { goldReward: 3, revealDelayMinSec: 15, revealDelayMaxSec: 45 },
  achievements: {
    gold: { first_blood: 2, hat_trick: 5, regular: 2, oracle: 1 },
  },
  prompts: { tradingCloseMinutesBefore: 15 },
  finale: { collapseSeconds: 10, podiumStepSeconds: 5, recapSlideSeconds: 8 },
  minter: { pauseMultiplier: 2, tvCrawlMinutes: 10 },
  hints: {
    enabled: true,
    games: { win: true, lastPlace: true, minMinutesLarge: 15, minMinutesSmall: 30, rarerMinutes: 90, rarestMinutes: 240 },
    streak: true,
    minter: true,
    buy: { enabled: false, priceCommon: 5, priceRarer: 10, priceRarest: 20 },
    rerollTradeIn: { enabled: true, cooldownMinutes: 120 },
    value: { common: 2, rarer: 4, rarest: 8 },
  },
  handicap: { autoEnabled: false, intervalMinutes: 60, gainByLevel: [0, 0.05, 0.12, 0.2, 0.3], goldShare: 0.3, idlePenaltyLevels: 1 },
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

  if (!Array.isArray(s.scoring.placementMults)) need(false, 'scoring.placementMults', 'must be a list of numbers');
  else {
    need(s.scoring.placementMults.length > 0, 'scoring.placementMults', 'needs at least one value');
    s.scoring.placementMults.forEach((m, i) => nonNeg(m, `scoring.placementMults.${i}`));
  }
  frac(s.scoring.tailFactor, 'scoring.tailFactor');
  need(['average', 'best', 'worst'].includes(s.scoring.tieRule), 'scoring.tieRule', 'unknown rule');
  nonNeg(s.scoring.dnfMult, 'scoring.dnfMult');
  nonNeg(s.scoring.coopLossMult, 'scoring.coopLossMult');
  pos(s.scoring.goldScale, 'scoring.goldScale');
  need(['linear', 'classic'].includes(s.scoring.curve), 'scoring.curve', 'linear or classic');
  frac(s.scoring.floorMult, 'scoring.floorMult');
  nonNeg(s.stake.startingGold, 'stake.startingGold');
  frac(s.lateJoin.goldFraction, 'lateJoin.goldFraction');
  nonNeg(s.lateJoin.goldPenalty, 'lateJoin.goldPenalty');
  frac(s.lateJoin.stockPenalty, 'lateJoin.stockPenalty');

  const m = s.market;
  need(m.tickSeconds >= 15 && m.tickSeconds <= 30, 'market.tickSeconds', 'must be 15–30');
  frac(m.maxChangeFrac, 'market.maxChangeFrac');
  frac(m.feeFrac, 'market.feeFrac');
  frac(m.slippage, 'market.slippage');
  frac(m.endSellProfitFeeFrac, 'market.endSellProfitFeeFrac');
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
  nonNeg(m.index.growthPerGold, 'market.index.growthPerGold');
  nonNeg(m.index.startDropPerGold, 'market.index.startDropPerGold');
  frac(m.index.noiseFrac, 'market.index.noiseFrac');
  frac(m.index.noiseReversion, 'market.index.noiseReversion');
  frac(m.crypto.sigma, 'market.crypto.sigma');
  frac(m.crypto.reversion, 'market.crypto.reversion');
  frac(m.crypto.baselineAlpha, 'market.crypto.baselineAlpha');
  need(m.crypto.driftPerHour > -1 && m.crypto.driftPerHour < 1, 'market.crypto.driftPerHour', 'must be between -1 and 1');
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
  nonNeg(s.espionage.goldReward, 'espionage.goldReward');
  nonNeg(s.espionage.revealDelayMinSec, 'espionage.revealDelayMinSec');
  need(s.espionage.revealDelayMaxSec >= s.espionage.revealDelayMinSec, 'espionage.revealDelayMaxSec', 'must be ≥ min');
  for (const [id, g] of Object.entries(s.achievements.gold)) nonNeg(g, `achievements.gold.${id}`);
  nonNeg(s.prompts.tradingCloseMinutesBefore, 'prompts.tradingCloseMinutesBefore');
  pos(s.finale.collapseSeconds, 'finale.collapseSeconds');
  pos(s.finale.podiumStepSeconds, 'finale.podiumStepSeconds');
  pos(s.finale.recapSlideSeconds, 'finale.recapSlideSeconds');
  need(s.minter.pauseMultiplier >= 1, 'minter.pauseMultiplier', 'must be ≥ 1');
  pos(s.minter.tvCrawlMinutes, 'minter.tvCrawlMinutes');
  const hg = s.hints.games;
  for (const k of ['minMinutesLarge', 'minMinutesSmall', 'rarerMinutes', 'rarestMinutes'] as const) nonNeg(hg[k], `hints.games.${k}`);
  need(hg.rarestMinutes >= hg.rarerMinutes, 'hints.games.rarestMinutes', 'must be ≥ rarerMinutes');
  for (const k of ['priceCommon', 'priceRarer', 'priceRarest'] as const) pos(s.hints.buy[k], `hints.buy.${k}`);
  nonNeg(s.hints.rerollTradeIn.cooldownMinutes, 'hints.rerollTradeIn.cooldownMinutes');
  for (const k of ['common', 'rarer', 'rarest'] as const) pos(s.hints.value[k], `hints.value.${k}`);
  pos(s.handicap.intervalMinutes, 'handicap.intervalMinutes');
  need(Array.isArray(s.handicap.gainByLevel) && s.handicap.gainByLevel.length === 5 && s.handicap.gainByLevel.every((x) => x >= 0 && x <= 2), 'handicap.gainByLevel', 'five fractions, 0–2');
  frac(s.handicap.goldShare, 'handicap.goldShare');
  need(Number.isInteger(s.handicap.idlePenaltyLevels) && s.handicap.idlePenaltyLevels >= 0 && s.handicap.idlePenaltyLevels <= 4, 'handicap.idlePenaltyLevels', 'whole number 0–4');
  return issues;
}

export function bandWidth(b: Band): number {
  return b.max - b.min;
}

export function bandAt(b: Band, frac: number): number {
  return b.min + frac * (b.max - b.min);
}
