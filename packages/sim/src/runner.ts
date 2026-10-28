import {
  createRng,
  createSecurities,
  deriveLedger,
  DUMMY_ACHIEVEMENTS,
  endNight,
  espionageImpulses,
  evaluateAchievements,
  kingfallImpulse,
  lateJoinStakeH,
  lateJoinStartPrice,
  moodBiasMap,
  playerSecurity,
  quarterAt,
  quarterSchedule,
  rankBy,
  rerollImpulse,
  resolveQuarter,
  scoreGame,
  indexExtra,
  type IndexGame,
  tapLeader,
  tickMarket,
  toH,
  voteDrift,
  type Ballot,
  type GameMode,
  type GameResult,
  type MoodReading,
  type Settings,
} from '@gn/engine';
import { AGENTS, agentMix, coalitionStep, kingmakerStep, TRAITS, voteStyle } from './agents';
import {
  active,
  addGold,
  netWorthH,
  playerSecId,
  ranksBy,
  type ActiveGame,
  type AgentKind,
  type SimPlayer,
  type SkillTier,
  type World,
} from './world';

export interface NightOptions {
  seed: number;
  players: number;
  lengthMinutes: number;
  /** Weight of skill vs luck in game performance. */
  skillWeight: number;
  coalitionTarget: 'crypto' | 'dead';
  lateJoinChance: number;
  leaverChance: number;
  /** Chance per tick that a player who is mid-game acts on their phone at all. */
  inGameActivity: number;
  /** Minutes between coalition pump rounds (min, max). */
  coalitionGapMinutes: [number, number];
  /** Explicit players (type + skill) for the population study. Overrides the default mix. */
  roster?: { agent: AgentKind; skill: number; tier: SkillTier }[];
  /** Optional observers for example/trace output. Not used by the batch runs. */
  hooks?: {
    onTick?(w: World, nightMin: number): void;
    onResult?(w: World, result: GameResult, nightMin: number): void;
    onBounty?(w: World, quarter: number, payouts: { playerId: string; goldH: number }[], winners: string[], nightMin: number): void;
    onEnd?(w: World, end: ReturnType<typeof endNight>): void;
  };
}

export interface NightMetrics {
  seed: number;
  players: number;
  coalitionTarget: 'crypto' | 'dead';
  winnerAgent: AgentKind;
  winnerGoldH: number;
  /** Winner's trading P&L (incl. auto-sell, after fees) / final gold. */
  winnerMarketShare: number;
  soloPump: { trips: number; noRankChangeTrips: number; noRankChangePnlH: number };
  coalition: { trips: number; costH: number; pnlH: number };
  bottomQuartileTop3: boolean;
  midLeaderWon: boolean;
  goldByAgent: Partial<Record<AgentKind, number[]>>;
  /** Mean |Δ|/tick while trading. */
  playerAbsDelta: number;
  cryptoAbsDelta: number;
  /** Fraction of trading ticks each security sat at a band edge; worst per kind. */
  pinnedMaxByKind: Record<string, number>;
  endFeeH: number;
  bountyPaidH: number;
  kingfalls: number;
  games: number;
  marketPnlByAgent: Partial<Record<AgentKind, number[]>>;
  /** Gold sources: winner and average player. */
  sources: { winnerGamesH: number; winnerTradeH: number; avgGamesH: number; avgOtherH: number; avgFinalH: number };
  /** One row per starting player (population study). */
  playerRows: PlayerRow[];
}

export interface PlayerRow {
  agent: AgentKind;
  tier: SkillTier | null;
  skill: number;
  goldH: number;
  gamesH: number;
  tradeH: number;
  bountyH: number;
  rank: number;
  won: boolean;
  top3: boolean;
  gamesPlayed: number;
}

const G = (g: number) => Math.round(g * 100);

export function runNight(opts: NightOptions, settings: Settings): NightMetrics {
  const rng = createRng(opts.seed);
  const tickMs = settings.market.tickSeconds * 1000;
  const totalTicks = Math.round((opts.lengthMinutes * 60_000) / tickMs);
  const lastEndMin = opts.lengthMinutes - 15;
  const minToTick = (m: number) => Math.round((m * 60_000) / tickMs);

  const mix = opts.roster ? opts.roster.map((r) => r.agent) : agentMix(opts.players);
  const skills = opts.roster?.map((r) => r.skill);
  const tiers = opts.roster?.map((r) => r.tier);
  if (!opts.roster) {
    // shuffle agents onto players
    for (let i = mix.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [mix[i], mix[j]] = [mix[j]!, mix[i]!];
    }
  }
  const players: SimPlayer[] = mix.map((agent, i) => ({
    id: `P${i + 1}`,
    skill: skills ? skills[i]! : rng.normal(),
    tier: tiers?.[i],
    agent,
    joinedTick: 0,
    leftTick: null,
    gotStake: true,
    rerolls: settings.rerolls.perPlayer,
    busyUntil: rng.int(0, minToTick(10)),
    inGame: false,
    mem: {},
  }));
  const securities = createSecurities({ players: players.map((p) => ({ id: p.id, ticker: p.id })) }, settings);
  const w: World = {
    settings,
    rng,
    tick: 0,
    tickMs,
    totalTicks,
    closeTick: totalTicks,
    closePromptTick: totalTicks,
    players,
    securities,
    secIndex: new Map(securities.map((s, i) => [s.id, i])),
    lots: new Map(),
    lotSeq: 0,
    ledger: { players: players.map((p) => ({ id: p.id, gotStake: true })), results: [], adjustments: [], bounties: [], achievements: [], tradeFlows: [] },
    earned: new Map(),
    cash: new Map(),
    impulses: [],
    lastTradeTick: new Map(),
    marketOpen: true,
    games: [],
    results: [],
    trips: { selfPump: [], coalition: [] },
    coalition: {
      members: players.filter((p) => p.agent === 'coalition').map((p) => p.id),
      targetId: opts.coalitionTarget,
      phase: 'idle',
      nextTick: rng.int(minToTick(10), minToTick(30)),
      gap: [minToTick(opts.coalitionGapMinutes[0]), minToTick(opts.coalitionGapMinutes[1])],
      sellTick: 0,
      costs: new Map(),
    },
    priceHist: new Map(securities.map((s) => [s.id, [s.price]])),
    recent: [],
    dethroned: [],
    quarter: { n: null, phase: 'pre' },
    kingmaker: { members: players.filter((p) => p.agent === 'kingmaker').map((p) => p.id), targetPid: null, quarter: null, costs: new Map(), sellTick: 0 },
  };
  for (const p of players) addGold(w, p.id, toH(settings.stake.startingGold), true);

  const schedule = quarterSchedule(opts.lengthMinutes, settings.votes);
  let drift = new Map<string, number>();
  let ballots: Ballot[] = [];
  let voteTicks = new Map<string, number>();
  let openQuarter: number | null = null;
  const correctVotes = new Map<string, number>();
  const awarded = new Set<string>();
  const moods: MoodReading[] = [];
  const moodTicks = [Math.round(totalTicks * 0.35), Math.round(totalTicks * 0.7)];
  let nextEspionage = minToTick(rng.int(20, 40));
  const espionage: { playerId: string; resolveTick: number }[] = [];
  const lateJoinTick = rng.next() < opts.lateJoinChance ? Math.round(totalTicks * (0.2 + 0.2 * rng.next())) : -1;
  const leaveTick = rng.next() < opts.leaverChance ? Math.round(totalTicks * (0.5 + 0.2 * rng.next())) : -1;
  let pendingLeave = false;
  let kingfalls = 0;
  let bountyPaidH = 0;
  let mid: { leader: string[]; bottom: string[] } | null = null;
  const gamesPlayed = new Map<string, number>();

  // stats
  let playerDeltaSum = 0;
  let playerDeltaN = 0;
  let cryptoDeltaSum = 0;
  let cryptoDeltaN = 0;
  const pinned = new Map<string, number>();
  let tradingTicks = 0;

  const award = () => {
    const awards = evaluateAchievements({ results: w.results, correctVotes, awarded }, DUMMY_ACHIEVEMENTS, settings);
    for (const a of awards) {
      awarded.add(`${a.achievementId}:${a.playerId}`);
      if (a.goldH) {
        w.ledger.achievements.push({ playerId: a.playerId, goldH: a.goldH });
        addGold(w, a.playerId, a.goldH, true);
      }
    }
  };

  const startGames = () => {
    const nowMin = (w.tick * tickMs) / 60_000;
    const idle = active(w).filter((p) => !p.inGame && p.busyUntil <= w.tick);
    while (idle.length >= 3) {
      const size = Math.min(idle.length, rng.int(3, 5));
      const table: SimPlayer[] = [];
      for (let i = 0; i < size; i++) table.push(idle.splice(rng.int(0, idle.length - 1), 1)[0]!);
      let hours = Math.round((0.5 + rng.next()) * 20) / 20;
      if (nowMin + hours * 60 > lastEndMin) hours = Math.floor(((lastEndMin - nowMin) / 60) * 20) / 20;
      if (hours < 0.4) return;
      const roll = rng.next();
      const mode: GameMode = roll < 0.7 || (roll < 0.85 && size < 4) ? 'competitive' : roll < 0.85 ? 'team' : 'coop';
      const perf = (p: SimPlayer) => p.skill * opts.skillWeight + rng.normal();
      let result: GameResult;
      let winners: string[];
      if (mode === 'coop') {
        const won = table.reduce((a, p) => a + p.skill, 0) / size * 0.5 + rng.normal() > 0;
        result = { id: `g${w.results.length + w.games.length}`, mode, actualHours: hours, coopWon: won, participants: table.map((p) => ({ playerId: p.id })) };
        winners = [];
      } else if (mode === 'team') {
        const half = Math.floor(size / 2);
        const A = table.slice(0, half);
        const B = table.slice(half);
        const pa = A.reduce((a, p) => a + perf(p), 0) / A.length;
        const pb = B.reduce((a, p) => a + perf(p), 0) / B.length;
        const [win, lose] = pa >= pb ? [A, B] : [B, A];
        result = {
          id: `g${w.results.length + w.games.length}`,
          mode,
          actualHours: hours,
          participants: [...win.map((p) => ({ playerId: p.id, team: 'W', placement: 1 })), ...lose.map((p) => ({ playerId: p.id, team: 'L', placement: 2 }))],
        };
        winners = win.map((p) => p.id);
      } else {
        const order = table.map((p) => ({ p, v: perf(p) })).sort((a, b) => b.v - a.v);
        result = {
          id: `g${w.results.length + w.games.length}`,
          mode,
          actualHours: hours,
          participants: (() => {
            let place = 0;
            return order.map((o) => (rng.next() < 0.02 ? { playerId: o.p.id, dnf: true } : { playerId: o.p.id, placement: ++place }));
          })(),
        };
        winners = [order[0]!.p.id];
      }
      const endTick = w.tick + minToTick(hours * 60);
      for (const p of table) p.inGame = true;
      w.games.push({
        result,
        startTick: w.tick,
        endTick,
        winners,
        crown: { leaderId: null, since: 0 },
        nextTapTick: w.tick + minToTick(rng.int(5, 15)),
        rerollTick: rng.next() < 0.4 ? w.tick + rng.int(1, Math.max(1, endTick - w.tick - 1)) : null,
        firstGoldH: G(hours * size),
      });
    }
  };

  const paidByGame = new Map<string, number>();
  const finishGames = () => {
    for (const g of [...w.games]) {
      if (w.tick < g.endTick) continue;
      w.games.splice(w.games.indexOf(g), 1);
      w.results.push(g.result);
      w.ledger.results.push(g.result);
      for (const row of scoreGame(g.result, settings).rows) addGold(w, row.playerId, row.goldH, true);
      opts.hooks?.onResult?.(w, g.result, (w.tick * tickMs) / 60_000);
      const r = g.result;
      const maxPlace = Math.max(0, ...r.participants.filter((x) => !x.dnf && x.placement != null).map((x) => x.placement!));
      for (const pp of r.participants) {
        const p = w.players.find((x) => x.id === pp.playerId)!;
        p.inGame = false;
        const gap = TRAITS[p.agent]?.gap ?? [3, 10];
        p.busyUntil = w.tick + minToTick(rng.int(gap[0], gap[1]));
        const won = r.mode === 'coop' ? !!r.coopWon : !pp.dnf && pp.placement === 1;
        const lastPlace = r.mode === 'coop' ? !r.coopWon : !!pp.dnf || pp.placement === maxPlace;
        w.recent.push({ tick: w.tick, playerId: p.id, won, lastPlace });
      }
      for (const pp of r.participants) gamesPlayed.set(pp.playerId, (gamesPlayed.get(pp.playerId) ?? 0) + 1);
      award();
    }
  };

  const gameEvents = () => {
    for (const g of w.games) {
      if (g.result.mode !== 'coop' && w.tick >= g.nextTapTick) {
        const progress = (w.tick - g.startTick) / Math.max(1, g.endTick - g.startTick);
        const ids = g.result.participants.map((p) => p.playerId);
        const pick = rng.next() < 0.4 + 0.5 * progress ? rng.pick(g.winners) : rng.pick(ids);
        const t = tapLeader(g.crown, pick, w.tick * tickMs, settings);
        g.crown = t.state;
        if (t.dethroned) w.dethroned.push({ tick: w.tick, playerId: t.dethroned.from });
        if (t.kingfall) {
          kingfalls++;
          const imp = kingfallImpulse(w.securities, settings);
          if (imp) w.impulses.push(imp);
        }
        g.nextTapTick = w.tick + minToTick(rng.int(8, 20));
      }
      if (g.rerollTick === w.tick) {
        for (const pp of g.result.participants) {
          const p = w.players.find((x) => x.id === pp.playerId)!;
          if (p.rerolls > 0 && rng.next() < 0.3) {
            p.rerolls--;
            const imp = rerollImpulse(w.securities, settings);
            if (imp) w.impulses.push(imp);
          }
        }
      }
    }
  };

  const espionageEvents = () => {
    if (w.tick >= nextEspionage && w.tick < w.closePromptTick) {
      const cands = active(w);
      let agent = rng.pick(cands);
      if (rng.next() > 0.7) agent = rng.pick(cands); // rejected → reassigned
      if (rng.next() < 0.85) espionage.push({ playerId: agent.id, resolveTick: w.tick + minToTick(rng.int(10, 30)) });
      nextEspionage = w.tick + minToTick(rng.int(25, 40));
    }
    for (const e of [...espionage]) {
      if (w.tick < e.resolveTick) continue;
      espionage.splice(espionage.indexOf(e), 1);
      const ok = rng.next() < 0.55;
      if (ok) {
        w.ledger.adjustments.push({ playerId: e.playerId, goldH: G(3) });
        addGold(w, e.playerId, G(3), true);
      }
      w.impulses.push(...espionageImpulses(w.securities, e.playerId, ok ? 'success' : 'fail', settings));
    }
  };

  const voteEvents = (nightMin: number) => {
    const pos = quarterAt(schedule, nightMin);
    const q = pos.quarter?.n ?? null;
    w.quarter = { n: q, phase: pos.phase };
    if (q !== openQuarter) {
      if (openQuarter !== null) resolveOpenQuarter();
      if (q !== null) {
        openQuarter = q;
        ballots = [];
        voteTicks = new Map();
        const windowTicks = Math.max(1, minToTick(settings.votes.windowMinutes) - 1);
        for (const p of active(w)) if (rng.next() < 0.9) voteTicks.set(p.id, w.tick + rng.int(0, windowTicks));
      }
    }
    if (pos.phase === 'window') {
      for (const [pid, t] of voteTicks) {
        if (t !== w.tick) continue;
        const p = w.players.find((x) => x.id === pid)!;
        if (p.leftTick !== null) continue;
        ballots.push({ voterId: pid, targetId: chooseVote(p), weight: 1 });
      }
    }
    if (pos.phase === 'drift' && drift.size === 0 && ballots.length) {
      drift = voteDrift(ballots, active(w).map((p) => p.id), settings);
    }
  };

  const chooseVote = (p: SimPlayer): string => {
    const styled = voteStyle(w, p);
    if (styled && active(w).some((x) => x.id === styled)) return styled;
    const r = ranksBy(w, (id) => netWorthH(w, id));
    const ids = [...r.keys()];
    const x = rng.next();
    if (x < 0.5) return ids.find((id) => r.get(id) === 1)!;
    if (x < 0.7) return rng.pick(ids.filter((id) => r.get(id)! <= 3));
    if (x < 0.85) return p.id;
    return rng.pick(ids);
  };

  const standingsRows = () =>
    rankBy(
      active(w).map((p) => ({ playerId: p.id, cashH: w.cash.get(p.id)!, holdingsH: 0, netWorthH: netWorthH(w, p.id), rank: 0 })),
      (r) => r.netWorthH,
    );

  const resolveOpenQuarter = () => {
    const res = resolveQuarter(ballots, standingsRows(), settings);
    opts.hooks?.onBounty?.(w, openQuarter ?? 0, res.payouts, res.winners, (w.tick * tickMs) / 60_000);
    for (const pay of res.payouts) {
      w.ledger.bounties.push(pay);
      addGold(w, pay.playerId, pay.goldH, true);
      bountyPaidH += pay.goldH;
      correctVotes.set(pay.playerId, (correctVotes.get(pay.playerId) ?? 0) + 1);
    }
    award();
    openQuarter = null;
    ballots = [];
    drift = new Map();
  };

  const membershipEvents = () => {
    if (w.tick === lateJoinTick) {
      const id = `P${w.players.length + 1}`;
      const act = active(w);
      const stake = lateJoinStakeH(act.map((p) => w.earned.get(p.id)!), settings);
      const price = lateJoinStartPrice(w.securities.filter((s) => s.kind === 'player').map((s) => s.price), settings);
      const p: SimPlayer = { id, skill: rng.normal(), agent: rng.pick<AgentKind>(['holder', 'inactive', 'trader']), joinedTick: w.tick, leftTick: null, gotStake: false, rerolls: settings.rerolls.perPlayer, busyUntil: w.tick, inGame: false, mem: {} };
      w.players.push(p);
      w.ledger.players.push({ id, gotStake: false });
      w.ledger.adjustments.push({ playerId: id, goldH: stake });
      w.cash.set(id, 0);
      w.earned.set(id, 0);
      addGold(w, id, stake, true);
      const s = playerSecurity(id, id, price);
      w.secIndex.set(s.id, w.securities.length);
      w.securities.push(s);
    }
    if (w.tick === leaveTick) pendingLeave = true;
    if (pendingLeave) {
      const cand = active(w).filter((p) => !p.inGame && p.agent !== 'coalition' && p.agent !== 'kingmaker');
      if (cand.length) {
        const p = rng.pick(cand);
        p.leftTick = w.tick;
        w.securities[w.secIndex.get(playerSecId(p.id))!] = { ...w.securities[w.secIndex.get(playerSecId(p.id))!]!, left: true };
        pendingLeave = false;
      }
    }
  };

  // ---------------- main loop ----------------
  for (w.tick = 0; w.tick < totalTicks; w.tick++) {
    const nightMin = (w.tick * tickMs) / 60_000;
    finishGames();
    opts.hooks?.onTick?.(w, nightMin);
    membershipEvents();
    startGames();
    gameEvents();
    espionageEvents();
    voteEvents(nightMin);
    if (moodTicks.includes(w.tick)) {
      const r = ranksBy(w, (id) => netWorthH(w, id));
      const n = r.size;
      for (const [pid, rank] of r) {
        const pos = n > 1 ? 1 - (rank - 1) / (n - 1) : 0.5;
        const v = () => Math.min(5, Math.max(1, Math.round(3 + (pos - 0.5) * 2 + rng.normal() * 0.8)));
        moods.push({ playerId: pid, mood: v(), selfAssessment: v(), tick: w.tick });
      }
    }
    if (w.tick === Math.round(totalTicks / 2)) {
      const r = ranksBy(w, (id) => netWorthH(w, id));
      const sorted = [...r].sort((a, b) => a[1] - b[1]).map(([id]) => id);
      const q = Math.max(1, Math.floor(sorted.length / 4));
      mid = { leader: sorted.filter((id) => r.get(id) === 1), bottom: sorted.slice(-q) };
    }

    // Close trading once all games are done and no more can start.
    // (no game can start within 24 min of the last allowed end)
    if (w.games.length === 0 && nightMin >= lastEndMin - 24 && w.tick > 0) {
      w.marketOpen = false;
      w.closeTick = w.tick;
      break;
    }
    // Prompt: 15 min before the last planned game end.
    const plannedEnd = Math.max(0, ...w.games.map((g) => g.endTick));
    if (nightMin >= lastEndMin - 60 && w.closePromptTick === totalTicks) {
      const promptAt = plannedEnd - minToTick(settings.prompts.tradingCloseMinutesBefore);
      if (w.tick >= promptAt) w.closePromptTick = w.tick;
    }

    // Agents trade at current prices.
    coalitionStep(w);
    kingmakerStep(w);
    for (const p of active(w)) {
      if (p.inGame && rng.next() > opts.inGameActivity * (TRAITS[p.agent]?.phone ?? 1)) continue;
      AGENTS[p.agent](w, p);
    }

    // Market tick applies queued impulses.
    const earnedActive = active(w).map((p) => ({ playerId: p.id, earnedH: w.earned.get(p.id)! }));
    const prev = new Map(w.securities.map((s) => [s.id, s.price]));
    // Hidden index growth and start dips, built the way the server does (services/indexTerms.ts).
    const idxGames: IndexGame[] = [];
    for (const r of w.results) {
      let paid = paidByGame.get(r.id);
      if (paid === undefined) {
        paid = scoreGame(r, settings).rows.reduce((a, x) => a + x.goldH, 0);
        paidByGame.set(r.id, paid);
      }
      idxGames.push({ status: 'final', players: r.participants.length, plannedHours: 0, elapsedHours: 0, paidH: paid });
    }
    for (const g of w.games) {
      idxGames.push({ status: 'active', players: g.result.participants.length, plannedHours: g.result.actualHours, elapsedHours: ((w.tick - g.startTick) * tickMs) / 3_600_000 });
    }
    const indexExtraNow = indexExtra(idxGames, active(w).length, settings).extra;
    const res = tickMarket(w.securities, { earned: earnedActive, drift, mood: moodBiasMap(moods, w.tick, settings), impulses: w.impulses, indexExtra: indexExtraNow }, settings, rng);
    w.securities = res.securities;
    w.impulses = [];
    for (const s of w.securities) {
      const h = w.priceHist.get(s.id) ?? [];
      h.push(s.price);
      if (h.length > 30) h.shift();
      w.priceHist.set(s.id, h);
    }
    tradingTicks++;
    for (const s of w.securities) {
      const p0 = prev.get(s.id)!;
      const d = Math.abs(s.price / p0 - 1);
      if (s.kind === 'player') {
        playerDeltaSum += d;
        playerDeltaN++;
      } else if (s.kind === 'crypto') {
        cryptoDeltaSum += d;
        cryptoDeltaN++;
      }
      const b = settings.market.bands[s.kind];
      const eps = (b.max - b.min) * 0.01;
      if (s.price <= b.min + eps || s.price >= b.max - eps) pinned.set(s.id, (pinned.get(s.id) ?? 0) + 1);
    }
  }

  // ---------------- end ----------------
  const allLots = [...w.lots.values()].flat();
  const end = endNight(
    {
      ledger: w.ledger,
      lots: allLots,
      securities: w.securities,
      activePlayerIds: active(w).map((p) => p.id),
      openQuarter: openQuarter !== null ? { ballots } : null,
    },
    settings,
  );
  if (end.quarter) for (const p of end.quarter.payouts) bountyPaidH += p.goldH;
  opts.hooks?.onEnd?.(w, end);

  // Sanity: incremental cash matches the engine's derivation before liquidation.
  const check = deriveLedger(w.ledger, settings);
  for (const [id, row] of check) if (row.cashH !== w.cash.get(id)) throw new Error(`ledger drift for ${id}`);

  const winner = end.podium[0]!;
  const winnerRow = end.ledger.get(winner.playerId)!;
  const top3 = new Set(end.podium.filter((r) => r.rank <= 3).map((r) => r.playerId));
  const goldByAgent: NightMetrics['goldByAgent'] = {};
  const marketPnlByAgent: NightMetrics['marketPnlByAgent'] = {};
  for (const p of w.players) {
    if (p.joinedTick > 0) continue; // compare like with like: exclude late joiners
    const row = end.ledger.get(p.id)!;
    (goldByAgent[p.agent] ??= []).push(row.cashH);
    (marketPnlByAgent[p.agent] ??= []).push(row.tradeFlowH);
  }
  const pinnedMaxByKind: Record<string, number> = {};
  for (const s of w.securities) {
    const f = (pinned.get(s.id) ?? 0) / Math.max(1, tradingTicks);
    pinnedMaxByKind[s.kind] = Math.max(pinnedMaxByKind[s.kind] ?? 0, f);
  }
  const noRank = w.trips.selfPump.filter((t) => t.rankAtBuy === t.rankAtSell);
  return {
    seed: opts.seed,
    players: opts.players,
    coalitionTarget: opts.coalitionTarget,
    winnerAgent: w.players.find((p) => p.id === winner.playerId)!.agent,
    winnerGoldH: winner.goldH,
    winnerMarketShare: winner.goldH > 0 ? winnerRow.tradeFlowH / winner.goldH : 0,
    soloPump: {
      trips: w.trips.selfPump.length,
      noRankChangeTrips: noRank.length,
      noRankChangePnlH: noRank.reduce((a, t) => a + t.proceedsH - t.costH, 0),
    },
    coalition: {
      trips: w.trips.coalition.length,
      costH: w.trips.coalition.reduce((a, t) => a + t.costH, 0),
      pnlH: w.trips.coalition.reduce((a, t) => a + t.proceedsH - t.costH, 0),
    },
    bottomQuartileTop3: mid ? mid.bottom.some((id) => top3.has(id)) : false,
    midLeaderWon: mid ? mid.leader.includes(winner.playerId) : false,
    goldByAgent,
    playerAbsDelta: playerDeltaSum / Math.max(1, playerDeltaN),
    cryptoAbsDelta: cryptoDeltaSum / Math.max(1, cryptoDeltaN),
    pinnedMaxByKind,
    endFeeH: end.liquidations.reduce((a, t) => a + t.feeH, 0),
    bountyPaidH,
    kingfalls,
    games: w.results.length,
    marketPnlByAgent,
    playerRows: w.players
      .filter((p) => p.joinedTick === 0)
      .map((p) => {
        const l = end.ledger.get(p.id)!;
        const rank = end.podium.find((r) => r.playerId === p.id)!.rank;
        return {
          agent: p.agent,
          tier: p.tier ?? null,
          skill: p.skill,
          goldH: l.cashH,
          gamesH: l.resultsH,
          tradeH: l.tradeFlowH,
          bountyH: l.bountiesH,
          rank,
          won: rank === 1,
          top3: rank <= 3,
          gamesPlayed: gamesPlayed.get(p.id) ?? 0,
        };
      }),
    sources: (() => {
      const rows = [...end.ledger.values()];
      const avg = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
      return {
        winnerGamesH: winnerRow.resultsH,
        winnerTradeH: winnerRow.tradeFlowH,
        avgGamesH: avg((r) => r.resultsH),
        avgOtherH: avg((r) => r.earnedH - r.resultsH),
        avgFinalH: avg((r) => r.cashH),
      };
    })(),
  };
}
