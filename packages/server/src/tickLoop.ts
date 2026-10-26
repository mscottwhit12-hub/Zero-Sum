import { quarterAt } from '@gn/engine';
import type { Ctx } from './context';
import { runTick, tradingOpen } from './services/market';
import { computeNightState, currentNight } from './services/state';

/**
 * Checks once a second. Ticks the market every `tickSeconds` (wall clock) while the night is live
 * with trading open, and keeps current_quarter in step with the night clock (pause excluded).
 */
export function startTickLoop(ctx: Ctx, intervalMs = 1000): () => void {
  const step = () => {
    try {
      tickOnce(ctx);
    } catch (e) {
      console.error('tick failed', e);
    }
  };
  const h = setInterval(step, intervalMs);
  return () => clearInterval(h);
}

/** One loop step (exported for tests). Returns true if a market tick ran. */
export function tickOnce(ctx: Ctx): boolean {
  const n = currentNight(ctx);
  if (!n || n.status !== 'live' || !n.started_at) return false;
  const st = computeNightState(ctx, n.id)!;
  const q = quarterAt(st.quarters, st.nightMs / 60_000).quarter?.n ?? null;
  if (q !== n.current_quarter) {
    ctx.db.prepare('UPDATE night SET current_quarter = ? WHERE id = ?').run(q, n.id);
    ctx.bus.all('night:update', { currentQuarter: q });
    ctx.bus.refresh(n.id);
  }
  if (!tradingOpen(n.status, n.trading_closed)) return false;
  const due = (n.last_tick_at ?? n.started_at) + st.settings.market.tickSeconds * 1000;
  if (ctx.now() < due) return false;
  return runTick(ctx, n.id);
}
