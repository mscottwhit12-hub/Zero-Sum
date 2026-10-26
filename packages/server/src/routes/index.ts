import type { FastifyInstance } from 'fastify';
import { type Ctx } from '../context';
import { auditTail } from '../services/audit';
import {
  createSubGm,
  deactivateSubGm,
  listGms,
  listOwnSessions,
  login,
  logout,
  needsSetup,
  setDeviceType,
  setSessionPaused,
  setupMaster,
  unlockWithPin,
} from '../services/gm';
import { addAdjustment, applyNightAction, createNight, updateNightInfo, updateSettings, type NightAction } from '../services/night';
import { computeNightState, currentNight } from '../services/state';
import { gmView, publicView } from '../services/views';
import { GM_COOKIE } from '../sockets';
import { requireGm } from './guard';

type Body = Record<string, unknown>;
const NIGHT_ACTIONS: Record<string, NightAction> = {
  'open-joins': 'openJoins',
  start: 'start',
  pause: 'pause',
  resume: 'resume',
  'close-trading': 'closeTrading',
  end: 'end',
  archive: 'archive',
};

export function registerRoutes(app: FastifyInstance, ctx: Ctx) {
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: ctx.config.secureCookies, maxAge: 60 * 60 * 24 * 30 };
  const body = (b: unknown) => (b ?? {}) as Body;

  app.get('/api/health', async () => ({ ok: true, time: ctx.now() }));

  // ---- first run
  app.get('/api/setup/status', async () => ({ needsSetup: needsSetup(ctx) }));
  app.post('/api/setup', async (req, reply) => {
    const b = body(req.body);
    setupMaster(ctx, { name: b.name, password: b.password, pin: b.pin });
    const { token, auth } = login(ctx, { name: b.name, password: b.password, deviceType: b.deviceType ?? 'laptop' });
    reply.setCookie(GM_COOKIE, token, cookieOpts);
    return { gm: { name: auth.name, role: auth.role, deviceType: auth.deviceType } };
  });

  // ---- GM auth & devices
  app.post('/api/gm/login', async (req, reply) => {
    const b = body(req.body);
    const { token, auth } = login(ctx, { name: b.name, password: b.password, deviceType: b.deviceType });
    reply.setCookie(GM_COOKIE, token, cookieOpts);
    return { gm: { name: auth.name, role: auth.role, deviceType: auth.deviceType } };
  });
  app.post('/api/gm/logout', async (req, reply) => {
    logout(ctx, requireGm(ctx, req, { allowPaused: true }));
    reply.clearCookie(GM_COOKIE, { path: '/' });
    return { ok: true };
  });
  app.get('/api/gm/me', async (req) => {
    const a = requireGm(ctx, req, { allowPaused: true });
    return { gm: { id: a.gmId, name: a.name, role: a.role, deviceType: a.deviceType, paused: a.paused, sessionId: a.sessionId } };
  });
  app.post('/api/gm/device-type', async (req) => {
    setDeviceType(ctx, requireGm(ctx, req), body(req.body).deviceType);
    return { ok: true };
  });
  app.get('/api/gm/sessions', async (req) => ({ sessions: listOwnSessions(ctx, requireGm(ctx, req)) }));
  app.post<{ Params: { id: string } }>('/api/gm/sessions/:id/pause', async (req) => {
    setSessionPaused(ctx, requireGm(ctx, req), Number(req.params.id), true);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/gm/sessions/:id/resume', async (req) => {
    setSessionPaused(ctx, requireGm(ctx, req), Number(req.params.id), false);
    return { ok: true };
  });
  app.post('/api/gm/unlock', async (req) => {
    unlockWithPin(ctx, requireGm(ctx, req, { allowPaused: true }), body(req.body).pin);
    return { ok: true };
  });
  app.get('/api/gm/gms', async (req) => ({ gms: (requireGm(ctx, req), listGms(ctx)) }));
  app.post('/api/gm/gms', async (req) => {
    const b = body(req.body);
    return { id: createSubGm(ctx, requireGm(ctx, req, { master: true }), { name: b.name, password: b.password, pin: b.pin }) };
  });
  app.delete<{ Params: { id: string } }>('/api/gm/gms/:id', async (req) => {
    deactivateSubGm(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id));
    return { ok: true };
  });
  app.get<{ Querystring: { limit?: string } }>('/api/gm/audit', async (req) => {
    requireGm(ctx, req, { master: true });
    return { entries: auditTail(ctx, Math.min(500, Number(req.query.limit ?? 100))) };
  });

  // ---- night
  app.get('/api/night', async (req) => {
    const n = currentNight(ctx);
    if (!n) return { night: null };
    const st = computeNightState(ctx, n.id)!;
    let gm = false;
    try {
      requireGm(ctx, req);
      gm = true;
    } catch {
      /* public */
    }
    return gm ? gmView(ctx, st) : publicView(ctx, st);
  });
  app.post('/api/nights', async (req) => {
    const b = body(req.body);
    const n = createNight(ctx, requireGm(ctx, req, { master: true }), { name: b.name, date: b.date, lengthMinutes: b.lengthMinutes, settings: b.settings });
    return { id: n.id, status: n.status };
  });
  app.patch('/api/night', async (req) => {
    const b = body(req.body);
    const n = updateNightInfo(ctx, requireGm(ctx, req, { master: true }), { name: b.name, lengthMinutes: b.lengthMinutes });
    return { id: n.id, name: n.name, lengthMinutes: n.length_minutes };
  });
  app.post<{ Params: { action: string } }>('/api/night/:action', async (req, reply) => {
    const action = NIGHT_ACTIONS[req.params.action];
    if (!action) return reply.code(404).send({ error: 'not_found' });
    const n = applyNightAction(ctx, requireGm(ctx, req, { master: true }), action);
    return { status: n.status, tradingClosed: !!n.trading_closed };
  });
  app.patch('/api/night/settings', async (req) => {
    updateSettings(ctx, requireGm(ctx, req, { master: true }), req.body);
    const n = currentNight(ctx)!;
    return gmView(ctx, computeNightState(ctx, n.id)!).gm.settings;
  });
  app.post('/api/night/adjustments', async (req) => {
    const b = body(req.body);
    return addAdjustment(ctx, requireGm(ctx, req, { master: true }), { playerId: b.playerId, gold: b.gold, reason: b.reason });
  });
}
