/**
 * Global game library (persists across nights). Pure data: anyone can share packs as JSON.
 * Format: { format: "game-night-pack/1", name, games: LibraryGameInput[] }.
 */
import { readFileSync } from 'node:fs';
import { bad, conflict, forbidden, notFound, type Ctx } from '../context';
import { audit } from './audit';
import type { GmAuth } from './gm';
import { currentNight } from './state';

/** Library changes show up in the GM view of the current night (schedule form). */
const refresh = (ctx: Ctx) => {
  const n = currentNight(ctx);
  if (n) ctx.bus.refresh(n.id);
};

export type GameMode = 'competitive' | 'team' | 'coop';

export interface LibraryGame {
  id: number;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  defaultDuration: number;
  mode: GameMode;
  rerollsAllowed: boolean;
  soundTheme: string | null;
  ruleEntryId: number | null;
  icon: string | null;
  color: string | null;
}

export interface LibraryGameInput {
  name: unknown;
  minPlayers?: unknown;
  maxPlayers?: unknown;
  defaultDuration?: unknown;
  mode?: unknown;
  rerollsAllowed?: unknown;
  soundTheme?: unknown;
  ruleEntryId?: unknown;
  icon?: unknown;
  color?: unknown;
}

const PACK_FORMAT = 'game-night-pack/1';

interface Row {
  id: number;
  name: string;
  min_players: number;
  max_players: number;
  default_duration: number;
  mode: GameMode;
  rerolls_allowed: number;
  sound_theme: string | null;
  rule_entry_id: number | null;
  icon: string | null;
  color: string | null;
}

const toGame = (r: Row): LibraryGame => ({
  id: r.id,
  name: r.name,
  minPlayers: r.min_players,
  maxPlayers: r.max_players,
  defaultDuration: r.default_duration,
  mode: r.mode,
  rerollsAllowed: !!r.rerolls_allowed,
  soundTheme: r.sound_theme,
  ruleEntryId: r.rule_entry_id,
  icon: r.icon,
  color: r.color,
});

/** Validates and normalizes one entry. */
export function normalizeGame(input: LibraryGameInput): Omit<LibraryGame, 'id'> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > 60) throw bad('bad_name', 'Name must be 1–60 characters.');
  const minPlayers = Number(input.minPlayers ?? 2);
  const maxPlayers = Number(input.maxPlayers ?? Math.max(minPlayers, 6));
  if (!Number.isInteger(minPlayers) || minPlayers < 1 || minPlayers > 30) throw bad('bad_min_players');
  if (!Number.isInteger(maxPlayers) || maxPlayers < minPlayers || maxPlayers > 30) throw bad('bad_max_players');
  const defaultDuration = Number(input.defaultDuration ?? 1);
  if (!Number.isFinite(defaultDuration) || defaultDuration < 0.1 || defaultDuration > 8) throw bad('bad_duration', 'Duration must be 0.1–8 hours.');
  const mode = (input.mode ?? 'competitive') as GameMode;
  if (!['competitive', 'team', 'coop'].includes(mode)) throw bad('bad_mode');
  const color = typeof input.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : null;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const ruleEntryId = input.ruleEntryId == null || input.ruleEntryId === '' ? null : Number(input.ruleEntryId);
  return {
    name,
    minPlayers,
    maxPlayers,
    defaultDuration: Math.round(defaultDuration * 100) / 100,
    mode,
    rerollsAllowed: !!input.rerollsAllowed,
    soundTheme: str(input.soundTheme, 60),
    ruleEntryId: Number.isInteger(ruleEntryId) ? ruleEntryId : null,
    icon: str(input.icon, 16),
    color,
  };
}

/** Rule links are local ids: drop dangling ones (e.g. from a pack exported on another server). */
const ruleRef = (ctx: Ctx, id: number | null) => (id != null && ctx.db.prepare('SELECT 1 FROM rule_entry WHERE id = ?').get(id) ? id : null);

export function listLibrary(ctx: Ctx): LibraryGame[] {
  return (ctx.db.prepare('SELECT * FROM library_game ORDER BY name').all() as Row[]).map(toGame);
}

export function getLibraryGame(ctx: Ctx, id: number): LibraryGame | null {
  const r = ctx.db.prepare('SELECT * FROM library_game WHERE id = ?').get(id) as Row | undefined;
  return r ? toGame(r) : null;
}

function insert(ctx: Ctx, g: Omit<LibraryGame, 'id'>): number {
  const r = ctx.db
    .prepare(
      'INSERT INTO library_game (name, min_players, max_players, default_duration, mode, rerolls_allowed, sound_theme, rule_entry_id, icon, color) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
    .run(g.name, g.minPlayers, g.maxPlayers, g.defaultDuration, g.mode, g.rerollsAllowed ? 1 : 0, g.soundTheme, ruleRef(ctx, g.ruleEntryId), g.icon, g.color);
  return Number(r.lastInsertRowid);
}

function update(ctx: Ctx, id: number, g: Omit<LibraryGame, 'id'>) {
  ctx.db
    .prepare(
      'UPDATE library_game SET name=?, min_players=?, max_players=?, default_duration=?, mode=?, rerolls_allowed=?, sound_theme=?, rule_entry_id=?, icon=?, color=? WHERE id=?',
    )
    .run(g.name, g.minPlayers, g.maxPlayers, g.defaultDuration, g.mode, g.rerollsAllowed ? 1 : 0, g.soundTheme, ruleRef(ctx, g.ruleEntryId), g.icon, g.color, id);
}

const masterOnly = (a: GmAuth) => {
  if (a.role !== 'master') throw forbidden('master_only');
};

export function createLibraryGame(ctx: Ctx, actor: GmAuth, input: LibraryGameInput): LibraryGame {
  masterOnly(actor);
  const g = normalizeGame(input);
  const created = ctx.db.transaction(() => {
    if (ctx.db.prepare('SELECT 1 FROM library_game WHERE name = ?').get(g.name)) throw conflict('name_taken');
    const id = insert(ctx, g);
    audit(ctx, { nightId: null, gmId: actor.gmId, action: 'library.create', entity: 'library_game', entityId: id, after: g });
    return { id, ...g };
  })();
  refresh(ctx);
  return created;
}

export function updateLibraryGame(ctx: Ctx, actor: GmAuth, id: number, input: LibraryGameInput): LibraryGame {
  masterOnly(actor);
  const before = getLibraryGame(ctx, id);
  if (!before) throw notFound();
  const g = normalizeGame({ ...before, ...input });
  const updated = ctx.db.transaction(() => {
    const clash = ctx.db.prepare('SELECT id FROM library_game WHERE name = ? AND id != ?').get(g.name, id);
    if (clash) throw conflict('name_taken');
    update(ctx, id, g);
    audit(ctx, { nightId: null, gmId: actor.gmId, action: 'library.update', entity: 'library_game', entityId: id, before, after: g });
    return { id, ...g };
  })();
  refresh(ctx);
  return updated;
}

/** Scheduled games keep their own copy (name, mode, duration), so deleting from the library is safe. */
export function deleteLibraryGame(ctx: Ctx, actor: GmAuth, id: number): void {
  masterOnly(actor);
  const before = getLibraryGame(ctx, id);
  if (!before) throw notFound();
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE game SET library_game_id = NULL WHERE library_game_id = ?').run(id);
    ctx.db.prepare('DELETE FROM library_game WHERE id = ?').run(id);
    audit(ctx, { nightId: null, gmId: actor.gmId, action: 'library.delete', entity: 'library_game', entityId: id, before });
  })();
  refresh(ctx);
}

export function exportPack(ctx: Ctx, name = 'My game library') {
  return {
    format: PACK_FORMAT,
    name,
    exportedAt: new Date(ctx.now()).toISOString(),
    games: listLibrary(ctx).map(({ id: _id, ruleEntryId: _r, ...g }) => g),
  };
}

/** Adds new games and updates existing ones with the same name. Validates every entry before writing any. */
export function importPack(ctx: Ctx, actor: GmAuth | null, pack: unknown): { added: number; updated: number } {
  if (actor) masterOnly(actor);
  const p = pack as { format?: unknown; games?: unknown };
  if (!p || typeof p !== 'object' || !Array.isArray(p.games)) throw bad('bad_pack', 'Expected { games: [...] }.');
  if (p.format !== undefined && p.format !== PACK_FORMAT) throw bad('bad_pack_format');
  if (p.games.length > 500) throw bad('pack_too_large');
  const games = (p.games as LibraryGameInput[]).map((g, i) => {
    try {
      return normalizeGame({ ...g, ruleEntryId: null });
    } catch (e) {
      throw bad('bad_pack_entry', `Entry ${i + 1}: ${(e as Error).message}`);
    }
  });
  let added = 0;
  let updated = 0;
  ctx.db.transaction(() => {
    for (const g of games) {
      const existing = ctx.db.prepare('SELECT id, rule_entry_id FROM library_game WHERE name = ?').get(g.name) as { id: number; rule_entry_id: number | null } | undefined;
      if (existing) {
        update(ctx, existing.id, { ...g, ruleEntryId: existing.rule_entry_id });
        updated++;
      } else {
        insert(ctx, g);
        added++;
      }
    }
    audit(ctx, { nightId: null, gmId: actor?.gmId ?? null, action: 'library.import', entity: 'library_game', after: { added, updated } });
  })();
  refresh(ctx);
  return { added, updated };
}

/** First boot only: load the bundled generic examples. Never re-seeds after that (even if the library is emptied). */
export function seedLibraryOnce(ctx: Ctx, packFile: string): boolean {
  if (ctx.db.prepare("SELECT 1 FROM meta WHERE key = 'library_seeded'").get()) return false;
  let pack: unknown;
  try {
    pack = JSON.parse(readFileSync(packFile, 'utf8'));
  } catch {
    return false;
  }
  importPack(ctx, null, pack);
  ctx.db.prepare("INSERT INTO meta (key, value) VALUES ('library_seeded', ?)").run(String(ctx.now()));
  return true;
}
