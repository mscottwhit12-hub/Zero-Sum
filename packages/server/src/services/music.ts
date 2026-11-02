/**
 * Music (tag-driven background tracks on the TV). A track is a sound of kind 'ambient' with tags.
 *  - Manual: the Master picks tags; the pool is every track that has ALL of them.
 *  - Auto: a running game's library sound theme counts as a tag and wins; otherwise the night's state picks a tag
 *    through the rules in the audio settings (e.g. joins open → lobby). A track tagged only "ambient" is never
 *    auto-picked unless a rule points at that tag. No matching track = quiet.
 *  - Off: the same flag as the old "ambient off" button.
 * The TV shuffles the pool itself (no repeats until every track has played), crossfades, ducks under stingers and
 * reports what it is playing back so the GM console can show it. Master-only controls; volume/fades are settings.
 */
import { bad, notFound, type Ctx } from '../context';
import { audit } from './audit';
import { masterOnly, type GmAuth } from './gm';
import { ambientOff, normTags, toInfo, type SoundInfo, type SoundRow } from './sounds';
import { currentNight, type NightState } from './state';

export const RULE_KEYS = ['setup', 'joins_open', 'live', 'final_round', 'paused', 'ended'] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export interface AudioSettings {
  /** Music volume on the TV, 0–100. */
  volume: number;
  /** Seconds to crossfade between tracks (0 = hard cut). */
  crossfadeSeconds: number;
  /** While a stinger or cue plays, music drops to this % of its volume (100 = no ducking, 0 = silent). */
  duckPercent: number;
  /** Seconds for the music to come back up after a stinger. */
  duckReleaseSeconds: number;
  /** Auto mode: night state → the tag to play ('' = quiet). */
  rules: Record<RuleKey, string>;
}

export const AUDIO_DEFAULTS: AudioSettings = {
  volume: 60,
  crossfadeSeconds: 4,
  duckPercent: 25,
  duckReleaseSeconds: 2,
  rules: { setup: '', joins_open: 'lobby', live: 'focus', final_round: 'tense', paused: 'intermission', ended: 'celebration' },
};

const RANGES = {
  volume: [0, 100],
  crossfadeSeconds: [0, 15],
  duckPercent: [0, 100],
  duckReleaseSeconds: [0, 10],
} as const;

const SETTINGS_KEY = 'audio_settings';

/** Never throws: anything unreadable or out of range in the stored settings falls back to its default. */
export function getAudioSettings(ctx: Ctx): AudioSettings {
  let saved: unknown = {};
  try {
    const row = ctx.db.prepare('SELECT value FROM meta WHERE key = ?').get(SETTINGS_KEY) as { value: string } | undefined;
    saved = row ? JSON.parse(row.value) : {};
  } catch {
    saved = {};
  }
  const o = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  const num = (k: keyof typeof RANGES): number => {
    const v = o[k];
    const [lo, hi] = RANGES[k];
    return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : AUDIO_DEFAULTS[k];
  };
  const r = o.rules && typeof o.rules === 'object' && !Array.isArray(o.rules) ? (o.rules as Record<string, unknown>) : {};
  const rules = { ...AUDIO_DEFAULTS.rules };
  for (const k of RULE_KEYS) if (typeof r[k] === 'string') rules[k] = normTags(r[k])[0] ?? '';
  return { volume: num('volume'), crossfadeSeconds: num('crossfadeSeconds'), duckPercent: num('duckPercent'), duckReleaseSeconds: num('duckReleaseSeconds'), rules };
}

/** Master changes the audio settings. Only the fields sent change; every number is range-checked. */
export function setAudioSettings(ctx: Ctx, actor: GmAuth, input: Partial<Record<keyof typeof RANGES, unknown>> & { rules?: unknown }): AudioSettings {
  masterOnly(actor);
  const cur = getAudioSettings(ctx);
  const next: AudioSettings = { ...cur, rules: { ...cur.rules } };
  for (const k of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    if (input[k] === undefined) continue;
    const v = Number(input[k]);
    const [lo, hi] = RANGES[k];
    if (!Number.isFinite(v) || v < lo || v > hi) throw bad('bad_audio_setting', `${k} must be ${lo}–${hi}.`);
    next[k] = Math.round(v * 10) / 10;
  }
  if (input.rules !== undefined) {
    if (typeof input.rules !== 'object' || input.rules === null) throw bad('bad_audio_setting', 'rules must be an object.');
    for (const k of RULE_KEYS) {
      const v = (input.rules as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (typeof v !== 'string') throw bad('bad_audio_setting', `The rule for ${k} must be a tag.`);
      const tags = normTags(v);
      if (tags.length > 1) throw bad('bad_audio_setting', `The rule for ${k} takes one tag, not a list.`);
      next.rules[k] = tags[0] ?? '';
    }
  }
  ctx.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(SETTINGS_KEY, JSON.stringify(next));
  audit(ctx, { nightId: null, gmId: actor.gmId, action: 'audio.settings', entity: 'audio', entityId: null, before: cur, after: next });
  const n = currentNight(ctx);
  if (n) ctx.bus.refresh(n.id);
  return next;
}

interface MusicState {
  /** null = Auto. */
  tags: string[] | null;
  repeat: boolean;
  /** Bumped by Skip; the TV moves to the next track when it changes. */
  skip: number;
}
const stateKey = (nightId: number) => `music_state:${nightId}`;

function getState(ctx: Ctx, nightId: number): MusicState {
  const row = ctx.db.prepare('SELECT value FROM meta WHERE key = ?').get(stateKey(nightId)) as { value: string } | undefined;
  try {
    const v = row ? (JSON.parse(row.value) as Partial<MusicState>) : {};
    return { tags: Array.isArray(v.tags) ? v.tags.filter((x): x is string => typeof x === 'string') : null, repeat: !!v.repeat, skip: Number(v.skip) || 0 };
  } catch {
    return { tags: null, repeat: false, skip: 0 };
  }
}
const putState = (ctx: Ctx, nightId: number, s: MusicState) => ctx.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(stateKey(nightId), JSON.stringify(s));

function setOff(ctx: Ctx, nightId: number, off: boolean) {
  const key = `ambient_off:${nightId}`;
  if (off) ctx.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, '1');
  else ctx.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
}

/** Tracks that have ALL of the wanted tags. No tags wanted = nothing. */
export function matchTracks<T extends { tags: string[] }>(tracks: T[], wanted: string[]): T[] {
  if (!wanted.length) return [];
  return tracks.filter((t) => wanted.every((w) => t.tags.includes(w)));
}

export function musicTracks(ctx: Ctx): SoundInfo[] {
  return (ctx.db.prepare("SELECT * FROM sound WHERE kind = 'ambient' ORDER BY name COLLATE NOCASE").all() as SoundRow[]).map(toInfo);
}

/** Which rule applies to the night right now (the final quarter of a live night is its own state). */
export function ruleKeyFor(st: Pick<NightState, 'night' | 'quarters'>): RuleKey | null {
  switch (st.night.status) {
    case 'setup':
      return 'setup';
    case 'joins_open':
      return 'joins_open';
    case 'paused':
      return 'paused';
    case 'ended':
    case 'archived':
      return 'ended';
    case 'live': {
      const last = st.quarters[st.quarters.length - 1];
      return last && st.night.current_quarter === last.n ? 'final_round' : 'live';
    }
    default:
      return null;
  }
}

/** Sound themes of the games running now, newest first, as tags. */
function activeGameTags(ctx: Ctx, nightId: number): string[] {
  const rows = ctx.db
    .prepare(
      `SELECT l.sound_theme AS t FROM game g JOIN library_game l ON l.id = g.library_game_id
       WHERE g.night_id = ? AND g.status = 'active' AND l.sound_theme IS NOT NULL AND l.sound_theme <> ''
       ORDER BY g.started_at DESC, g.id DESC`,
    )
    .all(nightId) as { t: string }[];
  const out: string[] = [];
  for (const r of rows) for (const t of normTags([r.t])) if (!out.includes(t)) out.push(t);
  return out;
}

export interface ResolvedMusic {
  mode: 'off' | 'auto' | 'manual';
  source: 'off' | 'manual' | 'game' | 'rule' | 'none';
  /** The tag (or "a + b" for several) being played, for display. */
  tag: string | null;
  tags: string[];
  tracks: SoundInfo[];
}

export function resolveMusic(ctx: Ctx, st: Pick<NightState, 'night' | 'quarters'>): ResolvedMusic {
  const nightId = st.night.id;
  if (ambientOff(ctx, nightId)) return { mode: 'off', source: 'off', tag: null, tags: [], tracks: [] };
  const all = musicTracks(ctx);
  const ms = getState(ctx, nightId);
  if (ms.tags && ms.tags.length) {
    const tracks = matchTracks(all, ms.tags);
    return { mode: 'manual', source: tracks.length ? 'manual' : 'none', tag: ms.tags.join(' + '), tags: ms.tags, tracks };
  }
  if (st.night.status === 'live') {
    for (const tag of activeGameTags(ctx, nightId)) {
      const tracks = matchTracks(all, [tag]);
      if (tracks.length) return { mode: 'auto', source: 'game', tag, tags: [tag], tracks };
    }
  }
  const rk = ruleKeyFor(st);
  const tag = rk ? getAudioSettings(ctx).rules[rk] : '';
  if (!tag) return { mode: 'auto', source: 'none', tag: null, tags: [], tracks: [] };
  const tracks = matchTracks(all, [tag]);
  return { mode: 'auto', source: tracks.length ? 'rule' : 'none', tag, tags: [tag], tracks };
}

const reported = new Set<string>();
/** Music is optional: if building its payload ever fails, log it once and send a quiet default instead of breaking the broadcast (market, scores...). */
function safely<T>(what: string, build: () => T, fallback: () => T): T {
  try {
    return build();
  } catch (e) {
    const msg = `${what}: ${(e as Error).message}`;
    if (!reported.has(msg)) {
      reported.add(msg);
      console.error(`[music] ${msg}`);
    }
    return fallback();
  }
}

/** What the TV plays. `key` changes when the pool changes (the TV crossfades); `skip` changes on Skip. */
export function musicForTv(ctx: Ctx, st: NightState) {
  return safely(
    'tv payload',
    () => buildTv(ctx, st),
    () => ({ key: 'error|', source: 'none' as const, tag: null as string | null, tracks: [] as { id: number; name: string; url: string }[], repeat: false, skip: 0, volume: AUDIO_DEFAULTS.volume / 100, crossfadeMs: AUDIO_DEFAULTS.crossfadeSeconds * 1000, duckLevel: AUDIO_DEFAULTS.duckPercent / 100, duckReleaseMs: AUDIO_DEFAULTS.duckReleaseSeconds * 1000 }),
  );
}

function buildTv(ctx: Ctx, st: NightState) {
  const r = resolveMusic(ctx, st);
  const a = getAudioSettings(ctx);
  const ms = getState(ctx, st.night.id);
  return {
    key: `${r.source}|${r.tags.join('+')}`,
    source: r.source,
    tag: r.tag,
    tracks: r.tracks.map((t) => ({ id: t.id, name: t.name, url: t.url })),
    repeat: ms.repeat,
    skip: ms.skip,
    volume: a.volume / 100,
    crossfadeMs: Math.round(a.crossfadeSeconds * 1000),
    duckLevel: a.duckPercent / 100,
    duckReleaseMs: Math.round(a.duckReleaseSeconds * 1000),
  };
}

// What the TV last said it is playing, per night (memory only; the TV re-reports on load). Keyed by db so tests stay isolated.
const NOW = new WeakMap<object, Map<number, number | null>>();

/** The TV reports the track it just started (or null when it stopped). */
export function setNowPlaying(ctx: Ctx, trackId: unknown): void {
  const n = currentNight(ctx);
  if (!n) return;
  const id = typeof trackId === 'number' && Number.isInteger(trackId) ? trackId : null;
  if (id !== null && !ctx.db.prepare("SELECT 1 FROM sound WHERE id = ? AND kind = 'ambient'").get(id)) return;
  let m = NOW.get(ctx.db);
  if (!m) NOW.set(ctx.db, (m = new Map()));
  if (m.get(n.id) === id) return;
  m.set(n.id, id);
  ctx.bus.refresh(n.id);
}

/** GM console: the mode, the manual tags, what is resolved and what the TV says is playing. */
export function musicForGm(ctx: Ctx, st: NightState) {
  return safely(
    'gm payload',
    () => buildGm(ctx, st),
    () => ({ mode: 'auto' as 'off' | 'auto' | 'manual', tags: [] as string[], repeat: false, source: 'none' as ResolvedMusic['source'], tag: null as string | null, matching: 0, now: null as { id: number; name: string; tags: string[] } | null }),
  );
}

function buildGm(ctx: Ctx, st: NightState) {
  const r = resolveMusic(ctx, st);
  const ms = getState(ctx, st.night.id);
  const nowId = NOW.get(ctx.db)?.get(st.night.id) ?? null;
  const now = nowId !== null ? r.tracks.find((t) => t.id === nowId) : undefined;
  return {
    mode: r.mode,
    tags: ms.tags ?? [],
    repeat: ms.repeat,
    source: r.source,
    tag: r.tag,
    matching: r.tracks.length,
    now: now ? { id: now.id, name: now.name, tags: now.tags } : null,
  };
}

/** Master: Auto, Manual (tags), Off, Repeat, Skip. Any of them can be sent alone. */
export function musicAction(ctx: Ctx, actor: GmAuth, input: { mode?: unknown; tags?: unknown; repeat?: unknown; skip?: unknown }) {
  masterOnly(actor);
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  const ms = getState(ctx, n.id);
  const before = { off: ambientOff(ctx, n.id), tags: ms.tags, repeat: ms.repeat };
  if (input.mode !== undefined) {
    if (input.mode === 'off') setOff(ctx, n.id, true);
    else if (input.mode === 'auto') {
      setOff(ctx, n.id, false);
      ms.tags = null;
    } else if (input.mode === 'manual') {
      const tags = normTags(input.tags);
      if (!tags.length) throw bad('bad_tags', 'Pick at least one tag.');
      if (!matchTracks(musicTracks(ctx), tags).length) throw bad('no_tracks_match', 'No track has all of those tags.');
      setOff(ctx, n.id, false);
      ms.tags = tags;
    } else throw bad('bad_music_mode', 'Music mode must be auto, manual or off.');
  }
  if (input.repeat !== undefined) {
    if (typeof input.repeat !== 'boolean') throw bad('bad_music_repeat', 'Repeat must be on or off.');
    ms.repeat = input.repeat;
  }
  if (input.skip === true) ms.skip += 1;
  putState(ctx, n.id, ms);
  audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'music.set', entity: 'music', entityId: null, before, after: { off: ambientOff(ctx, n.id), tags: ms.tags, repeat: ms.repeat, skip: input.skip === true } });
  ctx.bus.refresh(n.id);
  return { ok: true };
}
