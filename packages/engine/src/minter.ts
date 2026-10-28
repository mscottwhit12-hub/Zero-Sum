/**
 * NFT Minter (spec §15.4): an idle clicker for fun only, in the Adventure Capitalist mould. Its own fake currency
 * ("credits"), with ZERO link to gold, the market, or scoring. All numbers are placeholders.
 * The server is authoritative: clients report taps and purchases; passive minting is computed from elapsed time.
 *
 *  - Generators: buy as many as you like; each one costs `costGrowth` more than the last.
 *  - Milestones: owning 10 / 25 / 50 / 100 / 200 of a generator doubles its output each time.
 *  - Upgrades: one-time buys. "Overclock" triples one generator; mouse upgrades multiply taps.
 *  - Managers: a generator only mints while the Minter is open, unless it has a manager (then it keeps going away).
 *  - Rebrand: reset credits, generators, upgrades and managers for investors (permanent +% to everything).
 *    The leaderboard is lifetime NFTs minted, which a rebrand never resets.
 */

export interface MinterTier {
  id: string;
  name: string;
  /** Base price in credits; each one owned raises the next price by `costGrowth`. */
  cost: number;
  /** NFTs minted per second per unit owned (before milestones/upgrades/investors). */
  rate: number;
  /** Only purchasable while the night is paused (intermission bonus tier). */
  intermissionOnly?: boolean;
}

export const MINTER_TIERS: MinterTier[] = [
  { id: 'laptop', name: 'Laptop', cost: 15, rate: 0.2 },
  { id: 'rig', name: 'Gaming Rig', cost: 100, rate: 1 },
  { id: 'rack', name: 'Server Rack', cost: 600, rate: 5 },
  { id: 'datacenter', name: 'Data Center', cost: 4_000, rate: 30 },
  { id: 'orbital', name: 'Orbital Array', cost: 30_000, rate: 200 },
  { id: 'breakroom', name: 'Break-Room Farm', cost: 400, rate: 8, intermissionOnly: true },
];

export interface MinterUpgrade {
  id: string;
  name: string;
  cost: number;
  /** Generator it multiplies, or 'tap' for tap value. */
  target: string;
  mult: number;
}

export const MINTER_UPGRADES: MinterUpgrade[] = [
  { id: 'mouse', name: 'Ergonomic Mouse', cost: 250, target: 'tap', mult: 2 },
  { id: 'macro', name: 'Macro Keyboard', cost: 15_000, target: 'tap', mult: 5 },
  ...MINTER_TIERS.map((t) => ({ id: `oc-${t.id}`, name: `Overclock: ${t.name}`, cost: t.cost * 60, target: t.id, mult: 3 })),
];

export const MINTER_RULES = {
  costGrowth: 1.15,
  /** Max taps per second accepted from a phone (anti-autoclicker, generous for humans). */
  maxTapsPerSecond: 15,
  /** Managed generators accrue for at most this long between syncs (phone asleep, etc.). */
  maxIdleSeconds: 600,
  /** Generators without a manager only count this long between syncs (i.e. while the Minter is open). */
  unmanagedSeconds: 8,
  /** A manager costs this many times the generator's base price. */
  managerCostMult: 25,
  milestones: [10, 25, 50, 100, 200],
  milestoneMult: 2,
  /** Investors earned in total = floor(sqrt(lifetime minted / investorUnit)). */
  investorUnit: 2_000,
  /** Each investor adds this fraction to all output (taps and generators). */
  investorBonus: 0.05,
};

export interface MinterState {
  /** Lifetime NFTs minted tonight (leaderboard; never reset). */
  minted: number;
  /** Credits on hand (1 per NFT minted, spent in the shop). */
  credits: number;
  tiers: Record<string, number>;
  taps: number;
  upgrades?: string[];
  managers?: string[];
  /** Investors claimed by rebranding (permanent bonus). */
  investors?: number;
  rebrands?: number;
}

export const emptyMinter = (): MinterState => ({ minted: 0, credits: 0, tiers: {}, taps: 0, upgrades: [], managers: [], investors: 0, rebrands: 0 });

export const tierCost = (t: MinterTier, owned: number) => Math.ceil(t.cost * Math.pow(MINTER_RULES.costGrowth, owned));
export const managerCost = (t: MinterTier) => t.cost * MINTER_RULES.managerCostMult;

/** ×2 per milestone reached. */
export const milestoneMult = (owned: number) => Math.pow(MINTER_RULES.milestoneMult, MINTER_RULES.milestones.filter((m) => owned >= m).length);
export const nextMilestone = (owned: number) => MINTER_RULES.milestones.find((m) => owned < m) ?? null;
export const investorMult = (s: MinterState) => 1 + (s.investors ?? 0) * MINTER_RULES.investorBonus;
/** Investors a rebrand would add now. */
export const claimableInvestors = (s: MinterState) => Math.max(0, Math.floor(Math.sqrt(s.minted / MINTER_RULES.investorUnit)) - (s.investors ?? 0));

const upgradeMult = (s: MinterState, target: string) => MINTER_UPGRADES.filter((u) => u.target === target && (s.upgrades ?? []).includes(u.id)).reduce((a, u) => a * u.mult, 1);

/** NFTs per tap. */
export const tapValue = (s: MinterState) => upgradeMult(s, 'tap') * investorMult(s);

/** One generator type's NFTs per second. */
export function tierRate(s: MinterState, t: MinterTier): number {
  const owned = s.tiers[t.id] ?? 0;
  return t.rate * owned * milestoneMult(owned) * upgradeMult(s, t.id) * investorMult(s);
}

/** Passive NFTs per second (before any intermission multiplier). Accepts a bare tier map for old callers. */
export function minterRate(s: MinterState | Record<string, number>): number {
  const st: MinterState = 'tiers' in s && typeof (s as MinterState).tiers === 'object' ? (s as MinterState) : { ...emptyMinter(), tiers: s as Record<string, number> };
  return MINTER_TIERS.reduce((a, t) => a + tierRate(st, t), 0);
}

export interface MinterSync {
  /** Taps since the last sync. */
  taps: number;
  /** Purchases in order: a generator id, `up:<upgrade id>`, `mgr:<generator id>`, or `rebrand`. */
  buys: string[];
}

/**
 * Apply one sync: passive minting for the elapsed time (managed generators up to maxIdleSeconds, the rest only up to
 * unmanagedSeconds), clamped taps, then purchases. `mult` is the intermission multiplier when paused, else 1.
 */
export function applyMinterSync(prev: MinterState, sync: MinterSync, elapsedSec: number, opts: { paused: boolean; mult: number }): { state: MinterState; rejected: string[] } {
  const p: MinterState = { ...emptyMinter(), ...prev };
  const elapsed = Math.max(0, elapsedSec);
  const mult = opts.paused ? Math.max(1, opts.mult) : 1;
  const taps = Math.max(0, Math.min(Math.floor(Number(sync.taps) || 0), Math.ceil(MINTER_RULES.maxTapsPerSecond * Math.max(Math.min(elapsed, MINTER_RULES.maxIdleSeconds), 1))));
  let passive = 0;
  for (const t of MINTER_TIERS) {
    const managed = (p.managers ?? []).includes(t.id);
    const dt = Math.min(elapsed, managed ? MINTER_RULES.maxIdleSeconds : MINTER_RULES.unmanagedSeconds);
    passive += tierRate(p, t) * dt;
  }
  const gained = (taps * tapValue(p) + passive) * mult;
  const s: MinterState = {
    ...p,
    minted: p.minted + gained,
    credits: p.credits + gained,
    tiers: { ...p.tiers },
    taps: p.taps + taps,
    upgrades: [...(p.upgrades ?? [])],
    managers: [...(p.managers ?? [])],
  };
  const rejected: string[] = [];
  for (const raw of (sync.buys ?? []).slice(0, 50)) {
    const id = String(raw);
    if (id === 'rebrand') {
      const add = claimableInvestors(s);
      if (add < 1) {
        rejected.push(id);
        continue;
      }
      s.investors = (s.investors ?? 0) + add;
      s.rebrands = (s.rebrands ?? 0) + 1;
      s.credits = 0;
      s.tiers = {};
      s.upgrades = [];
      s.managers = [];
      continue;
    }
    if (id.startsWith('up:')) {
      const u = MINTER_UPGRADES.find((x) => x.id === id.slice(3));
      if (!u || s.upgrades!.includes(u.id) || u.cost > s.credits) {
        rejected.push(id);
        continue;
      }
      s.credits -= u.cost;
      s.upgrades!.push(u.id);
      continue;
    }
    if (id.startsWith('mgr:')) {
      const t = MINTER_TIERS.find((x) => x.id === id.slice(4));
      if (!t || s.managers!.includes(t.id) || !(s.tiers[t.id] ?? 0) || managerCost(t) > s.credits) {
        rejected.push(id);
        continue;
      }
      s.credits -= managerCost(t);
      s.managers!.push(t.id);
      continue;
    }
    const t = MINTER_TIERS.find((x) => x.id === id);
    if (!t || (t.intermissionOnly && !opts.paused)) {
      rejected.push(id);
      continue;
    }
    const c = tierCost(t, s.tiers[id] ?? 0);
    if (c > s.credits) {
      rejected.push(id);
      continue;
    }
    s.credits -= c;
    s.tiers[id] = (s.tiers[id] ?? 0) + 1;
  }
  return { state: s, rejected };
}
