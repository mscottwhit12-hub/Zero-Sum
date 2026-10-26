/**
 * Player trades (spec §7.2). All rules come from the engine: invest cap, per-lot lockout, FIFO sells,
 * fractional shares, fee, 1 trade per stock per player per tick, frozen while paused/closed.
 * Trade impact is queued and applies on the next tick. Holdings stay private to the player.
 */
import { buy, sell, toH, type TradeError } from '@gn/engine';
import { bad, conflict, HttpError, notFound, type Ctx } from '../context';
import { queueImpulse } from './market';
import { computeNightState, currentNight, nightMs, pid, type PlayerRow } from './state';

const MESSAGES: Record<TradeError, string> = {
  market_closed: 'Trading is closed right now.',
  rate_limited: 'One trade per stock per market tick. Try again in a few seconds.',
  below_minimum: 'Minimum trade is 1 gold.',
  insufficient_gold: 'Not enough gold.',
  over_cap: 'That would put you over your investment limit.',
  too_small: 'That amount buys less than 0.01 shares.',
  no_shares: "You don't hold that many shares.",
  locked: 'Those shares are still locked.',
};

const tradeError = (e: TradeError) => new HttpError(e === 'market_closed' ? 409 : 400, e, MESSAGES[e]);

function context(ctx: Ctx, player: PlayerRow, securityId: unknown) {
  const n = currentNight(ctx);
  if (!n || n.id !== player.night_id) throw notFound('no_night');
  if (player.left_at != null) throw conflict('player_left');
  if (typeof securityId !== 'string') throw bad('bad_security');
  const st = computeNightState(ctx, n.id)!;
  const security = st.securities.find((s) => s.id === securityId);
  if (!security) throw notFound('security_not_found');
  const last = ctx.db.prepare('SELECT MAX(tick) t FROM trade WHERE player_id = ? AND security_id = ? AND forced = 0').get(player.id, securityId) as { t: number | null };
  const gate = {
    marketOpen: n.status === 'live' && !n.trading_closed,
    tick: n.tick_count,
    lastTradeTick: last.t,
    now: nightMs(ctx, n),
  };
  const id = pid(player.id);
  return { n, st, security, gate, id };
}

export function playerBuy(ctx: Ctx, player: PlayerRow, input: { securityId: unknown; gold: unknown }) {
  const { n, st, security, gate, id } = context(ctx, player, input.securityId);
  const gold = Number(input.gold);
  if (!Number.isFinite(gold) || gold <= 0) throw bad('bad_amount');
  const lots = st.lots.filter((l) => l.playerId === id);
  const r = buy({ playerId: id, security, goldH: toH(gold), cashH: st.ledger.get(id)?.cashH ?? 0, lots, gate, lotId: 'new' }, st.settings);
  if (!r.ok) throw tradeError(r.error);
  const now = ctx.now();
  ctx.db.transaction(() => {
    ctx.db
      .prepare('INSERT INTO trade (night_id, player_id, security_id, side, shares_h, price, cash_h, fee_h, tick, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(n.id, player.id, security.id, 'buy', r.trade.sharesH, r.trade.price, r.trade.cashH, r.trade.feeH, gate.tick, now);
    ctx.db
      .prepare('INSERT INTO lot (night_id, player_id, security_id, shares_h, cost_basis_h, created_nms, unlock_nms) VALUES (?,?,?,?,?,?,?)')
      .run(n.id, player.id, security.id, r.lot.sharesH, r.lot.costBasisH, r.lot.createdAt, r.lot.unlockAt);
    if (r.impulse) queueImpulse(ctx, n.id, r.impulse);
  })();
  ctx.bus.refresh(n.id);
  return { side: 'buy', securityId: security.id, sharesH: r.trade.sharesH, price: r.trade.price, cashH: r.trade.cashH, feeH: r.trade.feeH, unlockNms: r.lot.unlockAt };
}

export function playerSell(ctx: Ctx, player: PlayerRow, input: { securityId: unknown; shares: unknown }) {
  const { n, st, security, gate, id } = context(ctx, player, input.securityId);
  let sharesH: number | 'all';
  if (input.shares === 'all') sharesH = 'all';
  else {
    const s = Number(input.shares);
    if (!Number.isFinite(s) || s <= 0) throw bad('bad_amount');
    sharesH = Math.round(s * 100);
  }
  const lots = st.lots.filter((l) => l.playerId === id && l.securityId === security.id);
  const r = sell({ playerId: id, security, sharesH, lots, gate }, st.settings);
  if (!r.ok) throw tradeError(r.error);
  const now = ctx.now();
  ctx.db.transaction(() => {
    ctx.db
      .prepare('INSERT INTO trade (night_id, player_id, security_id, side, shares_h, price, cash_h, fee_h, basis_h, tick, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(n.id, player.id, security.id, 'sell', r.trade.sharesH, r.trade.price, r.trade.cashH, r.trade.feeH, r.trade.basisH ?? null, gate.tick, now);
    // Replace this player's lots for the security with the engine's FIFO result.
    ctx.db.prepare('DELETE FROM lot WHERE night_id = ? AND player_id = ? AND security_id = ?').run(n.id, player.id, security.id);
    const ins = ctx.db.prepare('INSERT INTO lot (night_id, player_id, security_id, shares_h, cost_basis_h, created_nms, unlock_nms) VALUES (?,?,?,?,?,?,?)');
    for (const l of r.lots) ins.run(n.id, player.id, security.id, l.sharesH, l.costBasisH, l.createdAt, l.unlockAt);
    if (r.impulse) queueImpulse(ctx, n.id, r.impulse);
  })();
  ctx.bus.refresh(n.id);
  return { side: 'sell', securityId: security.id, sharesH: r.trade.sharesH, price: r.trade.price, cashH: r.trade.cashH, feeH: r.trade.feeH, realizedH: r.trade.realizedH };
}

/** Own trade history (private). */
export function myTrades(ctx: Ctx, player: PlayerRow) {
  return ctx.db
    .prepare('SELECT security_id AS securityId, side, shares_h AS sharesH, price, cash_h AS cashH, fee_h AS feeH, forced, created_at AS createdAt FROM trade WHERE player_id = ? ORDER BY id DESC LIMIT 200')
    .all(player.id);
}
