/** Field actions (Master or Sub): mood rounds, re-roll logging, notifications. Plus Master-only GM price offsets. */
import { centeredMood, moodBiasMap, rerollImpulse } from '@gn/engine';
import { j } from '../db';
import { bad, conflict, forbidden, notFound, type Ctx } from '../context';
import { audit } from './audit';
import { pushFeed } from './feed';
import type { GmAuth } from './gm';
import { moodReadings, queueImpulse } from './market';
import { currentNight, loadSecurities, nightSettings, pid, type NightRow } from './state';

function liveNight(ctx: Ctx): NightRow {
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  if (n.status !== 'live' && n.status !== 'paused') throw conflict('bad_night_state');
  return n;
}
const rating = (v: unknown) => {
  const x = Number(v);
  if (!Number.isInteger(x) || x < 1 || x > 5) throw bad('bad_rating', 'Ratings are 1–5.');
  return x;
};

// ---------------------------------------------------------------- mood rounds

/** Two 1–5 ratings: mood (gloomy→cheery) and perceived self-assessment. Target ≤10 s per player. */
export function recordMood(ctx: Ctx, actor: GmAuth, input: { playerId: unknown; mood: unknown; selfAssessment: unknown }) {
  const n = liveNight(ctx);
  const playerId = Number(input.playerId);
  if (!ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ? AND left_at IS NULL').get(playerId, n.id)) throw notFound('player_not_found');
  const mood = rating(input.mood);
  const self = rating(input.selfAssessment);
  ctx.db.transaction(() => {
    ctx.db
      .prepare('INSERT INTO mood_reading (night_id, player_id, gm_id, mood, self_assessment, tick, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(n.id, playerId, actor.gmId, mood, self, n.tick_count, ctx.now());
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'mood.record', entity: 'player', entityId: playerId, after: { mood, self } });
  })();
  ctx.bus.refresh(n.id);
  const s = nightSettings(n);
  return { playerId, mood, selfAssessment: self, impact: s.mood.moodMax * centeredMood(mood, self) };
}

/** GM-only: current mood-driven price bias per player (band units) and the latest ratings. */
export function moodGmView(ctx: Ctx, n: NightRow) {
  const readings = moodReadings(ctx, n.id);
  const bias = moodBiasMap(readings, n.tick_count, nightSettings(n));
  const latest = new Map<string, { mood: number; selfAssessment: number; tick: number }>();
  for (const r of readings) latest.set(r.playerId, r);
  return [...latest].map(([playerId, r]) => ({ playerId: Number(playerId), mood: r.mood, selfAssessment: r.selfAssessment, bias: bias.get(playerId) ?? 0 }));
}

// ---------------------------------------------------------------- re-rolls

/** Log a re-roll spend in a flagged game. Drives Second Chance Insurance Co. (hinted only, so GM-only feed). */
/** `requestId` (optional, from boards) makes the call idempotent: the same id never spends twice. */
export function logReroll(ctx: Ctx, actor: GmAuth, input: { gameId: unknown; playerId: unknown; requestId?: unknown }) {
  const n = liveNight(ctx);
  const gameId = Number(input.gameId);
  const playerId = Number(input.playerId);
  const requestId = typeof input.requestId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(input.requestId) ? input.requestId : null;
  if (requestId) {
    const done = ctx.db.prepare('SELECT player_id FROM reroll_use WHERE request_id = ?').get(requestId) as { player_id: number } | undefined;
    if (done) {
      const left = ctx.db.prepare('SELECT reroll_tokens_left FROM player WHERE id = ?').get(done.player_id) as { reroll_tokens_left: number };
      return { left: left.reroll_tokens_left };
    }
  }
  const g = ctx.db.prepare('SELECT id, name, status, rerolls_allowed FROM game WHERE id = ? AND night_id = ?').get(gameId, n.id) as
    | { id: number; name: string; status: string; rerolls_allowed: number }
    | undefined;
  if (!g) throw notFound('game_not_found');
  if (g.status !== 'active') throw conflict('game_not_active');
  if (!g.rerolls_allowed) throw conflict('rerolls_not_allowed', 'Re-rolls are not allowed in this game.');
  const p = ctx.db.prepare('SELECT reroll_tokens_left FROM player WHERE id = ? AND night_id = ?').get(playerId, n.id) as { reroll_tokens_left: number } | undefined;
  if (!p) throw notFound('player_not_found');
  if (p.reroll_tokens_left <= 0) throw conflict('no_rerolls', 'No re-rolls left.');
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE player SET reroll_tokens_left = reroll_tokens_left - 1 WHERE id = ?').run(playerId);
    ctx.db.prepare('INSERT INTO reroll_use (player_id, game_id, gm_id, created_at, request_id) VALUES (?,?,?,?,?)').run(playerId, gameId, actor.gmId, ctx.now(), requestId);
    const imp = rerollImpulse(loadSecurities(ctx, n.id), nightSettings(n));
    if (imp) queueImpulse(ctx, n.id, imp);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'reroll.log', entity: 'player', entityId: playerId, after: { gameId } });
  })();
  pushFeed(ctx, n.id, 'reroll', 'feed.reroll', { playerId, gameId, name: g.name }, true);
  ctx.bus.refresh(n.id);
  return { left: p.reroll_tokens_left - 1 };
}

// ---------------------------------------------------------------- notifications

/** GM → one player, several, everyone, or a game's table. Arrives in Messages with a badge + vibration. */
export function sendNotification(ctx: Ctx, actor: GmAuth, input: { to: unknown; message: unknown }) {
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  const message = typeof input.message === 'string' ? input.message.trim().slice(0, 500) : '';
  if (!message) throw bad('empty_message');
  const to = (input.to ?? {}) as { all?: boolean; players?: unknown[]; gameId?: unknown };
  let target: string;
  let recipients: number[];
  const nightPlayers = (ctx.db.prepare('SELECT id FROM player WHERE night_id = ?').all(n.id) as { id: number }[]).map((r) => r.id);
  if (to.all) {
    target = 'all';
    recipients = nightPlayers;
  } else if (to.gameId != null) {
    recipients = (ctx.db.prepare('SELECT player_id FROM game_participant gp JOIN game g ON g.id = gp.game_id WHERE g.id = ? AND g.night_id = ?').all(Number(to.gameId), n.id) as { player_id: number }[]).map((r) => r.player_id);
    if (!recipients.length) throw bad('no_recipients', 'Nobody to send that to.');
    target = `players:${recipients.join(',')}`;
  } else if (Array.isArray(to.players) && to.players.length) {
    recipients = [...new Set(to.players.map(Number))].filter((id) => nightPlayers.includes(id));
    if (!recipients.length) throw bad('no_recipients', 'Nobody to send that to.');
    target = recipients.length === 1 ? `player:${recipients[0]}` : `players:${recipients.join(',')}`;
  } else throw bad('no_recipients', 'Nobody to send that to.');
  const id = ctx.db.transaction(() => {
    const r = ctx.db.prepare("INSERT INTO notification (night_id, target, message, sent_by_gm_id, read_by, created_at) VALUES (?,?,?,?, '[]', ?)").run(n.id, target, message, actor.gmId, ctx.now());
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'notify.send', entity: 'notification', entityId: Number(r.lastInsertRowid), after: { target, message } });
    return Number(r.lastInsertRowid);
  })();
  for (const p of recipients) ctx.bus.player(p, 'notify:player', { id });
  ctx.bus.refresh(n.id);
  return { id, recipients: recipients.length };
}

export function sentNotifications(ctx: Ctx, nightId: number) {
  return (ctx.db.prepare('SELECT id, target, message, read_by, created_at FROM notification WHERE night_id = ? ORDER BY id DESC LIMIT 50').all(nightId) as {
    id: number;
    target: string;
    message: string;
    read_by: string;
    created_at: number;
  }[]).map((r) => ({ id: r.id, to: r.target, message: r.message, readCount: j.parse<number[]>(r.read_by, []).length, createdAt: r.created_at }));
}

// ---------------------------------------------------------------- GM price offsets (Master)

/** Per-stock ± offset in band units; player stocks only (locked #6). Persists until cleared; never shown to players. */
export function setOffset(ctx: Ctx, actor: GmAuth, securityId: string, offset: unknown) {
  if (actor.role !== 'master') throw forbidden('master_only');
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  const sec = ctx.db.prepare('SELECT kind, gm_offset FROM security WHERE night_id = ? AND id = ?').get(n.id, securityId) as { kind: string; gm_offset: number } | undefined;
  if (!sec) throw notFound('security_not_found');
  if (sec.kind !== 'player') throw bad('player_stocks_only', 'GM offsets apply to player stocks only.');
  const v = Number(offset);
  if (!Number.isFinite(v) || Math.abs(v) > 0.5) throw bad('bad_offset', 'Offset must be between −0.5 and 0.5 band units.');
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE security SET gm_offset = ? WHERE night_id = ? AND id = ?').run(v, n.id, securityId);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'market.offset', entity: 'security', entityId: securityId, before: { offset: sec.gm_offset }, after: { offset: v } });
  })();
  ctx.bus.refresh(n.id);
  return { securityId, offset: v };
}

export const securityIdOf = (playerId: number) => `p:${playerId}`;
export { pid };
