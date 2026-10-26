import { createRng, moodBiasMap, tickMarket, type Impulse, type MoodReading } from '@gn/engine';
import { j } from '../db';
import type { Ctx } from '../context';
import { computeNightState, getNight, pid, upsertSecurities } from './state';

/** Queue an impulse for the next tick (trades, espionage, kingfall, re-rolls). Persisted so a restart loses nothing. */
export function queueImpulse(ctx: Ctx, nightId: number, imp: Impulse): void {
  ctx.db
    .prepare('INSERT INTO impulse (night_id, security_id, frac, cause, move_baseline, created_at) VALUES (?,?,?,?,?,?)')
    .run(nightId, imp.securityId, imp.frac, imp.cause, imp.moveBaseline ? 1 : 0, ctx.now());
}

function pendingImpulses(ctx: Ctx, nightId: number): (Impulse & { rowId: number })[] {
  return (ctx.db.prepare('SELECT id, security_id, frac, cause, move_baseline FROM impulse WHERE night_id = ? AND consumed_tick IS NULL ORDER BY id').all(nightId) as {
    id: number;
    security_id: string;
    frac: number;
    cause: Impulse['cause'];
    move_baseline: number;
  }[]).map((r) => ({ rowId: r.id, securityId: r.security_id, frac: r.frac, cause: r.cause, moveBaseline: !!r.move_baseline }));
}

/** Hidden vote drift for the current quarter, set when its vote window closed (Phase 6 writes it). */
function activeDrift(ctx: Ctx, nightId: number, quarter: number | null): Map<string, number> {
  if (quarter == null) return new Map();
  const r = ctx.db.prepare("SELECT drift FROM vote_round WHERE night_id = ? AND quarter = ? AND status = 'closed'").get(nightId, quarter) as { drift: string | null } | undefined;
  return new Map(Object.entries(j.parse<Record<string, number>>(r?.drift, {})));
}

export function moodReadings(ctx: Ctx, nightId: number): MoodReading[] {
  return (ctx.db.prepare('SELECT player_id, mood, self_assessment, tick FROM mood_reading WHERE night_id = ? ORDER BY id').all(nightId) as {
    player_id: number;
    mood: number;
    self_assessment: number;
    tick: number;
  }[]).map((r) => ({ playerId: pid(r.player_id), mood: r.mood, selfAssessment: r.self_assessment, tick: r.tick }));
}

/** Deterministic per-tick seed: a restart replays the same randomness for the same tick. */
function tickSeed(nightId: number, tick: number): number {
  let h = 2166136261 ^ nightId;
  h = Math.imul(h ^ tick, 16777619);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

export function tradingOpen(status: string, tradingClosed: number): boolean {
  return status === 'live' && !tradingClosed;
}

/** One market tick. Returns false (and does nothing) unless the night is live with trading open. */
export function runTick(ctx: Ctx, nightId: number): boolean {
  const done = ctx.db.transaction(() => {
    const n = getNight(ctx, nightId);
    if (!n || !tradingOpen(n.status, n.trading_closed) || !n.started_at) return false;
    const st = computeNightState(ctx, nightId)!;
    const tick = n.tick_count + 1;
    const active = new Set(st.players.filter((p) => p.left_at == null).map((p) => pid(p.id)));
    const earned = [...st.ledger.values()].filter((r) => active.has(r.playerId)).map((r) => ({ playerId: r.playerId, earnedH: r.earnedH }));
    const impulses = pendingImpulses(ctx, nightId);
    const res = tickMarket(
      st.securities,
      {
        earned,
        drift: activeDrift(ctx, nightId, n.current_quarter),
        mood: moodBiasMap(moodReadings(ctx, nightId), tick, st.settings),
        impulses,
      },
      st.settings,
      createRng(tickSeed(nightId, tick)),
    );
    upsertSecurities(ctx, nightId, res.securities);
    const ins = ctx.db.prepare('INSERT INTO price (night_id, security_id, tick, price, fair, target, causes, created_at) VALUES (?,?,?,?,?,?,?,?)');
    const now = ctx.now();
    for (const r of res.records) ins.run(nightId, r.securityId, tick, r.price, r.fair, r.target, j.str(r.causes), now);
    if (impulses.length) {
      const mark = ctx.db.prepare('UPDATE impulse SET consumed_tick = ? WHERE id = ?');
      for (const i of impulses) mark.run(tick, i.rowId);
    }
    ctx.db.prepare('UPDATE night SET tick_count = ?, last_tick_at = ? WHERE id = ?').run(tick, now, nightId);
    return true;
  })();
  if (done) ctx.bus.refresh(nightId);
  return done;
}

/** Recent public price history per security (for sparklines). */
export function priceHistory(ctx: Ctx, nightId: number, points = 60): Map<string, number[]> {
  const rows = ctx.db
    .prepare(
      `SELECT security_id, price FROM (
         SELECT security_id, price, tick, ROW_NUMBER() OVER (PARTITION BY security_id ORDER BY tick DESC) AS rn
         FROM price WHERE night_id = ?
       ) WHERE rn <= ? ORDER BY security_id, tick`,
    )
    .all(nightId, points) as { security_id: string; price: number }[];
  const out = new Map<string, number[]>();
  for (const r of rows) (out.get(r.security_id) ?? out.set(r.security_id, []).get(r.security_id)!).push(r.price);
  return out;
}

/** Latest mood term per player stock (GM-visible impact). Drift and impulses are never exposed. */
export function latestMoodTerms(ctx: Ctx, nightId: number): Map<string, number> {
  const rows = ctx.db
    .prepare(
      `SELECT p.security_id, p.causes FROM price p
       JOIN (SELECT security_id, MAX(tick) t FROM price WHERE night_id = ? GROUP BY security_id) m
         ON m.security_id = p.security_id AND m.t = p.tick
       WHERE p.night_id = ? AND p.security_id LIKE 'p:%'`,
    )
    .all(nightId, nightId) as { security_id: string; causes: string }[];
  return new Map(rows.map((r) => [r.security_id, j.parse<{ mood?: number }>(r.causes, {}).mood ?? 0]));
}
