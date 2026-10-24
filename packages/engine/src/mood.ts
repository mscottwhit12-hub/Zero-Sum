import type { Settings } from './settings';

export interface MoodReading {
  playerId: string;
  /** 1 gloomy … 5 cheery */
  mood: number;
  /** 1 … 5: how well the player seems to feel they're doing */
  selfAssessment: number;
  /** Tick number when recorded. */
  tick: number;
}

/** Centered average of both ratings, in [−1, 1]. 3/3 → 0. */
export function centeredMood(mood: number, selfAssessment: number): number {
  const c = (v: number) => (Math.min(5, Math.max(1, v)) - 3) / 2;
  return (c(mood) + c(selfAssessment)) / 2;
}

/** mood_bias in band units, decaying toward 0 each tick since the reading. */
export function moodBias(reading: MoodReading | undefined, currentTick: number, settings: Settings): number {
  if (!reading) return 0;
  const age = Math.max(0, currentTick - reading.tick);
  return settings.mood.moodMax * centeredMood(reading.mood, reading.selfAssessment) * Math.pow(1 - settings.mood.decayPerTick, age);
}

/** Latest reading per player → bias map. */
export function moodBiasMap(readings: MoodReading[], currentTick: number, settings: Settings): Map<string, number> {
  const latest = new Map<string, MoodReading>();
  for (const r of readings) {
    const prev = latest.get(r.playerId);
    if (!prev || r.tick >= prev.tick) latest.set(r.playerId, r);
  }
  const out = new Map<string, number>();
  for (const [id, r] of latest) out.set(id, moodBias(r, currentTick, settings));
  return out;
}
