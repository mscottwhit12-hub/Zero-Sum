/**
 * Sound (spec §17.3): ambient music tracks (tagged; see music.ts), cues (final round, intermission, achievement,
 * night end, collapse), and a GM soundboard. Everything plays on the TV. Local files only:
 * uploads are stored under MEDIA_DIR/sounds and served from this server. Global (persist across nights).
 * Missing cue files fall back to a synthesized placeholder tone on the TV.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bad, notFound, type Ctx } from '../context';
import { audit } from './audit';
import { masterOnly, type GmAuth } from './gm';
import { currentNight } from './state';

export const CUES = ['final_round', 'intermission', 'achievement', 'night_end', 'collapse'] as const;
export type Cue = (typeof CUES)[number];
export type SoundKind = 'ambient' | 'cue' | 'soundboard';

/** Upload cap (uncompressed WAV and FLAC are big). The route's body limit allows for base64 (+37%). */
export const SOUND_MAX_MB = 30;
const MAX_BYTES = SOUND_MAX_MB * 1024 * 1024;
const TYPES: Record<string, { ext: string; sig: (b: Buffer) => boolean }> = {
  'audio/mpeg': { ext: 'mp3', sig: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) },
  'audio/ogg': { ext: 'ogg', sig: (b) => b.subarray(0, 4).toString('latin1') === 'OggS' },
  'audio/wav': { ext: 'wav', sig: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  'audio/mp4': { ext: 'm4a', sig: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  'audio/flac': { ext: 'flac', sig: (b) => b.subarray(0, 4).toString('latin1') === 'fLaC' || (b.subarray(0, 3).toString('latin1') === 'ID3' && b.includes('fLaC')) },
};
const ALIASES: Record<string, string> = { 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/x-m4a': 'audio/mp4', 'audio/m4a': 'audio/mp4', 'audio/x-flac': 'audio/flac' };

export interface SoundInfo {
  id: number;
  name: string;
  kind: SoundKind;
  /** Ambient: legacy theme name (also kept as a tag). Cue: which cue. */
  theme: string | null;
  /** Lowercase tags. Music tracks (kind 'ambient') are picked by tag; a library game's sound theme counts as a tag. */
  tags: string[];
  /** Attribution text shown in the Credits list (and required by CC-BY style licences). */
  credit: string | null;
  sourceUrl: string | null;
  license: string | null;
  url: string;
}

export interface SoundRow {
  id: number;
  name: string;
  file_path: string;
  kind: SoundKind;
  theme: string | null;
  tags?: string | null;
  credit?: string | null;
  source_url?: string | null;
  license?: string | null;
}
type Row = SoundRow;

export const MAX_TAGS = 12;
export const MAX_TAG_LEN = 24;

/** Lowercase, letters/digits/space/hyphen only, de-duplicated. Accepts an array or a comma-separated string. */
export function normTags(input: unknown): string[] {
  const arr = (Array.isArray(input) ? input : [input]).flatMap((x) => (typeof x === 'string' ? x.split(',') : []));
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x !== 'string') continue;
    const t = x.toLowerCase().replace(/[^\p{L}\p{N} -]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LEN).trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export const toInfo = (r: Row): SoundInfo => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  theme: r.theme,
  tags: parseTags(r.tags),
  credit: r.credit ?? null,
  sourceUrl: r.source_url ?? null,
  license: r.license ?? null,
  url: `/media/sounds/${r.file_path}`,
});

const optText = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
/** Only web links: the Credits list shows this as a link. */
const optUrl = (v: unknown): string | null => {
  const u = optText(v, 300);
  return u && /^https?:\/\/\S+$/i.test(u) ? u : null;
};

export function listSounds(ctx: Ctx): SoundInfo[] {
  return (ctx.db.prepare('SELECT * FROM sound ORDER BY kind, name COLLATE NOCASE').all() as Row[]).map(toInfo);
}

const refresh = (ctx: Ctx) => {
  const n = currentNight(ctx);
  if (n) ctx.bus.refresh(n.id);
};

/** Which audio format these bytes are, by their magic bytes (never by file name). */
export function sniffAudio(bytes: Buffer): { mime: string; ext: string } | null {
  // FLAC first: a FLAC with an ID3 tag also starts like an MP3.
  for (const mime of ['audio/flac', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/mpeg']) {
    const t = TYPES[mime]!;
    if (t.sig(bytes)) return { mime, ext: t.ext };
  }
  return null;
}

export interface NewSound {
  name: string;
  kind: SoundKind;
  theme: string | null;
  tags: string[];
  credit: string | null;
  sourceUrl: string | null;
  license: string | null;
}

/** Validate the descriptive fields shared by single uploads and pack entries. */
export function cleanSound(input: { name?: unknown; kind?: unknown; theme?: unknown; tags?: unknown; credit?: unknown; sourceUrl?: unknown; license?: unknown }): NewSound {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 60) : '';
  if (!name) throw bad('bad_name', 'Name the sound.');
  const kind = input.kind as SoundKind;
  if (!['ambient', 'cue', 'soundboard'].includes(kind)) throw bad('bad_kind', 'Kind must be ambient, cue or soundboard.');
  let theme = typeof input.theme === 'string' && input.theme.trim() ? input.theme.trim().slice(0, 40) : null;
  if (kind === 'cue' && !CUES.includes(theme as Cue)) throw bad('bad_cue', `Cue must be one of: ${CUES.join(', ')}.`);
  if (kind === 'soundboard') theme = null;
  // A legacy ambient theme is also a tag, so a library game's sound theme finds it.
  const tags = normTags(input.tags);
  if (kind === 'ambient' && theme && !tags.includes(theme.toLowerCase())) tags.push(...normTags([theme]).filter((t) => !tags.includes(t)));
  if (kind === 'ambient' && !tags.length) throw bad('bad_tags', 'Music needs at least one tag, like ambient or lobby.');
  if (kind === 'cue') tags.length = 0;
  return { name, kind, theme, tags: tags.slice(0, MAX_TAGS), credit: optText(input.credit, 300), sourceUrl: optUrl(input.sourceUrl), license: optText(input.license, 120) };
}

/** Write the file and add the row. The caller has already checked the bytes. */
export function storeSound(ctx: Ctx, n: NewSound, bytes: Buffer, mime: string, ext: string): SoundInfo {
  const dir = join(ctx.config.mediaDir, 'sounds');
  mkdirSync(dir, { recursive: true });
  const file = `${randomBytes(12).toString('hex')}.${ext}`;
  writeFileSync(join(dir, file), bytes);
  const id = Number(
    ctx.db
      .prepare('INSERT INTO sound (name, file_path, kind, theme, mime, created_at, tags, credit, source_url, license) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(n.name, file, n.kind, n.theme, mime, ctx.now(), n.tags.length ? JSON.stringify(n.tags) : null, n.credit, n.sourceUrl, n.license).lastInsertRowid,
  );
  return toInfo({ id, name: n.name, file_path: file, kind: n.kind, theme: n.theme, tags: n.tags.length ? JSON.stringify(n.tags) : null, credit: n.credit, source_url: n.sourceUrl, license: n.license });
}

export const MAX_SOUND_BYTES = MAX_BYTES;

export function uploadSound(
  ctx: Ctx,
  actor: GmAuth,
  input: { name?: unknown; kind?: unknown; theme?: unknown; tags?: unknown; credit?: unknown; sourceUrl?: unknown; license?: unknown; data?: unknown },
) {
  masterOnly(actor);
  const meta = cleanSound(input);
  const m = typeof input.data === 'string' ? /^data:(audio\/[\w.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(input.data) : null;
  if (!m) throw bad('bad_audio', 'Upload an MP3, OGG, WAV, M4A or FLAC file.');
  const mime = ALIASES[m[1]!] ?? m[1]!;
  const type = TYPES[mime];
  if (!type) throw bad('bad_audio', 'Upload an MP3, OGG, WAV, M4A or FLAC file.');
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length > MAX_BYTES) throw bad('audio_too_large', `Sound files must be under ${SOUND_MAX_MB} MB.`);
  if (!type.sig(bytes)) throw bad('bad_audio', 'That file is not valid audio.');
  const info = storeSound(ctx, meta, bytes, mime, type.ext);
  audit(ctx, { nightId: null, gmId: actor.gmId, action: 'sound.upload', entity: 'sound', entityId: info.id, after: { name: meta.name, kind: meta.kind, theme: meta.theme, tags: meta.tags } });
  refresh(ctx);
  return info;
}

/** Master edits a sound's name, tags and credit after the fact (the audio file itself never changes). */
export function updateSound(ctx: Ctx, actor: GmAuth, id: number, input: { name?: unknown; tags?: unknown; credit?: unknown; sourceUrl?: unknown; license?: unknown }) {
  masterOnly(actor);
  const r = ctx.db.prepare('SELECT * FROM sound WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw notFound('sound_not_found');
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const name = has('name') ? (typeof input.name === 'string' ? input.name.trim().slice(0, 60) : '') : r.name;
  if (!name) throw bad('bad_name', 'Name the sound.');
  let tags = has('tags') ? normTags(input.tags) : parseTags(r.tags);
  if (r.kind === 'ambient' && !tags.length) throw bad('bad_tags', 'Music needs at least one tag, like ambient or lobby.');
  if (r.kind === 'cue') tags = [];
  const credit = has('credit') ? optText(input.credit, 300) : (r.credit ?? null);
  const sourceUrl = has('sourceUrl') ? optUrl(input.sourceUrl) : (r.source_url ?? null);
  const license = has('license') ? optText(input.license, 120) : (r.license ?? null);
  ctx.db.prepare('UPDATE sound SET name = ?, tags = ?, credit = ?, source_url = ?, license = ? WHERE id = ?').run(name, tags.length ? JSON.stringify(tags) : null, credit, sourceUrl, license, id);
  audit(ctx, { nightId: null, gmId: actor.gmId, action: 'sound.update', entity: 'sound', entityId: id, before: { name: r.name, tags: parseTags(r.tags) }, after: { name, tags } });
  refresh(ctx);
  return toInfo({ ...r, name, tags: tags.length ? JSON.stringify(tags) : null, credit, source_url: sourceUrl, license });
}

export function deleteSound(ctx: Ctx, actor: GmAuth, id: number) {
  masterOnly(actor);
  const r = ctx.db.prepare('SELECT * FROM sound WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw notFound('sound_not_found');
  ctx.db.prepare('DELETE FROM sound WHERE id = ?').run(id);
  try {
    unlinkSync(join(ctx.config.mediaDir, 'sounds', r.file_path));
  } catch {
    /* already gone */
  }
  audit(ctx, { nightId: null, gmId: actor.gmId, action: 'sound.delete', entity: 'sound', entityId: id, before: r });
  refresh(ctx);
  return { ok: true };
}

export function soundFileMime(ctx: Ctx, file: string): string | null {
  const r = ctx.db.prepare('SELECT mime FROM sound WHERE file_path = ?').get(file) as { mime: string | null } | undefined;
  return r ? (r.mime ?? 'application/octet-stream') : null;
}

/** Play a cue on the TV: the newest uploaded file for that cue, else the TV's synthesized placeholder. */
export function playCue(ctx: Ctx, cue: Cue) {
  const r = ctx.db.prepare("SELECT * FROM sound WHERE kind = 'cue' AND theme = ? ORDER BY id DESC LIMIT 1").get(cue) as Row | undefined;
  ctx.bus.tv('sound:play', { cue, url: r ? toInfo(r).url : null });
}

/** GM soundboard (any GM): a stored sound, a cue, or stop/resume ambient. */
export function playSound(ctx: Ctx, actor: GmAuth, input: { soundId?: unknown; cue?: unknown; ambient?: unknown }) {
  if (input.cue != null) {
    if (!CUES.includes(input.cue as Cue)) throw bad('bad_cue');
    playCue(ctx, input.cue as Cue);
    return { ok: true };
  }
  if (input.ambient === 'off' || input.ambient === 'on') {
    const n = currentNight(ctx);
    if (!n) throw notFound('no_night');
    const key = `ambient_off:${n.id}`;
    if (input.ambient === 'off') ctx.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, '1');
    else ctx.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
    ctx.bus.refresh(n.id);
    return { ok: true };
  }
  const r = ctx.db.prepare('SELECT * FROM sound WHERE id = ?').get(Number(input.soundId)) as Row | undefined;
  if (!r) throw notFound('sound_not_found');
  ctx.bus.tv('sound:play', { soundId: r.id, url: toInfo(r).url });
  void actor;
  return { ok: true };
}

/**
 * Current ambient loop for the TV: the theme of the most recently started active game that has
 * an uploaded ambient sound, unless the GM switched ambient off for the night.
 */
export function currentAmbient(ctx: Ctx, nightId: number): { url: string; theme: string; gameId: number } | null {
  if (ctx.db.prepare('SELECT 1 FROM meta WHERE key = ?').get(`ambient_off:${nightId}`)) return null;
  const r = ctx.db
    .prepare(
      `SELECT g.id AS game_id, l.sound_theme AS game_theme, s.* FROM game g
       JOIN library_game l ON l.id = g.library_game_id
       JOIN sound s ON s.kind = 'ambient' AND (s.theme = l.sound_theme COLLATE NOCASE
         OR EXISTS (SELECT 1 FROM json_each(COALESCE(s.tags, '[]')) j WHERE j.value = lower(l.sound_theme)))
       WHERE g.night_id = ? AND g.status = 'active'
       ORDER BY g.started_at DESC, s.id DESC LIMIT 1`,
    )
    .get(nightId) as (Row & { game_id: number; game_theme: string }) | undefined;
  return r ? { url: toInfo(r).url, theme: r.theme ?? r.game_theme, gameId: r.game_id } : null;
}

export function ambientOff(ctx: Ctx, nightId: number): boolean {
  return !!ctx.db.prepare('SELECT 1 FROM meta WHERE key = ?').get(`ambient_off:${nightId}`);
}

/**
 * Parse an HTTP Range header for a file of `size` bytes. Returns null when there is no (usable) single range, so the
 * whole file is served; 'invalid' when the range cannot be satisfied (416). Audio elements (Safari insists) use
 * ranges to start playing, seek and loop without downloading the whole track again.
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // "-N": the last N bytes
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || start > end) return 'invalid';
  return { start, end };
}
