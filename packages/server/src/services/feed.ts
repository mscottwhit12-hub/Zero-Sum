import { j } from '../db';
import type { Ctx } from '../context';

export interface FeedItem {
  id: number;
  type: string;
  message: string;
  data: Record<string, unknown>;
  gmOnly: boolean;
  createdAt: number;
}

/** Adds a feed entry and broadcasts it (public, or GM-only). Message keys are copy-file keys; clients render text. */
export function pushFeed(ctx: Ctx, nightId: number, type: string, message: string, data: Record<string, unknown> = {}, gmOnly = false): FeedItem {
  const createdAt = ctx.now();
  const r = ctx.db
    .prepare('INSERT INTO feed_event (night_id, type, message, data, gm_only, created_at) VALUES (?,?,?,?,?,?)')
    .run(nightId, type, message, j.str(data), gmOnly ? 1 : 0, createdAt);
  const item: FeedItem = { id: Number(r.lastInsertRowid), type, message, data, gmOnly, createdAt };
  if (gmOnly) ctx.bus.gm('feed:new', item);
  else ctx.bus.all('feed:new', item);
  return item;
}

export function feedTail(ctx: Ctx, nightId: number, includeGmOnly: boolean, limit = 50): FeedItem[] {
  const rows = ctx.db
    .prepare(
      `SELECT id, type, message, data, gm_only, created_at FROM feed_event
       WHERE night_id = ? ${includeGmOnly ? '' : 'AND gm_only = 0'} ORDER BY id DESC LIMIT ?`,
    )
    .all(nightId, limit) as { id: number; type: string; message: string; data: string; gm_only: number; created_at: number }[];
  return rows.map((r) => ({ id: r.id, type: r.type, message: r.message, data: j.parse(r.data, {}), gmOnly: !!r.gm_only, createdAt: r.created_at }));
}
