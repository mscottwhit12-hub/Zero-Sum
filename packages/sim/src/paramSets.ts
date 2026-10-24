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

export const PARAM_SETS: ParamSet[] = [
  { name: 'baseline', note: 'Spec §20 defaults (Phase 1 build, with the crypto model fix).', settings: {} },
  {
    name: 'tuned-fee',
    note: '3% trade fee, faster player-price reversion, calmer crypto, gentler dead stock. Uses only existing settings.',
    settings: { market: tunedMarket },
  },
  {
    name: 'tuned-fee-cap30',
    note: 'As tuned-fee, with slower player reversion (0.2) and invest cap 30.',
    settings: { market: { ...tunedMarket, investCap: 30, player: { reversion: 0.2 } } },
  },
  {
    name: 'tuned-slippage',
    note: 'NEW MECHANIC: traders pay half their own price impact at execution. 2% fee, narrower fair range (20–80%), cap 30.',
    settings: {
      market: {
        ...tunedMarket,
        feeFrac: 0.02,
        slippage: 0.5,
        investCap: 30,
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
