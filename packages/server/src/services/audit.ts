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

/** Names for the ids that audit entries mention (all nights), so the GM screen can write "Ann", not "#12". */
export function auditNames(ctx: Ctx) {
  const map = (sql: string) => Object.fromEntries((ctx.db.prepare(sql).all() as { id: number; name: string }[]).map((r) => [String(r.id), r.name]));
  return {
    players: map('SELECT id, display_name AS name FROM player'),
    games: map('SELECT id, name FROM game'),
    tables: map('SELECT id, name FROM game_table'),
    library: map('SELECT id, name FROM library_game'),
  };
}

/** Board-state keys that are bookkeeping, not something the GM edited (the board's own log is noise here). */
const BOARD_NOISE = new Set(['log', 'seq', 'v', 'backup', 'eliminatedAt', 'elimCount', 'history']);
const blank = (v: unknown) => v === undefined || v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0);

function leaves(v: unknown, path: string, out: Map<string, unknown>) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!BOARD_NOISE.has(k)) leaves(x, path ? `${path}.${k}` : k, out);
  } else out.set(path, v);
}

/**
 * What changed between two board states, as flat `path → value` maps (e.g. "players.12.territories": 12 → 15).
 * A missing value and a blank one (0, false, null, none) count as the same, so a board's first save lists only
 * what was actually set. At most `max` changes are kept; `more` says how many were left out.
 */
export function boardDiff(before: unknown, after: unknown, max = 40): { before: Record<string, unknown>; after: Record<string, unknown>; more: number } {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  leaves(before ?? {}, '', a);
  leaves(after ?? {}, '', b);
  const out = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown>, more: 0 };
  let n = 0;
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path);
    const y = b.get(path);
    if (JSON.stringify(x) === JSON.stringify(y) || (blank(x) && blank(y))) continue;
    if (n >= max) {
      out.more++;
      continue;
    }
    n++;
    out.before[path] = x ?? null;
    out.after[path] = y ?? null;
  }
  return out;
}
