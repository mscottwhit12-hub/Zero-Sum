import {
  active,
  allUnlocked,
  doBuy,
  doSellAll,
  holdingH,
  impliedFair,
  lotsOf,
  netWorthH,
  playerSecId,
  ranksBy,
  sec,
  unlockedFor,
  type AgentKind,
  type SimPlayer,
  type World,
} from '../world';

type Act = (w: World, p: SimPlayer) => void;

const G = (gold: number) => Math.round(gold * 100);
const prompted = (w: World) => w.tick >= w.closePromptTick;

/** Before close: sell every unlocked position in profit (avoids the end-of-night profit fee). */
function sellProfitableBeforeClose(w: World, p: SimPlayer): boolean {
  if (!prompted(w)) return false;
  for (const secId of new Set(lotsOf(w, p.id).map((l) => l.securityId))) {
    if (!unlockedFor(w, p.id, secId)) continue;
    const h = holdingH(w, p.id, secId);
    if (h.shares * sec(w, secId).price > h.basis * 1.0) {
      if (doSellAll(w, p.id, secId)) return true;
    }
  }
  return true; // no new buys after the prompt
}

const holder: Act = (w, p) => {
  const m = p.mem as { step?: number };
  const step = m.step ?? 0;
  if (step === 0 && (w.cash.get(p.id) ?? 0) >= G(10)) {
    if (doBuy(w, p.id, 'index', G(8))) m.step = 1;
  } else if (step === 1) {
    if (doBuy(w, p.id, playerSecId(p.id), G(6)) || w.rng.next() < 0.1) m.step = 2;
  } else if (step === 2 && w.tick >= w.totalTicks / 2) {
    const r = ranksBy(w, (id) => netWorthH(w, id));
    const leader = [...r].find(([, rank]) => rank === 1)?.[0];
    if (leader && doBuy(w, p.id, playerSecId(leader), G(8))) m.step = 3;
    else if (w.rng.next() < 0.1) m.step = 3;
  }
};

const trader: Act = (w, p) => {
  if (sellProfitableBeforeClose(w, p)) return;
  if (w.rng.next() > 0.35) return;
  const fair = impliedFair(w);
  // Sell side first.
  for (const secId of new Set(lotsOf(w, p.id).map((l) => l.securityId))) {
    if (!unlockedFor(w, p.id, secId)) continue;
    const s = sec(w, secId);
    const h = holdingH(w, p.id, secId);
    const pnl = (h.shares * s.price) / h.basis - 1;
    const f = s.kind === 'player' ? fair.get(s.playerId!) : undefined;
    if (pnl >= 0.08 || pnl <= -0.08 || (f !== undefined && s.price >= f - 0.5)) {
      if (doSellAll(w, p.id, secId)) return;
    }
  }
  // Buy the most under-priced player stock.
  let best: { id: string; edge: number } | null = null;
  for (const [pid, f] of fair) {
    const s = sec(w, playerSecId(pid));
    const edge = (f - s.price) / s.price;
    if (!best || edge > best.edge) best = { id: s.id, edge };
  }
  if (best && best.edge > 0.04) doBuy(w, p.id, best.id, G(10));
};

const selfPumper: Act = (w, p) => {
  const own = playerSecId(p.id);
  const m = p.mem as { phase?: 'buy' | 'hold' | 'cool'; buys?: number; until?: number; cost?: number; rank?: number };
  const earnedRank = () => ranksBy(w, (id) => w.earned.get(id) ?? 0).get(p.id)!;
  m.phase ??= 'cool';
  if (prompted(w) && m.phase !== 'hold') return;
  if (m.phase === 'cool') {
    if (w.tick >= (m.until ?? 0)) Object.assign(m, { phase: 'buy', buys: 0, cost: 0, rank: earnedRank() });
    return;
  }
  if (m.phase === 'buy') {
    const spent = doBuy(w, p.id, own, G(10));
    m.cost! += spent;
    m.buys! += 1;
    if (m.buys! >= 3 || spent === 0) m.phase = m.cost! > 0 ? 'hold' : 'cool';
    if (m.phase === 'cool') m.until = w.tick + w.rng.int(10, 30);
    return;
  }
  if (allUnlocked(w, p.id, own)) {
    const r = doSellAll(w, p.id, own);
    if (r) {
      w.trips.selfPump.push({ playerId: p.id, securityId: own, costH: m.cost!, proceedsH: r.proceedsH, rankAtBuy: m.rank!, rankAtSell: earnedRank() });
      Object.assign(m, { phase: 'cool', until: w.tick + w.rng.int(10, 30) });
    }
  }
};

/** Coalition members act together through w.coalition (driven from coalitionStep). */
const coalition: Act = () => {};

export function coalitionStep(w: World) {
  const c = w.coalition;
  const members = c.members.filter((id) => active(w).some((p) => p.id === id));
  if (members.length === 0) return;
  if (c.phase === 'idle') {
    if (w.tick < c.nextTick || prompted(w)) return;
    for (const id of members) {
      const spent = doBuy(w, id, c.targetId, G(15));
      if (spent) c.costs.set(id, spent);
    }
    if (c.costs.size) {
      c.phase = 'holding';
      c.sellTick = w.tick + Math.ceil((w.settings.market.lockoutMinutes * 60_000) / w.tickMs) + w.rng.int(0, 2);
    } else c.nextTick = w.tick + 20;
    return;
  }
  if (w.tick < c.sellTick) return;
  for (const [id, cost] of [...c.costs]) {
    const r = doSellAll(w, id, c.targetId);
    if (r) {
      w.trips.coalition.push({ playerId: id, securityId: c.targetId, costH: cost, proceedsH: r.proceedsH });
      c.costs.delete(id);
    }
  }
  if (c.costs.size === 0) {
    c.phase = 'idle';
    c.nextTick = w.tick + w.rng.int(c.gap[0], c.gap[1]);
  }
}

const gambler: Act = (w, p) => {
  if (prompted(w)) return;
  const h = holdingH(w, p.id, 'crypto');
  if (h.shares > 0 && unlockedFor(w, p.id, 'crypto')) {
    const pnl = (h.shares * sec(w, 'crypto').price) / h.basis - 1;
    if (Math.abs(pnl) >= 0.15 || w.rng.next() < 0.03) doSellAll(w, p.id, 'crypto');
    return;
  }
  if (w.rng.next() < 0.05) doBuy(w, p.id, 'crypto', G(w.rng.int(10, 20)));
};

const random: Act = (w, p) => {
  if (w.rng.next() > 0.04) return;
  const held = [...new Set(lotsOf(w, p.id).map((l) => l.securityId))];
  if (held.length && w.rng.next() < 0.5) {
    doSellAll(w, p.id, w.rng.pick(held));
  } else if (!prompted(w)) {
    doBuy(w, p.id, w.rng.pick(w.securities).id, G(w.rng.int(5, 15)));
  }
};

const inactive: Act = () => {};

export const AGENTS: Record<AgentKind, Act> = { holder, trader, selfPumper, coalition, gambler, random, inactive };

/** Agent mix by party size. */
export function agentMix(n: number): AgentKind[] {
  const base: AgentKind[] =
    n >= 20
      ? ['holder', 'holder', 'holder', 'trader', 'trader', 'trader', 'trader', 'selfPumper', 'selfPumper', 'coalition', 'coalition', 'coalition', 'gambler', 'gambler', 'random', 'random']
      : ['holder', 'holder', 'trader', 'trader', 'selfPumper', 'coalition', 'coalition', 'coalition', 'gambler', 'random'];
  const out = [...base];
  while (out.length < n) out.push('inactive');
  return out.slice(0, n);
}
