import {
  createSecurities,
  endNight as engineEndNight,
  resolveSettings,
  toH,
  validateSettings,
  type DeepPartial,
  type Settings,
} from '@gn/engine';
import { j } from '../db';
import { bad, conflict, forbidden, notFound, type Ctx } from '../context';
import { audit } from './audit';
import { pushFeed } from './feed';
import type { GmAuth } from './gm';
import {
  computeNightState,
  currentNight,
  getNight,
  loadLedgerInput,
  loadLots,
  loadSecurities,
  nightOverrides,
  pid,
  players,
  upsertSecurities,
  type NightRow,
  type NightStatus,
} from './state';

export type NightAction = 'openJoins' | 'start' | 'pause' | 'resume' | 'closeTrading' | 'end' | 'archive';

/**
 * Pure state machine. Returns the new status, or an error code.
 * setup → joins_open → live ⇄ paused → ended → archived; closeTrading is a flag on live/paused.
 */
export function transition(status: NightStatus, tradingClosed: boolean, action: NightAction): { status: NightStatus; tradingClosed: boolean } | { error: string } {
  switch (action) {
    case 'openJoins':
      return status === 'setup' ? { status: 'joins_open', tradingClosed } : { error: 'bad_transition' };
    case 'start':
      return status === 'joins_open' ? { status: 'live', tradingClosed } : { error: 'bad_transition' };
    case 'pause':
      return status === 'live' ? { status: 'paused', tradingClosed } : { error: 'bad_transition' };
    case 'resume':
      return status === 'paused' ? { status: 'live', tradingClosed } : { error: 'bad_transition' };
    case 'closeTrading':
      if (status !== 'live' && status !== 'paused') return { error: 'bad_transition' };
      return tradingClosed ? { error: 'already_closed' } : { status, tradingClosed: true };
    case 'end':
      // Pressing End force-closes trading.
      return status === 'live' || status === 'paused' ? { status: 'ended', tradingClosed: true } : { error: 'bad_transition' };
    case 'archive':
      return status === 'ended' ? { status: 'archived', tradingClosed } : { error: 'bad_transition' };
  }
}

const masterOnly = (actor: GmAuth) => {
  if (actor.role !== 'master') throw forbidden('master_only');
};

export function createNight(ctx: Ctx, actor: GmAuth, input: { name?: unknown; date?: unknown; lengthMinutes?: unknown; settings?: unknown }): NightRow {
  masterOnly(actor);
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : 'Game Night';
  const date = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date(ctx.now()).toISOString().slice(0, 10);
  const length = Number(input.lengthMinutes ?? 300);
  if (!Number.isInteger(length) || length < 30 || length > 24 * 60) throw bad('bad_length', 'Night length must be 30–1440 minutes.');
  const overrides = (input.settings ?? {}) as DeepPartial<Settings>;
  checkSettings(overrides);
  const created = ctx.db.transaction(() => {
    if (currentNight(ctx)) throw conflict('night_in_progress', 'Archive the current night first.');
    const r = ctx.db
      .prepare("INSERT INTO night (name, date, status, length_minutes, settings, created_at) VALUES (?,?, 'setup', ?, ?, ?)")
      .run(name, date, length, j.str(overrides), ctx.now());
    const n = getNight(ctx, Number(r.lastInsertRowid))!;
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'night.create', entity: 'night', entityId: n.id, after: { name, date, length } });
    return n;
  })();
  ctx.bus.all('night:update', { created: true });
  ctx.bus.refresh(created.id);
  return created;
}

function checkSettings(overrides: DeepPartial<Settings>): Settings {
  let resolved: Settings;
  try {
    resolved = resolveSettings(overrides);
  } catch {
    throw bad('bad_settings');
  }
  const issues = validateSettings(resolved);
  if (issues.length) throw bad('bad_settings', issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  return resolved;
}

function requireNight(ctx: Ctx): NightRow {
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  return n;
}

/** Applies a state-machine action with its side effects. */
export function applyNightAction(ctx: Ctx, actor: GmAuth, action: NightAction, opts: { pauseMinutes?: unknown } = {}): NightRow {
  masterOnly(actor);
  const result = ctx.db.transaction(() => {
    const n = requireNight(ctx);
    const t = transition(n.status, !!n.trading_closed, action);
    if ('error' in t) throw conflict(t.error, `Can't ${action} while the night is ${n.status}${n.trading_closed ? ' (trading closed)' : ''}.`);
    const now = ctx.now();
    const before = { status: n.status, tradingClosed: !!n.trading_closed };
    let feed: { type: string; message: string } | null = null;

    switch (action) {
      case 'openJoins':
        feed = { type: 'night', message: 'feed.joins_open' };
        break;
      case 'start': {
        const ps = players(ctx, n.id);
        if (ps.length < 1) throw conflict('no_players', 'At least one player must join first.');
        // Equal starting stake for everyone present when the night goes live.
        ctx.db.prepare('UPDATE player SET got_stake = 1 WHERE night_id = ? AND left_at IS NULL').run(n.id);
        const settings = resolveSettings(nightOverrides(n));
        // Player security ids are `p:<playerId>` (engine playerSecurityId).
        const secs = createSecurities({ players: ps.map((p) => ({ id: pid(p.id), ticker: p.ticker })) }, settings);
        upsertSecurities(ctx, n.id, secs);
        ctx.db.prepare('UPDATE night SET started_at = ?, last_tick_at = ? WHERE id = ?').run(now, now, n.id);
        feed = { type: 'night', message: 'feed.night_live' };
        break;
      }
      case 'pause':
        ctx.db.prepare('INSERT INTO night_pause (night_id, started_at) VALUES (?, ?)').run(n.id, now);
        {
          const mins = Number(opts.pauseMinutes);
          const until = Number.isFinite(mins) && mins > 0 && mins <= 240 ? now + Math.round(mins * 60_000) : null;
          ctx.db.prepare('UPDATE night SET paused_at = ?, pause_until = ? WHERE id = ?').run(now, until, n.id);
        }
        feed = { type: 'night', message: 'feed.paused' };
        break;
      case 'resume':
        closeOpenPause(ctx, n.id, now);
        // Don't fire a catch-up tick the instant we resume.
        ctx.db.prepare('UPDATE night SET paused_at = NULL, pause_until = NULL, last_tick_at = ? WHERE id = ?').run(now, n.id);
        feed = { type: 'night', message: 'feed.resumed' };
        break;
      case 'closeTrading':
        feed = { type: 'night', message: 'feed.trading_closed' };
        break;
      case 'end':
        if (n.status === 'paused') closeOpenPause(ctx, n.id, now);
        finishNight(ctx, n, now);
        feed = { type: 'night', message: 'feed.collapse' };
        break;
      case 'archive':
        break;
    }
    ctx.db.prepare('UPDATE night SET status = ?, trading_closed = ? WHERE id = ?').run(t.status, t.tradingClosed ? 1 : 0, n.id);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: `night.${action}`, entity: 'night', entityId: n.id, before, after: t });
    return { night: getNight(ctx, n.id)!, feed };
  })();

  const n = result.night;
  if (result.feed) pushFeed(ctx, n.id, result.feed.type, result.feed.message);
  const event = { pause: 'night:paused', resume: 'night:resumed', end: 'night:ended' }[action as string] ?? 'night:update';
  ctx.bus.all(event, { status: n.status, tradingClosed: !!n.trading_closed });
  ctx.bus.refresh(n.id);
  return n;
}

function closeOpenPause(ctx: Ctx, nightId: number, now: number) {
  ctx.db.prepare('UPDATE night_pause SET ended_at = ? WHERE night_id = ? AND ended_at IS NULL').run(now, nightId);
}

/**
 * End sequence (locked #3): force-resolve the open quarter (bounty) on net worth, then auto-sell every lot
 * at the pre-crash price (10% fee on profits), then the podium is by gold.
 */
function finishNight(ctx: Ctx, n: NightRow, now: number) {
  const settings = resolveSettings(nightOverrides(n));
  const securities = loadSecurities(ctx, n.id);
  const lots = loadLots(ctx, n.id);
  const ps = players(ctx, n.id);
  const open = ctx.db
    .prepare("SELECT id FROM vote_round WHERE night_id = ? AND status IN ('open','closed') ORDER BY quarter DESC LIMIT 1")
    .get(n.id) as { id: number } | undefined;
  const ballots = open
    ? (ctx.db.prepare('SELECT player_id, target_player_id, weight FROM ballot WHERE vote_round_id = ?').all(open.id) as { player_id: number; target_player_id: number; weight: number }[]).map(
        (b) => ({ voterId: pid(b.player_id), targetId: pid(b.target_player_id), weight: b.weight }),
      )
    : [];
  const res = engineEndNight(
    {
      ledger: loadLedgerInput(ctx, n.id),
      lots,
      securities,
      activePlayerIds: ps.filter((p) => p.left_at == null).map((p) => pid(p.id)),
      openQuarter: open ? { ballots } : null,
    },
    settings,
  );
  if (open && res.quarter) {
    const pay = ctx.db.prepare('INSERT INTO bounty_payout (vote_round_id, player_id, gold_h, paid_at) VALUES (?,?,?,?)');
    for (const p of res.quarter.payouts) pay.run(open.id, Number(p.playerId), p.goldH, now);
    ctx.db.prepare("UPDATE vote_round SET status = 'resolved', closed_at = COALESCE(closed_at, ?) WHERE id = ?").run(now, open.id);
  }
  const ins = ctx.db.prepare(
    'INSERT INTO trade (night_id, player_id, security_id, side, shares_h, price, cash_h, fee_h, basis_h, forced, tick, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)',
  );
  for (const t of res.liquidations) ins.run(n.id, Number(t.playerId), t.securityId, 'sell', t.sharesH, t.price, t.cashH, t.feeH, t.basisH ?? null, n.tick_count, now);
  ctx.db.prepare('DELETE FROM lot WHERE night_id = ?').run(n.id);
  ctx.db.prepare('UPDATE night SET ended_at = ?, paused_at = NULL WHERE id = ?').run(now, n.id);
  ctx.db
    .prepare('INSERT INTO standings_snapshot (night_id, data, created_at) VALUES (?,?,?)')
    .run(n.id, j.str(res.podium.map((p) => ({ playerId: Number(p.playerId), goldH: p.goldH, rank: p.rank }))), now);
}

/** Merge a settings patch into the night's overrides. Totals re-derive on the next read (full re-score). */
export function updateSettings(ctx: Ctx, actor: GmAuth, patch: unknown): NightRow {
  masterOnly(actor);
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw bad('bad_settings');
  const n = requireNight(ctx);
  const before = nightOverrides(n);
  const merged = mergeDeep(before, patch as Record<string, unknown>);
  checkSettings(merged as DeepPartial<Settings>);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE night SET settings = ? WHERE id = ?').run(j.str(merged), n.id);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'night.settings', entity: 'night', entityId: n.id, before, after: merged });
  })();
  pushFeed(ctx, n.id, 'settings', 'feed.settings_changed', { keys: Object.keys(patch as object) }, true);
  ctx.bus.all('night:update', { settingsChanged: true });
  ctx.bus.refresh(n.id);
  return getNight(ctx, n.id)!;
}

/** Reset one setting path back to its default by passing null in the patch. */
function mergeDeep(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null && !Array.isArray(out[k]))
      out[k] = mergeDeep(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

export function updateNightInfo(ctx: Ctx, actor: GmAuth, input: { name?: unknown; lengthMinutes?: unknown }): NightRow {
  masterOnly(actor);
  const n = requireNight(ctx);
  const name = input.name === undefined ? n.name : String(input.name).trim().slice(0, 80);
  const length = input.lengthMinutes === undefined ? n.length_minutes : Number(input.lengthMinutes);
  if (!name) throw bad('bad_name');
  if (!Number.isInteger(length) || length < 30 || length > 24 * 60) throw bad('bad_length');
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE night SET name = ?, length_minutes = ? WHERE id = ?').run(name, length, n.id);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'night.update', entity: 'night', entityId: n.id, before: { name: n.name, length: n.length_minutes }, after: { name, length } });
  })();
  ctx.bus.all('night:update', { name, lengthMinutes: length });
  ctx.bus.refresh(n.id);
  return getNight(ctx, n.id)!;
}

/** Manual gold adjustment (Master only, reason required). */
export function addAdjustment(ctx: Ctx, actor: GmAuth, input: { playerId: unknown; gold: unknown; reason: unknown }) {
  masterOnly(actor);
  const n = requireNight(ctx);
  const playerId = Number(input.playerId);
  const gold = Number(input.gold);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw bad('reason_required');
  if (!Number.isFinite(gold) || gold === 0) throw bad('bad_amount');
  if (!ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ?').get(playerId, n.id)) throw notFound('player_not_found');
  const goldH = toH(gold);
  const id = ctx.db.transaction(() => {
    const r = ctx.db
      .prepare("INSERT INTO adjustment (night_id, player_id, gold_h, reason, kind, gm_id, created_at) VALUES (?,?,?,?, 'manual', ?, ?)")
      .run(n.id, playerId, goldH, reason, actor.gmId, ctx.now());
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'gold.adjust', entity: 'adjustment', entityId: Number(r.lastInsertRowid), after: { playerId, goldH, reason } });
    return Number(r.lastInsertRowid);
  })();
  pushFeed(ctx, n.id, 'adjustment', 'feed.adjustment', { playerId, goldH, reason }, true);
  ctx.bus.refresh(n.id);
  return { id, goldH };
}

export { computeNightState };
