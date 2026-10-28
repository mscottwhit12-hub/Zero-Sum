/**
 * Player chat: one-to-one and group threads for game talk. Every message is kept with its time (GMs can read all of
 * it, and it's in the night export). Members get a live `chat:message` push; nothing reaches the feed or the TV.
 *
 * Wiretap (espionage memo reward, GM picks the version): one random message from a chat the holder isn't in, either
 * from any chat that night (`any`) or between two players the holder picks (`pair`). The players whose message was
 * read are never told.
 */
import { j } from '../db';
import { bad, conflict, notFound, type Ctx } from '../context';
import { audit } from './audit';
import type { PlayerRow } from './state';

const MAX_TEXT = 500;
const MAX_NAME = 40;

export interface ChatMessage {
  id: number;
  threadId: number;
  playerId: number;
  text: string;
  createdAt: number;
}
export interface ChatThreadView {
  id: number;
  kind: 'dm' | 'group';
  name: string | null;
  members: number[];
  last: ChatMessage | null;
  unread: number;
  count: number;
}

type MsgRow = { id: number; thread_id: number; player_id: number; text: string; created_at: number };
const toMsg = (r: MsgRow): ChatMessage => ({ id: r.id, threadId: r.thread_id, playerId: r.player_id, text: r.text, createdAt: r.created_at });

function liveNight(ctx: Ctx, nightId: number) {
  const n = ctx.db.prepare('SELECT status FROM night WHERE id = ?').get(nightId) as { status: string } | undefined;
  if (!n || n.status === 'archived' || n.status === 'setup') throw conflict('chat_closed', 'Chat is closed right now.');
}

const membersOf = (ctx: Ctx, threadId: number) =>
  (ctx.db.prepare('SELECT player_id FROM chat_member WHERE thread_id = ? ORDER BY player_id').all(threadId) as { player_id: number }[]).map((r) => r.player_id);

function threadFor(ctx: Ctx, player: PlayerRow, threadId: number) {
  const t = ctx.db.prepare('SELECT t.* FROM chat_thread t JOIN chat_member m ON m.thread_id = t.id WHERE t.id = ? AND m.player_id = ? AND t.night_id = ?').get(threadId, player.id, player.night_id) as
    | { id: number; night_id: number; kind: 'dm' | 'group'; name: string | null }
    | undefined;
  if (!t) throw notFound('chat_not_found');
  return t;
}

function threadView(ctx: Ctx, t: { id: number; kind: 'dm' | 'group'; name: string | null }, me: number | null): ChatThreadView {
  const last = ctx.db.prepare('SELECT * FROM chat_message WHERE thread_id = ? ORDER BY id DESC LIMIT 1').get(t.id) as MsgRow | undefined;
  const count = (ctx.db.prepare('SELECT COUNT(*) c FROM chat_message WHERE thread_id = ?').get(t.id) as { c: number }).c;
  let unread = 0;
  if (me != null) {
    const lr = (ctx.db.prepare('SELECT last_read_id FROM chat_member WHERE thread_id = ? AND player_id = ?').get(t.id, me) as { last_read_id: number } | undefined)?.last_read_id ?? 0;
    unread = (ctx.db.prepare('SELECT COUNT(*) c FROM chat_message WHERE thread_id = ? AND id > ? AND player_id != ?').get(t.id, lr, me) as { c: number }).c;
  }
  return { id: t.id, kind: t.kind, name: t.name, members: membersOf(ctx, t.id), last: last ? toMsg(last) : null, unread, count };
}

/** A player's threads, most recent activity first. */
export function myChats(ctx: Ctx, player: PlayerRow): ChatThreadView[] {
  const rows = ctx.db
    .prepare(
      `SELECT t.id, t.kind, t.name, COALESCE((SELECT MAX(id) FROM chat_message WHERE thread_id = t.id), 0) last_id FROM chat_thread t
       JOIN chat_member m ON m.thread_id = t.id WHERE m.player_id = ? AND t.night_id = ? ORDER BY last_id DESC, t.id DESC`,
    )
    .all(player.id, player.night_id) as { id: number; kind: 'dm' | 'group'; name: string | null }[];
  return rows.map((t) => threadView(ctx, t, player.id));
}

/** Unread chat messages for a player (phone badge). */
export function chatUnread(ctx: Ctx, playerId: number): number {
  return (
    ctx.db
      .prepare('SELECT COUNT(*) c FROM chat_message msg JOIN chat_member m ON m.thread_id = msg.thread_id AND m.player_id = ? WHERE msg.id > m.last_read_id AND msg.player_id != ?')
      .get(playerId, playerId) as { c: number }
  ).c;
}

/** Starts a chat: one other player = their one-to-one thread (reused if it exists); more = a new group. */
export function startChat(ctx: Ctx, player: PlayerRow, input: { members?: unknown; name?: unknown }): ChatThreadView {
  liveNight(ctx, player.night_id);
  const raw = Array.isArray(input.members) ? input.members.map(Number) : [];
  const ids = [...new Set(raw)].filter((id) => Number.isInteger(id) && id !== player.id);
  if (!ids.length) throw bad('chat_no_members', 'Pick at least one associate.');
  const valid = ctx.db.prepare('SELECT id FROM player WHERE night_id = ? AND left_at IS NULL').all(player.night_id) as { id: number }[];
  const ok = new Set(valid.map((r) => r.id));
  if (ids.some((id) => !ok.has(id))) throw bad('chat_bad_member', 'One of those associates is not here tonight.');
  if (ids.length === 1) {
    const other = ids[0]!;
    const existing = ctx.db
      .prepare(
        `SELECT t.id, t.kind, t.name FROM chat_thread t WHERE t.night_id = ? AND t.kind = 'dm'
         AND EXISTS (SELECT 1 FROM chat_member WHERE thread_id = t.id AND player_id = ?) AND EXISTS (SELECT 1 FROM chat_member WHERE thread_id = t.id AND player_id = ?)`,
      )
      .get(player.night_id, player.id, other) as { id: number; kind: 'dm'; name: null } | undefined;
    if (existing) return threadView(ctx, existing, player.id);
  }
  const name = ids.length > 1 && typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, MAX_NAME) : null;
  const kind = ids.length === 1 ? 'dm' : 'group';
  const id = ctx.db.transaction(() => {
    const r = ctx.db.prepare('INSERT INTO chat_thread (night_id, kind, name, created_by, created_at) VALUES (?,?,?,?,?)').run(player.night_id, kind, name, player.id, ctx.now());
    const tid = Number(r.lastInsertRowid);
    const ins = ctx.db.prepare('INSERT INTO chat_member (thread_id, player_id) VALUES (?,?)');
    for (const p of [player.id, ...ids]) ins.run(tid, p);
    return tid;
  })();
  ctx.bus.gm('chat:thread', { threadId: id });
  return threadView(ctx, { id, kind, name }, player.id);
}

export function chatMessages(ctx: Ctx, player: PlayerRow, threadId: number, before?: unknown): { thread: ChatThreadView; messages: ChatMessage[] } {
  const t = threadFor(ctx, player, threadId);
  return { thread: threadView(ctx, t, player.id), messages: page(ctx, t.id, before) };
}

function page(ctx: Ctx, threadId: number, before?: unknown): ChatMessage[] {
  const b = Number(before);
  const rows = (Number.isInteger(b) && b > 0
    ? ctx.db.prepare('SELECT * FROM chat_message WHERE thread_id = ? AND id < ? ORDER BY id DESC LIMIT 100').all(threadId, b)
    : ctx.db.prepare('SELECT * FROM chat_message WHERE thread_id = ? ORDER BY id DESC LIMIT 100').all(threadId)) as MsgRow[];
  return rows.reverse().map(toMsg);
}

/** Sends a message. `clientId` makes a double tap / retry send it once. */
export function sendChat(ctx: Ctx, player: PlayerRow, threadId: number, input: { text?: unknown; clientId?: unknown }): ChatMessage {
  liveNight(ctx, player.night_id);
  const t = threadFor(ctx, player, threadId);
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_TEXT) : '';
  if (!text) throw bad('chat_empty', 'Type a message first.');
  const clientId = typeof input.clientId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(input.clientId) ? input.clientId : null;
  if (clientId) {
    const dup = ctx.db.prepare('SELECT * FROM chat_message WHERE player_id = ? AND client_id = ?').get(player.id, clientId) as MsgRow | undefined;
    if (dup) return toMsg(dup);
  }
  const r = ctx.db.prepare('INSERT INTO chat_message (thread_id, night_id, player_id, text, client_id, created_at) VALUES (?,?,?,?,?,?)').run(t.id, t.night_id, player.id, text, clientId, ctx.now());
  const msg: ChatMessage = { id: Number(r.lastInsertRowid), threadId: t.id, playerId: player.id, text, createdAt: ctx.now() };
  ctx.db.prepare('UPDATE chat_member SET last_read_id = ? WHERE thread_id = ? AND player_id = ?').run(msg.id, t.id, player.id);
  for (const p of membersOf(ctx, t.id)) ctx.bus.player(p, 'chat:message', msg);
  ctx.bus.gm('chat:message', { threadId: t.id, id: msg.id });
  ctx.bus.refresh(t.night_id);
  return msg;
}

export function markChatRead(ctx: Ctx, player: PlayerRow, threadId: number, upTo: unknown) {
  const t = threadFor(ctx, player, threadId);
  const max = (ctx.db.prepare('SELECT COALESCE(MAX(id), 0) m FROM chat_message WHERE thread_id = ?').get(t.id) as { m: number }).m;
  const n = Math.min(max, Number.isInteger(Number(upTo)) ? Number(upTo) : max);
  ctx.db.prepare('UPDATE chat_member SET last_read_id = MAX(last_read_id, ?) WHERE thread_id = ? AND player_id = ?').run(n, t.id, player.id);
  ctx.bus.refresh(t.night_id);
  return { ok: true };
}

// ---------------------------------------------------------------- GM

export function gmChats(ctx: Ctx, nightId: number): ChatThreadView[] {
  const rows = ctx.db
    .prepare('SELECT t.id, t.kind, t.name, COALESCE((SELECT MAX(id) FROM chat_message WHERE thread_id = t.id), 0) last_id FROM chat_thread t WHERE t.night_id = ? ORDER BY last_id DESC, t.id DESC')
    .all(nightId) as { id: number; kind: 'dm' | 'group'; name: string | null }[];
  return rows.map((t) => threadView(ctx, t, null));
}

export function gmChatMessages(ctx: Ctx, nightId: number, threadId: number, before?: unknown) {
  const t = ctx.db.prepare('SELECT id, kind, name FROM chat_thread WHERE id = ? AND night_id = ?').get(threadId, nightId) as { id: number; kind: 'dm' | 'group'; name: string | null } | undefined;
  if (!t) throw notFound('chat_not_found');
  return { thread: threadView(ctx, t, null), messages: page(ctx, t.id, before) };
}

/** Every thread and message of a night, for the export. */
export function chatExport(ctx: Ctx, nightId: number) {
  const threads = (ctx.db.prepare('SELECT id, kind, name, created_by, created_at FROM chat_thread WHERE night_id = ? ORDER BY id').all(nightId) as {
    id: number;
    kind: string;
    name: string | null;
    created_by: number | null;
    created_at: number;
  }[]).map((t) => ({ id: t.id, kind: t.kind, name: t.name, createdBy: t.created_by, createdAt: t.created_at, members: membersOf(ctx, t.id) }));
  const messages = (ctx.db.prepare('SELECT * FROM chat_message WHERE night_id = ? ORDER BY id').all(nightId) as MsgRow[]).map(toMsg);
  return { threads, messages };
}

// ---------------------------------------------------------------- wiretap

export type WiretapMode = 'any' | 'pair';
export interface WiretapResult {
  message: ChatMessage;
  thread: { kind: 'dm' | 'group'; name: string | null; members: number[] };
}

/** Uses a wiretap memo reward (once). Picks one random message from a chat the holder isn't in. */
export function useWiretap(ctx: Ctx, player: PlayerRow, challengeId: number, input: { a?: unknown; b?: unknown }): WiretapResult {
  const c = ctx.db.prepare('SELECT * FROM challenge WHERE id = ?').get(challengeId) as
    | { id: number; player_id: number; night_id: number; status: string; reward: string; wiretap_message_id: number | null }
    | undefined;
  if (!c || c.player_id !== player.id) throw notFound('challenge_not_found');
  const reward = j.parse<{ type: string; mode?: WiretapMode }>(c.reward, { type: 'custom' });
  if (c.status !== 'succeeded' || reward.type !== 'wiretap') throw conflict('no_wiretap');
  if (c.wiretap_message_id != null) return wiretapResult(ctx, c.wiretap_message_id)!;
  const notMine = 'NOT EXISTS (SELECT 1 FROM chat_member WHERE thread_id = msg.thread_id AND player_id = @me)';
  let row: { id: number } | undefined;
  let pair: [number, number] | null = null;
  if (reward.mode === 'pair') {
    const a = Number(input.a);
    const b = Number(input.b);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) throw bad('wiretap_pick_two', 'Pick two different associates.');
    pair = [a, b];
    row = ctx.db
      .prepare(
        `SELECT msg.id FROM chat_message msg WHERE msg.night_id = @n AND msg.player_id IN (@a, @b) AND ${notMine}
         AND EXISTS (SELECT 1 FROM chat_member WHERE thread_id = msg.thread_id AND player_id = @a)
         AND EXISTS (SELECT 1 FROM chat_member WHERE thread_id = msg.thread_id AND player_id = @b)
         ORDER BY RANDOM() LIMIT 1`,
      )
      .get({ n: c.night_id, a, b, me: player.id }) as { id: number } | undefined;
    if (!row) throw conflict('wiretap_nothing', "Nothing on the line between those two yet. Your wiretap is still unused.");
  } else {
    row = ctx.db.prepare(`SELECT msg.id FROM chat_message msg WHERE msg.night_id = @n AND ${notMine} ORDER BY RANDOM() LIMIT 1`).get({ n: c.night_id, me: player.id }) as { id: number } | undefined;
    if (!row) throw conflict('wiretap_nothing', 'Nothing on the line yet. Your wiretap is still unused.');
  }
  const msgId = row.id;
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE challenge SET wiretap_message_id = ?, wiretap_pair = ? WHERE id = ? AND wiretap_message_id IS NULL').run(msgId, pair ? JSON.stringify(pair) : null, c.id);
    audit(ctx, { nightId: c.night_id, gmId: null, action: 'wiretap.use', entity: 'challenge', entityId: c.id, after: { playerId: player.id, mode: reward.mode ?? 'any', pair, messageId: msgId } });
  })();
  ctx.bus.refresh(c.night_id);
  const used = (ctx.db.prepare('SELECT wiretap_message_id m FROM challenge WHERE id = ?').get(c.id) as { m: number }).m;
  return wiretapResult(ctx, used)!;
}

export function wiretapResult(ctx: Ctx, messageId: number | null): WiretapResult | null {
  if (messageId == null) return null;
  const m = ctx.db.prepare('SELECT * FROM chat_message WHERE id = ?').get(messageId) as MsgRow | undefined;
  if (!m) return null;
  const t = ctx.db.prepare('SELECT kind, name FROM chat_thread WHERE id = ?').get(m.thread_id) as { kind: 'dm' | 'group'; name: string | null };
  return { message: toMsg(m), thread: { kind: t.kind, name: t.name, members: membersOf(ctx, m.thread_id) } };
}
