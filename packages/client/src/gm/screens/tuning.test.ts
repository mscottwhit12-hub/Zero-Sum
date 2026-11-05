import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@gn/engine';
import { DIAL_GROUPS, dialFactor, dialPatch, expand, nearestStep } from './tuning';

const at = (o: unknown, p: string): unknown => p.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);

describe('tuning dials', () => {
  it('every dial points at real numeric settings', () => {
    for (const g of DIAL_GROUPS)
      for (const d of g.dials) {
        const ps = expand(d.paths);
        expect(ps.length, d.id).toBeGreaterThan(0);
        for (const p of ps) expect(typeof at(DEFAULT_SETTINGS, p), `${d.id} ${p}`).toBe('number');
      }
  });
  it('a dial is a multiplier on the defaults; ×1 sends nulls (back to default)', () => {
    const games = DIAL_GROUPS[0]!.dials[0]!;
    expect(dialPatch(games, 1.5)).toEqual({ scoring: { goldScale: DEFAULT_SETTINGS.scoring.goldScale * 1.5 } });
    expect(dialPatch(games, 1)).toEqual({ scoring: { goldScale: null } });
    const resolved = { ...DEFAULT_SETTINGS, scoring: { ...DEFAULT_SETTINGS.scoring, goldScale: DEFAULT_SETTINGS.scoring.goldScale * 2 } };
    expect(dialFactor(games, resolved)).toBe(2);
    const ach = DIAL_GROUPS[0]!.dials[1]!;
    expect(Object.keys((dialPatch(ach, 2) as { achievements: { gold: object } }).achievements.gold).length).toBe(Object.keys(DEFAULT_SETTINGS.achievements.gold).length);
    expect(nearestStep(1.1)).toBe(4);
    expect(nearestStep(9)).toBe(9);
  });
});
