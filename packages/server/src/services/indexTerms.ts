/**
 * Hidden index growth (GM-only): games feed the index. Derived from games/results every tick, so corrections recompute it.
 */
import { indexExtra, scoreGame, type IndexGame } from '@gn/engine';
import type { Ctx } from '../context';
import { loadResults, nightSettings, pauses, type NightRow } from './state';

/** Wall ms between a and b with night pauses removed. */
function playedMs(ctx: Ctx, nightId: number, a: number, b: number): number {
  let paused = 0;
  for (const p of pauses(ctx, nightId)) {
    const s = Math.max(a, p.start);
    const e = Math.min(b, p.end ?? b);
    if (e > s) paused += e - s;
  }
  return Math.max(0, b - a - paused);
}

export interface IndexTerms {
  growth: number;
  drop: number;
  extra: number;
}

export function indexTerms(ctx: Ctx, n: NightRow): IndexTerms {
  const settings = nightSettings(n);
  const paid = new Map(loadResults(ctx, n.id).map((r) => [Number(r.id), scoreGame(r, settings).rows.reduce((a, x) => a + x.goldH, 0)]));
  const rows = ctx.db
    .prepare("SELECT id, status, planned_duration_hours, started_at FROM game WHERE night_id = ? AND status IN ('active','final')")
    .all(n.id) as { id: number; status: 'active' | 'final'; planned_duration_hours: number | null; started_at: number | null }[];
  const count = ctx.db.prepare('SELECT COUNT(*) c FROM game_participant WHERE game_id = ?');
  const nightPlayers = (ctx.db.prepare('SELECT COUNT(*) c FROM player WHERE night_id = ? AND left_at IS NULL').get(n.id) as { c: number }).c;
  const now = ctx.now();
  const games: IndexGame[] = [];
  for (const g of rows) {
    const players = (count.get(g.id) as { c: number }).c || nightPlayers;
    if (g.status === 'final') games.push({ status: 'final', players, plannedHours: 0, elapsedHours: 0, paidH: paid.get(g.id) ?? 0 });
    else if (g.started_at) {
      const end = n.status === 'ended' && n.ended_at ? n.ended_at : now;
      games.push({ status: 'active', players, plannedHours: g.planned_duration_hours ?? 1, elapsedHours: playedMs(ctx, n.id, g.started_at, end) / 3_600_000 });
    }
  }
  return indexExtra(games, nightPlayers, settings);
}
