/**
 * Bets between players on a game's outcome (the phone's Bets app).
 *
 *  - A player offers a bet on a scheduled or running game: "<subject> wins" or "<subject> finishes in the top N", with
 *    odds "a to b" (the offerer risks the stake to win stake × a ÷ b). The offer is open to everyone, or to one named player.
 *  - Whoever accepts it locks both stakes (held through the gold ledger as kind 'bet' adjustments).
 *  - When the GM records the game's result the bet settles by itself: the winner takes both stakes. A tie, a game that is
 *    cancelled, or a player who wasn't in the game returns both stakes. Open offers lapse when the game ends.
 *  - The most either side can lose is the GM's limit (default 5 gold); a High Roller ticket (a challenge reward) lifts it for one bet.
 */
import { betKindAllowed, decideBet, maxLossH, oddsOk, PLACE_MAX, PLACE_MIN, toH, winAmountH, type BetKind, type GameResult } from '@gn/engine';
import { j } from '../db';
import { bad, conflict, notFound, type Ctx } from '../context';
import { audit } from './audit';
import { pushFeed } from './feed';
import type { GmAuth } from './gm';
import { computeNightState, currentNight, nightSettings, pid, type NightRow, type PlayerRow } from './state';

export type BetStatus = 'open' | 'accepted' | 'settled' | 'tie' | 'void' | 'cancelled' | 'expired';

interface BetRow {
  id: number;
  night_id: number;
  game_id: number;
  offerer_id: number;
  taker_id: number | null;
  target_id: number | null;
  kind: BetKind;
  subject_id: number;
  top_n: number | null;
  odds_a: number;
  odds_b: number;
  stake_h: number;
  win_h: number;
  ticket_id: number | null;
  status: BetStatus;
  winner_id: number | null;
  note: string | null;
  created_at: number;
  accepted_at: number | null;
  settled_at: number | null;
}

const gold = (h: number) => (h / 100).toFixed(2).replace(/\.00$/, '');

function liveNight(ctx: Ctx): NightRow {
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  if (n.status !== 'live' && n.status !== 'paused') throw conflict('bad_night_state', 'Betting is open while the night is running.');
  return n;
}

const getBet = (ctx: Ctx, id: number): BetRow => {
  const b = ctx.db.prepare('SELECT * FROM bet WHERE id = ?').get(id) as BetRow | undefined;
  if (!b) throw notFound('bet_not_found');
  return b;
};

const nameOf = (ctx: Ctx, id: number | null) => (id == null ? '?' : ((ctx.db.prepare('SELECT display_name FROM player WHERE id = ?').get(id) as { display_name: string } | undefined)?.display_name ?? '?'));
const gameOf = (ctx: Ctx, id: number) => ctx.db.prepare('SELECT id, night_id, name, mode, status FROM game WHERE id = ?').get(id) as { id: number; night_id: number; name: string; mode: 'competitive' | 'team' | 'coop'; status: string } | undefined;

/** Plain-language terms, e.g. "Ann wins at 3 to 1, 2 gold" / "Ann finishes top 3 at 1 to 2, 5 gold". */
function termsText(ctx: Ctx, b: BetRow): string {
  const who = nameOf(ctx, b.subject_id);
  const what = b.kind === 'win' ? `${who} wins` : `${who} finishes top ${b.top_n}`;
  return `${what} at ${b.odds_a} to ${b.odds_b} (${gold(b.stake_h)} vs ${gold(b.win_h)} gold)`;
}

/** Tickets the player holds and hasn't used: succeeded High Roller challenges with no live bet attached. */
function freeTickets(ctx: Ctx, playerId: number, nightId: number): number[] {
  const rows = ctx.db
    .prepare("SELECT id, reward FROM challenge WHERE player_id = ? AND night_id = ? AND status = 'succeeded' ORDER BY id")
    .all(playerId, nightId) as { id: number; reward: string }[];
  const used = new Set((ctx.db.prepare("SELECT ticket_id FROM bet WHERE ticket_id IS NOT NULL AND status IN ('open','accepted','settled','tie')").all() as { ticket_id: number }[]).map((r) => r.ticket_id));
  return rows.filter((r) => j.parse<{ type?: string }>(r.reward, {}).type === 'high_roller' && !used.has(r.id)).map((r) => r.id);
}

const cashOf = (ctx: Ctx, nightId: number, playerId: number) => computeNightState(ctx, nightId)?.ledger.get(pid(playerId))?.cashH ?? 0;

function adjust(ctx: Ctx, nightId: number, playerId: number, goldH: number, reason: string) {
  ctx.db.prepare("INSERT INTO adjustment (night_id, player_id, gold_h, reason, kind, gm_id, created_at) VALUES (?,?,?,?, 'bet', NULL, ?)").run(nightId, playerId, goldH, reason, ctx.now());
}

function activePlayer(ctx: Ctx, nightId: number, id: number) {
  return !!ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ? AND left_at IS NULL').get(id, nightId);
}

export interface OfferInput {
  gameId: unknown;
  kind: unknown;
  subjectId: unknown;
  topN?: unknown;
  oddsA: unknown;
  oddsB: unknown;
  /** Gold. */
  stake: unknown;
  /** Only this player may accept. Omit for an offer open to everyone. */
  targetId?: unknown;
  /** Use a High Roller ticket to lift the limit for this bet. */
  ticket?: unknown;
}

export function offerBet(ctx: Ctx, player: PlayerRow, input: OfferInput) {
  const n = liveNight(ctx);
  if (n.id !== player.night_id) throw notFound('no_night');
  if (player.left_at != null) throw conflict('player_left');
  const cfg = nightSettings(n).betting;
  if (!cfg.enabled) throw conflict('betting_off', 'Betting is switched off tonight.');
  const g = gameOf(ctx, Number(input.gameId));
  if (!g || g.night_id !== n.id) throw notFound('game_not_found');
  if (g.status !== 'scheduled' && g.status !== 'active') throw conflict('game_closed', 'Bets can only be placed on a scheduled or running game.');
  const kind = input.kind as BetKind;
  if (kind !== 'win' && kind !== 'place') throw bad('bad_bet', 'Choose a win bet or a place bet.');
  if (!betKindAllowed(g.mode, kind)) throw bad('bad_bet', 'Co-op games only take win bets.');
  const topN = kind === 'place' ? Number(input.topN) : null;
  if (kind === 'place' && !(Number.isInteger(topN) && topN! >= PLACE_MIN && topN! <= PLACE_MAX)) throw bad('bad_bet', `Top ${PLACE_MIN}–${PLACE_MAX} only.`);
  const subjectId = Number(input.subjectId);
  if (!activePlayer(ctx, n.id, subjectId)) throw bad('bad_subject', 'Pick a player in tonight’s game.');
  // Once the table is known, only people actually playing can be bet on, and a place bet can't be a sure thing.
  const seated = (ctx.db.prepare('SELECT player_id FROM game_participant WHERE game_id = ?').all(g.id) as { player_id: number }[]).map((r) => r.player_id);
  if (seated.length) {
    if (!seated.includes(subjectId)) throw bad('bad_subject', `${nameOf(ctx, subjectId)} isn’t playing ${g.name}.`);
    if (kind === 'place' && topN! >= seated.length) throw bad('bad_bet', `Only ${seated.length} are playing, so a top ${topN} bet can’t lose. Pick a smaller number.`);
  }
  const a = Number(input.oddsA);
  const b = Number(input.oddsB);
  if (!oddsOk(a, b)) throw bad('bad_odds', 'Odds are whole numbers from 1 to 10, like 3 to 1.');
  const stake = Number(input.stake);
  const stakeH = toH(stake);
  if (!Number.isFinite(stake) || stakeH < 10) throw bad('bad_amount', 'The smallest bet is 0.10 gold.');
  let targetId: number | null = null;
  if (input.targetId != null && input.targetId !== '') {
    targetId = Number(input.targetId);
    if (targetId === player.id || !activePlayer(ctx, n.id, targetId)) throw bad('bad_target');
  }
  const winH = winAmountH(stakeH, a, b);
  const worst = maxLossH(stakeH, a, b);
  let ticketId: number | null = null;
  const limitH = toH(cfg.maxStake);
  if (worst > limitH) {
    if (!input.ticket) throw bad('over_limit', `Bets are limited to ${gold(limitH)} gold at risk on either side${freeTickets(ctx, player.id, n.id).length ? '. Use your High Roller ticket for a bigger one.' : '.'}`);
    ticketId = freeTickets(ctx, player.id, n.id)[0] ?? null;
    if (ticketId == null) throw conflict('no_ticket', 'You have no High Roller ticket to use.');
    if (worst > toH(cfg.ticketMaxStake)) throw bad('over_limit', `Even with a ticket, the limit is ${cfg.ticketMaxStake} gold at risk on either side.`);
  }
  const open = (ctx.db.prepare("SELECT COUNT(*) c FROM bet WHERE night_id = ? AND offerer_id = ? AND status = 'open'").get(n.id, player.id) as { c: number }).c;
  if (open >= cfg.maxOpenOffers) throw conflict('too_many_offers', `You can have ${cfg.maxOpenOffers} open offers at once.`);
  if (cashOf(ctx, n.id, player.id) < stakeH) throw conflict('insufficient_cash', 'You don’t have that much gold free.');
  const id = ctx.db.transaction(() => {
    const r = ctx.db
      .prepare("INSERT INTO bet (night_id, game_id, offerer_id, target_id, kind, subject_id, top_n, odds_a, odds_b, stake_h, win_h, ticket_id, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'open', ?)")
      .run(n.id, g.id, player.id, targetId, kind, subjectId, topN, a, b, stakeH, winH, ticketId, ctx.now());
    const id = Number(r.lastInsertRowid);
    audit(ctx, { nightId: n.id, gmId: null, action: 'bet.offer', entity: 'bet', entityId: id, after: { playerId: player.id, gameId: g.id, kind, subjectId, topN, oddsA: a, oddsB: b, stakeH, winH, targetId, ticket: ticketId != null } });
    return id;
  })();
  ctx.bus.refresh(n.id);
  if (targetId != null) ctx.bus.player(targetId, 'bet:new', { id });
  return { id };
}

export function acceptBet(ctx: Ctx, player: PlayerRow, id: number) {
  const n = liveNight(ctx);
  const b = getBet(ctx, id);
  if (b.night_id !== n.id || player.night_id !== n.id) throw notFound('bet_not_found');
  if (player.left_at != null) throw conflict('player_left');
  if (b.status !== 'open') throw conflict('bet_not_open', 'That bet is no longer open.');
  if (b.offerer_id === player.id) throw conflict('own_bet', 'You can’t take your own offer.');
  if (!activePlayer(ctx, n.id, b.offerer_id)) {
    ctx.db.prepare("UPDATE bet SET status = 'expired', note = 'The offerer left.', settled_at = ? WHERE id = ?").run(ctx.now(), id);
    ctx.bus.refresh(n.id);
    throw conflict('offerer_gone', 'That offer has lapsed: the offerer has left.');
  }
  if (b.target_id != null && b.target_id !== player.id) throw conflict('not_for_you', 'That offer is for someone else.');
  const g = gameOf(ctx, b.game_id);
  if (!g || (g.status !== 'scheduled' && g.status !== 'active')) throw conflict('game_closed', 'That game is already over.');
  if (!nightSettings(n).betting.enabled) throw conflict('betting_off', 'Betting is switched off tonight.');
  if (cashOf(ctx, n.id, player.id) < b.win_h) throw conflict('insufficient_cash', `You need ${gold(b.win_h)} gold free to take this bet.`);
  if (cashOf(ctx, n.id, b.offerer_id) < b.stake_h) {
    ctx.db.prepare("UPDATE bet SET status = 'expired', note = 'The offerer no longer had the gold free.', settled_at = ? WHERE id = ?").run(ctx.now(), id);
    ctx.bus.refresh(n.id);
    throw conflict('offerer_short', 'That offer has lapsed: the offerer no longer has the gold.');
  }
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE bet SET status = 'accepted', taker_id = ?, accepted_at = ? WHERE id = ?").run(player.id, ctx.now(), id);
    adjust(ctx, n.id, b.offerer_id, -b.stake_h, `Bet #${id} (${g.name}): stake held`);
    adjust(ctx, n.id, player.id, -b.win_h, `Bet #${id} (${g.name}): stake held`);
    audit(ctx, { nightId: n.id, gmId: null, action: 'bet.accept', entity: 'bet', entityId: id, after: { takerId: player.id } });
  })();
  pushFeed(ctx, n.id, 'bet', 'feed.bet_accepted', { from: b.offerer_id, to: player.id, name: g.name, terms: termsText(ctx, b) });
  ctx.bus.player(b.offerer_id, 'bet:accepted', { id });
  ctx.bus.refresh(n.id);
  return { id };
}

/** The offerer takes back an offer nobody has accepted. */
export function cancelBet(ctx: Ctx, player: PlayerRow, id: number) {
  const n = liveNight(ctx);
  const b = getBet(ctx, id);
  if (b.night_id !== n.id || b.offerer_id !== player.id) throw notFound('bet_not_found');
  if (b.status !== 'open') throw conflict('bet_not_open', 'Only an open offer can be withdrawn.');
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE bet SET status = 'cancelled', settled_at = ? WHERE id = ?").run(ctx.now(), id);
    audit(ctx, { nightId: n.id, gmId: null, action: 'bet.cancel', entity: 'bet', entityId: id });
  })();
  ctx.bus.refresh(n.id);
  return { id };
}

function refund(ctx: Ctx, b: BetRow, status: 'tie' | 'void' | 'expired' | 'cancelled', note: string) {
  if (b.status === 'accepted') {
    const g = gameOf(ctx, b.game_id);
    adjust(ctx, b.night_id, b.offerer_id, b.stake_h, `Bet #${b.id} (${g?.name ?? 'game'}): stake returned`);
    adjust(ctx, b.night_id, b.taker_id!, b.win_h, `Bet #${b.id} (${g?.name ?? 'game'}): stake returned`);
  }
  ctx.db.prepare('UPDATE bet SET status = ?, note = ?, settled_at = ? WHERE id = ?').run(status, note, ctx.now(), b.id);
}

/** GM safety valve: call off any open or accepted bet; accepted stakes go back. */
export function voidBet(ctx: Ctx, actor: GmAuth, id: number, reason?: unknown) {
  const n = liveNight(ctx);
  const b = getBet(ctx, id);
  if (b.night_id !== n.id) throw notFound('bet_not_found');
  if (b.status !== 'open' && b.status !== 'accepted') throw conflict('bet_closed', 'That bet is already settled.');
  const note = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : 'Called off by the GM.';
  ctx.db.transaction(() => {
    refund(ctx, b, 'void', note);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'bet.void', entity: 'bet', entityId: id, before: { status: b.status }, after: { note } });
  })();
  if (b.status === 'accepted') pushFeed(ctx, n.id, 'bet', 'feed.bet_void', { from: b.offerer_id, to: b.taker_id, name: gameOf(ctx, b.game_id)?.name ?? '' });
  ctx.bus.refresh(n.id);
  return { id };
}

/** Called once a game's result is recorded: settle every accepted bet on it, lapse the open ones. */
export function settleBetsForGame(ctx: Ctx, n: NightRow, gameId: number, result: GameResult) {
  const bets = ctx.db.prepare("SELECT * FROM bet WHERE game_id = ? AND status IN ('open','accepted')").all(gameId) as BetRow[];
  if (!bets.length) return;
  const g = gameOf(ctx, gameId);
  const feed: Parameters<typeof pushFeed>[2][] = [];
  const data: Record<string, unknown>[] = [];
  ctx.db.transaction(() => {
    for (const b of bets) {
      if (b.status === 'open') {
        refund(ctx, b, 'expired', 'The game ended before anyone took this bet.');
        continue;
      }
      const out = decideBet(result, { kind: b.kind, subjectId: String(b.subject_id), topN: b.top_n ?? undefined });
      if (out === 'tie' || out === 'void') {
        refund(ctx, b, out, out === 'tie' ? 'Tied: stakes returned.' : 'The player wasn’t in the game: stakes returned.');
        feed.push(out === 'tie' ? 'feed.bet_tie' : 'feed.bet_void');
        data.push({ from: b.offerer_id, to: b.taker_id, name: g?.name ?? '' });
        continue;
      }
      const winner = out === 'yes' ? b.offerer_id : b.taker_id!;
      adjust(ctx, b.night_id, winner, b.stake_h + b.win_h, `Bet #${b.id} (${g?.name ?? 'game'}): won`);
      ctx.db.prepare("UPDATE bet SET status = 'settled', winner_id = ?, settled_at = ? WHERE id = ?").run(winner, ctx.now(), b.id);
      audit(ctx, { nightId: b.night_id, gmId: null, action: 'bet.settle', entity: 'bet', entityId: b.id, after: { winnerId: winner, gameId } });
      feed.push('feed.bet_settled');
      data.push({ winnerId: winner, from: b.offerer_id, to: b.taker_id, name: g?.name ?? '', goldH: winner === b.offerer_id ? b.win_h : b.stake_h });
    }
  })();
  feed.forEach((m, i) => pushFeed(ctx, n.id, 'bet', m as string, data[i]!));
  for (const b of bets) if (b.status === 'accepted') for (const p of [b.offerer_id, b.taker_id!]) ctx.bus.player(p, 'bet:settled', { id: b.id });
}

/** A game was cancelled: refund accepted bets, lapse open ones. */
export function closeBetsForGame(ctx: Ctx, nightId: number, gameId: number) {
  const bets = ctx.db.prepare("SELECT * FROM bet WHERE game_id = ? AND status IN ('open','accepted')").all(gameId) as BetRow[];
  if (!bets.length) return;
  ctx.db.transaction(() => {
    for (const b of bets) refund(ctx, b, b.status === 'open' ? 'expired' : 'void', 'The game was cancelled.');
  })();
  for (const b of bets) if (b.status === 'accepted') pushFeed(ctx, nightId, 'bet', 'feed.bet_void', { from: b.offerer_id, to: b.taker_id, name: gameOf(ctx, gameId)?.name ?? '' });
  ctx.bus.refresh(nightId);
}

export interface BetView {
  id: number;
  gameId: number;
  kind: BetKind;
  subjectId: number;
  topN: number | null;
  oddsA: number;
  oddsB: number;
  stakeH: number;
  winH: number;
  offererId: number;
  takerId: number | null;
  targetId: number | null;
  status: BetStatus;
  winnerId: number | null;
  ticket: boolean;
  note: string | null;
  createdAt: number;
}

const toView = (b: BetRow): BetView => ({
  id: b.id,
  gameId: b.game_id,
  kind: b.kind,
  subjectId: b.subject_id,
  topN: b.top_n,
  oddsA: b.odds_a,
  oddsB: b.odds_b,
  stakeH: b.stake_h,
  winH: b.win_h,
  offererId: b.offerer_id,
  takerId: b.taker_id,
  targetId: b.target_id,
  status: b.status,
  winnerId: b.winner_id,
  ticket: b.ticket_id != null,
  note: b.note,
  createdAt: b.created_at,
});

/** Player view: open offers (a targeted one only to the offerer and the person it's for), live bets, and recent results. */
export function playerBets(ctx: Ctx, n: NightRow, playerId: number) {
  const cfg = nightSettings(n).betting;
  const rows = ctx.db.prepare('SELECT * FROM bet WHERE night_id = ? ORDER BY id DESC LIMIT 200').all(n.id) as BetRow[];
  const visible = rows.filter((b) => b.status !== 'open' || b.target_id == null || b.target_id === playerId || b.offerer_id === playerId);
  // Cancelled and lapsed offers are noise; everything else stays visible for the night.
  const shown = visible.filter((b) => !['cancelled', 'expired'].includes(b.status) || b.offerer_id === playerId);
  return {
    enabled: cfg.enabled,
    limitH: toH(cfg.maxStake),
    ticketLimitH: toH(cfg.ticketMaxStake),
    tickets: freeTickets(ctx, playerId, n.id).length,
    list: shown.map(toView),
  };
}

/** GM view: every bet tonight. */
export function gmBets(ctx: Ctx, nightId: number): BetView[] {
  return (ctx.db.prepare('SELECT * FROM bet WHERE night_id = ? ORDER BY id DESC LIMIT 300').all(nightId) as BetRow[]).map(toView);
}
