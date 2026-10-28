import type { Settings } from './settings';

/** Wall-clock pause spans in ms. `end` null = still paused. */
export interface PauseSpan {
  start: number;
  end: number | null;
}

/**
 * Night clock (locked #3): wall time since the night went live, minus paused time.
 * All quarter/lockout/kingfall timing runs on this clock.
 */
export function nightClockMs(startedAt: number, now: number, pauses: PauseSpan[]): number {
  let paused = 0;
  for (const p of pauses) {
    const s = Math.max(p.start, startedAt);
    const e = Math.min(p.end ?? now, now);
    if (e > s) paused += e - s;
  }
  return Math.max(0, now - startedAt - paused);
}

export interface Quarter {
  /** 1-based. */
  n: number;
  startMin: number;
  endMin: number;
  /** Vote window closes here (clamped to the quarter end). */
  windowEndMin: number;
}

/**
 * Locked #7: bufferFrac of night length at each end; the middle is split evenly into quarterCount quarters.
 * Night length is editable live; recompute whenever it changes.
 */
export function quarterSchedule(lengthMinutes: number, votes: Settings['votes']): Quarter[] {
  const buffer = lengthMinutes * votes.bufferFrac;
  const span = lengthMinutes - 2 * buffer;
  const q = span / votes.quarterCount;
  const out: Quarter[] = [];
  for (let i = 0; i < votes.quarterCount; i++) {
    const startMin = buffer + i * q;
    const endMin = buffer + (i + 1) * q;
    out.push({ n: i + 1, startMin, endMin, windowEndMin: Math.min(endMin, startMin + votes.windowMinutes) });
  }
  return out;
}

/** Quarter boundaries in night-clock minutes (a stored plan after the night length changed mid-night). */
export type QuarterSpan = { startMin: number; endMin: number };

/** Builds quarters from stored spans, recomputing each vote window from the current settings. */
export function quartersFromPlan(plan: QuarterSpan[], votes: Settings['votes']): Quarter[] {
  return plan.map((q, i) => ({ n: i + 1, startMin: q.startMin, endMin: q.endMin, windowEndMin: Math.min(q.endMin, q.startMin + votes.windowMinutes) }));
}

/**
 * The night length changed at `nowMin`: quarters that have started keep their times; the quarters still to come are
 * spread evenly from the end of the last started quarter to the new end buffer. Returns null if they no longer fit
 * (each must still hold a full poll window). Before Q1 starts, returns the plain schedule for the new length.
 */
export function respreadQuarters(current: Quarter[], nowMin: number, newLength: number, votes: Settings['votes']): QuarterSpan[] | null {
  const started = current.filter((q) => q.startMin <= nowMin);
  if (!started.length) {
    const fresh = quarterSchedule(newLength, votes);
    return fresh.every((q) => q.endMin - q.startMin >= votes.windowMinutes && q.startMin >= nowMin) ? fresh.map(({ startMin, endMin }) => ({ startMin, endMin })) : null;
  }
  const keep = started.map(({ startMin, endMin }) => ({ startMin, endMin }));
  const future = current.length - started.length;
  if (!future) return keep;
  const from = Math.max(keep[keep.length - 1]!.endMin, nowMin);
  const to = newLength - newLength * votes.bufferFrac;
  const each = (to - from) / future;
  if (!(each >= votes.windowMinutes)) return null;
  for (let i = 0; i < future; i++) keep.push({ startMin: from + i * each, endMin: from + (i + 1) * each });
  return keep;
}

export type QuarterPhase = 'pre' | 'window' | 'drift' | 'post';

export interface QuarterPosition {
  quarter: Quarter | null;
  /** pre = before Q1, window = vote open, drift = window closed (hidden drift active), post = after the last quarter. */
  phase: QuarterPhase;
}

export function quarterAt(schedule: Quarter[], nightMin: number): QuarterPosition {
  if (schedule.length === 0 || nightMin < schedule[0]!.startMin) return { quarter: null, phase: 'pre' };
  for (const q of schedule) {
    if (nightMin >= q.startMin && nightMin < q.endMin) return { quarter: q, phase: nightMin < q.windowEndMin ? 'window' : 'drift' };
  }
  return { quarter: null, phase: 'post' };
}

/** When to show the "Close trading?" prompt (night-clock minutes). */
export function tradingClosePromptAt(lastGamePlannedEndMin: number, settings: Settings): number {
  return Math.max(0, lastGamePlannedEndMin - settings.prompts.tradingCloseMinutesBefore);
}
