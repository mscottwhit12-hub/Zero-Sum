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
