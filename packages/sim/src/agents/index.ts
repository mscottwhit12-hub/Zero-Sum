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
  capLeftH,
  type AgentKind,
  type SimPlayer,
  type World,
} from '../world';

type Act = (w: World, p: SimPlayer) => void;

const G = (gold: number) => Math.round(gold * 100);
const prompted = (w: World) => w.tick >= w.closePromptTick;
const minutes = (w: World, m: number) => Math.round((m * 60_000) / w.tickMs);
const heldIds = (w: World, p: SimPlayer) => [...new Set(lotsOf(w, p.id).map((l) => l.securityId))];
/** Position return at the current price (before fees). */
function pnl(w: World, p: SimPlayer, secId: string): number {
  const h = holdingH(w, p.id, secId);
  return h.basis > 0 ? (h.shares * sec(w, secId).price) / h.basis - 1 : 0;
}
const others = (w: World, p: SimPlayer) => active(w).filter((x) => x.id !== p.id);

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

/** Fair-value trader on public info (results + crowns). Parameterized for variants. */
function makeTrader(o: { act: number; edge: number; takeProfit: number; stopLoss: number; size: number }): Act {
  return (w, p) => {
    if (sellProfitableBeforeClose(w, p)) return;
    if (w.rng.next() > o.act) return;
    const fair = impliedFair(w);
    for (const secId of heldIds(w, p)) {
      if (!unlockedFor(w, p.id, secId)) continue;
      const s = sec(w, secId);
      const r = pnl(w, p, secId);
      const f = s.kind === 'player' ? fair.get(s.playerId!) : undefined;
      if (r >= o.takeProfit || r <= -o.stopLoss || (f !== undefined && s.price >= f - 0.5)) {
        if (doSellAll(w, p.id, secId)) return;
      }
    }
    let best: { id: string; edge: number } | null = null;
    for (const [pid, f] of fair) {
      const s = sec(w, playerSecId(pid));
      const edge = (f - s.price) / s.price;
      if (!best || edge > best.edge) best = { id: s.id, edge };
    }
    if (best && best.edge > o.edge) doBuy(w, p.id, best.id, G(o.size));
  };
}

const trader = makeTrader({ act: 0.35, edge: 0.04, takeProfit: 0.08, stopLoss: 0.08, size: 10 });

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

// ---------------------------------------------------------------- added 20

/** Buys the crowned leader of a running game; sells once that game has finished. */
const crownChaser: Act = (w, p) => {
  if (sellProfitableBeforeClose(w, p)) return;
  if (w.rng.next() > 0.3) return;
  const m = p.mem as { secId?: string; until?: number };
  if (m.secId) {
    if (w.tick >= m.until! && unlockedFor(w, p.id, m.secId) && doSellAll(w, p.id, m.secId)) m.secId = undefined;
    return;
  }
  const g = w.games.find((x) => x.crown.leaderId && (w.tick - x.startTick) / Math.max(1, x.endTick - x.startTick) >= 0.3);
  if (!g) return;
  const id = playerSecId(g.crown.leaderId!);
  if (doBuy(w, p.id, id, G(10))) Object.assign(m, { secId: id, until: g.endTick + 1 });
};

/** Buys whoever just came last or lost a crown, betting on a bounce. */
const contrarian: Act = (w, p) => {
  if (sellProfitableBeforeClose(w, p)) return;
  if (w.rng.next() > 0.3) return;
  const m = p.mem as { bought?: Record<string, number> };
  m.bought ??= {};
  for (const secId of heldIds(w, p)) {
    if (!unlockedFor(w, p.id, secId)) continue;
    if (pnl(w, p, secId) >= 0.05 || w.tick - (m.bought[secId] ?? 0) >= minutes(w, 30)) {
      if (doSellAll(w, p.id, secId)) return;
    }
  }
  if (heldIds(w, p).length >= 2) return;
  const since = w.tick - minutes(w, 10);
  const losers = [
    ...w.recent.filter((r) => r.tick >= since && r.lastPlace).map((r) => r.playerId),
    ...w.dethroned.filter((d) => d.tick >= since).map((d) => d.playerId),
  ].filter((id) => id !== p.id && active(w).some((x) => x.id === id));
  if (!losers.length) return;
  const id = playerSecId(w.rng.pick(losers));
  if (doBuy(w, p.id, id, G(10))) m.bought[id] = w.tick;
};

/** Buys the biggest recent riser; dumps on two falling ticks or ±6%. */
const momentum: Act = (w, p) => {
  if (sellProfitableBeforeClose(w, p)) return;
  if (w.rng.next() > 0.3) return;
  for (const secId of heldIds(w, p)) {
    if (!unlockedFor(w, p.id, secId)) continue;
    const h = w.priceHist.get(secId) ?? [];
    const falling = h.length >= 3 && h[h.length - 1]! < h[h.length - 2]! && h[h.length - 2]! < h[h.length - 3]!;
    const r = pnl(w, p, secId);
    if (falling || r >= 0.06 || r <= -0.06) if (doSellAll(w, p.id, secId)) return;
  }
  if (heldIds(w, p).length >= 2) return;
  let best: { id: string; ret: number } | null = null;
  for (const s of w.securities) {
    if (s.kind === 'index') continue;
    const h = w.priceHist.get(s.id) ?? [];
    if (h.length < 6) continue;
    const ret = h[h.length - 1]! / h[h.length - 6]! - 1;
    if (!best || ret > best.ret) best = { id: s.id, ret };
  }
  if (best && best.ret > 0.03) doBuy(w, p.id, best.id, G(10));
};

/** Backs 1–2 chosen friends early and again at halfway. Never sells. */
const loyalFriend: Act = (w, p) => {
  const m = p.mem as { friends?: string[]; step?: number };
  if (!m.friends) {
    const o = others(w, p);
    m.friends = [w.rng.pick(o).id];
    if (w.rng.next() < 0.5 && o.length > 1) m.friends.push(w.rng.pick(o.filter((x) => x.id !== m.friends![0])).id);
    m.step = 0;
  }
  if (m.step === 0) {
    for (const f of m.friends) doBuy(w, p.id, playerSecId(f), G(10 / m.friends.length + 2));
    m.step = 1;
  } else if (m.step === 1 && w.tick >= w.totalTicks / 2 && !prompted(w)) {
    for (const f of m.friends) doBuy(w, p.id, playerSecId(f), G(5));
    m.step = 2;
  }
};

/** Everything it can into the index at the start; never touches it again. */
const indexHugger: Act = (w, p) => {
  const m = p.mem as { done?: boolean };
  if (m.done) return;
  if (doBuy(w, p.id, 'index', Math.min(w.cash.get(p.id) ?? 0, capLeftH(w, p.id)))) m.done = true;
};

/** Shared entry for the exit-rule types: a random other player's stock. */
function randomEntry(w: World, p: SimPlayer, chance: number, gold = 10) {
  if (prompted(w) || heldIds(w, p).length || w.rng.next() > chance) return;
  const o = others(w, p);
  if (o.length) doBuy(w, p.id, playerSecId(w.rng.pick(o).id), G(gold));
}

/** Exit rule only: sells at −3% (panic) or +10%. */
const panicSeller: Act = (w, p) => {
  if (w.rng.next() > 0.3) return;
  for (const secId of heldIds(w, p)) {
    const r = pnl(w, p, secId);
    if (unlockedFor(w, p.id, secId) && (r <= -0.03 || r >= 0.1)) if (doSellAll(w, p.id, secId)) return;
  }
  randomEntry(w, p, 0.15);
};

/** Exit rule only: never sells at a loss; sells at +5%. */
const bagholder: Act = (w, p) => {
  if (w.rng.next() > 0.3) return;
  for (const secId of heldIds(w, p)) {
    if (unlockedFor(w, p.id, secId) && pnl(w, p, secId) >= 0.05) if (doSellAll(w, p.id, secId)) return;
  }
  randomEntry(w, p, 0.15);
};

/** Exit rule only: sells as soon as the price is above what it paid (ignores the fee). */
const profitLocker: Act = (w, p) => {
  if (w.rng.next() > 0.3) return;
  for (const secId of heldIds(w, p)) {
    if (unlockedFor(w, p.id, secId) && pnl(w, p, secId) > 0) if (doSellAll(w, p.id, secId)) return;
  }
  randomEntry(w, p, 0.15);
};

/** Whole cap into one stock at once; sells at +5% / −10%, then repeats. */
const yolo: Act = (w, p) => {
  if (sellProfitableBeforeClose(w, p)) return;
  if (w.rng.next() > 0.3) return;
  const held = heldIds(w, p);
  if (held.length) {
    const id = held[0]!;
    const r = pnl(w, p, id);
    if (unlockedFor(w, p.id, id) && (r >= 0.05 || r <= -0.1)) doSellAll(w, p.id, id);
    return;
  }
  if (w.rng.next() > 0.2) return;
  const pool = w.securities.filter((s) => s.kind === 'player' || s.kind === 'crypto' || s.kind === 'dead');
  doBuy(w, p.id, w.rng.pick(pool).id, capLeftH(w, p.id));
};

const lateTrader: Act = (w, p) => {
  if (w.tick >= w.totalTicks - minutes(w, 60)) trader(w, p);
};

const earlyBird: Act = (w, p) => {
  if (w.tick < minutes(w, 60)) trader(w, p);
};

/** Trades only on big edges, holds longer. */
const feeAware = makeTrader({ act: 0.35, edge: 0.1, takeProfit: 0.12, stopLoss: 0.12, size: 10 });

/** Bets on Second Chance / Shadow Logistics; sells at ±10% or after 20 min. */
const eventSpec: Act = (w, p) => {
  if (sellProfitableBeforeClose(w, p)) return;
  if (w.rng.next() > 0.3) return;
  const m = p.mem as { at?: Record<string, number> };
  m.at ??= {};
  for (const secId of heldIds(w, p)) {
    const r = pnl(w, p, secId);
    if (unlockedFor(w, p.id, secId) && (r >= 0.1 || r <= -0.1 || w.tick - (m.at[secId] ?? 0) >= minutes(w, 20)))
      if (doSellAll(w, p.id, secId)) return;
  }
  if (heldIds(w, p).length || w.rng.next() > 0.2) return;
  const ev = w.securities.filter((s) => s.kind === 'event');
  if (!ev.length) return;
  const id = w.rng.pick(ev).id;
  if (doBuy(w, p.id, id, G(10))) m.at[id] = w.tick;
};

/** Pumps the dead stock alone: buy, wait out the lockout, sell; repeat every 20–40 min. */
const deadLoneWolf: Act = (w, p) => {
  const m = p.mem as { next?: number };
  m.next ??= w.rng.int(minutes(w, 10), minutes(w, 30));
  if (holdingH(w, p.id, 'dead').shares > 0) {
    if (allUnlocked(w, p.id, 'dead')) doSellAll(w, p.id, 'dead');
    return;
  }
  if (prompted(w) || w.tick < m.next) return;
  if (doBuy(w, p.id, 'dead', G(15))) m.next = w.tick + w.rng.int(minutes(w, 20), minutes(w, 40));
};

/** Vote-only types: no trading. */
const leaderVoter: Act = () => {};
const underdogVoter: Act = () => {};

/** Crew members act together through kingmakerStep. */
const kingmaker: Act = () => {};

export function kingmakerStep(w: World) {
  const k = w.kingmaker;
  const members = k.members.filter((id) => active(w).some((p) => p.id === id));
  if (!members.length) return;
  // Exit: the quarter they backed is over.
  if (k.costs.size && w.quarter.n !== k.quarter) {
    for (const id of [...k.costs.keys()]) {
      if (!k.targetPid) break;
      if (doSellAll(w, id, playerSecId(k.targetPid))) k.costs.delete(id);
    }
    if (k.costs.size === 0) k.targetPid = null;
    return;
  }
  // Entry: a new vote window opens → pick the median-ranked outsider, buy it, vote for it.
  if (w.quarter.phase === 'window' && w.quarter.n !== null && k.quarter !== w.quarter.n && !prompted(w)) {
    k.quarter = w.quarter.n;
    const ranks = [...ranksBy(w, (id) => netWorthH(w, id))].filter(([id]) => !members.includes(id)).sort((a, b) => a[1] - b[1]);
    if (!ranks.length) return;
    k.targetPid = ranks[Math.floor(ranks.length / 2)]![0];
    for (const id of members) {
      const spent = doBuy(w, id, playerSecId(k.targetPid), G(10));
      if (spent) k.costs.set(id, spent);
    }
  }
}

/** After coming last in a game, makes an emotional buy of its own stock; sells when unlocked. */
const soreLoser: Act = (w, p) => {
  const m = p.mem as { seen?: number };
  const own = playerSecId(p.id);
  if (holdingH(w, p.id, own).shares > 0) {
    if (allUnlocked(w, p.id, own)) doSellAll(w, p.id, own);
    return;
  }
  const mine = w.recent.filter((r) => r.playerId === p.id);
  const last = mine[mine.length - 1];
  if (!last || last.tick === m.seen) return;
  m.seen = last.tick;
  if (last.lastPlace && !prompted(w)) doBuy(w, p.id, own, G(15));
};

/** Games only, barely touches the phone. */
const grinder: Act = () => {};

/** Sits out games often; trades actively while idle. */
const butterfly = makeTrader({ act: 0.5, edge: 0.04, takeProfit: 0.08, stopLoss: 0.08, size: 10 });

export const AGENTS: Record<AgentKind, Act> = {
  holder,
  trader,
  selfPumper,
  coalition,
  gambler,
  random,
  inactive,
  crownChaser,
  contrarian,
  momentum,
  loyalFriend,
  indexHugger,
  panicSeller,
  bagholder,
  profitLocker,
  yolo,
  lateTrader,
  earlyBird,
  feeAware,
  eventSpec,
  deadLoneWolf,
  leaderVoter,
  underdogVoter,
  kingmaker,
  soreLoser,
  grinder,
  butterfly,
};

/** Game-table habits: minutes idle between games, and how often they check the phone mid-game (× global rate). */
export const TRAITS: Partial<Record<AgentKind, { gap?: [number, number]; phone?: number }>> = {
  grinder: { gap: [0, 2], phone: 0.3 },
  butterfly: { gap: [10, 30], phone: 1 },
};

/** Vote style. null = default mix (leader 50%, top-3 20%, self 15%, random 15%). */
export function voteStyle(w: World, p: SimPlayer): string | null {
  const ranks = () => [...ranksBy(w, (id) => netWorthH(w, id))].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  switch (p.agent) {
    case 'selfPumper':
    case 'soreLoser':
      return p.id;
    case 'coalition':
      return w.coalition.members[0] ?? null;
    case 'kingmaker':
      return w.kingmaker.targetPid;
    case 'loyalFriend':
      return (p.mem as { friends?: string[] }).friends?.[0] ?? null;
    case 'leaderVoter':
      return ranks()[0] ?? null;
    case 'underdogVoter': {
      const r = ranks();
      const q = Math.max(1, Math.floor(r.length / 4));
      return w.rng.pick(r.slice(-q));
    }
    default:
      return null;
  }
}

/** Agent mix for the target tests (original 7 types). */
export function agentMix(n: number): AgentKind[] {
  const base: AgentKind[] =
    n >= 20
      ? ['holder', 'holder', 'holder', 'trader', 'trader', 'trader', 'trader', 'selfPumper', 'selfPumper', 'coalition', 'coalition', 'coalition', 'gambler', 'gambler', 'random', 'random']
      : ['holder', 'holder', 'trader', 'trader', 'selfPumper', 'coalition', 'coalition', 'coalition', 'gambler', 'random'];
  const out = [...base];
  while (out.length < n) out.push('inactive');
  return out.slice(0, n);
}
