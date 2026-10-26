/**
 * End of night (spec §17.1 finale, §15.3 statement). Everything here is public-safe:
 * hidden mechanics (vote drift, espionage nudges, hidden achievement gold, mood/kingfall price
 * effects) are never computed into or revealed by the recap or the statements.
 */
import { hoursPlayed } from '@gn/engine';
import { conflict, notFound, type Ctx } from '../context';
import { minterLeaderboard } from './minter';
import { playCue } from './sounds';
import { computeNightState, getNight, loadResults, nightSettings, pid, type NightRow, type PlayerRow } from './state';

export interface PodiumRow {
  playerId: number;
  goldH: number;
  rank: number;
}
export type RecapSlide =
  | { id: 'top_trade'; playerId: number; ticker: string; profitH: number }
  | { id: 'best_investment' | 'worst_investment'; playerId: number; ticker: string; profitH: number }
  | { id: 'most_predicted'; playerId: number; votes: number }
  | { id: 'long_reigns'; count: number }
  | { id: 'mood'; cheeriest: number; moodiest: number }
  | { id: 'hours'; leaders: { playerId: number; hours: number }[] }
  | { id: 'espionage'; sent: number; accepted: number; completed: number; exposed: number }
  | { id: 'minter'; playerId: number; minted: number }
  | { id: 'achievements'; items: { playerId: number; type: string }[] };

export interface Finale {
  podium: PodiumRow[];
  slides: RecapSlide[];
  /** Seconds for the TV sequence (collapse → podium → slides). */
  timing: { collapseSeconds: number; podiumStepSeconds: number; recapSlideSeconds: number };
}

interface SellRow {
  player_id: number;
  security_id: string;
  ticker: string;
  profit: number;
}

function sells(ctx: Ctx, nightId: number): SellRow[] {
  return ctx.db
    .prepare(
      `SELECT t.player_id, t.security_id, s.ticker, (t.cash_h - t.basis_h) AS profit FROM trade t
       JOIN security s ON s.id = t.security_id AND s.night_id = t.night_id
       WHERE t.night_id = ? AND t.side = 'sell' AND t.basis_h IS NOT NULL`,
    )
    .all(nightId) as SellRow[];
}

export function finale(ctx: Ctx, nightId: number): Finale {
  const n = getNight(ctx, nightId);
  if (!n) throw notFound('no_night');
  const st = computeNightState(ctx, nightId)!;
  const settings = nightSettings(n);
  // After End every holding is sold, so net worth = gold.
  const podium = st.standings.filter((r) => r.rank <= 3).map((r) => ({ playerId: Number(r.playerId), goldH: r.netWorthH, rank: r.rank }));
  const slides: RecapSlide[] = [];

  const ss = sells(ctx, nightId);
  if (ss.length) {
    const top = ss.reduce((a, b) => (b.profit > a.profit ? b : a));
    if (top.profit > 0) slides.push({ id: 'top_trade', playerId: top.player_id, ticker: top.ticker, profitH: top.profit });
    const pos = new Map<string, { playerId: number; ticker: string; profitH: number }>();
    for (const r of ss) {
      const k = `${r.player_id}|${r.security_id}`;
      const cur = pos.get(k) ?? { playerId: r.player_id, ticker: r.ticker, profitH: 0 };
      cur.profitH += r.profit;
      pos.set(k, cur);
    }
    const list = [...pos.values()];
    const best = list.reduce((a, b) => (b.profitH > a.profitH ? b : a));
    const worst = list.reduce((a, b) => (b.profitH < a.profitH ? b : a));
    if (best.profitH > 0) slides.push({ id: 'best_investment', ...best });
    if (worst.profitH < 0) slides.push({ id: 'worst_investment', ...worst });
  }

  const predicted = ctx.db
    .prepare('SELECT b.target_player_id AS id, COUNT(*) c FROM ballot b JOIN vote_round v ON v.id = b.vote_round_id WHERE v.night_id = ? GROUP BY b.target_player_id ORDER BY c DESC, id LIMIT 1')
    .get(nightId) as { id: number; c: number } | undefined;
  if (predicted) slides.push({ id: 'most_predicted', playerId: predicted.id, votes: predicted.c });

  const reigns = (ctx.db.prepare("SELECT COUNT(*) c FROM feed_event WHERE night_id = ? AND message = 'feed.kingfall'").get(nightId) as { c: number }).c;
  if (reigns) slides.push({ id: 'long_reigns', count: reigns });

  const moods = ctx.db.prepare('SELECT player_id, AVG(mood) m FROM mood_reading WHERE night_id = ? GROUP BY player_id ORDER BY m DESC, player_id').all(nightId) as { player_id: number; m: number }[];
  if (moods.length >= 2) slides.push({ id: 'mood', cheeriest: moods[0]!.player_id, moodiest: moods[moods.length - 1]!.player_id });

  const hours = [...hoursPlayed(loadResults(ctx, nightId))]
    .map(([id, h]) => ({ playerId: Number(id), hours: Math.round(h * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 3);
  if (hours.length) slides.push({ id: 'hours', leaders: hours });

  const esp = ctx.db
    .prepare(
      `SELECT COUNT(*) sent,
              SUM(status IN ('accepted','succeeded','failed')) accepted,
              SUM(status = 'succeeded') completed,
              SUM(status = 'failed') exposed
       FROM challenge WHERE night_id = ? AND status != 'reassigned'`,
    )
    .get(nightId) as { sent: number; accepted: number | null; completed: number | null; exposed: number | null };
  if (esp.sent) slides.push({ id: 'espionage', sent: esp.sent, accepted: esp.accepted ?? 0, completed: esp.completed ?? 0, exposed: esp.exposed ?? 0 });

  const minter = minterLeaderboard(ctx, nightId, 1)[0];
  if (minter) slides.push({ id: 'minter', playerId: minter.playerId, minted: minter.minted });

  const ach = ctx.db.prepare('SELECT player_id, type FROM achievement WHERE night_id = ? ORDER BY id').all(nightId) as { player_id: number; type: string }[];
  if (ach.length) slides.push({ id: 'achievements', items: ach.map((a) => ({ playerId: a.player_id, type: a.type })) });

  return { podium, slides, timing: { ...settings.finale } };
}

/** Wall-clock length of the TV finale. */
export function finaleSeconds(f: Finale): number {
  return f.timing.collapseSeconds + 3 * f.timing.podiumStepSeconds + f.slides.length * f.timing.recapSlideSeconds;
}

export const recapRunning = (ctx: Ctx, n: NightRow) => n.status === 'ended' && !n.recap_done && n.recap_until != null && ctx.now() < n.recap_until;

/** Tick step: when the finale has played, unlock phones (recap:done). */
export function recapStep(ctx: Ctx, n: NightRow) {
  if (n.status !== 'ended' || n.recap_done || n.recap_until == null || ctx.now() < n.recap_until) return;
  markRecapDone(ctx, n.id);
}

export function markRecapDone(ctx: Ctx, nightId: number) {
  ctx.db.prepare('UPDATE night SET recap_done = 1, recap_until = MIN(COALESCE(recap_until, ?), ?) WHERE id = ?').run(ctx.now(), ctx.now(), nightId);
  ctx.bus.all('recap:done', { nightId });
  playCue(ctx, 'night_end');
  ctx.bus.refresh(nightId);
}

// ---------------------------------------------------------------- Final Account Statement

export interface StatementTrade {
  at: number;
  side: 'buy' | 'sell';
  ticker: string;
  sharesH: number;
  price: number;
  cashH: number;
  feeH: number;
  profitH: number | null;
  forced: boolean;
}

export function statement(ctx: Ctx, player: PlayerRow) {
  const n = getNight(ctx, player.night_id);
  if (!n || n.status === 'setup' || n.status === 'joins_open' || n.status === 'live' || n.status === 'paused') throw conflict('night_not_over', 'Statements are ready after the night ends.');
  if (recapRunning(ctx, n)) throw conflict('recap_running', 'Stand by.');
  const st = computeNightState(ctx, n.id)!;
  const me = st.standings.find((r) => r.playerId === pid(player.id));
  const trades = (ctx.db
    .prepare(
      `SELECT t.created_at, t.side, s.ticker, t.shares_h, t.price, t.cash_h, t.fee_h, t.basis_h, t.forced FROM trade t
       JOIN security s ON s.id = t.security_id AND s.night_id = t.night_id WHERE t.player_id = ? ORDER BY t.id`,
    )
    .all(player.id) as { created_at: number; side: 'buy' | 'sell'; ticker: string; shares_h: number; price: number; cash_h: number; fee_h: number; basis_h: number | null; forced: number }[]).map(
    (t): StatementTrade => ({
      at: t.created_at,
      side: t.side,
      ticker: t.ticker,
      sharesH: t.shares_h,
      price: t.price,
      cashH: t.cash_h,
      feeH: t.fee_h,
      profitH: t.side === 'sell' && t.basis_h != null ? t.cash_h - t.basis_h : null,
      forced: !!t.forced,
    }),
  );
  const closed = trades.filter((t) => t.profitH != null);
  const best = closed.length ? closed.reduce((a, b) => (b.profitH! > a.profitH! ? b : a)) : null;
  const worst = closed.length ? closed.reduce((a, b) => (b.profitH! < a.profitH! ? b : a)) : null;
  // Rank over the night, from the standings snapshot taken after every result.
  const ranks = (ctx.db.prepare('SELECT data FROM standings_snapshot WHERE night_id = ? ORDER BY id').all(n.id) as { data: string }[])
    .map((r) => (JSON.parse(r.data) as { playerId: number; rank: number }[]).find((x) => x.playerId === player.id)?.rank)
    .filter((r): r is number => r != null);
  const correctVotes = (ctx.db.prepare('SELECT COUNT(*) c FROM bounty_payout b JOIN vote_round v ON v.id = b.vote_round_id WHERE v.night_id = ? AND b.player_id = ?').get(n.id, player.id) as { c: number }).c;
  const votesCast = (ctx.db.prepare('SELECT COUNT(*) c FROM ballot b JOIN vote_round v ON v.id = b.vote_round_id WHERE v.night_id = ? AND b.player_id = ?').get(n.id, player.id) as { c: number }).c;
  const minted = (ctx.db.prepare('SELECT minted FROM minter_state WHERE night_id = ? AND player_id = ?').get(n.id, player.id) as { minted: number } | undefined)?.minted ?? 0;
  const achievements = (ctx.db.prepare('SELECT type FROM achievement WHERE night_id = ? AND player_id = ? ORDER BY id').all(n.id, player.id) as { type: string }[]).map((a) => a.type);
  return {
    night: { name: n.name, date: n.date },
    player: { id: player.id, displayName: player.display_name, ticker: player.ticker },
    goldH: me?.netWorthH ?? 0,
    rank: me?.rank ?? null,
    players: st.players.length,
    rankStart: ranks[0] ?? null,
    rankBest: ranks.length ? Math.min(...ranks) : null,
    bestTrade: best,
    worstTrade: worst && worst !== best ? worst : null,
    tradingResultH: closed.reduce((a, t) => a + t.profitH!, 0),
    correctVotes,
    votesCast,
    achievements,
    nftsMinted: Math.floor(minted),
    trades,
  };
}
export type Statement = ReturnType<typeof statement>;
