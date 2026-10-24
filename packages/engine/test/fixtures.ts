import { resolveSettings, type DeepPartial, type Settings } from '../src';

/** Original spec §20 values (game gold ×1). Worked examples in the tests are written against these. */
export const SPEC_PATCH: DeepPartial<Settings> = {
  scoring: { goldScale: 1 },
  market: {
    feeFrac: 0,
    investCap: 50,
    impact: { player: 0.02, index: 0, crypto: 0.06, event: 0.02, dead: 0.08 },
    player: { reversion: 0.1 },
    crypto: { sigma: 0.1, reversion: 0.03, kingfallFrac: 0.2 },
    dead: { reversion: 0.01 },
  },
};

/** Spec values with an optional override on top. */
export const spec = (patch: DeepPartial<Settings> = {}) => resolveSettings(patch, resolveSettings(SPEC_PATCH));
