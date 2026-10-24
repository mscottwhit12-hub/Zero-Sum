import {
  buy,
  capRemainingH,
  computeFair,
  sell,
  sellValueH,
  type GameResult,
  type GoldH,
  type Impulse,
  type LedgerInput,
  type Lot,
  type Rng,
  type SecurityState,
  type Settings,
} from '@gn/engine';

export type AgentKind = 'holder' | 'trader' | 'selfPumper' | 'coalition' | 'gambler' | 'random' | 'inactive';
export const AGENT_KINDS: AgentKind[] = ['holder', 'trader', 'selfPumper', 'coalition', 'gambler', 'random', 'inactive'];

export interface SimPlayer {
  id: string;
  skill: number;
  agent: AgentKind;
  joinedTick: number;
  leftTick: number | null;
  gotStake: boolean;
  rerolls: number;
  /** Not available for a new game before this tick. */
  busyUntil: number;
  inGame: boolean;
  /** Agent scratch memory. */
  mem: Record<string, unknown>;
}

export interface ActiveGame {
  result: GameResult;
  startTick: number;
  endTick: number;
  /** Predetermined winner(s) for crown taps. */
  winners: string[];
  crown: { leaderId: string | null; since: number };
  nextTapTick: number;
  rerollTick: number | null;
  /** Expected gold for 1st, for trader signals. */
  firstGoldH: GoldH;
}

export interface RoundTrip {
  playerId: string;
  securityId: string;
  costH: GoldH;
  proceedsH: GoldH;
  /** Self-pumper: earned-rank at buy and sell. */
  rankAtBuy?: number;
  rankAtSell?: number;
}

export interface World {
  settings: Settings;
  rng: Rng;
  tick: number;
  tickMs: number;
  totalTicks: number;
  closeTick: number;
  closePromptTick: number;
  players: SimPlayer[];
  securities: SecurityState[];
  secIndex: Map<string, number>;
  lots: Map<string, Lot[]>;
  lotSeq: number;
  ledger: LedgerInput;
  earned: Map<string, GoldH>;
  cash: Map<string, GoldH>;
  impulses: Impulse[];
  lastTradeTick: Map<string, number>;
  marketOpen: boolean;
  games: ActiveGame[];
  results: GameResult[];
  trips: { selfPump: RoundTrip[]; coalition: RoundTrip[] };
  coalition: { members: string[]; targetId: string; phase: 'idle' | 'holding'; nextTick: number; sellTick: number; gap: [number, number]; costs: Map<string, GoldH> };
}

export const now = (w: World) => w.tick * w.tickMs;
export const active = (w: World) => w.players.filter((p) => p.joinedTick <= w.tick && p.leftTick === null);
export const sec = (w: World, id: string) => w.securities[w.secIndex.get(id)!]!;
export const playerSecId = (pid: string) => `p:${pid}`;
export const lotsOf = (w: World, pid: string) => w.lots.get(pid) ?? [];

export function addGold(w: World, pid: string, h: GoldH, earned: boolean) {
  w.cash.set(pid, (w.cash.get(pid) ?? 0) + h);
  if (earned) w.earned.set(pid, (w.earned.get(pid) ?? 0) + h);
}

export function holdingH(w: World, pid: string, secId: string) {
  return lotsOf(w, pid)
    .filter((l) => l.securityId === secId)
    .reduce((a, l) => ({ shares: a.shares + l.sharesH, basis: a.basis + l.costBasisH }), { shares: 0, basis: 0 });
}

export function netWorthH(w: World, pid: string): GoldH {
  let v = w.cash.get(pid) ?? 0;
  for (const l of lotsOf(w, pid)) v += sellValueH(l.sharesH, sec(w, l.securityId).price, w.settings.market.feeFrac);
  return v;
}

/** Competition ranks (1 = best) of active players by a value. */
export function ranksBy(w: World, value: (pid: string) => number): Map<string, number> {
  const ps = active(w).map((p) => ({ id: p.id, v: value(p.id) })).sort((a, b) => b.v - a.v);
  const out = new Map<string, number>();
  ps.forEach((p, i) => out.set(p.id, i > 0 && ps[i - 1]!.v === p.v ? out.get(ps[i - 1]!.id)! : i + 1));
  return out;
}

export function capLeftH(w: World, pid: string) {
  return capRemainingH(lotsOf(w, pid), pid, w.settings);
}

/** Buy up to `goldH`, trimmed to cash and cap. Returns gold spent (0 on failure). */
export function doBuy(w: World, pid: string, secId: string, goldH: GoldH): GoldH {
  const amount = Math.min(goldH, w.cash.get(pid) ?? 0, capLeftH(w, pid));
  if (amount < 100) return 0;
  const key = `${pid}|${secId}`;
  const r = buy(
    {
      playerId: pid,
      security: sec(w, secId),
      goldH: amount,
      cashH: w.cash.get(pid) ?? 0,
      lots: lotsOf(w, pid),
      gate: { marketOpen: w.marketOpen, tick: w.tick, lastTradeTick: w.lastTradeTick.get(key) ?? null, now: now(w) },
      lotId: `l${w.lotSeq++}`,
    },
    w.settings,
  );
  if (!r.ok) return 0;
  w.lots.set(pid, [...lotsOf(w, pid), r.lot]);
  w.ledger.tradeFlows.push({ playerId: pid, cashH: r.trade.cashH });
  addGold(w, pid, r.trade.cashH, false);
  if (r.impulse) w.impulses.push(r.impulse);
  w.lastTradeTick.set(key, w.tick);
  return -r.trade.cashH;
}

/** Sell all unlocked shares of a security. Returns { proceeds, basis } or null. */
export function doSellAll(w: World, pid: string, secId: string): { proceedsH: GoldH; basisH: GoldH } | null {
  const key = `${pid}|${secId}`;
  const mine = lotsOf(w, pid);
  const r = sell(
    {
      playerId: pid,
      security: sec(w, secId),
      sharesH: 'all',
      lots: mine.filter((l) => l.securityId === secId),
      gate: { marketOpen: w.marketOpen, tick: w.tick, lastTradeTick: w.lastTradeTick.get(key) ?? null, now: now(w) },
    },
    w.settings,
  );
  if (!r.ok) return null;
  w.lots.set(pid, [...mine.filter((l) => l.securityId !== secId), ...r.lots]);
  w.ledger.tradeFlows.push({ playerId: pid, cashH: r.trade.cashH });
  addGold(w, pid, r.trade.cashH, false);
  if (r.impulse) w.impulses.push(r.impulse);
  w.lastTradeTick.set(key, w.tick);
  return { proceedsH: r.trade.cashH, basisH: r.trade.basisH! };
}

export function unlockedFor(w: World, pid: string, secId: string) {
  return lotsOf(w, pid).some((l) => l.securityId === secId && l.unlockAt <= now(w));
}

export function allUnlocked(w: World, pid: string, secId: string) {
  const ls = lotsOf(w, pid).filter((l) => l.securityId === secId);
  return ls.length > 0 && ls.every((l) => l.unlockAt <= now(w));
}

/**
 * Public-information fair estimate: earned gold plus half the expected 1st-place gold for each
 * crown currently held (crowns are public on the TV).
 */
export function impliedFair(w: World): Map<string, number> {
  const proj = new Map<string, number>();
  for (const p of active(w)) proj.set(p.id, w.earned.get(p.id) ?? 0);
  for (const g of w.games) {
    const id = g.crown.leaderId;
    if (id && proj.has(id)) proj.set(id, proj.get(id)! + g.firstGoldH * 0.5);
  }
  const m = w.settings.market;
  return computeFair(
    [...proj].map(([playerId, earnedH]) => ({ playerId, earnedH })),
    m.bands.player,
    m.player.fairInnerLo,
    m.player.fairInnerHi,
  );
}
