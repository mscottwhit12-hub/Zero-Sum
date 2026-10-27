/**
 * Espionage (spec §12).
 *  1. GM secretly assigns a challenge (reward: gold, re-roll, one-time peek, dead-stock clue, or custom).
 *  2. TV: anonymous BREAKING "an associate has received a confidential memo".
 *  3. Player gets an encrypted message, decrypts it, accepts or rejects.
 *  4. After a random delay the TV shows "accepted"/"rejected" (still anonymous).
 *  Reject: no penalty; GM may reassign. Success: only the agent knows (reward + hidden stock rise +
 *  Shadow Logistics moves). Fail: TV and feed expose the agent by name (+ hidden dip).
 */
import { espionageImpulses, toH } from '@gn/engine';
import { grantHint } from './hints';
import { j } from '../db';
import { bad, conflict, notFound, type Ctx } from '../context';
import { audit } from './audit';
import { pushFeed } from './feed';
import type { GmAuth } from './gm';
import { queueImpulse } from './market';
import { currentNight, loadSecurities, nightSettings, pid, type NightRow, type PlayerRow } from './state';

export type RewardType = 'gold' | 'reroll' | 'peek' | 'dead_clue' | 'custom' | 'hint';
export interface Reward {
  type: RewardType;
  gold?: number;
  text?: string;
  /** hint rewards: which tier of tip. */
  tier?: 'common' | 'rarer' | 'rarest';
}
type Status = 'sent' | 'read' | 'accepted' | 'rejected' | 'succeeded' | 'failed' | 'reassigned';

interface ChallengeRow {
  id: number;
  night_id: number;
  player_id: number;
  gm_id: number | null;
  text: string;
  reward: string;
  status: Status;
  created_at: number;
  resolved_at: number | null;
  reveal_at: number | null;
  revealed: number;
  reassigned_from: number | null;
  peek_target: number | null;
  read_at: number | null;
}

function liveNight(ctx: Ctx): NightRow {
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  if (n.status !== 'live' && n.status !== 'paused') throw conflict('bad_night_state');
  return n;
}

function getChallenge(ctx: Ctx, id: number): ChallengeRow {
  const c = ctx.db.prepare('SELECT * FROM challenge WHERE id = ?').get(id) as ChallengeRow | undefined;
  if (!c) throw notFound('challenge_not_found');
  return c;
}

function normalizeReward(ctx: Ctx, n: NightRow, r: unknown): Reward {
  const x = (r ?? {}) as Reward;
  if (!['gold', 'reroll', 'peek', 'dead_clue', 'custom', 'hint'].includes(x.type)) throw bad('bad_reward');
  if (x.type === 'hint') {
    const tier = x.tier ?? 'common';
    if (!['common', 'rarer', 'rarest'].includes(tier)) throw bad('bad_reward', 'Pick a tip tier.');
    return { type: 'hint', tier };
  }
  if (x.type === 'gold') {
    const g = x.gold == null || (x.gold as unknown) === '' ? nightSettings(n).espionage.goldReward : Number(x.gold);
    if (!Number.isFinite(g) || g <= 0 || g > 100) throw bad('bad_reward', 'Gold reward must be 0–100.');
    return { type: 'gold', gold: g };
  }
  if (x.type === 'custom') {
    const text = typeof x.text === 'string' ? x.text.trim().slice(0, 200) : '';
    if (!text) throw bad('bad_reward', 'Describe the custom reward.');
    return { type: 'custom', text };
  }
  return { type: x.type };
}

function insert(ctx: Ctx, n: NightRow, actor: GmAuth, playerId: number, text: string, reward: Reward, reassignedFrom: number | null): number {
  const r = ctx.db
    .prepare("INSERT INTO challenge (night_id, player_id, gm_id, text, reward, status, created_at, reassigned_from) VALUES (?,?,?,?,?, 'sent', ?, ?)")
    .run(n.id, playerId, actor.gmId, text, j.str(reward), ctx.now(), reassignedFrom);
  return Number(r.lastInsertRowid);
}

function announceMemo(ctx: Ctx, n: NightRow, playerId: number, challengeId: number) {
  pushFeed(ctx, n.id, 'espionage', 'feed.memo', {});
  ctx.bus.tv('espionage:notice', { state: 'memo' });
  ctx.bus.player(playerId, 'espionage:new', { id: challengeId });
  ctx.bus.refresh(n.id);
}

/** GM: create and assign (field action). */
export function createChallenge(ctx: Ctx, actor: GmAuth, input: { playerId: unknown; text: unknown; reward: unknown }) {
  const n = liveNight(ctx);
  const playerId = Number(input.playerId);
  if (!ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ? AND left_at IS NULL').get(playerId, n.id)) throw notFound('player_not_found');
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, 500) : '';
  if (!text) throw bad('empty_challenge');
  const reward = normalizeReward(ctx, n, input.reward);
  const id = ctx.db.transaction(() => {
    const id = insert(ctx, n, actor, playerId, text, reward, null);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'espionage.create', entity: 'challenge', entityId: id, after: { playerId, text, reward } });
    return id;
  })();
  announceMemo(ctx, n, playerId, id);
  return { id };
}

/** GM: hand a rejected challenge to someone else; the cycle repeats. */
export function reassignChallenge(ctx: Ctx, actor: GmAuth, id: number, playerId: unknown) {
  const n = liveNight(ctx);
  const c = getChallenge(ctx, id);
  if (c.night_id !== n.id) throw notFound('challenge_not_found');
  if (c.status !== 'rejected') throw conflict('not_rejected', 'Only rejected challenges can be reassigned.');
  const to = Number(playerId);
  if (to === c.player_id) throw bad('same_player');
  if (!ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ? AND left_at IS NULL').get(to, n.id)) throw notFound('player_not_found');
  const newId = ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE challenge SET status = 'reassigned' WHERE id = ?").run(id);
    const newId = insert(ctx, n, actor, to, c.text, j.parse<Reward>(c.reward, { type: 'custom' }), id);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'espionage.reassign', entity: 'challenge', entityId: newId, after: { from: id, playerId: to } });
    return newId;
  })();
  announceMemo(ctx, n, to, newId);
  return { id: newId };
}

/** Player: decrypt (marks read). */
export function readChallenge(ctx: Ctx, player: PlayerRow, id: number) {
  const c = getChallenge(ctx, id);
  if (c.player_id !== player.id) throw notFound('challenge_not_found');
  if (c.status === 'sent') ctx.db.prepare("UPDATE challenge SET status = 'read', read_at = ? WHERE id = ?").run(ctx.now(), id);
  ctx.bus.refresh(c.night_id);
  return { ok: true };
}

/** Player: accept or reject. The TV reveals the decision (anonymously) after a random delay. */
export function respondChallenge(ctx: Ctx, player: PlayerRow, id: number, accept: unknown) {
  const n = liveNight(ctx);
  const c = getChallenge(ctx, id);
  if (c.player_id !== player.id || c.night_id !== n.id) throw notFound('challenge_not_found');
  // Idempotent: the same answer twice (double tap) is fine; changing your answer is not.
  if ((c.status === 'accepted' && accept) || (c.status === 'rejected' && !accept)) return { status: c.status };
  if (c.status !== 'sent' && c.status !== 'read') throw conflict('already_answered', 'You already answered that memo.');
  const s = nightSettings(n).espionage;
  const delay = (s.revealDelayMinSec + Math.random() * (s.revealDelayMaxSec - s.revealDelayMinSec)) * 1000;
  ctx.db.prepare('UPDATE challenge SET status = ?, read_at = COALESCE(read_at, ?), reveal_at = ? WHERE id = ?').run(accept ? 'accepted' : 'rejected', ctx.now(), ctx.now() + Math.round(delay), id);
  ctx.bus.gm('espionage:update', { id, status: accept ? 'accepted' : 'rejected' });
  ctx.bus.refresh(n.id);
  return { status: accept ? 'accepted' : 'rejected' };
}

/** Tick-loop step: reveal accept/reject decisions on the TV when their delay has passed. */
export function espionageStep(ctx: Ctx, n: NightRow) {
  const due = ctx.db
    .prepare("SELECT id, status FROM challenge WHERE night_id = ? AND revealed = 0 AND reveal_at IS NOT NULL AND reveal_at <= ? AND status IN ('accepted','rejected','succeeded','failed','reassigned')")
    .all(n.id, ctx.now()) as { id: number; status: Status }[];
  for (const c of due) {
    // Reveal what the agent decided, regardless of what happened since.
    const decided = c.status === 'rejected' || c.status === 'reassigned' ? 'rejected' : 'accepted';
    ctx.db.prepare('UPDATE challenge SET revealed = 1 WHERE id = ?').run(c.id);
    pushFeed(ctx, n.id, 'espionage', decided === 'accepted' ? 'feed.memo_accepted' : 'feed.memo_rejected', {});
    ctx.bus.tv('espionage:notice', { state: decided });
  }
}

/** GM: mark an accepted challenge as success or fail. */
export function resolveChallenge(ctx: Ctx, actor: GmAuth, id: number, success: boolean) {
  const n = liveNight(ctx);
  const c = getChallenge(ctx, id);
  if (c.night_id !== n.id) throw notFound('challenge_not_found');
  if (c.status !== 'accepted') throw conflict('not_accepted', 'Only accepted challenges can be resolved.');
  const reward = j.parse<Reward>(c.reward, { type: 'custom' });
  const settings = nightSettings(n);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE challenge SET status = ?, resolved_at = ? WHERE id = ?').run(success ? 'succeeded' : 'failed', ctx.now(), id);
    if (success) {
      if (reward.type === 'gold')
        ctx.db
          .prepare("INSERT INTO adjustment (night_id, player_id, gold_h, reason, kind, gm_id, created_at) VALUES (?,?,?, 'Espionage reward', 'espionage', ?, ?)")
          .run(n.id, c.player_id, toH(reward.gold ?? settings.espionage.goldReward), actor.gmId, ctx.now());
      if (reward.type === 'reroll') ctx.db.prepare('UPDATE player SET reroll_tokens_left = reroll_tokens_left + 1 WHERE id = ?').run(c.player_id);
      if (reward.type === 'hint') grantHint(ctx, n, c.player_id, reward.tier ?? 'common', 'memo', `memo:${id}`, { force: true });
    }
    // Hidden nudges: agent's stock rises on success / dips on fail; Shadow Logistics moves on success.
    for (const imp of espionageImpulses(loadSecurities(ctx, n.id), pid(c.player_id), success ? 'success' : 'fail', settings)) queueImpulse(ctx, n.id, imp);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: success ? 'espionage.success' : 'espionage.fail', entity: 'challenge', entityId: id, after: { playerId: c.player_id, reward } });
  })();
  if (success) {
    pushFeed(ctx, n.id, 'espionage', 'feed.espionage_success_gm', { playerId: c.player_id }, true);
    ctx.bus.player(c.player_id, 'espionage:result', { id, success: true });
  } else {
    pushFeed(ctx, n.id, 'espionage', 'feed.espionage_fail', { playerId: c.player_id });
    ctx.bus.tv('espionage:notice', { state: 'failed', playerId: c.player_id });
    ctx.bus.player(c.player_id, 'espionage:result', { id, success: false });
  }
  ctx.bus.refresh(n.id);
  return { status: success ? 'succeeded' : 'failed' };
}

/** Peek reward: a one-time look at one player's investment history. */
export function usePeek(ctx: Ctx, player: PlayerRow, id: number, targetId: unknown) {
  const c = getChallenge(ctx, id);
  if (c.player_id !== player.id) throw notFound('challenge_not_found');
  const reward = j.parse<Reward>(c.reward, { type: 'custom' });
  if (c.status !== 'succeeded' || reward.type !== 'peek') throw conflict('no_peek');
  if (c.peek_target != null) throw conflict('peek_used', 'You already used this peek.');
  const t = Number(targetId);
  if (t === player.id || !ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ?').get(t, c.night_id)) throw bad('bad_target');
  ctx.db.prepare('UPDATE challenge SET peek_target = ? WHERE id = ?').run(t, id);
  ctx.bus.refresh(c.night_id);
  return { targetId: t, trades: peekTrades(ctx, t) };
}

function peekTrades(ctx: Ctx, playerId: number) {
  return ctx.db
    .prepare('SELECT security_id AS securityId, side, shares_h AS sharesH, price, created_at AS createdAt FROM trade WHERE player_id = ? AND forced = 0 ORDER BY id DESC LIMIT 50')
    .all(playerId) as { securityId: string; side: string; sharesH: number; price: number; createdAt: number }[];
}

/** The agent's own view of their challenges (encrypted until opened on the phone). */
export function playerChallenges(ctx: Ctx, playerId: number, nightId: number) {
  return (ctx.db.prepare("SELECT * FROM challenge WHERE player_id = ? AND night_id = ? AND status != 'reassigned' ORDER BY id DESC").all(playerId, nightId) as ChallengeRow[]).map((c) => {
    const reward = j.parse<Reward>(c.reward, { type: 'custom' });
    return {
      id: c.id,
      status: c.status === 'reassigned' ? 'rejected' : c.status,
      text: c.text,
      reward,
      createdAt: c.created_at,
      peek: reward.type === 'peek' && c.status === 'succeeded' ? { used: c.peek_target != null, targetId: c.peek_target, trades: c.peek_target != null ? peekTrades(ctx, c.peek_target) : [] } : null,
    };
  });
}

export function gmChallenges(ctx: Ctx, nightId: number) {
  return (ctx.db.prepare('SELECT * FROM challenge WHERE night_id = ? ORDER BY id DESC').all(nightId) as ChallengeRow[]).map((c) => ({
    id: c.id,
    playerId: c.player_id,
    status: c.status,
    text: c.text,
    reward: j.parse<Reward>(c.reward, { type: 'custom' }),
    createdAt: c.created_at,
    reassignedFrom: c.reassigned_from,
  }));
}
