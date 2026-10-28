/**
 * GM prompts (spec §16): never automatic actions, just reminders.
 *  - "Close trading?" from N minutes (prompts.tradingCloseMinutesBefore) before the last
 *    scheduled game's planned end. Dismissible; re-prompts if that planned end changes.
 *  - "End the night?" once the final scheduled game's result is in (nothing scheduled or active).
 *    Dismissible; re-prompts if more games are added.
 *  - "Running over": the night's end has arrived with games still running. Offers to push the night back by a game's
 *    planned length ÷ prompts.overrunDivisor, one game at a time, biggest extension first. "No" moves to the next
 *    game; "yes" extends the night and the cycle starts again at the new end.
 */
import { bad, notFound, type Ctx } from '../context';
import type { GmAuth } from './gm';
import { currentNight, nightMs, nightSettings, type NightRow } from './state';
import { updateNightInfo } from './night';

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

export interface OverrunOffer {
  gameId: number;
  name: string;
  extendMinutes: number;
}

/** Games still running at the night's end, biggest extension first, minus the ones declined at this end time. */
function overrunOffers(ctx: Ctx, n: NightRow): OverrunOffer[] {
  if (n.status !== 'live' && n.status !== 'paused') return [];
  if (nightMs(ctx, n) < n.length_minutes * 60_000) return [];
  const div = nightSettings(n).prompts.overrunDivisor;
  const declined = new Set<number>(JSON.parse(dismissedFor(ctx, n.id, `overrun:${n.length_minutes}`) ?? '[]'));
  return (ctx.db.prepare("SELECT id, name, planned_duration_hours h FROM game WHERE night_id = ? AND status = 'active'").all(n.id) as { id: number; name: string; h: number | null }[])
    .map((g) => ({ gameId: g.id, name: g.name, extendMinutes: Math.max(1, Math.round(((g.h ?? 1) * 60) / div)) }))
    .filter((o) => !declined.has(o.gameId))
    .sort((a, b) => b.extendMinutes - a.extendMinutes || a.gameId - b.gameId);
}

/** Master answers the running-over offer for one game. */
export function answerOverrun(ctx: Ctx, actor: GmAuth, input: { gameId?: unknown; accept?: unknown }) {
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  const offer = overrunOffers(ctx, n).find((o) => o.gameId === Number(input.gameId));
  if (!offer) return { ok: true, lengthMinutes: n.length_minutes }; // already answered (double tap / other GM)
  if (input.accept === true) {
    const after = updateNightInfo(ctx, actor, { lengthMinutes: n.length_minutes + offer.extendMinutes });
    return { ok: true, lengthMinutes: after.length_minutes };
  }
  const k = `overrun:${n.length_minutes}`;
  const declined: number[] = JSON.parse(dismissedFor(ctx, n.id, k) ?? '[]');
  ctx.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key(n.id, k), JSON.stringify([...declined, offer.gameId]));
  ctx.bus.refresh(n.id);
  return { ok: true, lengthMinutes: n.length_minutes };
}

export function promptsView(ctx: Ctx, n: NightRow) {
  const running = n.status === 'live' || n.status === 'paused';
  let closeTradingAt: number | null = null;
  if (running && !n.trading_closed) {
    const end = lastPlannedEnd(ctx, n.id);
    if (end != null && dismissedFor(ctx, n.id, 'closeTrading') !== String(end)) closeTradingAt = end - nightSettings(n).prompts.tradingCloseMinutesBefore * 60_000;
  }
  const sig = running ? endSignature(ctx, n.id) : null;
  return { closeTradingAt, endNight: sig != null && dismissedFor(ctx, n.id, 'endNight') !== sig, overrun: overrunOffers(ctx, n)[0] ?? null };
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
