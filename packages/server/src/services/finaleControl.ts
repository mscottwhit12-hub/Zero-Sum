/**
 * GM control of the TV finale (QoL list): it always plays by itself; a Master GM can step back/forward while it
 * keeps playing, and pause/play. The server owns the finale clock: `start` (ms; elapsed = now − start) and
 * `pausedEl` (seconds, frozen while paused). The TV follows it; phones unlock when the finale really ends
 * (pausing holds them: recap_until moves with the clock).
 */
import { audit } from './audit';
import { conflict, type Ctx } from '../context';
import type { GmAuth } from './gm';
import { masterOnly } from './gm';
import { finale, finaleSeconds, type Finale } from './recap';
import { currentNight, type NightRow } from './state';

export interface FinaleCtl {
  start: number;
  pausedEl: number | null;
}
const ctls = new WeakMap<Ctx, Map<number, FinaleCtl>>();
const book = (ctx: Ctx) => {
  let m = ctls.get(ctx);
  if (!m) ctls.set(ctx, (m = new Map()));
  return m;
};

/** Where each part starts (seconds), for stepping and for the GM's "now showing". */
export function finaleSegments(f: Finale): { at: number; label: string }[] {
  const { collapseSeconds: c, podiumStepSeconds: p, recapSlideSeconds: r } = f.timing;
  return [
    { at: 0, label: 'collapse' },
    { at: c, label: 'place3' },
    { at: c + p, label: 'place2' },
    { at: c + 2 * p, label: 'place1' },
    ...f.slides.map((s, i) => ({ at: c + 3 * p + i * r, label: `slide:${s.id}` })),
  ];
}

/** The finale clock now (derived from recap_until when nobody has touched it). */
export function finaleCtl(ctx: Ctx, n: NightRow): FinaleCtl | null {
  if (n.status !== 'ended') return null;
  const own = book(ctx).get(n.id);
  if (own) return own;
  const total = finaleSeconds(finale(ctx, n.id)) * 1000;
  return { start: (n.recap_until ?? ctx.now()) - total, pausedEl: null };
}

/** Replay restarts the clock. */
export function restartFinaleCtl(ctx: Ctx, nightId: number) {
  book(ctx).set(nightId, { start: ctx.now(), pausedEl: null });
}

export function controlFinale(ctx: Ctx, actor: GmAuth, action: unknown) {
  masterOnly(actor);
  const n = currentNight(ctx);
  if (!n) throw conflict('no_night');
  if (n.status !== 'ended') throw conflict('night_not_ended');
  const f = finale(ctx, n.id);
  const total = finaleSeconds(f);
  const now = ctx.now();
  const c = { ...finaleCtl(ctx, n)! };
  const el = Math.min(total, c.pausedEl ?? (now - c.start) / 1000);
  const marks = finaleSegments(f).map((s) => s.at);
  let target: number | null = null;
  if (action === 'next') target = marks.find((m) => m > el + 0.5) ?? total;
  else if (action === 'prev') target = [...marks].reverse().find((m) => m < el - 1.5) ?? 0;
  else if (action === 'pause') c.pausedEl = el;
  else if (action === 'play') {
    if (c.pausedEl != null) c.start = now - c.pausedEl * 1000;
    c.pausedEl = null;
  } else throw conflict('bad_action', 'Use next, prev, pause or play.');
  if (target != null) {
    if (c.pausedEl != null) c.pausedEl = target;
    else c.start = now - target * 1000;
  }
  book(ctx).set(n.id, c);
  // Phones unlock when the finale ends on this clock (held while paused).
  if (!n.recap_done) {
    const until = c.pausedEl != null ? now + 6 * 3600_000 : c.start + total * 1000;
    ctx.db.prepare('UPDATE night SET recap_until = ? WHERE id = ?').run(Math.max(now, until), n.id);
  }
  ctx.bus.tv('finale:ctl', c);
  ctx.bus.refresh(n.id);
  audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'finale.control', entity: 'night', entityId: n.id, after: { action } });
  return { ok: true, ctl: c };
}
