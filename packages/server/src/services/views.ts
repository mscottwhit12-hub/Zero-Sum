/**
 * Role-filtered views. This file is the boundary for hidden mechanics (spec §8):
 *  - Never sent to anyone: vote drift, price causes/fair/target, espionage nudges, hidden achievement gold.
 *  - GM only: GM price offsets, mood impact per stock, full gold breakdown, GM-only feed.
 *  - Player only (own): holdings, lots, cash.
 * Views are built field-by-field from DB/engine data; nothing is spread wholesale.
 */
import { capRemainingH, hoursPlayed, sellValueH, type GoldH } from '@gn/engine';
import { gameViews, type GameView } from './games';
import { listLibrary, type LibraryGame } from './library';
import type { Ctx } from '../context';
import { feedTail } from './feed';
import { latestMoodTerms, priceHistory } from './market';
import { loadResults, nightOverrides, pid, type NightState } from './state';

export interface PublicView {
  night: {
    id: number;
    name: string;
    date: string;
    status: string;
    tradingClosed: boolean;
    lengthMinutes: number;
    nightMs: number;
    currentQuarter: number | null;
    quarters: { n: number; startMin: number; endMin: number; windowEndMin: number }[];
    tickSeconds: number;
    serverTime: number;
  };
  players: { id: number; displayName: string; ticker: string; color: string | null; avatarPath: string | null; left: boolean }[];
  standings: { playerId: number; netWorthH: GoldH; rank: number }[];
  market: { id: string; kind: string; ticker: string; playerId: number | null; price: number; history: number[] }[];
  games: GameView[];
  feed: ReturnType<typeof feedTail>;
}

export function publicView(ctx: Ctx, st: NightState): PublicView {
  const n = st.night;
  const hist = priceHistory(ctx, n.id);
  return {
    night: {
      id: n.id,
      name: n.name,
      date: n.date,
      status: n.status,
      tradingClosed: !!n.trading_closed,
      lengthMinutes: n.length_minutes,
      nightMs: st.nightMs,
      currentQuarter: n.current_quarter,
      quarters: st.quarters.map((q) => ({ n: q.n, startMin: q.startMin, endMin: q.endMin, windowEndMin: q.windowEndMin })),
      tickSeconds: st.settings.market.tickSeconds,
      serverTime: ctx.now(),
    },
    players: st.players.map((p) => ({
      id: p.id,
      displayName: p.display_name,
      ticker: p.ticker,
      color: p.color,
      avatarPath: p.avatar_path,
      left: p.left_at != null,
    })),
    standings: st.standings.map((r) => ({ playerId: Number(r.playerId), netWorthH: r.netWorthH, rank: r.rank })),
    market: st.securities.map((s) => ({
      id: s.id,
      kind: s.kind,
      ticker: s.ticker,
      playerId: s.playerId == null ? null : Number(s.playerId),
      price: s.price,
      history: hist.get(s.id) ?? [s.price],
    })),
    games: gameViews(ctx, n.id),
    feed: feedTail(ctx, n.id, false),
  };
}

export interface PlayerView extends PublicView {
  me: {
    id: number;
    displayName: string;
    ticker: string;
    cashH: GoldH;
    netWorthH: GoldH;
    rank: number | null;
    rerollsLeft: number;
    capRemainingH: GoldH;
    holdings: { securityId: string; sharesH: number; costBasisH: GoldH; valueH: GoldH; lots: { sharesH: number; unlockNms: number }[] }[];
    achievements: { type: string; createdAt: number }[];
  };
}

export function playerView(ctx: Ctx, st: NightState, playerId: number, base?: PublicView): PlayerView | null {
  const p = st.players.find((x) => x.id === playerId);
  if (!p) return null;
  const id = pid(playerId);
  const row = st.ledger.get(id);
  const standing = st.standings.find((r) => r.playerId === id);
  const mine = st.lots.filter((l) => l.playerId === id);
  const bySec = new Map<string, typeof mine>();
  for (const l of mine) (bySec.get(l.securityId) ?? bySec.set(l.securityId, []).get(l.securityId)!).push(l);
  const price = new Map(st.securities.map((s) => [s.id, s.price]));
  const ach = ctx.db.prepare('SELECT type, created_at FROM achievement WHERE night_id = ? AND player_id = ? ORDER BY id').all(st.night.id, playerId) as {
    type: string;
    created_at: number;
  }[];
  return {
    ...(base ?? publicView(ctx, st)),
    me: {
      id: p.id,
      displayName: p.display_name,
      ticker: p.ticker,
      cashH: row?.cashH ?? 0,
      netWorthH: standing?.netWorthH ?? row?.cashH ?? 0,
      rank: standing?.rank ?? null,
      rerollsLeft: p.reroll_tokens_left,
      capRemainingH: capRemainingH(st.lots, id, st.settings),
      holdings: [...bySec].map(([securityId, ls]) => {
        const sharesH = ls.reduce((a, l) => a + l.sharesH, 0);
        return {
          securityId,
          sharesH,
          costBasisH: ls.reduce((a, l) => a + l.costBasisH, 0),
          valueH: sellValueH(sharesH, price.get(securityId) ?? 0, st.settings.market.feeFrac),
          lots: ls.map((l) => ({ sharesH: l.sharesH, unlockNms: l.unlockAt })),
        };
      }),
      achievements: ach.map((a) => ({ type: a.type, createdAt: a.created_at })),
    },
  };
}

export interface GmView extends PublicView {
  gm: {
    ledger: {
      playerId: number;
      stakeH: GoldH;
      resultsH: GoldH;
      adjustmentsH: GoldH;
      bountiesH: GoldH;
      /** Visible achievement gold only; hidden (vote-based) gold is folded into totals, never itemized. */
      achievementsH: GoldH;
      tradeFlowH: GoldH;
      cashH: GoldH;
      netWorthH: GoldH;
    }[];
    stocks: { securityId: string; gmOffset: number; moodTerm: number }[];
    settings: { resolved: NightState['settings']; overrides: unknown };
    library: LibraryGame[];
    /** Hours played per player (tracked, never enforced). */
    hours: Record<number, number>;
    tickCount: number;
    feed: ReturnType<typeof feedTail>;
  };
}

export function gmView(ctx: Ctx, st: NightState, base?: PublicView): GmView {
  const visibleAch = new Map(
    (ctx.db.prepare('SELECT player_id, SUM(gold_h) g FROM achievement WHERE night_id = ? AND gold_hidden = 0 GROUP BY player_id').all(st.night.id) as {
      player_id: number;
      g: number;
    }[]).map((r) => [pid(r.player_id), r.g]),
  );
  const nw = new Map(st.standings.map((r) => [r.playerId, r.netWorthH]));
  const mood = latestMoodTerms(ctx, st.night.id);
  return {
    ...(base ?? publicView(ctx, st)),
    gm: {
      ledger: [...st.ledger.values()].map((l) => ({
        playerId: Number(l.playerId),
        stakeH: l.stakeH,
        resultsH: l.resultsH,
        adjustmentsH: l.adjustmentsH,
        bountiesH: l.bountiesH,
        achievementsH: visibleAch.get(l.playerId) ?? 0,
        tradeFlowH: l.tradeFlowH,
        cashH: l.cashH,
        netWorthH: nw.get(l.playerId) ?? l.cashH,
      })),
      stocks: st.securities.filter((s) => s.kind === 'player').map((s) => ({ securityId: s.id, gmOffset: s.gmOffset, moodTerm: mood.get(s.id) ?? 0 })),
      settings: { resolved: st.settings, overrides: nightOverrides(st.night) },
      library: listLibrary(ctx),
      hours: Object.fromEntries([...hoursPlayed(loadResults(ctx, st.night.id))].map(([k, v]) => [Number(k), Math.round(v * 100) / 100])),
      tickCount: st.night.tick_count,
      feed: feedTail(ctx, st.night.id, true),
    },
  };
}
