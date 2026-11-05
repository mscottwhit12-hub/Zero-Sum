import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@gn/engine';
import { call, liveNight, makeApp } from './helpers';

// The GM Settings "Tuning" dials (client gm/screens/tuning.ts) scale these defaults from ×0 to ×3.
const PATHS = ['scoring.goldScale', 'votes.bountyGold', 'espionage.goldReward', 'market.player.liveMax', 'mood.moodMax', 'market.crypto.kingfallFrac', 'market.impact.player', 'market.impact.crypto', 'market.impact.event', 'market.impact.dead', 'market.crypto.sigma', 'market.index.growthPerGold', 'market.feeFrac', 'market.investCap', ...Object.keys(DEFAULT_SETTINGS.achievements.gold).map((k) => `achievements.gold.${k}`)];
const at = (o: unknown, p: string): number => p.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown>)[k], o) as number;
const body = (p: string, v: number) => p.split('.').reduceRight<unknown>((acc, k) => ({ [k]: acc }), v) as object;

describe('tuning dial limits', () => {
  it('every dial path accepts its range (×0, or ×0.25 for games and the cap, to ×3)', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const refused: string[] = [];
    for (const p of PATHS)
      for (const f of p === 'scoring.goldScale' || p === 'market.investCap' ? [0.25, 3] : [0, 0.25, 3]) {
        const r = await call(t, gm, 'PATCH', '/api/night/settings', body(p, Math.round(at(DEFAULT_SETTINGS, p) * f * 1e6) / 1e6));
        if (r.statusCode !== 200) refused.push(`${p} ×${f}: ${r.json().message ?? r.json().error}`);
      }
    expect(refused).toEqual([]);
  });
});
