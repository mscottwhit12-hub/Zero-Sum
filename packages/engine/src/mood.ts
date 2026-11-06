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

/**
 * The two GM ratings (QoL list, mood rework):
 *  - GM reported mood (1 most upset … 5 calm): how much the stock jitters (see moodJitter).
 *  - Reported mood (1 thinks they're losing … 5 winning): the price push (see moodBias), up to ± moodMax band units.
 */
const clamp15 = (v: number) => Math.min(5, Math.max(1, v));

/** Reported mood centred to [−1, 1]: 3 → 0. Only the self-assessment sets the push now. */
export function centeredMood(_mood: number, selfAssessment: number): number {
  return (clamp15(selfAssessment) - 3) / 2;
}

const fade = (reading: MoodReading, currentTick: number, settings: Settings) => Math.pow(1 - settings.mood.decayPerTick, Math.max(0, currentTick - reading.tick));

/** mood_bias in band units, decaying toward 0 each tick since the reading. */
export function moodBias(reading: MoodReading | undefined, currentTick: number, settings: Settings): number {
  if (!reading) return 0;
  return settings.mood.moodMax * centeredMood(reading.mood, reading.selfAssessment) * fade(reading, currentTick, settings);
}

/**
 * How far (± gold) a player's stock jitters: the background noise, plus up to jitterMax for GM reported mood 1
 * (steep near 1: 1 → ±3, 2 → ±1.8, 3 → ±0.9, 4 → ±0.45, 5 → background only), fading back to the background after the reading like the push does.
 */
export function moodJitter(reading: MoodReading | undefined, currentTick: number, settings: Settings): number {
  const base = settings.market.noise.base;
  if (!reading) return base;
  const upset = Math.pow((5 - clamp15(reading.mood)) / 4, settings.mood.jitterCurve);
  return base + Math.max(0, settings.mood.jitterMax - base) * upset * fade(reading, currentTick, settings);
}

function latestByPlayer(readings: MoodReading[]) {
  const latest = new Map<string, MoodReading>();
  for (const r of readings) {
    const prev = latest.get(r.playerId);
    if (!prev || r.tick >= prev.tick) latest.set(r.playerId, r);
  }
  return latest;
}

/** Latest reading per player → jitter (± gold) map. Players with no reading are absent (they get the background). */
export function moodJitterMap(readings: MoodReading[], currentTick: number, settings: Settings): Map<string, number> {
  return new Map([...latestByPlayer(readings)].map(([id, r]) => [id, moodJitter(r, currentTick, settings)]));
}

/** Latest reading per player → bias map. */
export function moodBiasMap(readings: MoodReading[], currentTick: number, settings: Settings): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, r] of latestByPlayer(readings)) out.set(id, moodBias(r, currentTick, settings));
  return out;
}
