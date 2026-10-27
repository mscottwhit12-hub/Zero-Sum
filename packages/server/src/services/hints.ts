/**
 * Hint rewards: tips about hidden mechanics, delivered to the phone's Messages app as anonymous tips.
 * Every grant is idempotent on (player, source, source_ref), so retries and result corrections never double-pay.
 */
import { drawHint, gameHintTier, HINT_TIERS, hintVars, MINTER_HINT_TIERS, type GameResult, type HintTier } from '@gn/engine';
import { bad, conflict, notFound, type Ctx } from '../context';
import { audit } from './audit';
import type { GmAuth } from './gm';
import { currentNight, nightMs, nightSettings, type NightRow, type PlayerRow } from './state';

export type HintSource = 'game_win' | 'game_last' | 'streak' | 'minter' | 'memo' | 'buy' | 'reroll_trade' | 'gm' | 'handicap';

interface GrantRow {
  id: number;
  player_id: number;
  hint_id: string;
  tier: HintTier;
  source: HintSource;
  source_ref: string;
  cost_h: number;
  night_ms: number;
  created_at: number;
  read_at: number | null;
}

const tierOf = (v: unknown): HintTier => {
  if (!HINT_TIERS.includes(v as HintTier)) throw bad('bad_tier', 'Tier must be common, rarer or rarest.');
  return v as HintTier;
};

/** Deterministic 0..1 per (night, player, ref) so a re-run picks the same tip. */
function pickFor(nightId: number, playerId: number, ref: string): number {
  let h = 2166136261 ^ nightId;
  for (const c of `${playerId}:${ref}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Grants a tip if this (source, ref) hasn't paid this player yet. Returns the grant id, or null if already granted / disabled. */
export function grantHint(
  ctx: Ctx,
  n: NightRow,
  playerId: number,
  tier: HintTier,
  source: HintSource,
  ref: string,
  opts: { costH?: number; gmId?: number | null; force?: boolean } = {},
): number | null {
  const settings = nightSettings(n);
  if (!settings.hints.enabled && !opts.force) return null;
  if (ctx.db.prepare('SELECT 1 FROM hint_grant WHERE night_id = ? AND player_id = ? AND source = ? AND source_ref = ?').get(n.id, playerId, source, ref)) return null;
  const seen = new Set((ctx.db.prepare('SELECT hint_id FROM hint_grant WHERE night_id = ? AND player_id = ?').all(n.id, playerId) as { hint_id: string }[]).map((r) => r.hint_id));
  const hint = drawHint(tier, seen, pickFor(n.id, playerId, `${source}:${ref}`));
  const r = ctx.db
    .prepare('INSERT INTO hint_grant (night_id, player_id, hint_id, tier, source, source_ref, cost_h, gm_id, night_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(n.id, playerId, hint.id, hint.tier, source, ref, opts.costH ?? 0, opts.gmId ?? null, nightMs(ctx, n), ctx.now());
  const id = Number(r.lastInsertRowid);
  ctx.bus.player(playerId, 'hint:new', { id });
  return id;
}

// ---------------------------------------------------------------- sources

/** Winners and last places of qualifying competitive/team games. Called after every result or correction. */
export function hintsForResult(ctx: Ctx, n: NightRow, result: GameResult): void {
  const s = nightSettings(n);
  if (!s.hints.enabled || result.mode === 'coop') return;
  const tier = gameHintTier(result.participants.length, result.actualHours, s);
  if (!tier) return;
  const placed = result.participants.filter((p) => !p.dnf && p.placement != null);
  if (placed.length < 2) return;
  const best = Math.min(...placed.map((p) => p.placement!));
  const worst = Math.max(...placed.map((p) => p.placement!));
  if (best === worst) return; // everyone tied: no winner, no last place
  for (const p of placed) {
    if (s.hints.games.win && p.placement === best) grantHint(ctx, n, Number(p.playerId), tier, 'game_win', `game:${result.id}`);
    if (s.hints.games.lastPlace && p.placement === worst) grantHint(ctx, n, Number(p.playerId), tier, 'game_last', `game:${result.id}`);
  }
}

/** Two correct quarter picks in a row → a rarer tip. `correct` = player ids paid a bounty in quarter q. */
export function hintsForStreak(ctx: Ctx, n: NightRow, quarter: number, correct: number[]): void {
  const s = nightSettings(n);
  if (!s.hints.enabled || !s.hints.streak || quarter < 2) return;
  const prev = new Set(
    (ctx.db
      .prepare('SELECT b.player_id FROM bounty_payout b JOIN vote_round r ON r.id = b.vote_round_id WHERE r.night_id = ? AND r.quarter = ?')
      .all(n.id, quarter - 1) as { player_id: number }[]).map((r) => r.player_id),
  );
  for (const p of correct) if (prev.has(p)) grantHint(ctx, n, p, 'rarer', 'streak', `q:${quarter}`);
}

/** First Server Rack / Data Center / Orbital Array. `bought` = tier ids just bought. */
export function hintsForMinter(ctx: Ctx, n: NightRow, playerId: number, bought: string[]): void {
  const s = nightSettings(n);
  if (!s.hints.enabled || !s.hints.minter) return;
  for (const t of bought) {
    const tier = MINTER_HINT_TIERS[t];
    if (tier) grantHint(ctx, n, playerId, tier, 'minter', `tier:${t}`);
  }
}

// ---------------------------------------------------------------- player actions

const priceOf = (s: ReturnType<typeof nightSettings>, tier: HintTier) =>
  tier === 'rarest' ? s.hints.buy.priceRarest : tier === 'rarer' ? s.hints.buy.priceRarer : s.hints.buy.priceCommon;

/** Buy a tip with gold (setting off by default). The cost leaves cash like a trade; it doesn't touch the stock's fair value. */
export function buyHint(ctx: Ctx, player: PlayerRow, input: { tier?: unknown; cashH: number }): { id: number } {
  const n = currentNight(ctx);
  if (!n || n.id !== player.night_id) throw notFound('no_night');
  if (n.status !== 'live') throw conflict('not_live', 'Tips can be bought while the night is live.');
  const s = nightSettings(n);
  if (!s.hints.enabled || !s.hints.buy.enabled) throw conflict('tips_closed', 'Tips are not for sale tonight.');
  const tier = tierOf(input.tier ?? 'common');
  const costH = Math.round(priceOf(s, tier) * 100);
  if (input.cashH < costH) throw conflict('not_enough_gold', 'Not enough gold.');
  const count = (ctx.db.prepare("SELECT COUNT(*) c FROM hint_grant WHERE night_id = ? AND player_id = ? AND source = 'buy'").get(n.id, player.id) as { c: number }).c;
  const id = ctx.db.transaction(() => grantHint(ctx, n, player.id, tier, 'buy', `buy:${count + 1}`, { costH }))();
  if (id == null) throw conflict('try_again');
  ctx.bus.refresh(n.id);
  return { id };
}

/** Trade one unused re-roll token for a common tip; at most once per cooldown (night clock). Not a re-roll spend (no SCIC move). */
export function tradeRerollForHint(ctx: Ctx, player: PlayerRow): { id: number } {
  const n = currentNight(ctx);
  if (!n || n.id !== player.night_id) throw notFound('no_night');
  if (n.status !== 'live') throw conflict('not_live', 'Trade-ins open while the night is live.');
  const s = nightSettings(n);
  if (!s.hints.enabled || !s.hints.rerollTradeIn.enabled) throw conflict('tradein_closed', 'Trade-ins are closed tonight.');
  const p = ctx.db.prepare('SELECT reroll_tokens_left, hint_tradein_nms FROM player WHERE id = ?').get(player.id) as { reroll_tokens_left: number; hint_tradein_nms: number | null };
  if (p.reroll_tokens_left <= 0) throw conflict('no_rerolls', 'No re-roll tokens left to trade.');
  const now = nightMs(ctx, n);
  const cool = s.hints.rerollTradeIn.cooldownMinutes * 60_000;
  if (p.hint_tradein_nms != null && now - p.hint_tradein_nms < cool) throw conflict('tradein_cooldown', 'You can trade in another token later.');
  const id = ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE player SET reroll_tokens_left = reroll_tokens_left - 1, hint_tradein_nms = ? WHERE id = ?').run(now, player.id);
    return grantHint(ctx, n, player.id, 'common', 'reroll_trade', `t:${now}`);
  })();
  if (id == null) throw conflict('try_again');
  ctx.bus.refresh(n.id);
  return { id };
}

export function readHint(ctx: Ctx, player: PlayerRow, id: number): void {
  const r = ctx.db.prepare('UPDATE hint_grant SET read_at = COALESCE(read_at, ?) WHERE id = ? AND player_id = ?').run(ctx.now(), id, player.id);
  if (!r.changes) throw notFound();
  ctx.bus.refresh(player.night_id);
}

// ---------------------------------------------------------------- GM

/** Any GM: send a tip by hand. */
export function gmSendHint(ctx: Ctx, actor: GmAuth, input: { playerId?: unknown; tier?: unknown }): { id: number } {
  const n = currentNight(ctx);
  if (!n || !['live', 'paused'].includes(n.status)) throw conflict('bad_night_state', 'Tips can be sent while the night is running.');
  const playerId = Number(input.playerId);
  if (!ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ? AND left_at IS NULL').get(playerId, n.id)) throw notFound('player_not_found');
  const tier = tierOf(input.tier);
  const count = (ctx.db.prepare("SELECT COUNT(*) c FROM hint_grant WHERE night_id = ? AND source = 'gm'").get(n.id) as { c: number }).c;
  const id = grantHint(ctx, n, playerId, tier, 'gm', `gm:${count + 1}`, { gmId: actor.gmId, force: true });
  if (id == null) throw conflict('try_again');
  audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'hint.send', entity: 'player', entityId: playerId, after: { tier, grantId: id } });
  ctx.bus.refresh(n.id);
  return { id };
}

// ---------------------------------------------------------------- views

export function playerHints(ctx: Ctx, n: NightRow, playerId: number) {
  const vars = hintVars(nightSettings(n));
  return (ctx.db.prepare('SELECT * FROM hint_grant WHERE night_id = ? AND player_id = ? ORDER BY id DESC').all(n.id, playerId) as GrantRow[]).map((g) => ({
    id: g.id,
    hintId: g.hint_id,
    vars,
    createdAt: g.created_at,
    read: g.read_at != null,
  }));
}

/** Purchases leave cash like trade flows (not earned gold). */
export function hintSpends(ctx: Ctx, nightId: number): { playerId: number; cashH: number }[] {
  return (ctx.db.prepare('SELECT player_id, cost_h FROM hint_grant WHERE night_id = ? AND cost_h > 0').all(nightId) as { player_id: number; cost_h: number }[]).map((r) => ({
    playerId: r.player_id,
    cashH: -r.cost_h,
  }));
}

export function tipShop(ctx: Ctx, n: NightRow, playerId: number) {
  const s = nightSettings(n);
  const p = ctx.db.prepare('SELECT reroll_tokens_left, hint_tradein_nms FROM player WHERE id = ?').get(playerId) as { reroll_tokens_left: number; hint_tradein_nms: number | null } | undefined;
  const nextAt = p?.hint_tradein_nms != null ? p.hint_tradein_nms + s.hints.rerollTradeIn.cooldownMinutes * 60_000 : null;
  return {
    buy: s.hints.enabled && s.hints.buy.enabled ? { common: s.hints.buy.priceCommon, rarer: s.hints.buy.priceRarer, rarest: s.hints.buy.priceRarest } : null,
    tradeIn: s.hints.enabled && s.hints.rerollTradeIn.enabled ? { tokens: p?.reroll_tokens_left ?? 0, nextAtNms: nextAt } : null,
  };
}

export function gmHintLog(ctx: Ctx, nightId: number) {
  return (ctx.db.prepare('SELECT * FROM hint_grant WHERE night_id = ? ORDER BY id DESC LIMIT 200').all(nightId) as GrantRow[]).map((g) => ({
    id: g.id,
    playerId: g.player_id,
    hintId: g.hint_id,
    tier: g.tier,
    source: g.source,
    costH: g.cost_h,
    nightMs: g.night_ms,
    createdAt: g.created_at,
    read: g.read_at != null,
  }));
}
