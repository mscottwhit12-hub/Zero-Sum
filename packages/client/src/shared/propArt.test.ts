import { describe, expect, it } from 'vitest';
import { BOARD_PROP, PROP_KINDS, propKind } from '@gn/engine';
import { propArt } from './propArt';
import { BOARDS } from '../gm/boards';

describe('table prop art', () => {
  it('every prop kind has its own picture; every installed board has a mini board', () => {
    const fallback = propArt('no-such-prop');
    for (const k of PROP_KINDS) {
      expect(propArt(k.id), k.id).not.toBe(fallback);
      expect(propArt(k.id)).not.toMatch(/<script|on\w+=/i);
    }
    for (const key of Object.keys(BOARDS)) expect(propKind(BOARD_PROP[key] ?? ''), key).not.toBeNull();
  });
});
