/**
 * Sound (spec §17.3): per-game theme ambient, cues (final round, intermission, achievement,
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

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES: Record<string, { ext: string; sig: (b: Buffer) => boolean }> = {
  'audio/mpeg': { ext: 'mp3', sig: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) },
  'audio/ogg': { ext: 'ogg', sig: (b) => b.subarray(0, 4).toString('latin1') === 'OggS' },
  'audio/wav': { ext: 'wav', sig: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  'audio/mp4': { ext: 'm4a', sig: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
};
const ALIASES: Record<string, string> = { 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/x-m4a': 'audio/mp4', 'audio/m4a': 'audio/mp4' };

export interface SoundInfo {
  id: number;
  name: string;
  kind: SoundKind;
  /** Ambient: theme name matched against a library game's sound theme. Cue: which cue. */
  theme: string | null;
  url: string;
}

interface Row {
  id: number;
  name: string;
  file_path: string;
  kind: SoundKind;
  theme: string | null;
}

const toInfo = (r: Row): SoundInfo => ({ id: r.id, name: r.name, kind: r.kind, theme: r.theme, url: `/media/sounds/${r.file_path}` });

export function listSounds(ctx: Ctx): SoundInfo[] {
  return (ctx.db.prepare('SELECT * FROM sound ORDER BY kind, name COLLATE NOCASE').all() as Row[]).map(toInfo);
}

const refresh = (ctx: Ctx) => {
  const n = currentNight(ctx);
  if (n) ctx.bus.refresh(n.id);
};

export function uploadSound(ctx: Ctx, actor: GmAuth, input: { name?: unknown; kind?: unknown; theme?: unknown; data?: unknown }) {
  masterOnly(actor);
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 60) : '';
  if (!name) throw bad('bad_name', 'Name the sound.');
  const kind = input.kind as SoundKind;
  if (!['ambient', 'cue', 'soundboard'].includes(kind)) throw bad('bad_kind');
  let theme = typeof input.theme === 'string' && input.theme.trim() ? input.theme.trim().slice(0, 40) : null;
  if (kind === 'cue' && !CUES.includes(theme as Cue)) throw bad('bad_cue', `Cue must be one of: ${CUES.join(', ')}.`);
  if (kind === 'ambient' && !theme) throw bad('bad_theme', 'Ambient sounds need a theme name (matches a library game’s sound theme).');
  if (kind === 'soundboard') theme = null;
  const m = typeof input.data === 'string' ? /^data:(audio\/[\w.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(input.data) : null;
  if (!m) throw bad('bad_audio', 'Upload an MP3, OGG, WAV or M4A file.');
  const mime = ALIASES[m[1]!] ?? m[1]!;
  const type = TYPES[mime];
  if (!type) throw bad('bad_audio', 'Upload an MP3, OGG, WAV or M4A file.');
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length > MAX_BYTES) throw bad('audio_too_large', 'Sound files must be under 8 MB.');
  if (!type.sig(bytes)) throw bad('bad_audio', 'That file is not valid audio.');
  const dir = join(ctx.config.mediaDir, 'sounds');
  mkdirSync(dir, { recursive: true });
  const file = `${randomBytes(12).toString('hex')}.${type.ext}`;
  writeFileSync(join(dir, file), bytes);
  const id = Number(ctx.db.prepare('INSERT INTO sound (name, file_path, kind, theme, mime, created_at) VALUES (?,?,?,?,?,?)').run(name, file, kind, theme, mime, ctx.now()).lastInsertRowid);
  audit(ctx, { nightId: null, gmId: actor.gmId, action: 'sound.upload', entity: 'sound', entityId: id, after: { name, kind, theme } });
  refresh(ctx);
  return toInfo({ id, name, file_path: file, kind, theme });
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
      `SELECT g.id AS game_id, s.* FROM game g
       JOIN library_game l ON l.id = g.library_game_id
       JOIN sound s ON s.kind = 'ambient' AND s.theme = l.sound_theme COLLATE NOCASE
       WHERE g.night_id = ? AND g.status = 'active'
       ORDER BY g.started_at DESC, s.id DESC LIMIT 1`,
    )
    .get(nightId) as (Row & { game_id: number }) | undefined;
  return r ? { url: toInfo(r).url, theme: r.theme!, gameId: r.game_id } : null;
}

export function ambientOff(ctx: Ctx, nightId: number): boolean {
  return !!ctx.db.prepare('SELECT 1 FROM meta WHERE key = ?').get(`ambient_off:${nightId}`);
}
