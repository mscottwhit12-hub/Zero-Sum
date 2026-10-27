/**
 * TEST ONLY. `ZS_TIME_SCALE=60` makes the server clock run 60× faster than real time, so an
 * 8-hour night plays in 8 minutes. Everything driven by ctx.now() scales together: market ticks,
 * lockouts, vote windows, quarters, pauses, espionage reveals, minter accrual, finale timing.
 * Not a GM setting and not shown anywhere in the app. Never use it with a real night's database:
 * it stamps future times, and restarting without it makes the clock jump backwards.
 * Client-side countdowns and animations still run at real speed.
 */
export function parseTimeScale(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 1;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 1 || v > 1000) throw new Error(`ZS_TIME_SCALE must be a number from 1 to 1000 (got "${raw}")`);
  return v;
}

/** A clock anchored at `anchor` (real ms) that advances `scale`× faster than `real`. */
export function scaledClock(scale: number, real: () => number = Date.now, anchor = real()): () => number {
  if (scale === 1) return real;
  return () => anchor + Math.round((real() - anchor) * scale);
}

/** Tick-loop period: one game-second per step, but never faster than every 50 real ms. */
export const loopIntervalMs = (scale: number) => Math.max(50, Math.round(1000 / scale));
