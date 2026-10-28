import type { FastifyInstance } from 'fastify';
import { buyHint, gmSendHint, readHint, tradeRerollForHint } from '../services/hints';
import { readGift, setHandicapOffset } from '../services/handicap';
import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { HttpError, type Ctx } from '../context';
import { decideRequest, join, joinInfo, requestRejoin, requestStatus } from '../services/join';
import { markLeft, overrideTicker, playerFromDevice } from '../services/players';
import { playerBuy, playerSell } from '../services/trading';
import { castBallot } from '../services/votes';
import { logReroll, recordMood, sendNotification, setOffset } from '../services/field';
import { createRule, deleteRule, listRules, updateRule } from '../services/rules';
import { assignSeat, clearSeats, createTable, deleteTable, updateTable } from '../services/seating';
import { getBoard, saveBoard, setBoardSettings } from '../services/boards';
import { deleteSound, listSounds, playSound, soundFileMime, uploadSound } from '../services/sounds';
import { minterGet, minterSync } from '../services/minter';
import { dismissPrompt } from '../services/prompts';
import { statement } from '../services/recap';
import { statementPdf } from '../services/pdf';
import { CSV_KINDS, exportNightCsv, exportNightJson, listNights } from '../services/exports';
import { replayFinale, skipFinale } from '../services/night';
import { createChallenge, readChallenge, reassignChallenge, resolveChallenge, respondChallenge, usePeek } from '../services/espionage';
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
import {
  createLibraryGame,
  deleteLibraryGame,
  exportPack,
  importPack,
  listLibrary,
  updateLibraryGame,
} from '../services/library';
import {
  cancelGame,
  correctResult,
  getGame,
  leaderTap,
  enterScores,
  scheduleGame,
  startGame,
  submitResult,
  suggestedHours,
  updateScheduledGame,
} from '../services/games';

type Body = Record<string, unknown>;
/** User-facing text (copy/en.json) for server-rendered output such as the PDF statement. */
const COPY = JSON.parse(readFileSync(new URL('../../../../copy/en.json', import.meta.url), 'utf8')) as {
  brand: { company: string; tagline: string };
  achievements: Record<string, { name: string }>;
};
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
    const n = applyNightAction(ctx, requireGm(ctx, req, { master: true }), action, { pauseMinutes: body(req.body).minutes });
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


// ---------------------------------------------------------------- library, schedule, games
export function registerGameRoutes(app: FastifyInstance, ctx: Ctx) {
  type Id = { Params: { id: string } };
  const b = (x: unknown) => (x ?? {}) as Record<string, unknown>;

  // Library (setup → Master; anyone GM can read)
  app.get('/api/library', async (req) => (requireGm(ctx, req), { games: listLibrary(ctx) }));
  app.post('/api/library', async (req) => ({ game: createLibraryGame(ctx, requireGm(ctx, req, { master: true }), b(req.body) as never) }));
  app.patch<Id>('/api/library/:id', async (req) => ({ game: updateLibraryGame(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id), b(req.body) as never) }));
  app.delete<Id>('/api/library/:id', async (req) => {
    deleteLibraryGame(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id));
    return { ok: true };
  });
  app.get('/api/library/export', async (req, reply) => {
    requireGm(ctx, req);
    reply.header('content-disposition', 'attachment; filename="game-pack.json"');
    return exportPack(ctx);
  });
  app.post('/api/library/import', async (req) => importPack(ctx, requireGm(ctx, req, { master: true }), req.body));

  // Schedule (Master)
  app.post('/api/games', async (req) => ({ game: scheduleGame(ctx, requireGm(ctx, req, { master: true }), b(req.body)) }));
  app.patch<Id>('/api/games/:id', async (req) => ({ game: updateScheduledGame(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id), b(req.body)) }));
  app.post<Id>('/api/games/:id/cancel', async (req) => {
    cancelGame(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id));
    return { ok: true };
  });

  // Field actions (Master or Sub)
  app.post<Id>('/api/games/:id/start', async (req) => ({ game: startGame(ctx, requireGm(ctx, req), Number(req.params.id), b(req.body)) }));
  app.get<Id>('/api/games/:id/prefill', async (req) => {
    requireGm(ctx, req);
    const g = getGame(ctx, Number(req.params.id));
    return { suggestedHours: suggestedHours(ctx, g) ?? g.planned_duration_hours ?? 1 };
  });
  app.post<Id>('/api/games/:id/result', async (req) => {
    const x = b(req.body);
    return submitResult(ctx, requireGm(ctx, req), Number(req.params.id), { participants: x.participants, actualHours: x.actualHours, coopWon: x.coopWon });
  });
  app.post<Id>('/api/games/:id/correct', async (req) => {
    const x = b(req.body);
    return correctResult(ctx, requireGm(ctx, req), Number(req.params.id), { participants: x.participants, actualHours: x.actualHours, coopWon: x.coopWon });
  });
  app.post<Id>('/api/games/:id/leader', async (req) => leaderTap(ctx, requireGm(ctx, req), Number(req.params.id), b(req.body).playerId));
  app.post<Id>('/api/games/:id/scores', async (req) => enterScores(ctx, requireGm(ctx, req), Number(req.params.id), b(req.body)));
}

// ---------------------------------------------------------------- players: join, devices, trading
export function registerPlayerRoutes(app: FastifyInstance, ctx: Ctx) {
  type Id = { Params: { id: string } };
  const b = (x: unknown) => (x ?? {}) as Record<string, unknown>;
  const device = (req: { headers: Record<string, unknown> }) => {
    const p = playerFromDevice(ctx, req.headers['x-device-token'] as string | undefined);
    if (!p) throw new HttpError(401, 'unknown_device');
    return p;
  };

  // Public join flow
  app.get('/api/join', async () => joinInfo(ctx));
  app.post('/api/join', async (req) => {
    const x = b(req.body);
    const r = join(ctx, { displayName: x.displayName, ticker: x.ticker, color: x.color, avatarData: x.avatarData });
    return { deviceToken: r.deviceToken, pending: r.pending, playerId: r.player?.id ?? null };
  });
  app.post('/api/join/rejoin', async (req) => requestRejoin(ctx, b(req.body).playerId));
  app.get('/api/join/status', async (req) => requestStatus(ctx, req.headers['x-device-token']));

  // Player (device token)
  app.get('/api/me', async (req) => {
    const p = device(req);
    return { player: { id: p.id, displayName: p.display_name, ticker: p.ticker } };
  });
  app.post('/api/trade/buy', async (req) => playerBuy(ctx, device(req), { securityId: b(req.body).securityId, gold: b(req.body).gold }));
  app.post('/api/trade/sell', async (req) => playerSell(ctx, device(req), { securityId: b(req.body).securityId, shares: b(req.body).shares }));
  app.post<Id>('/api/me/messages/:id/read', async (req) => {
    const p = device(req);
    const row = ctx.db.prepare('SELECT read_by FROM notification WHERE id = ? AND night_id = ?').get(Number(req.params.id), p.night_id) as { read_by: string } | undefined;
    if (!row) return { ok: false };
    const read = new Set(JSON.parse(row.read_by) as number[]);
    read.add(p.id);
    ctx.db.prepare('UPDATE notification SET read_by = ? WHERE id = ?').run(JSON.stringify([...read]), Number(req.params.id));
    ctx.bus.refresh(p.night_id);
    return { ok: true };
  });

  // Avatars (stored under DATA_DIR/uploads/avatars)
  app.get<{ Params: { file: string } }>('/uploads/avatars/:file', async (req, reply) => {
    const f = req.params.file;
    if (!/^[a-f0-9]{24}\.(png|jpg|webp)$/.test(f)) return reply.code(404).send();
    try {
      const data = readFileSync(joinPath(ctx.config.dataDir, 'uploads', 'avatars', f));
      const type = f.endsWith('.png') ? 'image/png' : f.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
      return reply.header('content-type', type).header('cache-control', 'public, max-age=31536000, immutable').send(data);
    } catch {
      return reply.code(404).send();
    }
  });

  // GM: approvals (field action), player management (Master)
  app.post<Id>('/api/requests/:id/approve', async (req) => decideRequest(ctx, requireGm(ctx, req), Number(req.params.id), true));
  app.post<Id>('/api/requests/:id/deny', async (req) => decideRequest(ctx, requireGm(ctx, req), Number(req.params.id), false));
  app.post<Id>('/api/players/:id/leave', async (req) => {
    markLeft(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id), b(req.body).left !== false);
    return { ok: true };
  });
  app.patch<Id>('/api/players/:id', async (req) => {
    overrideTicker(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id), b(req.body).ticker);
    return { ok: true };
  });

  // Phase 6 — player actions
  app.post('/api/vote', async (req) => castBallot(ctx, device(req), b(req.body).targetId));
  app.post<Id>('/api/me/challenges/:id/read', async (req) => readChallenge(ctx, device(req), Number(req.params.id)));
  app.post<Id>('/api/me/tips/:id/read', async (req) => (readHint(ctx, device(req), Number(req.params.id)), { ok: true }));
  app.post<Id>('/api/me/gifts/:id/read', async (req) => {
    const p = device(req);
    readGift(ctx, p.id, p.night_id, Number(req.params.id));
    return { ok: true };
  });
  app.post('/api/me/tips/buy', async (req) => {
    const p = device(req);
    const st = computeNightState(ctx, p.night_id)!;
    return buyHint(ctx, p, { tier: b(req.body).tier, cashH: st.ledger.get(String(p.id))?.cashH ?? 0 });
  });
  app.post('/api/me/tips/trade-reroll', async (req) => tradeRerollForHint(ctx, device(req)));
  app.post<Id>('/api/me/challenges/:id/respond', async (req) => respondChallenge(ctx, device(req), Number(req.params.id), b(req.body).accept === true));
  app.post<Id>('/api/me/challenges/:id/peek', async (req) => usePeek(ctx, device(req), Number(req.params.id), b(req.body).targetPlayerId));

  // Phase 6 — GM field actions (any GM) and Master-only market offset
  app.post('/api/mood', async (req) => recordMood(ctx, requireGm(ctx, req), b(req.body) as never));
  app.post('/api/rerolls', async (req) => logReroll(ctx, requireGm(ctx, req), b(req.body) as never));
  app.post('/api/notifications', async (req) => sendNotification(ctx, requireGm(ctx, req), b(req.body) as never));
  app.patch<Id>('/api/securities/:id/offset', async (req) => setOffset(ctx, requireGm(ctx, req, { master: true }), decodeURIComponent(req.params.id), b(req.body).offset));
  app.post('/api/challenges', async (req) => createChallenge(ctx, requireGm(ctx, req), b(req.body) as never));
  app.post('/api/tips', async (req) => gmSendHint(ctx, requireGm(ctx, req), b(req.body)));
  app.patch<Id>('/api/handicap/:id', async (req) => setHandicapOffset(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id), b(req.body)));
  app.post<Id>('/api/challenges/:id/reassign', async (req) => reassignChallenge(ctx, requireGm(ctx, req), Number(req.params.id), b(req.body).playerId));
  app.post<Id>('/api/challenges/:id/resolve', async (req) => resolveChallenge(ctx, requireGm(ctx, req), Number(req.params.id), b(req.body).success === true));

  // Phase 7 — rulebook (read: anyone; edit: Master)
  app.get('/api/rules', async () => ({ rules: listRules(ctx) }));
  app.post('/api/rules', async (req) => createRule(ctx, requireGm(ctx, req, { master: true }), b(req.body)));
  app.patch<Id>('/api/rules/:id', async (req) => updateRule(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id), b(req.body)));
  app.delete<Id>('/api/rules/:id', async (req) => deleteRule(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id)));

  // Per-game GM boards (any GM plays a board; settings are Master only)
  app.get<Id>('/api/games/:id/board', async (req) => getBoard(ctx, requireGm(ctx, req), Number(req.params.id)));
  app.put<Id>('/api/games/:id/board', async (req) => saveBoard(ctx, requireGm(ctx, req), Number(req.params.id), b(req.body)));
  app.patch<{ Params: { key: string } }>('/api/boards/:key/settings', async (req) => ({ settings: setBoardSettings(ctx, requireGm(ctx, req, { master: true }), req.params.key, b(req.body)) }));

  // Phase 7 — seating (Master; GM + TV only)
  app.post('/api/tables', async (req) => createTable(ctx, requireGm(ctx, req, { master: true }), b(req.body)));
  app.patch<Id>('/api/tables/:id', async (req) => updateTable(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id), b(req.body)));
  app.delete<Id>('/api/tables/:id', async (req) => deleteTable(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id)));
  app.post<Id>('/api/tables/:id/seat', async (req) => assignSeat(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id), b(req.body)));
  app.post('/api/seats/clear', async (req) => clearSeats(ctx, requireGm(ctx, req, { master: true })));

  // Phase 7 — sounds (upload: Master; soundboard: any GM). Files are local (MEDIA_DIR/sounds).
  app.get('/api/sounds', async (req) => (requireGm(ctx, req), { sounds: listSounds(ctx) }));
  app.post('/api/sounds', { bodyLimit: 12 * 1024 * 1024 }, async (req) => uploadSound(ctx, requireGm(ctx, req, { master: true }), b(req.body)));
  app.delete<Id>('/api/sounds/:id', async (req) => deleteSound(ctx, requireGm(ctx, req, { master: true }), Number(req.params.id)));
  app.post('/api/sounds/play', async (req) => playSound(ctx, requireGm(ctx, req), b(req.body)));
  app.get<{ Params: { file: string } }>('/media/sounds/:file', async (req, reply) => {
    const f = req.params.file;
    if (!/^[a-f0-9]{24}\.(mp3|ogg|wav|m4a)$/.test(f)) return reply.code(404).send();
    const mime = soundFileMime(ctx, f);
    if (!mime) return reply.code(404).send();
    try {
      const data = readFileSync(joinPath(ctx.config.mediaDir, 'sounds', f));
      return reply.header('content-type', mime).header('cache-control', 'public, max-age=31536000, immutable').send(data);
    } catch {
      return reply.code(404).send();
    }
  });

  // Phase 7 — NFT Minter (player device; fun only)
  app.get('/api/minter', async (req) => minterGet(ctx, device(req)));
  app.post('/api/minter/sync', async (req) => minterSync(ctx, device(req), b(req.body)));

  // Phase 8 — prompts, finale, statements, exports, archive
  app.post('/api/night/prompts/dismiss', async (req) => dismissPrompt(ctx, requireGm(ctx, req), b(req.body).prompt));
  app.post('/api/night/finale/skip', async (req) => skipFinale(ctx, requireGm(ctx, req, { master: true })));
  app.post('/api/night/finale/replay', async (req) => replayFinale(ctx, requireGm(ctx, req, { master: true })));
  app.get('/api/me/statement', async (req) => statement(ctx, device(req)));
  app.get('/api/me/statement.pdf', async (req, reply) => {
    const s = statement(ctx, device(req));
    const pdf = await statementPdf(s, { firm: COPY.brand.company, title: 'Final Account Statement', footer: COPY.brand.tagline }, (type) => COPY.achievements[type]?.name ?? type);
    const file = `statement-${s.night.date}-${s.player.ticker}.pdf`;
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${file}"`).send(pdf);
  });
  app.get('/api/nights', async (req) => ({ nights: listNights(ctx, requireGm(ctx, req)) }));
  app.get<{ Querystring: { night?: string } }>('/api/export/night.json', async (req, reply) => {
    const data = exportNightJson(ctx, requireGm(ctx, req, { master: true }), req.query.night);
    const file = `${data.night.date}-${data.night.name.replace(/[^\w-]+/g, '_')}.json`;
    return reply.header('content-type', 'application/json').header('content-disposition', `attachment; filename="${file}"`).send(JSON.stringify(data, null, 2));
  });
  app.get<{ Params: { kind: string }; Querystring: { night?: string } }>('/api/export/:kind.csv', async (req, reply) => {
    if (!(CSV_KINDS as readonly string[]).includes(req.params.kind)) return reply.code(404).send({ error: 'not_found' });
    const r = exportNightCsv(ctx, requireGm(ctx, req, { master: true }), req.params.kind, req.query.night);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${r.name}"`).send('\uFEFF' + r.csv);
  });
}
