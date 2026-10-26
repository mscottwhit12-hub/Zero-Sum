import { bad, conflict, forbidden, HttpError, notFound, type Ctx } from '../context';
import { hashSecret, newToken, tokenHash, validPassword, validPin, verifySecret } from '../auth/password';
import { audit } from './audit';

export type DeviceType = 'phone' | 'laptop';
export type GmRole = 'master' | 'sub';

export interface GmAuth {
  gmId: number;
  name: string;
  role: GmRole;
  sessionId: number;
  deviceType: DeviceType;
  paused: boolean;
}

const validName = (n: unknown): n is string => typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 40;
const validDevice = (d: unknown): d is DeviceType => d === 'phone' || d === 'laptop';

export function needsSetup(ctx: Ctx): boolean {
  return !ctx.db.prepare("SELECT 1 FROM game_master WHERE role = 'master' AND active = 1").get();
}

function insertGm(ctx: Ctx, role: GmRole, name: string, password: string, pin: string): number {
  if (!validName(name)) throw bad('bad_name');
  if (!validPassword(password)) throw bad('bad_password', 'Password must be at least 8 characters.');
  if (!validPin(pin)) throw bad('bad_pin', 'PIN must be 4–8 digits.');
  if (ctx.db.prepare('SELECT 1 FROM game_master WHERE name = ?').get(name.trim())) throw conflict('name_taken');
  const r = ctx.db
    .prepare('INSERT INTO game_master (name, role, credential_hash, pin_hash, created_at) VALUES (?,?,?,?,?)')
    .run(name.trim(), role, hashSecret(password), hashSecret(pin), ctx.now());
  return Number(r.lastInsertRowid);
}

/** First run only: creates the Master GM. No default credentials exist. */
export function setupMaster(ctx: Ctx, input: { name: unknown; password: unknown; pin: unknown }): number {
  return ctx.db.transaction(() => {
    if (!needsSetup(ctx)) throw conflict('already_set_up');
    const id = insertGm(ctx, 'master', input.name as string, input.password as string, input.pin as string);
    audit(ctx, { nightId: null, gmId: id, action: 'setup.master', entity: 'game_master', entityId: id, after: { name: input.name } });
    return id;
  })();
}

export function createSubGm(ctx: Ctx, actor: GmAuth, input: { name: unknown; password: unknown; pin: unknown }): number {
  if (actor.role !== 'master') throw forbidden('master_only');
  return ctx.db.transaction(() => {
    const id = insertGm(ctx, 'sub', input.name as string, input.password as string, input.pin as string);
    audit(ctx, { nightId: null, gmId: actor.gmId, action: 'gm.create_sub', entity: 'game_master', entityId: id, after: { name: input.name } });
    return id;
  })();
}

export function deactivateSubGm(ctx: Ctx, actor: GmAuth, gmId: number): void {
  if (actor.role !== 'master') throw forbidden('master_only');
  const row = ctx.db.prepare('SELECT id, role, name FROM game_master WHERE id = ?').get(gmId) as { id: number; role: GmRole; name: string } | undefined;
  if (!row) throw notFound();
  if (row.role === 'master') throw bad('cannot_remove_master');
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE game_master SET active = 0 WHERE id = ?').run(gmId);
    ctx.db.prepare('UPDATE gm_session SET revoked = 1 WHERE gm_id = ?').run(gmId);
    audit(ctx, { nightId: null, gmId: actor.gmId, action: 'gm.deactivate_sub', entity: 'game_master', entityId: gmId, before: { name: row.name } });
  })();
}

export function listGms(ctx: Ctx) {
  return ctx.db.prepare('SELECT id, name, role, active, created_at AS createdAt FROM game_master ORDER BY id').all();
}

export function login(ctx: Ctx, input: { name: unknown; password: unknown; deviceType: unknown }): { token: string; auth: GmAuth } {
  if (!validDevice(input.deviceType)) throw bad('bad_device_type', 'Choose phone or laptop.');
  const row = ctx.db
    .prepare('SELECT id, name, role, credential_hash FROM game_master WHERE name = ? AND active = 1')
    .get(String(input.name ?? '').trim()) as { id: number; name: string; role: GmRole; credential_hash: string } | undefined;
  if (!row || typeof input.password !== 'string' || !verifySecret(input.password, row.credential_hash)) {
    throw new HttpError(401, 'bad_credentials');
  }
  const { token, hash } = newToken();
  const t = ctx.now();
  const r = ctx.db
    .prepare('INSERT INTO gm_session (gm_id, token_hash, device_type, created_at, last_seen) VALUES (?,?,?,?,?)')
    .run(row.id, hash, input.deviceType, t, t);
  audit(ctx, { nightId: null, gmId: row.id, action: 'gm.login', entity: 'gm_session', entityId: Number(r.lastInsertRowid), after: { deviceType: input.deviceType } });
  return {
    token,
    auth: { gmId: row.id, name: row.name, role: row.role, sessionId: Number(r.lastInsertRowid), deviceType: input.deviceType, paused: false },
  };
}

export function authFromToken(ctx: Ctx, token: string | undefined | null): GmAuth | null {
  if (!token) return null;
  const row = ctx.db
    .prepare(
      `SELECT s.id AS sid, s.device_type, s.paused, g.id AS gid, g.name, g.role
       FROM gm_session s JOIN game_master g ON g.id = s.gm_id
       WHERE s.token_hash = ? AND s.revoked = 0 AND g.active = 1`,
    )
    .get(tokenHash(token)) as { sid: number; device_type: DeviceType; paused: number; gid: number; name: string; role: GmRole } | undefined;
  if (!row) return null;
  ctx.db.prepare('UPDATE gm_session SET last_seen = ? WHERE id = ?').run(ctx.now(), row.sid);
  return { gmId: row.gid, name: row.name, role: row.role, sessionId: row.sid, deviceType: row.device_type, paused: !!row.paused };
}

export function logout(ctx: Ctx, auth: GmAuth): void {
  ctx.db.prepare('UPDATE gm_session SET revoked = 1 WHERE id = ?').run(auth.sessionId);
  audit(ctx, { nightId: null, gmId: auth.gmId, action: 'gm.logout', entity: 'gm_session', entityId: auth.sessionId });
}

export function setDeviceType(ctx: Ctx, auth: GmAuth, deviceType: unknown): void {
  if (!validDevice(deviceType)) throw bad('bad_device_type');
  ctx.db.prepare('UPDATE gm_session SET device_type = ? WHERE id = ?').run(deviceType, auth.sessionId);
  audit(ctx, { nightId: null, gmId: auth.gmId, action: 'gm.device_type', entity: 'gm_session', entityId: auth.sessionId, before: { deviceType: auth.deviceType }, after: { deviceType } });
}

export function listOwnSessions(ctx: Ctx, auth: GmAuth) {
  return (
    ctx.db
      .prepare('SELECT id, device_type AS deviceType, paused, created_at AS createdAt, last_seen AS lastSeen FROM gm_session WHERE gm_id = ? AND revoked = 0 ORDER BY id')
      .all(auth.gmId) as { id: number; deviceType: DeviceType; paused: number; createdAt: number; lastSeen: number }[]
  ).map((s) => ({ ...s, paused: !!s.paused, current: s.id === auth.sessionId }));
}

/** Remote lock: pause/resume another of my own sessions (e.g. the laptop, from the phone). */
export function setSessionPaused(ctx: Ctx, auth: GmAuth, sessionId: number, paused: boolean): void {
  const s = ctx.db.prepare('SELECT id, gm_id, paused FROM gm_session WHERE id = ? AND revoked = 0').get(sessionId) as { id: number; gm_id: number; paused: number } | undefined;
  if (!s || s.gm_id !== auth.gmId) throw notFound('session_not_found');
  if (paused && sessionId === auth.sessionId) throw bad('cannot_pause_self');
  ctx.db.prepare('UPDATE gm_session SET paused = ? WHERE id = ?').run(paused ? 1 : 0, sessionId);
  audit(ctx, { nightId: null, gmId: auth.gmId, action: paused ? 'gm.device_pause' : 'gm.device_resume', entity: 'gm_session', entityId: sessionId });
  ctx.bus.gmSession(sessionId, 'gm:device_pause', { paused });
}

/** PIN unlock on the paused device itself. */
export function unlockWithPin(ctx: Ctx, auth: GmAuth, pin: unknown): void {
  const row = ctx.db.prepare('SELECT pin_hash FROM game_master WHERE id = ?').get(auth.gmId) as { pin_hash: string };
  if (typeof pin !== 'string' || !verifySecret(pin, row.pin_hash)) throw new HttpError(401, 'bad_pin');
  ctx.db.prepare('UPDATE gm_session SET paused = 0 WHERE id = ?').run(auth.sessionId);
  audit(ctx, { nightId: null, gmId: auth.gmId, action: 'gm.pin_unlock', entity: 'gm_session', entityId: auth.sessionId });
  ctx.bus.gmSession(auth.sessionId, 'gm:device_pause', { paused: false });
}

/** Setup actions (library, rulebook, seating, sounds, settings) are Master only. */
export function masterOnly(a: GmAuth): void {
  if (a.role !== 'master') throw forbidden('master_only');
}
