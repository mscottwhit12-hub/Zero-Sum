/**
 * Join, rejoin and late join (spec §4.2–4.3).
 *  - Joins open: self-register instantly.
 *  - Rejoin: pick your name from the list → GM approves → this device is added (all devices stay active).
 *  - Late join (night live/paused): request → GM approves → late-joiner rules apply.
 * A request's token becomes the device token once approved, so the phone just keeps it.
 */
import { j } from '../db';
import { bad, conflict, notFound, type Ctx } from '../context';
import { newToken, tokenHash } from '../auth/password';
import { audit } from './audit';
import { pushFeed } from './feed';
import type { GmAuth } from './gm';
import { assertAvailable, checkColor, checkName, checkTicker, createLatePlayer, createPlayer, saveAvatar } from './players';
import { currentNight, type PlayerRow } from './state';

export type JoinMode = 'join' | 'late' | 'closed';

export function joinInfo(ctx: Ctx) {
  const n = currentNight(ctx);
  const mode: JoinMode = !n ? 'closed' : n.status === 'joins_open' ? 'join' : n.status === 'live' || n.status === 'paused' ? 'late' : 'closed';
  const players = n
    ? (ctx.db.prepare('SELECT id, display_name FROM player WHERE night_id = ? AND left_at IS NULL ORDER BY display_name').all(n.id) as { id: number; display_name: string }[]).map((p) => ({
        id: p.id,
        displayName: p.display_name,
      }))
    : [];
  return { nightName: n?.name ?? null, status: n?.status ?? null, mode, players };
}

export interface JoinInput {
  displayName: unknown;
  ticker: unknown;
  color?: unknown;
  avatarData?: unknown;
  /** Permanent random id this phone keeps even after signing out. */
  phoneId?: unknown;
}

/** Hash of a phone id, or null if it isn't a plausible one. */
const phoneHash = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v) ? tokenHash(`phone:${v}`) : null);

/** Joins open → instant player. Night live → a late-join request awaiting GM approval. */
export function join(ctx: Ctx, input: JoinInput): { deviceToken: string; player?: PlayerRow; pending: boolean } {
  const info = joinInfo(ctx);
  if (info.mode === 'closed') throw conflict('joins_closed', 'Joins are not open right now.');
  const n = currentNight(ctx)!;
  // Validate before saving any file.
  const name = checkName(input.displayName);
  const ticker = checkTicker(input.ticker);
  assertAvailable(ctx, n.id, name, ticker);
  const avatarPath = saveAvatar(ctx, input.avatarData);
  const home = phoneHash(input.phoneId);
  if (info.mode === 'join') {
    const r = createPlayer(ctx, { displayName: name, ticker, color: input.color, avatarPath });
    if (home) ctx.db.prepare('UPDATE player SET home_phone_hash = ? WHERE id = ?').run(home, r.player.id);
    return { deviceToken: r.deviceToken, player: r.player, pending: false };
  }
  const { token, hash } = newToken();
  const r = ctx.db
    .prepare("INSERT INTO device_request (night_id, player_id, token_hash, kind, payload, created_at) VALUES (?, NULL, ?, 'late_join', ?, ?)")
    .run(n.id, hash, j.str({ displayName: name, ticker, color: checkColor(input.color), avatarPath, home }), ctx.now());
  ctx.bus.gm('device:approval', { id: Number(r.lastInsertRowid), kind: 'late_join', displayName: name });
  ctx.bus.refresh(n.id);
  return { deviceToken: token, pending: true };
}

/** Rejoin. From the phone the player joined on, it's approved at once; otherwise a GM approves it. */
export function requestRejoin(ctx: Ctx, playerId: unknown, phoneId?: unknown): { deviceToken: string; approved: boolean } {
  const n = currentNight(ctx);
  if (!n || n.status === 'ended' || n.status === 'archived' || n.status === 'setup') throw conflict('rejoin_closed');
  const p = ctx.db.prepare('SELECT id, display_name, home_phone_hash FROM player WHERE id = ? AND night_id = ? AND left_at IS NULL').get(Number(playerId), n.id) as
    | { id: number; display_name: string; home_phone_hash: string | null }
    | undefined;
  if (!p) throw notFound('player_not_found');
  const { token, hash } = newToken();
  const home = phoneHash(phoneId);
  if (home && p.home_phone_hash === home) {
    ctx.db.transaction(() => {
      ctx.db.prepare('INSERT INTO device (player_id, token_hash, approved_by_gm_id, created_at) VALUES (?,?,NULL,?)').run(p.id, hash, ctx.now());
      const r = ctx.db
        .prepare("INSERT INTO device_request (night_id, player_id, token_hash, kind, payload, status, created_at) VALUES (?,?,?, 'rejoin', '{\"auto\":true}', 'approved', ?)")
        .run(n.id, p.id, hash, ctx.now());
      audit(ctx, { nightId: n.id, gmId: null, action: 'device.auto_approve', entity: 'device_request', entityId: Number(r.lastInsertRowid), after: { kind: 'rejoin', playerId: p.id, reason: 'same phone' } });
    })();
    ctx.bus.refresh(n.id);
    return { deviceToken: token, approved: true };
  }
  const r = ctx.db
    .prepare("INSERT INTO device_request (night_id, player_id, token_hash, kind, payload, created_at) VALUES (?,?,?, 'rejoin', '{}', ?)")
    .run(n.id, p.id, hash, ctx.now());
  ctx.bus.gm('device:approval', { id: Number(r.lastInsertRowid), kind: 'rejoin', displayName: p.display_name });
  ctx.bus.refresh(n.id);
  return { deviceToken: token, approved: false };
}

/** Polled by the waiting phone. */
export function requestStatus(ctx: Ctx, token: unknown): { status: 'pending' | 'approved' | 'denied' | 'unknown' } {
  if (typeof token !== 'string' || !token) return { status: 'unknown' };
  const r = ctx.db.prepare('SELECT status FROM device_request WHERE token_hash = ? ORDER BY id DESC LIMIT 1').get(tokenHash(token)) as { status: 'pending' | 'approved' | 'denied' } | undefined;
  return { status: r?.status ?? 'unknown' };
}

export interface PendingRequest {
  id: number;
  kind: 'rejoin' | 'late_join';
  playerId: number | null;
  displayName: string;
  ticker: string | null;
  createdAt: number;
}

export function pendingRequests(ctx: Ctx, nightId: number): PendingRequest[] {
  return (ctx.db
    .prepare(
      `SELECT r.id, r.kind, r.player_id, r.payload, r.created_at, p.display_name, p.ticker FROM device_request r
       LEFT JOIN player p ON p.id = r.player_id WHERE r.night_id = ? AND r.status = 'pending' ORDER BY r.id`,
    )
    .all(nightId) as { id: number; kind: 'rejoin' | 'late_join'; player_id: number | null; payload: string; created_at: number; display_name: string | null; ticker: string | null }[]).map((r) => {
    const x = j.parse<{ displayName?: string; ticker?: string }>(r.payload, {});
    return { id: r.id, kind: r.kind, playerId: r.player_id, displayName: r.display_name ?? x.displayName ?? '?', ticker: r.ticker ?? x.ticker ?? null, createdAt: r.created_at };
  });
}

/** Device approvals are a field action (Master or Sub). */
export function decideRequest(ctx: Ctx, actor: GmAuth, id: number, approve: boolean): { playerId: number | null } {
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  const req = ctx.db.prepare("SELECT * FROM device_request WHERE id = ? AND night_id = ? AND status = 'pending'").get(id, n.id) as
    | { id: number; kind: 'rejoin' | 'late_join'; player_id: number | null; token_hash: string; payload: string }
    | undefined;
  if (!req) throw notFound('request_not_found');
  let playerId = req.player_id;
  ctx.db.transaction(() => {
    if (approve) {
      if (req.kind === 'rejoin') {
        ctx.db.prepare('INSERT INTO device (player_id, token_hash, approved_by_gm_id, created_at) VALUES (?,?,?,?)').run(req.player_id, req.token_hash, actor.gmId, ctx.now());
      } else {
        if (n.status !== 'live' && n.status !== 'paused') throw conflict('bad_night_state');
        const x = j.parse<{ displayName: string; ticker: string; color: string | null; avatarPath: string | null; home?: string | null }>(req.payload, {} as never);
        const p = createLatePlayer(ctx, n.id, { displayName: x.displayName, ticker: x.ticker, color: x.color, avatarPath: x.avatarPath }, req.token_hash, actor.gmId);
        playerId = p.id;
        if (x.home) ctx.db.prepare('UPDATE player SET home_phone_hash = ? WHERE id = ?').run(x.home, p.id);
        ctx.db.prepare('UPDATE device_request SET player_id = ? WHERE id = ?').run(p.id, id);
      }
    }
    ctx.db.prepare('UPDATE device_request SET status = ? WHERE id = ?').run(approve ? 'approved' : 'denied', id);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: `device.${approve ? 'approve' : 'deny'}`, entity: 'device_request', entityId: id, after: { kind: req.kind, playerId } });
  })();
  if (approve && req.kind === 'late_join') pushFeed(ctx, n.id, 'join', 'feed.late_join', { playerId });
  ctx.bus.refresh(n.id);
  return { playerId };
}

export { bad };
