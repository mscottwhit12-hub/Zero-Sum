import { j } from '../db';
import type { Ctx } from '../context';

export interface AuditEntry {
  nightId: number | null;
  gmId: number | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
}

/** Every GM write goes through here (spec §4.1). */
export function audit(ctx: Ctx, e: AuditEntry): void {
  ctx.db
    .prepare(
      'INSERT INTO audit_log (night_id, gm_id, action, entity, entity_id, before, after, created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      e.nightId,
      e.gmId,
      e.action,
      e.entity,
      e.entityId == null ? null : String(e.entityId),
      e.before === undefined ? null : j.str(e.before),
      e.after === undefined ? null : j.str(e.after),
      ctx.now(),
    );
}

export function auditTail(ctx: Ctx, limit = 100) {
  return ctx.db
    .prepare(
      `SELECT a.id, a.night_id AS nightId, a.gm_id AS gmId, g.name AS gmName, a.action, a.entity, a.entity_id AS entityId,
              a.before, a.after, a.created_at AS createdAt
       FROM audit_log a LEFT JOIN game_master g ON g.id = a.gm_id ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
}
