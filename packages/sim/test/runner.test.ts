import { resolveSettings } from '@gn/engine';
import { describe, expect, it } from 'vitest';
import { aggregate } from '../src/metrics';
import { PARAM_SETS, SIM_OPTIONS } from '../src/paramSets';
import { runNight } from '../src/runner';

const opts = (seed: number) => ({ ...SIM_OPTIONS, seed, players: 12, coalitionTarget: 'dead' as const });

describe('sim runner', () => {
  it('is deterministic per seed', () => {
    const s = resolveSettings();
    expect(runNight(opts(5), s)).toEqual(runNight(opts(5), s));
  });
  it('runs full nights for every parameter set and both sizes (ledger sanity checked inside)', () => {
    for (const set of PARAM_SETS) {
      const s = resolveSettings(set.settings);
      const ms = [1, 2, 3].map((seed) => runNight({ ...opts(seed), players: seed === 3 ? 20 : 12 }, s));
      expect(ms.every((m) => m.games > 5 && m.winnerGoldH > 0)).toBe(true);
      expect(aggregate(ms).targets).toHaveLength(9);
    }
  });
});
