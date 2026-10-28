/** One consistent way to describe a game's timing (GM screens, boards, seating plan, TV). */
import { timeOfDay } from './format';
import type { GameInfo } from './types';

export type GameTag = 'filibuster' | 'tardy' | null;

const dur = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m} min`;
};
const plannedMs = (g: GameInfo) => (g.plannedDurationHours ?? 0) * 3_600_000;

/** Running past its planned length → "filibuster"; scheduled and past its start time → "tardy". */
export function gameTag(g: GameInfo, now: number): GameTag {
  if (g.status === 'active' && g.startedAt && g.plannedDurationHours && now - g.startedAt > plannedMs(g)) return 'filibuster';
  if (g.status === 'scheduled' && g.plannedStart != null && now > g.plannedStart + 60_000) return 'tardy';
  return null;
}

/** Planned end (epoch ms) for a running or scheduled game. */
export function plannedEnd(g: GameInfo): number | null {
  if (!g.plannedDurationHours) return null;
  if (g.status === 'active' && g.startedAt) return g.startedAt + plannedMs(g);
  if (g.plannedStart != null) return g.plannedStart + plannedMs(g);
  return null;
}

/** Full line, e.g. "Started 8:05 PM · 1:12 in · ends ~9:35 PM" / "Starts 9:00 PM · in 23 min". */
export function gameClock(g: GameInfo, now: number): string {
  const end = plannedEnd(g);
  if (g.status === 'active' && g.startedAt) return [`Started ${timeOfDay(g.startedAt)}`, `${dur(now - g.startedAt)} in`, end ? `ends ~${timeOfDay(end)}` : ''].filter(Boolean).join(' · ');
  if (g.status === 'scheduled') {
    if (g.plannedStart == null) return 'Not scheduled yet';
    if (now > g.plannedStart + 60_000) return `Was due ${timeOfDay(g.plannedStart)} (${dur(now - g.plannedStart)} ago)`;
    return `Starts ${timeOfDay(g.plannedStart)} · in ${dur(g.plannedStart - now)}`;
  }
  if (g.status === 'final' && g.startedAt && g.endedAt) return `${timeOfDay(g.startedAt)}–${timeOfDay(g.endedAt)}`;
  return '';
}

/** Short form for small labels (seating plan, TV): "1:12 in" / "at 9:00 PM". */
export function gameClockShort(g: GameInfo, now: number): string {
  if (g.status === 'active' && g.startedAt) return `${dur(now - g.startedAt)} in`;
  if (g.status === 'scheduled' && g.plannedStart != null) return now > g.plannedStart + 60_000 ? `due ${timeOfDay(g.plannedStart)}` : `at ${timeOfDay(g.plannedStart)}`;
  return '';
}
