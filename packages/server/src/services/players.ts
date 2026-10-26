import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { lateJoinStakeH, lateJoinStartPrice, playerSecurity } from '@gn/engine';
import { j } from '../db';
import { bad, conflict, forbidden, notFound, type Ctx } from '../context';
import { newToken, tokenHash } from '../auth/password';
import { audit } from './audit';
import { pushFeed } from './feed';
import type { GmAuth } from './gm';
import { computeNightState, currentNight, getNight, loadSecurities, nightSettings, pid, securityIdForPlayer, upsertSecurities, type PlayerRow } from './state';

// ---------------------------------------------------------------- name/ticker rules

/** Slur blocklist (swears are fine). Loaded from assets/name-blocklist.txt at boot; hosts add their own entries. */
let BLOCKLIST: RegExp[] = [];

export function loadBlocklist(file: string): number {
  try {
    BLOCKLIST = readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  } catch {
    BLOCKLIST = [];
  }
  return BLOCKLIST.length;
}

export function setBlocklist(words: string[]) {
  BLOCKLIST = words.map((w) => new RegExp(w, 'i'));
}

export function checkName(name: unknown): string {
  if (typeof name !== 'string') throw bad('bad_name');
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length < 1 || n.length > 24) throw bad('bad_name', 'Name must be 1–24 characters.');
  if (BLOCKLIST.some((r) => r.test(n))) throw bad('name_blocked', 'Pick another name.');
  return n;
}

const RESERVED_TICKERS = ['IDX', 'COIN', 'SCIC', 'SHDW', 'DEAD'];

export function checkTicker(ticker: unknown): string {
  if (typeof ticker !== 'string' || !/^[A-Za-z]{3,4}$/.test(ticker.trim())) throw bad('bad_ticker', 'Ticker must be 3–4 letters.');
  const t = ticker.trim().toUpperCase();
  if (BLOCKLIST.some((r) => r.test(t))) throw bad('ticker_blocked', 'Pick another ticker.');
  if (RESERVED_TICKERS.includes(t)) throw conflict('ticker_taken', 'That ticker is taken.');
  return t;
}

export const checkColor = (c: unknown): string | null => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null);

/** Uniqueness against players and pending late-join requests in this night. */
export function assertAvailable(ctx: Ctx, nightId: number, name: string, ticker: string, except: { playerId?: number; requestTokenHash?: string } = {}) {
  const taken = (col: 'display_name' | 'ticker', v: string) =>
    ctx.db.prepare(`SELECT 1 FROM player WHERE night_id = ? AND ${col} = ? AND id != ?`).get(nightId, v, except.playerId ?? -1);
  if (taken('display_name', name)) throw conflict('name_taken', 'That name is taken.');
  if (taken('ticker', ticker)) throw conflict('ticker_taken', 'That ticker is taken.');
  const pending = ctx.db
    .prepare("SELECT payload FROM device_request WHERE night_id = ? AND kind = 'late_join' AND status = 'pending' AND token_hash != ?")
    .all(nightId, except.requestTokenHash ?? '') as { payload: string }[];
  for (const p of pending) {
    const x = j.parse<{ displayName?: string; ticker?: string }>(p.payload, {});
    if (x.displayName?.toLowerCase() === name.toLowerCase()) throw conflict('name_taken', 'That name is taken.');
    if (x.ticker?.toUpperCase() === ticker) throw conflict('ticker_taken', 'That ticker is taken.');
  }
}

// ---------------------------------------------------------------- avatars

const AVATAR_MAX_BYTES = 200 * 1024;
const AVATAR_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * Stores an uploaded avatar (data URL). The phone resizes to ≤512 px before upload; the server
 * enforces type and the 200 KB limit. Returns the public path.
 */
export function saveAvatar(ctx: Ctx, dataUrl: unknown): string | null {
  if (dataUrl == null || dataUrl === '') return null;
  if (typeof dataUrl !== 'string') throw bad('bad_avatar');
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw bad('bad_avatar', 'Avatar must be a PNG, JPEG or WebP image.');
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length > AVATAR_MAX_BYTES) throw bad('avatar_too_large', 'Avatar must be under 200 KB.');
  const sig = bytes.subarray(0, 12).toString('hex');
  const ok = (m[1] === 'image/png' && sig.startsWith('89504e47')) || (m[1] === 'image/jpeg' && sig.startsWith('ffd8ff')) || (m[1] === 'image/webp' && sig.startsWith('52494646'));
  if (!ok) throw bad('bad_avatar', 'That file is not a valid image.');
  const dir = join(ctx.config.dataDir, 'uploads', 'avatars');
  mkdirSync(dir, { recursive: true });
  const file = `${randomBytes(12).toString('hex')}.${AVATAR_TYPES[m[1]!]}`;
  writeFileSync(join(dir, file), bytes);
  return `/uploads/avatars/${file}`;
}

// ---------------------------------------------------------------- players

export interface NewPlayer {
  displayName: unknown;
  ticker: unknown;
  color?: unknown;
  avatarPath?: string | null;
}

/** Inserts a player + first device. Caller handles state checks. Late joiners get the frozen stake and a stock. */
function insertPlayer(ctx: Ctx, nightId: number, input: NewPlayer, tokenHashValue: string, opts: { late: boolean; gmId?: number | null }): PlayerRow {
  const name = checkName(input.displayName);
  const ticker = checkTicker(input.ticker);
  // A late joiner's own pending request must not block its approval.
  assertAvailable(ctx, nightId, name, ticker, { requestTokenHash: tokenHashValue });
  const night = getNight(ctx, nightId)!;
  const settings = nightSettings(night);
  const r = ctx.db
    .prepare('INSERT INTO player (night_id, display_name, avatar_path, color, ticker, reroll_tokens_left, joined_at) VALUES (?,?,?,?,?,?,?)')
    .run(nightId, name, input.avatarPath ?? null, checkColor(input.color), ticker, settings.rerolls.perPlayer, ctx.now());
  const playerId = Number(r.lastInsertRowid);
  ctx.db.prepare('INSERT INTO device (player_id, token_hash, approved_by_gm_id, created_at) VALUES (?,?,?,?)').run(playerId, tokenHashValue, opts.gmId ?? null, ctx.now());
  if (opts.late) {
    // Locked #4: the late-join stake is computed once, at approval, and stored as a system adjustment.
    const st = computeNightState(ctx, nightId)!;
    const active = new Set(st.players.filter((p) => p.left_at == null && p.id !== playerId).map((p) => pid(p.id)));
    const earned = [...st.ledger.values()].filter((l) => active.has(l.playerId)).map((l) => l.earnedH);
    const stakeH = lateJoinStakeH(earned, settings);
    ctx.db
      .prepare("INSERT INTO adjustment (night_id, player_id, gold_h, reason, kind, gm_id, created_at) VALUES (?,?,?, 'Late-join stake', 'late_join', ?, ?)")
      .run(nightId, playerId, stakeH, opts.gmId ?? null, ctx.now());
    const prices = loadSecurities(ctx, nightId).filter((s) => s.kind === 'player').map((s) => s.price);
    upsertSecurities(ctx, nightId, [playerSecurity(pid(playerId), ticker, lateJoinStartPrice(prices, settings))]);
  }
  return ctx.db.prepare('SELECT * FROM player WHERE id = ?').get(playerId) as PlayerRow;
}

/** Self-registration while joins are open (GM-gated by opening joins). */
export function createPlayer(ctx: Ctx, input: NewPlayer): { player: PlayerRow; deviceToken: string } {
  const night = currentNight(ctx);
  if (!night) throw notFound('no_night');
  if (night.status !== 'joins_open') throw conflict('joins_closed');
  const { token, hash } = newToken();
  const player = ctx.db.transaction(() => insertPlayer(ctx, night.id, input, hash, { late: false }))();
  pushFeed(ctx, night.id, 'join', 'feed.joined', { playerId: player.id });
  ctx.bus.refresh(night.id);
  return { player, deviceToken: token };
}

/** Used by approvals: late join after the night went live. */
export function createLatePlayer(ctx: Ctx, nightId: number, input: NewPlayer, tokenHashValue: string, gmId: number): PlayerRow {
  return insertPlayer(ctx, nightId, input, tokenHashValue, { late: true, gmId });
}

/** Player for a device token, if the device belongs to a player of a non-archived night. */
export function playerFromDevice(ctx: Ctx, token: string | undefined | null): PlayerRow | null {
  if (!token) return null;
  const row = ctx.db
    .prepare('SELECT p.* FROM device d JOIN player p ON p.id = d.player_id WHERE d.token_hash = ?')
    .get(tokenHash(token)) as PlayerRow | undefined;
  if (!row) return null;
  const n = getNight(ctx, row.night_id);
  return n && n.status !== 'archived' ? row : null;
}

const masterOnly = (a: GmAuth) => {
  if (a.role !== 'master') throw forbidden('master_only');
};

/** Leaver: stock stays listed and its fair decays toward band min (engine). Holdings stay until the end. */
export function markLeft(ctx: Ctx, actor: GmAuth, playerId: number, left = true): void {
  masterOnly(actor);
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  const p = ctx.db.prepare('SELECT * FROM player WHERE id = ? AND night_id = ?').get(playerId, n.id) as PlayerRow | undefined;
  if (!p) throw notFound('player_not_found');
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE player SET left_at = ? WHERE id = ?').run(left ? ctx.now() : null, playerId);
    const sec = ctx.db.prepare('SELECT state FROM security WHERE night_id = ? AND id = ?').get(n.id, securityIdForPlayer(playerId)) as { state: string } | undefined;
    if (sec) {
      const st = j.parse<Record<string, unknown>>(sec.state, {});
      st.left = left;
      if (!left) delete st.leaverFair;
      ctx.db.prepare('UPDATE security SET state = ? WHERE night_id = ? AND id = ?').run(j.str(st), n.id, securityIdForPlayer(playerId));
    }
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: left ? 'player.left' : 'player.returned', entity: 'player', entityId: playerId });
  })();
  pushFeed(ctx, n.id, 'left', left ? 'feed.left' : 'feed.returned', { playerId });
  ctx.bus.refresh(n.id);
}

export function overrideTicker(ctx: Ctx, actor: GmAuth, playerId: number, ticker: unknown): void {
  masterOnly(actor);
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  const p = ctx.db.prepare('SELECT * FROM player WHERE id = ? AND night_id = ?').get(playerId, n.id) as PlayerRow | undefined;
  if (!p) throw notFound('player_not_found');
  const t = checkTicker(ticker);
  if (ctx.db.prepare('SELECT 1 FROM player WHERE night_id = ? AND ticker = ? AND id != ?').get(n.id, t, playerId)) throw conflict('ticker_taken');
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE player SET ticker = ? WHERE id = ?').run(t, playerId);
    ctx.db.prepare('UPDATE security SET ticker = ? WHERE night_id = ? AND id = ?').run(t, n.id, securityIdForPlayer(playerId));
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'player.ticker', entity: 'player', entityId: playerId, before: { ticker: p.ticker }, after: { ticker: t } });
  })();
  ctx.bus.refresh(n.id);
}
