import { describe, expect, it } from 'vitest';
import { autoLevels, drawHint, effectiveLevel, gameHintTier, HINT_POOL, intervalHelpH, resolveSettings, spendHintCredit, validateSettings } from '../src';

const S = resolveSettings({});

describe('hints', () => {
  it('defaults validate', () => expect(validateSettings(S)).toEqual([]));
  it('game tiers', () => {
    expect(gameHintTier(4, 0.2, S)).toBeNull();
    expect(gameHintTier(4, 0.25, S)).toBe('common');
    expect(gameHintTier(3, 0.4, S)).toBeNull();
    expect(gameHintTier(3, 0.5, S)).toBe('common');
    expect(gameHintTier(6, 1.6, S)).toBe('rarer');
    expect(gameHintTier(6, 4.2, S)).toBe('rarest');
    expect(gameHintTier(1, 5, S)).toBeNull();
  });
  it('no repeats per tier, then the next tier down, then repeats', () => {
    const seen = new Set<string>();
    const rarest = HINT_POOL.filter((h) => h.tier === 'rarest').length;
    const got: string[] = [];
    for (let i = 0; i < rarest; i++) {
      const h = drawHint('rarest', seen, 0.5);
      expect(h.tier).toBe('rarest');
      seen.add(h.id);
      got.push(h.id);
    }
    expect(new Set(got).size).toBe(rarest);
    expect(drawHint('rarest', seen, 0.1).tier).toBe('rarer');
    for (const h of HINT_POOL) seen.add(h.id);
    expect(drawHint('common', seen, 0.9).tier).toBe('common');
  });
});

describe('handicap', () => {
  const mk = (id: string, nw: number, prev: number, place: number | null, played = true) => ({ id, netWorthH: nw, prevNetWorthH: prev, placementScore: place, playedInInterval: played });
  it('top half level 1; bottom half 2..5, worst highest', () => {
    const lv = autoLevels([mk('a', 9000, 5000, 1), mk('b', 7000, 5000, 0.7), mk('c', 5000, 4000, 0.4), mk('d', 2500, 2400, 0)], S);
    expect(lv.map((l) => l.level)).toEqual([1, 1, expect.any(Number), 5]);
    expect(lv[2]!.level).toBeGreaterThanOrEqual(2);
    expect(lv[2]!.level).toBeLessThan(5);
  });
  it('idle players are helped less but still helped', () => {
    const lv = autoLevels([mk('a', 9000, 5000, 1), mk('b', 7000, 5000, 0.7), mk('d', 2500, 2400, 0, false)], S);
    expect(lv[2]!.level).toBe(4);
    expect(lv[2]!.reasons.idle).toBe(true);
  });
  it('manual offset on top, clamped', () => {
    expect(effectiveLevel(1, 2)).toBe(3);
    expect(effectiveLevel(5, 2)).toBe(5);
    expect(effectiveLevel(2, -3)).toBe(1);
  });
  it('level 5 for a whole night ≈ +30%, split 30/70', () => {
    let gift = 0;
    let credit = 0;
    for (let h = 0; h < 8; h++) {
      const x = intervalHelpH(5, 3000, S, 480);
      gift += x.giftH;
      credit += x.hintCreditH;
    }
    expect(gift + credit).toBeCloseTo(900, -1);
    expect(gift / (gift + credit)).toBeCloseTo(0.3, 1);
  });
  it('hint credit buys the best affordable tier', () => expect(spendHintCredit(1450, S)).toEqual({ tiers: ['rarest', 'rarer', 'common'], leftH: 50 }));
});
