import type { DeepPartial, Settings } from '@gn/engine';
import type { NightOptions } from './runner';

export interface ParamSet {
  name: string;
  note: string;
  settings: DeepPartial<Settings>;
}

/** Behavior assumptions shared by every parameter set (not GM settings). */
export const SIM_OPTIONS: Omit<NightOptions, 'seed' | 'players' | 'coalitionTarget'> = {
  lengthMinutes: 300,
  skillWeight: 0.8,
  lateJoinChance: 0.25,
  leaverChance: 0.25,
  inGameActivity: 0.25,
  coalitionGapMinutes: [20, 40],
};

const tunedMarket = {
  feeFrac: 0.03,
  player: { reversion: 0.3 },
  crypto: { sigma: 0.07, reversion: 0.05, kingfallFrac: 0.1 },
  impact: { player: 0.02, index: 0, crypto: 0.06, event: 0.02, dead: 0.06 },
  dead: { reversion: 0.02 },
};

const tunedCap30 = { ...tunedMarket, investCap: 30, player: { reversion: 0.2 } };

export const PARAM_SETS: ParamSet[] = [
  {
    name: 'spec-original',
    note: 'Original spec §20 market values with game gold ×3. For comparison only.',
    settings: {
      market: {
        feeFrac: 0,
        investCap: 50,
        impact: { player: 0.02, index: 0, crypto: 0.06, event: 0.02, dead: 0.08 },
        player: { reversion: 0.1 },
        crypto: { sigma: 0.1, reversion: 0.03, kingfallFrac: 0.2 },
        dead: { reversion: 0.01 },
      },
    },
  },
  {
    name: 'old-x1-tuned',
    note: 'Previous recommendation (game gold ×1, 3% fee, cap 30). For comparison only.',
    settings: { scoring: { goldScale: 1 }, market: tunedCap30 },
  },
  {
    name: 'recommended',
    note: 'Engine defaults (approved): game gold ×3, 3% trade fee, invest cap 25, faster player-price catch-up, calmer crypto, gentler dead stock.',
    settings: {},
  },
  {
    name: 'slippage-alt',
    note: 'NEW MECHANIC alternative: traders pay half their own price impact. Game gold ×3, 2% fee, fair range 20–80%, cap 25.',
    settings: {
      market: {
        ...tunedMarket,
        feeFrac: 0.02,
        slippage: 0.5,
        investCap: 25,
        player: { reversion: 0.3, fairInnerLo: 0.2, fairInnerHi: 0.8 },
        impact: { ...tunedMarket.impact, dead: 0.08 },
      },
    },
  },
];

/** Behavior-assumption stress tests for the recommended set. */
export const SENSITIVITY: { name: string; options: Partial<typeof SIM_OPTIONS> }[] = [
  { name: 'Players check phones twice as often mid-game', options: { inGameActivity: 0.5 } },
  { name: 'Players barely touch phones mid-game', options: { inGameActivity: 0.1 } },
  { name: 'Games are more luck than skill', options: { skillWeight: 0.4 } },
  { name: 'Games are more skill than luck', options: { skillWeight: 1.2 } },
  { name: 'Coalition pumps every 10–20 min', options: { coalitionGapMinutes: [10, 20] } },
];
