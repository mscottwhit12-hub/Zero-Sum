/**
 * Quarterly voting (spec §9). Driven by the night clock (pause excluded), so pausing freezes the window.
 *  - Quarter start: round opens, phones get an incoming call.
 *  - Window close: hidden drift = driftMax × (share − 1/N) is computed and stored. Never sent to anyone.
 *  - Quarter end: bounty pays everyone who picked the net-worth leader (or top 2 at large party sizes).
 */
import { ballotWeight, quarterAt, rankBy, resolveQuarter, voteDrift, type Ballot } from '@gn/engine';
import { hintsForStreak } from './hints';
import { j } from '../db';
import { conflict, notFound, bad, type Ctx } from '../context';
import { awardAchievements } from './achievements';
import { pushFeed } from './feed';
import { computeNightState, pid, type NightRow, type NightState, type PlayerRow } from './state';

interface RoundRow {
  id: number;
  night_id: number;
  quarter: number;
  status: 'open' | 'closed' | 'resolved' | 'void';
  opened_at: number;
  closed_at: number | null;
  drift: string | null;
  /** Set when the GM opened this round early: its window closes here (night-clock ms) instead of at the quarter's. */
  window_end_nms: number | null;
}

export function currentRound(ctx: Ctx, nightId: number): RoundRow | null {
  // An open round wins (an early-opened next quarter can be open while this quarter's round waits to resolve).
  return (ctx.db.prepare("SELECT * FROM vote_round WHERE night_id = ? AND status IN ('open','closed') ORDER BY status = 'open' DESC, quarter DESC LIMIT 1").get(nightId) as RoundRow | undefined) ?? null;
}

function ballots(ctx: Ctx, roundId: number): Ballot[] {
  return (ctx.db.prepare('SELECT player_id, target_player_id, weight FROM ballot WHERE vote_round_id = ?').all(roundId) as { player_id: number; target_player_id: number; weight: number }[]).map(
    (b) => ({ voterId: pid(b.player_id), targetId: pid(b.target_player_id), weight: b.weight }),
  );
}

const activeIds = (st: NightState) => st.players.filter((p) => p.left_at == null).map((p) => pid(p.id));

function resolve(ctx: Ctx, n: NightRow, round: RoundRow, st: NightState) {
  const active = new Set(activeIds(st));
  const standings = rankBy(
    st.standings.filter((r) => active.has(r.playerId)).map((r) => ({ ...r })),
    (r) => r.netWorthH,
  );
  const res = resolveQuarter(ballots(ctx, round.id), standings, st.settings);
  ctx.db.transaction(() => {
    const pay = ctx.db.prepare('INSERT INTO bounty_payout (vote_round_id, player_id, gold_h, paid_at) VALUES (?,?,?,?)');
    for (const p of res.payouts) pay.run(round.id, Number(p.playerId), p.goldH, ctx.now());
    ctx.db.prepare("UPDATE vote_round SET status = 'resolved', closed_at = COALESCE(closed_at, ?) WHERE id = ?").run(ctx.now(), round.id);
  })();
  pushFeed(ctx, n.id, 'vote', 'feed.vote_resolved', { quarter: round.quarter, leaders: res.winners.map(Number), correct: res.payouts.length });
  for (const p of res.payouts) ctx.bus.player(Number(p.playerId), 'vote:bounty', { quarter: round.quarter, goldH: p.goldH });
  ctx.bus.all('vote:update', { quarter: round.quarter, status: 'resolved' });
  awardAchievements(ctx, n.id);
  hintsForStreak(ctx, n, round.quarter, res.payouts.map((p) => Number(p.playerId)));
}

/** One step of the voting clock. Called by the tick loop every second while the night is live. */
export function voteStep(ctx: Ctx, n: NightRow): void {
  const st = computeNightState(ctx, n.id)!;
  const min = st.nightMs / 60_000;
  const pos = quarterAt(st.quarters, min);
  const rounds = ctx.db.prepare("SELECT * FROM vote_round WHERE night_id = ? AND status IN ('open','closed') ORDER BY quarter").all(n.id) as RoundRow[];
  for (const round of rounds) {
    const q = st.quarters.find((x) => x.n === round.quarter);
    // Its quarter is over (or no longer exists after a length change) → resolve it.
    if (!q || min >= q.endMin) {
      if (round.status === 'open') closeWindow(ctx, round, st);
      resolve(ctx, n, round, st);
      continue;
    }
    const windowEnd = round.window_end_nms ?? q.windowEndMin * 60_000;
    if (round.status === 'open' && st.nightMs >= windowEnd) closeWindow(ctx, round, st);
  }
  if (!pos.quarter || pos.phase !== 'window') return;
  const q = pos.quarter;
  const exists = ctx.db.prepare('SELECT 1 FROM vote_round WHERE night_id = ? AND quarter = ?').get(n.id, q.n);
  if (exists) return; // one round per quarter (an early-opened one counts); don't open late mid-quarter
  ctx.db.prepare("INSERT INTO vote_round (night_id, quarter, status, opened_at) VALUES (?, ?, 'open', ?)").run(n.id, q.n, ctx.now());
  pushFeed(ctx, n.id, 'vote', 'feed.vote_open', { quarter: q.n });
  ctx.bus.all('vote:call', { quarter: q.n });
  ctx.bus.refresh(n.id);
}

/**
 * GM: open the next quarter's vote now. Its window lasts the usual length (votes.windowMinutes); the quarter itself
 * still starts and ends on schedule, its hidden drift applies from its start, and its bounty pays at its end.
 */
export function openVoteEarly(ctx: Ctx, n: NightRow) {
  const st = computeNightState(ctx, n.id)!;
  if (st.night.status !== 'live') throw conflict('not_live', 'The night must be running.');
  if (ctx.db.prepare("SELECT 1 FROM vote_round WHERE night_id = ? AND status = 'open'").get(n.id)) throw conflict('vote_already_open', 'A vote is already open.');
  const min = st.nightMs / 60_000;
  const taken = new Set((ctx.db.prepare('SELECT quarter FROM vote_round WHERE night_id = ?').all(n.id) as { quarter: number }[]).map((r) => r.quarter));
  const q = st.quarters.find((x) => !taken.has(x.n) && x.endMin > min);
  if (!q) throw conflict('no_quarter_left', 'There is no later quarter to vote on.');
  const windowEnd = Math.min(st.nightMs + st.settings.votes.windowMinutes * 60_000, q.endMin * 60_000);
  ctx.db.prepare("INSERT INTO vote_round (night_id, quarter, status, opened_at, window_end_nms) VALUES (?, ?, 'open', ?, ?)").run(n.id, q.n, ctx.now(), Math.round(windowEnd));
  pushFeed(ctx, n.id, 'vote', 'feed.vote_open', { quarter: q.n });
  ctx.bus.all('vote:call', { quarter: q.n });
  ctx.bus.refresh(n.id);
  return { quarter: q.n };
}

function closeWindow(ctx: Ctx, round: RoundRow, st: NightState) {
  const drift = voteDrift(ballots(ctx, round.id), activeIds(st), st.settings);
  ctx.db.prepare("UPDATE vote_round SET status = 'closed', closed_at = ?, drift = ? WHERE id = ?").run(ctx.now(), j.str(Object.fromEntries(drift)), round.id);
  ctx.bus.all('vote:update', { quarter: round.quarter, status: 'closed' });
  ctx.bus.refresh(round.night_id);
}

/** Cast or change a ballot while the window is open. Self-votes allowed. */
export function castBallot(ctx: Ctx, player: PlayerRow, targetId: unknown) {
  const st = computeNightState(ctx, player.night_id)!;
  if (st.night.status !== 'live') throw conflict('voting_paused', 'Voting is paused.');
  if (player.left_at != null) throw conflict('player_left');
  const round = currentRound(ctx, player.night_id);
  if (!round || round.status !== 'open') throw conflict('vote_closed', 'Voting is closed.');
  const target = st.players.find((p) => p.id === Number(targetId) && p.left_at == null);
  if (!target) throw bad('bad_target');
  const nw = st.standings.find((r) => r.playerId === pid(player.id))?.netWorthH ?? 0;
  ctx.db
    .prepare('INSERT INTO ballot (vote_round_id, player_id, target_player_id, weight, created_at) VALUES (?,?,?,?,?) ON CONFLICT (vote_round_id, player_id) DO UPDATE SET target_player_id = excluded.target_player_id, weight = excluded.weight, created_at = excluded.created_at')
    .run(round.id, player.id, target.id, ballotWeight(nw, st.settings), ctx.now());
  ctx.bus.refresh(player.night_id);
  return { quarter: round.quarter, targetId: target.id };
}

/** Player-facing vote state: no tallies, no drift. */
export function voteView(ctx: Ctx, st: NightState, playerId: number | null) {
  const round = currentRound(ctx, st.night.id);
  if (!round) return null;
  const q = st.quarters.find((x) => x.n === round.quarter);
  const mine = playerId == null ? null : (ctx.db.prepare('SELECT target_player_id FROM ballot WHERE vote_round_id = ? AND player_id = ?').get(round.id, playerId) as { target_player_id: number } | undefined);
  return {
    quarter: round.quarter,
    open: round.status === 'open',
    windowEndsNms: round.window_end_nms ?? (q ? q.windowEndMin * 60_000 : null),
    quarterEndsNms: q ? q.endMin * 60_000 : null,
    myTarget: mine?.target_player_id ?? null,
  };
}

/** GM sees participation only (the drift is hidden from GMs too). */
export function voteGmView(ctx: Ctx, st: NightState) {
  const v = voteView(ctx, st, null);
  if (!v) return null;
  const round = currentRound(ctx, st.night.id)!;
  const cast = (ctx.db.prepare('SELECT COUNT(*) c FROM ballot WHERE vote_round_id = ?').get(round.id) as { c: number }).c;
  return { ...v, ballotsCast: cast, eligible: st.players.filter((p) => p.left_at == null).length };
}

export function requireRound(ctx: Ctx, nightId: number) {
  const r = currentRound(ctx, nightId);
  if (!r) throw notFound('no_vote');
  return r;
}
