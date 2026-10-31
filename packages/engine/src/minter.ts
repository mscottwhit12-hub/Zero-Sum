/**
 * NFT Minter (spec §15.4): an Adventure Capitalist–style idle game, fun only. Its own fake currency ("credits"),
 * with ZERO link to gold, the market, or scoring. All numbers are placeholders.
 * The server is authoritative: phones send "run" taps and purchases; time is the night clock (pause excluded),
 * so everything keeps running whether the app is open or not, and stops while the night is paused or over.
 *
 *  - Businesses: you start with one Laptop. Tap a business to run one cycle; it pays when the timer fills.
 *    Each unit owned adds its payout to every cycle; each one costs `growth` more than the last.
 *  - Milestones: owning 25 / 50 / 100 / 200 / 300 / 400 of a business halves its cycle time each time.
 *  - Managers: one per business; it re-runs that business's cycle automatically, forever.
 *  - Upgrades: one-time "Overclock" buys, ×3 a business's payout.
 *  - Rebrand: reset credits, businesses, upgrades and managers for investors (permanent +% to everything).
 *    The leaderboard is lifetime NFTs minted, which a rebrand never resets.
 *  - Boost: a memo reward gives ×10 on everything for 5 minutes of night clock.
 */

export interface MinterTier {
  id: string;
  name: string;
  /** Price of the first unit; each one owned raises the next price by `growth`. */
  cost: number;
  growth: number;
  /** Seconds per cycle (before milestones). */
  time: number;
  /** Credits per cycle per unit owned (before upgrades/investors). */
  payout: number;
  managerCost: number;
}

export const MINTER_TIERS: MinterTier[] = [
  { id: 'laptop', name: 'Laptop', cost: 4, growth: 1.07, time: 1, payout: 1, managerCost: 1_000 },
  { id: 'rig', name: 'Gaming Rig', cost: 60, growth: 1.15, time: 3, payout: 60, managerCost: 15_000 },
  { id: 'rack', name: 'Server Rack', cost: 720, growth: 1.14, time: 6, payout: 540, managerCost: 100_000 },
  { id: 'datacenter', name: 'Data Center', cost: 8_640, growth: 1.13, time: 12, payout: 4_320, managerCost: 500_000 },
  { id: 'orbital', name: 'Orbital Array', cost: 103_680, growth: 1.12, time: 24, payout: 51_840, managerCost: 1_200_000 },
  { id: 'quantum', name: 'Quantum Farm', cost: 1_244_160, growth: 1.11, time: 96, payout: 622_080, managerCost: 10_000_000 },
];

export interface MinterUpgrade {
  id: string;
  name: string;
  cost: number;
  /** Business it multiplies. */
  target: string;
  mult: number;
}

export const MINTER_UPGRADES: MinterUpgrade[] = MINTER_TIERS.map((t) => ({ id: `oc-${t.id}`, name: `Overclock: ${t.name}`, cost: t.managerCost * 5, target: t.id, mult: 3 }));

export const MINTER_RULES = {
  milestones: [25, 50, 100, 200, 300, 400],
  /** Cycle time is divided by this at each milestone. */
  milestoneSpeed: 2,
  /** Investors earned in total = floor(sqrt(lifetime minted / investorUnit)). */
  investorUnit: 10_000_000,
  /** Each investor adds this fraction to all payouts. */
  investorBonus: 0.05,
  /** Memo reward "Minter boost". */
  boostSeconds: 300,
  boostMult: 10,
};

export interface MinterState {
  /** Lifetime NFTs minted tonight (leaderboard; never reset). */
  minted: number;
  /** Credits on hand (1 per NFT minted, spent in the shop). */
  credits: number;
  tiers: Record<string, number>;
  /** Cycle taps (stat only). */
  taps: number;
  upgrades?: string[];
  managers?: string[];
  /** Seconds into the current cycle, per running business (absent = idle). */
  prog?: Record<string, number>;
  /** Night-clock seconds of ×boostMult left. */
  boost?: number;
  /** Investors claimed by rebranding (permanent bonus). */
  investors?: number;
  rebrands?: number;
}

const START_TIERS = () => ({ laptop: 1 });
export const emptyMinter = (): MinterState => ({ minted: 0, credits: 0, tiers: START_TIERS(), taps: 0, upgrades: [], managers: [], prog: {}, boost: 0, investors: 0, rebrands: 0 });

export const tierCost = (t: MinterTier, owned: number) => Math.ceil(t.cost * Math.pow(t.growth, owned));
export const managerCost = (t: MinterTier) => t.managerCost;
export const nextMilestone = (owned: number) => MINTER_RULES.milestones.find((m) => owned < m) ?? null;
export const investorMult = (s: MinterState) => 1 + (s.investors ?? 0) * MINTER_RULES.investorBonus;
/** Investors a rebrand would add now. */
export const claimableInvestors = (s: MinterState) => Math.max(0, Math.floor(Math.sqrt(s.minted / MINTER_RULES.investorUnit)) - (s.investors ?? 0));

const upgradeMult = (s: MinterState, target: string) => MINTER_UPGRADES.filter((u) => u.target === target && (s.upgrades ?? []).includes(u.id)).reduce((a, u) => a * u.mult, 1);

/** Seconds per cycle at this many owned. */
export function cycleTime(t: MinterTier, owned: number): number {
  return t.time / Math.pow(MINTER_RULES.milestoneSpeed, MINTER_RULES.milestones.filter((m) => owned >= m).length);
}

/** Credits one cycle pays (no boost). */
export function cyclePayout(s: MinterState, t: MinterTier): number {
  return t.payout * (s.tiers[t.id] ?? 0) * upgradeMult(s, t.id) * investorMult(s);
}

/** Credits per second from managed businesses (no boost). */
export function minterRate(s: MinterState): number {
  return MINTER_TIERS.reduce((a, t) => a + ((s.managers ?? []).includes(t.id) && (s.tiers[t.id] ?? 0) > 0 ? cyclePayout(s, t) / cycleTime(t, s.tiers[t.id]!) : 0), 0);
}

const clone = (p: MinterState): MinterState => ({
  ...emptyMinter(),
  ...p,
  tiers: { ...p.tiers },
  upgrades: [...(p.upgrades ?? [])],
  managers: [...(p.managers ?? [])],
  prog: { ...(p.prog ?? {}) },
});

/** Advance by `dt` night-clock seconds: running cycles fill, finished ones pay, managed ones loop. */
export function advanceMinter(prev: MinterState, dt: number): MinterState {
  const s = clone(prev);
  const d = Math.max(0, dt);
  if (d === 0) return s;
  const b = Math.min(d, s.boost ?? 0);
  let gained = 0;
  for (const t of MINTER_TIERS) {
    const owned = s.tiers[t.id] ?? 0;
    const p0 = s.prog![t.id];
    const managed = s.managers!.includes(t.id);
    if (!owned || (p0 == null && !managed)) continue;
    const T = cycleTime(t, owned);
    const start = p0 ?? 0;
    const first = T - start; // seconds until the next payout
    const n = first > d ? 0 : managed ? 1 + Math.floor((d - first) / T) : 1;
    const boosted = n === 0 || first > b ? 0 : Math.min(n, 1 + Math.floor((b - first) / T));
    gained += cyclePayout(s, t) * (n + boosted * (MINTER_RULES.boostMult - 1));
    if (n === 0) s.prog![t.id] = start + d;
    else if (managed) s.prog![t.id] = (d - first) % T;
    else delete s.prog![t.id];
  }
  s.minted += gained;
  s.credits += gained;
  s.boost = Math.max(0, (s.boost ?? 0) - d);
  return s;
}

export interface MinterSync {
  /** In order: `run:<id>` (start a cycle), a business id (buy one), `up:<upgrade id>`, `mgr:<business id>`, or `rebrand`. */
  buys: string[];
}

/** Advance `elapsedSec` of night clock, then apply actions in order. `active` = the night is live (not paused/over). */
export function applyMinterSync(prev: MinterState, sync: MinterSync, elapsedSec: number, opts: { active: boolean }): { state: MinterState; rejected: string[] } {
  const s = opts.active ? advanceMinter(prev, elapsedSec) : clone(prev);
  const rejected: string[] = [];
  for (const raw of (sync.buys ?? []).slice(0, 50)) {
    const id = String(raw);
    if (!opts.active) {
      rejected.push(id);
      continue;
    }
    if (id.startsWith('run:')) {
      const t = MINTER_TIERS.find((x) => x.id === id.slice(4));
      if (!t || !(s.tiers[t.id] ?? 0) || s.prog![t.id] != null || s.managers!.includes(t.id)) {
        rejected.push(id);
        continue;
      }
      s.prog![t.id] = 0;
      s.taps += 1;
      continue;
    }
    if (id === 'rebrand') {
      const add = claimableInvestors(s);
      if (add < 1) {
        rejected.push(id);
        continue;
      }
      s.investors = (s.investors ?? 0) + add;
      s.rebrands = (s.rebrands ?? 0) + 1;
      s.credits = 0;
      s.tiers = START_TIERS();
      s.upgrades = [];
      s.managers = [];
      s.prog = {};
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
    const c = t ? tierCost(t, s.tiers[id] ?? 0) : Infinity;
    if (!t || c > s.credits) {
      rejected.push(id);
      continue;
    }
    // A running cycle keeps its progress as a fraction when a milestone shortens it.
    const before = cycleTime(t, s.tiers[id] ?? 0);
    s.credits -= c;
    s.tiers[id] = (s.tiers[id] ?? 0) + 1;
    const p = s.prog![id];
    if (p != null) s.prog![id] = (p / before) * cycleTime(t, s.tiers[id]!);
  }
  return { state: s, rejected };
}

/** Memo reward: add a ×10 boost (stacks in time). */
export function boostMinter(prev: MinterState): MinterState {
  const s = clone(prev);
  s.boost = (s.boost ?? 0) + MINTER_RULES.boostSeconds;
  return s;
}
