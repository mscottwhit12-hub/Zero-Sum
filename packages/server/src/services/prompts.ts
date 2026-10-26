/**
 * GM prompts (spec §16): never automatic actions, just reminders.
 *  - "Close trading?" from N minutes (prompts.tradingCloseMinutesBefore) before the last
 *    scheduled game's planned end. Dismissible; re-prompts if that planned end changes.
 *  - "End the night?" once the final scheduled game's result is in (nothing scheduled or active).
 *    Dismissible; re-prompts if more games are added.
 */
import { bad, notFound, type Ctx } from '../context';
import type { GmAuth } from './gm';
import { currentNight, nightSettings, type NightRow } from './state';

const key = (nightId: number, p: string) => `prompt:${nightId}:${p}`;
const dismissedFor = (ctx: Ctx, nightId: number, p: string) =>
  (ctx.db.prepare('SELECT value FROM meta WHERE key = ?').get(key(nightId, p)) as { value: string } | undefined)?.value ?? null;

function lastPlannedEnd(ctx: Ctx, nightId: number): number | null {
  const r = ctx.db
    .prepare("SELECT MAX(planned_start + planned_duration_hours * 3600000) t FROM game WHERE night_id = ? AND status != 'cancelled' AND planned_start IS NOT NULL AND planned_duration_hours IS NOT NULL")
    .get(nightId) as { t: number | null };
  return r.t == null ? null : Math.round(r.t);
}

function endSignature(ctx: Ctx, nightId: number): string | null {
  const r = ctx.db
    .prepare("SELECT COUNT(*) total, SUM(status = 'final') final, SUM(status IN ('scheduled','active')) open FROM game WHERE night_id = ? AND status != 'cancelled'")
    .get(nightId) as { total: number; final: number | null; open: number | null };
  return r.final && !r.open ? String(r.total) : null;
}

export function promptsView(ctx: Ctx, n: NightRow) {
  const running = n.status === 'live' || n.status === 'paused';
  let closeTradingAt: number | null = null;
  if (running && !n.trading_closed) {
    const end = lastPlannedEnd(ctx, n.id);
    if (end != null && dismissedFor(ctx, n.id, 'closeTrading') !== String(end)) closeTradingAt = end - nightSettings(n).prompts.tradingCloseMinutesBefore * 60_000;
  }
  const sig = running ? endSignature(ctx, n.id) : null;
  return { closeTradingAt, endNight: sig != null && dismissedFor(ctx, n.id, 'endNight') !== sig };
}

export function dismissPrompt(ctx: Ctx, actor: GmAuth, prompt: unknown) {
  void actor;
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  let sig: string | null;
  if (prompt === 'closeTrading') sig = ((v) => (v == null ? null : String(v)))(lastPlannedEnd(ctx, n.id));
  else if (prompt === 'endNight') sig = endSignature(ctx, n.id);
  else throw bad('bad_prompt');
  if (sig != null) ctx.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key(n.id, prompt), sig);
  ctx.bus.refresh(n.id);
  return { ok: true };
}
