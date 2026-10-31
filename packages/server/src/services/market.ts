import { createRng, moodBiasMap, tickMarket, type Impulse, type MoodReading } from '@gn/engine';
import { j } from '../db';
import { bad, notFound, type Ctx } from '../context';
import { computeNightState, getNight, pid, upsertSecurities } from './state';
import { indexTerms } from './indexTerms';

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

/** Live-standings bias per player: the sum of each non-cancelled game's last live levels (band units). */
export function liveBias(ctx: Ctx, nightId: number): Map<string, number> {
  const out = new Map<string, number>();
  const rows = ctx.db.prepare("SELECT live_levels FROM game WHERE night_id = ? AND status != 'cancelled' AND live_levels IS NOT NULL").all(nightId) as { live_levels: string }[];
  for (const r of rows) for (const [k, v] of Object.entries(j.parse<Record<string, number>>(r.live_levels, {}))) out.set(k, (out.get(k) ?? 0) + v);
  return out;
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
        live: liveBias(ctx, nightId),
        impulses,
        indexExtra: indexTerms(ctx, n).extra,
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

/** Per database, per night: the last `points` prices per security, rebuilt only when a new tick lands. */
const historyCache = new WeakMap<object, Map<number, { tick: number; points: number; hist: Map<string, { ticks: number[]; prices: number[] }> }>>();

/**
 * Recent price history per security (for sparklines), with the tick of each point.
 * Cached per night and rebuilt once per market tick with one small indexed read per security
 * (the old window query ranked every price row of the night on every broadcast).
 */
export function priceHistoryPoints(ctx: Ctx, nightId: number, points = 60): Map<string, { ticks: number[]; prices: number[] }> {
  const tickRow = ctx.db.prepare('SELECT tick_count FROM night WHERE id = ?').get(nightId) as { tick_count: number } | undefined;
  const tick = tickRow?.tick_count ?? 0;
  let perDb = historyCache.get(ctx.db);
  if (!perDb) historyCache.set(ctx.db, (perDb = new Map()));
  const hit = perDb.get(nightId);
  if (hit && hit.tick === tick && hit.points === points) return hit.hist;
  const ids = (ctx.db.prepare('SELECT id FROM security WHERE night_id = ?').all(nightId) as { id: string }[]).map((r) => r.id);
  const q = ctx.db.prepare('SELECT tick, price FROM price WHERE night_id = ? AND security_id = ? ORDER BY tick DESC LIMIT ?');
  const hist = new Map<string, { ticks: number[]; prices: number[] }>();
  for (const id of ids) {
    const rows = (q.all(nightId, id, points) as { tick: number; price: number }[]).reverse();
    if (rows.length) hist.set(id, { ticks: rows.map((r) => r.tick), prices: rows.map((r) => r.price) });
  }
  perDb.set(nightId, { tick, points, hist });
  return hist;
}

/** Recent public price history per security (for sparklines). */
export function priceHistory(ctx: Ctx, nightId: number, points = 60): Map<string, number[]> {
  return new Map([...priceHistoryPoints(ctx, nightId, points)].map(([k, v]) => [k, v.prices]));
}

/** At most `max` values, evenly spread, always keeping the first and the last. */
export function thin<T>(rows: T[], max: number): T[] {
  if (rows.length <= max || max < 2) return rows;
  return Array.from({ length: max }, (_, i) => rows[Math.round((i * (rows.length - 1)) / (max - 1))]!);
}

/** Longest window a chart can ask for (minutes); anything beyond it means "the whole night". */
export const CHART_MAX_MINUTES = 24 * 60;

/**
 * Public price series for one stock over the last `minutes` (null = the whole night), for the phone's chart.
 * Prices only (never fair value, targets or causes), thinned to `maxPoints`. A window with fewer than two
 * ticks (just after a pause) falls back to the latest two so the chart still draws.
 */
export function priceSeries(ctx: Ctx, nightId: number, securityId: string, minutes: number | null, maxPoints = 200): { prices: number[]; from: number | null; to: number | null } {
  if (!ctx.db.prepare('SELECT 1 FROM security WHERE night_id = ? AND id = ?').get(nightId, securityId)) throw notFound('security_not_found');
  if (minutes != null && (!Number.isFinite(minutes) || minutes <= 0)) throw bad('bad_minutes');
  const since = minutes == null ? 0 : ctx.now() - Math.min(minutes, CHART_MAX_MINUTES) * 60_000;
  let rows = ctx.db.prepare('SELECT price, created_at FROM price WHERE night_id = ? AND security_id = ? AND created_at >= ? ORDER BY tick').all(nightId, securityId, since) as { price: number; created_at: number }[];
  if (rows.length < 2) rows = (ctx.db.prepare('SELECT price, created_at FROM price WHERE night_id = ? AND security_id = ? ORDER BY tick DESC LIMIT 2').all(nightId, securityId) as { price: number; created_at: number }[]).reverse();
  const out = thin(rows, maxPoints);
  return { prices: out.map((r) => r.price), from: out[0]?.created_at ?? null, to: out[out.length - 1]?.created_at ?? null };
}

/** Latest mood term per player stock (GM-visible impact). Drift and impulses are never exposed. */
const moodCache = new WeakMap<object, Map<number, { tick: number; terms: Map<string, number> }>>();
export function latestMoodTerms(ctx: Ctx, nightId: number): Map<string, number> {
  const tick = (ctx.db.prepare('SELECT tick_count FROM night WHERE id = ?').get(nightId) as { tick_count: number } | undefined)?.tick_count ?? 0;
  let perDb = moodCache.get(ctx.db);
  if (!perDb) moodCache.set(ctx.db, (perDb = new Map()));
  const hit = perDb.get(nightId);
  if (hit && hit.tick === tick) return hit.terms;
  // One indexed read per player stock (the latest price row), instead of a GROUP BY over every price row.
  const ids = (ctx.db.prepare("SELECT id FROM security WHERE night_id = ? AND kind = 'player'").all(nightId) as { id: string }[]).map((r) => r.id);
  const q = ctx.db.prepare('SELECT causes FROM price WHERE night_id = ? AND security_id = ? ORDER BY tick DESC LIMIT 1');
  const terms = new Map<string, number>();
  for (const id of ids) {
    const r = q.get(nightId, id) as { causes: string } | undefined;
    if (r) terms.set(id, j.parse<{ mood?: number }>(r.causes, {}).mood ?? 0);
  }
  perDb.set(nightId, { tick, terms });
  return terms;
}
