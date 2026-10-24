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

import { analyse, buildRoster, runStudyNight, SOLO } from '../src/study';
import { createRng } from '@gn/engine';
import { AGENT_KINDS } from '../src/world';

describe('population study', () => {
  it('rosters cover every type and tier over many nights', () => {
    const rng = createRng(3);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) for (const r of buildRoster(rng, 20)) seen.add(`${r.agent}|${r.tier}`);
    expect(seen.size).toBe(AGENT_KINDS.length * 3);
    expect(SOLO).toHaveLength(25);
  });
  it('every agent type runs without breaking the ledger', () => {
    const s = resolveSettings(PARAM_SETS.find((p) => p.name === 'recommended')!.settings);
    const nights = [1, 2, 3, 4, 5, 6].map((i) => runStudyNight(i, i % 2 ? 12 : 20, s));
    expect(nights.every((n) => n.playerRows.length === n.players)).toBe(true);
    expect(analyse(nights).cells.size).toBe(AGENT_KINDS.length * 3);
  });
});
