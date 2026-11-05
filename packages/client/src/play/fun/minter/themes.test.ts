import { describe, expect, it } from 'vitest';
import { MINTER_THEMES, themeFor } from './themes.svelte';

describe('Minter rebrand themes', () => {
  it('five themes rotate forever, one per rebrand; every theme names all six businesses', () => {
    expect(MINTER_THEMES).toHaveLength(5);
    expect(themeFor(0).name).toBe('NFT Minter');
    expect(themeFor(1).name).toBe('Meme Coin Foundry');
    expect(themeFor(5).name).toBe('NFT Minter');
    expect(themeFor(12).name).toBe(themeFor(2).name);
    for (const th of MINTER_THEMES) expect(Object.keys(th.biz).sort()).toEqual(['datacenter', 'laptop', 'orbital', 'quantum', 'rack', 'rig']);
    expect(new Set(MINTER_THEMES.map((x) => x.name)).size).toBe(5);
  });
});
