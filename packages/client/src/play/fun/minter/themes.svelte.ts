/**
 * Minter rebrands (Tate, Nov 4): every rebrand literally rebrands the company. Five themes rotate (rebrand 5 is back
 * to the start); you can rebrand as often as you like. Only names and colour change: the businesses, numbers and the
 * leaderboard are the same underneath (ids laptop … quantum in the engine).
 */
export interface MinterTheme {
  /** Company / app name shown in the header. */
  name: string;
  /** What the lifetime counter counts (plural). */
  unit: string;
  /** Progress-bar colour (phone palette). */
  accent: string;
  biz: Record<string, string>;
}

export const MINTER_THEMES: MinterTheme[] = [
  {
    name: 'NFT Minter',
    unit: 'NFTs',
    accent: '#2e6b55',
    biz: { laptop: 'Laptop', rig: 'Gaming Rig', rack: 'Server Rack', datacenter: 'Data Center', orbital: 'Orbital Array', quantum: 'Quantum Farm' },
  },
  {
    name: 'Meme Coin Foundry',
    unit: 'coins',
    accent: '#8a5a1c',
    biz: { laptop: 'Group Chat', rig: 'Influencer', rack: 'Bot Farm', datacenter: 'Exchange Listing', orbital: 'Celebrity Tweet', quantum: 'Rug-Pull Insurance' },
  },
  {
    name: 'AI Startup',
    unit: 'tokens',
    accent: '#4b4f8f',
    biz: { laptop: 'Prompt Intern', rig: 'Rented GPU', rack: 'Wrapper App', datacenter: 'Seed Round', orbital: 'Hype Keynote', quantum: 'AGI Rumour' },
  },
  {
    name: 'Hedge Fund',
    unit: 'trades',
    accent: '#6e2f3a',
    biz: { laptop: 'Summer Analyst', rig: 'Algo Bot', rack: 'Trading Desk', datacenter: 'Dark Pool', orbital: 'Offshore Entity', quantum: 'Friend at the Fed' },
  },
  {
    name: 'Metaverse Realty',
    unit: 'parcels',
    accent: '#2f6378',
    biz: { laptop: 'Virtual Lot', rig: 'Pixel Mansion', rack: 'Avatar Mall', datacenter: 'Concert Venue', orbital: 'Private Island', quantum: 'Entire Planet' },
  },
];

export const themeFor = (rebrands: number): MinterTheme => MINTER_THEMES[(((rebrands | 0) % MINTER_THEMES.length) + MINTER_THEMES.length) % MINTER_THEMES.length]!;

/** The current brand, so the phone header and home screen can show it once the Minter has loaded. */
export const minterBrand = $state<{ name: string | null }>({ name: null });
