/**
 * Sound packs: a zip with a manifest.json and the audio files, imported once by the Master (like the game packs).
 * Packs keep licensed audio out of the public repo and carry each track's tags and credit text.
 *
 *   manifest.json: { "name": "Ambient pack", "tracks": [
 *     { "file": "a.mp3", "name": "Vanilla Sky", "kind": "ambient", "tags": ["ambient","soundscape"],
 *       "credit": "Song: Vanilla Sky. Music provided and produced by LonePeakMusic",
 *       "source": "https://…", "license": "Free with credit" } ] }
 * `kind` defaults to ambient; a cue track names its cue in `cue`. Files are identified by their bytes, never their names.
 * Everything is checked before anything is written; a track already present (same name and kind) is skipped, so
 * importing the same pack twice is harmless.
 */
import { bad, type Ctx } from '../context';
import { audit } from './audit';
import { masterOnly, type GmAuth } from './gm';
import { MAX_SOUND_BYTES, SOUND_MAX_MB, cleanSound, sniffAudio, storeSound, type NewSound } from './sounds';
import { currentNight } from './state';
import { zipIndex, type ZipFile } from './zip';

/** Largest pack zip accepted (MB). A pack is held in memory while it is read. */
export const PACK_MAX_MB = 200;
const MAX_TRACKS = 200;
const MANIFEST_MAX_BYTES = 1024 * 1024;

const ZIP_ERRORS: Record<string, string> = {
  not_a_zip: 'That is not a zip file.',
  zip_unsupported: 'That zip uses a feature this server can’t read (encryption or ZIP64). Re-zip it normally.',
  zip_too_many_files: 'That zip has too many files.',
  zip_entry_too_large: `A file inside is larger than ${SOUND_MAX_MB} MB.`,
  zip_corrupt: 'That zip is damaged.',
};
const zipMsg = (e: unknown) => ZIP_ERRORS[(e as Error).message] ?? 'That zip could not be read.';

export interface PackResult {
  pack: string;
  added: number;
  skipped: string[];
}

export function importSoundPack(ctx: Ctx, actor: GmAuth, body: unknown): PackResult {
  masterOnly(actor);
  if (!Buffer.isBuffer(body) || !body.length) throw bad('bad_pack', 'Choose a sound pack (a .zip file).');
  if (body.length > PACK_MAX_MB * 1024 * 1024) throw bad('bad_pack', `A sound pack can be up to ${PACK_MAX_MB} MB.`);
  let index: ZipFile[];
  try {
    index = zipIndex(body, { maxEntries: MAX_TRACKS * 2 + 10, maxEntryBytes: MAX_SOUND_BYTES + 1024 * 1024 });
  } catch (e) {
    throw bad('bad_pack', zipMsg(e));
  }
  const files = new Map(index.filter((e) => !e.name.startsWith('__MACOSX/')).map((e) => [e.name.replace(/\\/g, '/'), e]));
  const manKey = [...files.keys()].find((k) => /^([^/]+\/)?manifest\.json$/i.test(k));
  if (!manKey) throw bad('bad_pack', 'The pack needs a manifest.json at its top level.');
  const manFile = files.get(manKey)!;
  if (manFile.size > MANIFEST_MAX_BYTES) throw bad('bad_pack', 'manifest.json is too large.');
  const base = manKey.slice(0, manKey.length - 'manifest.json'.length);
  let man: { name?: unknown; tracks?: unknown };
  try {
    man = JSON.parse(manFile.read().toString('utf8')) as typeof man;
  } catch (e) {
    throw bad('bad_pack', (e as Error).message.startsWith('zip_') ? zipMsg(e) : 'manifest.json is not valid JSON.');
  }
  const list = Array.isArray(man?.tracks) ? (man.tracks as Record<string, unknown>[]) : [];
  if (!list.length) throw bad('bad_pack', 'manifest.json needs a non-empty "tracks" list.');
  if (list.length > MAX_TRACKS) throw bad('bad_pack', `A pack can hold up to ${MAX_TRACKS} tracks.`);

  // Pass 1: check everything, one file at a time (memory stays at the zip plus one track). Nothing is written yet.
  const plan: { meta: NewSound; file: ZipFile }[] = [];
  const problems: string[] = [];
  let audioBytes = 0;
  for (const [i, t] of list.entries()) {
    const item = t && typeof t === 'object' ? t : {};
    const fileName = typeof item.file === 'string' ? item.file.replace(/\\/g, '/') : '';
    const label = typeof item.name === 'string' && item.name ? item.name : fileName || `track ${i + 1}`;
    const zf = fileName ? files.get(base + fileName) : undefined;
    if (!zf) {
      problems.push(`${label}: “${fileName}” is not in the zip.`);
      continue;
    }
    let meta: NewSound;
    try {
      meta = cleanSound({ name: item.name ?? fileName.replace(/^.*\//, '').replace(/\.[^.]+$/, ''), kind: item.kind ?? 'ambient', theme: item.cue ?? item.theme, tags: item.tags, credit: item.credit, sourceUrl: item.source, license: item.license });
    } catch (e) {
      problems.push(`${label}: ${(e as Error).message}`);
      continue;
    }
    if (zf.size > MAX_SOUND_BYTES) {
      problems.push(`${label}: larger than ${SOUND_MAX_MB} MB.`);
      continue;
    }
    audioBytes += zf.size;
    try {
      if (!sniffAudio(zf.read())) problems.push(`${label}: not a valid audio file.`);
      else plan.push({ meta, file: zf });
    } catch (e) {
      problems.push(`${label}: ${zipMsg(e)}`);
    }
  }
  if (audioBytes > PACK_MAX_MB * 1024 * 1024) problems.push(`The audio adds up to more than ${PACK_MAX_MB} MB.`);
  if (problems.length) throw bad('bad_pack', `Nothing was imported. ${problems.slice(0, 5).join(' ')}${problems.length > 5 ? ` (and ${problems.length - 5} more)` : ''}`);

  // Pass 2: store, one file at a time. A track already present (same name and kind) is skipped.
  const skipped: string[] = [];
  let added = 0;
  ctx.db.transaction(() => {
    for (const p of plan) {
      if (ctx.db.prepare('SELECT 1 FROM sound WHERE name = ? COLLATE NOCASE AND kind = ?').get(p.meta.name, p.meta.kind)) {
        skipped.push(p.meta.name);
        continue;
      }
      const bytes = p.file.read();
      const type = sniffAudio(bytes)!;
      storeSound(ctx, p.meta, bytes, type.mime, type.ext);
      added++;
    }
  })();
  const pack = typeof man.name === 'string' && man.name.trim() ? man.name.trim().slice(0, 60) : 'Sound pack';
  audit(ctx, { nightId: null, gmId: actor.gmId, action: 'sound.pack', entity: 'sound', entityId: null, after: { pack, added, skipped } });
  const n = currentNight(ctx);
  if (n) ctx.bus.refresh(n.id);
  return { pack, added, skipped };
}
