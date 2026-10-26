/**
 * Rulebook (spec §17.3): searchable; per-game GM-written summaries, links to PDFs the host owns,
 * and house rules. Global (persists across nights). Never copy official rulebooks.
 * game_name null = house rule.
 */
import { readFileSync } from 'node:fs';
import { bad, notFound, type Ctx } from '../context';
import { audit } from './audit';
import { masterOnly, type GmAuth } from './gm';

export interface RuleEntry {
  id: number;
  gameName: string | null;
  title: string;
  body: string;
  link: string | null;
  updatedAt: number;
  /** Library games that point at this entry. */
  games: { id: number; name: string }[];
}

interface Row {
  id: number;
  game_name: string | null;
  title: string;
  body_markdown: string;
  link: string | null;
  updated_at: number;
}

export function listRules(ctx: Ctx): RuleEntry[] {
  const links = ctx.db.prepare('SELECT id, name, rule_entry_id FROM library_game WHERE rule_entry_id IS NOT NULL').all() as { id: number; name: string; rule_entry_id: number }[];
  return (ctx.db.prepare('SELECT * FROM rule_entry ORDER BY game_name IS NOT NULL, CASE WHEN game_name IS NULL THEN id END, game_name COLLATE NOCASE, title COLLATE NOCASE').all() as Row[]).map((r) => ({
    id: r.id,
    gameName: r.game_name,
    title: r.title,
    body: r.body_markdown,
    link: r.link,
    updatedAt: r.updated_at,
    games: links.filter((l) => l.rule_entry_id === r.id).map((l) => ({ id: l.id, name: l.name })),
  }));
}

function clean(input: { gameName?: unknown; title?: unknown; body?: unknown; link?: unknown }) {
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 120) : '';
  if (!title) throw bad('empty_title', 'Give the entry a title.');
  const body = typeof input.body === 'string' ? input.body.slice(0, 20_000) : '';
  const gameName = typeof input.gameName === 'string' && input.gameName.trim() ? input.gameName.trim().slice(0, 80) : null;
  let link: string | null = typeof input.link === 'string' && input.link.trim() ? input.link.trim() : null;
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) throw bad('bad_link', 'Links must start with http:// or https://');
  if (link) link = link.slice(0, 500);
  return { title, body, gameName, link };
}

const changed = (ctx: Ctx) => ctx.bus.all('rules:update', {});

export function createRule(ctx: Ctx, actor: GmAuth | null, input: Parameters<typeof clean>[0]) {
  if (actor) masterOnly(actor);
  const r = clean(input);
  const id = Number(
    ctx.db.prepare('INSERT INTO rule_entry (game_name, title, body_markdown, link, updated_at) VALUES (?,?,?,?,?)').run(r.gameName, r.title, r.body, r.link, ctx.now()).lastInsertRowid,
  );
  if (actor) audit(ctx, { nightId: null, gmId: actor.gmId, action: 'rule.create', entity: 'rule_entry', entityId: id, after: r });
  changed(ctx);
  return { id };
}

export function updateRule(ctx: Ctx, actor: GmAuth, id: number, input: Parameters<typeof clean>[0]) {
  masterOnly(actor);
  const before = ctx.db.prepare('SELECT * FROM rule_entry WHERE id = ?').get(id);
  if (!before) throw notFound('rule_not_found');
  const r = clean(input);
  ctx.db.prepare('UPDATE rule_entry SET game_name = ?, title = ?, body_markdown = ?, link = ?, updated_at = ? WHERE id = ?').run(r.gameName, r.title, r.body, r.link, ctx.now(), id);
  audit(ctx, { nightId: null, gmId: actor.gmId, action: 'rule.update', entity: 'rule_entry', entityId: id, before, after: r });
  changed(ctx);
  return { id };
}

export function deleteRule(ctx: Ctx, actor: GmAuth, id: number) {
  masterOnly(actor);
  const before = ctx.db.prepare('SELECT * FROM rule_entry WHERE id = ?').get(id);
  if (!before) throw notFound('rule_not_found');
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE library_game SET rule_entry_id = NULL WHERE rule_entry_id = ?').run(id);
    ctx.db.prepare('DELETE FROM rule_entry WHERE id = ?').run(id);
    audit(ctx, { nightId: null, gmId: actor.gmId, action: 'rule.delete', entity: 'rule_entry', entityId: id, before });
  })();
  changed(ctx);
  return { ok: true };
}

/** First boot only: seed generic house rules (no hidden mechanics, no copyrighted text). */
export function seedRulesOnce(ctx: Ctx, file: string): boolean {
  if (ctx.db.prepare("SELECT 1 FROM meta WHERE key = 'rules_seeded'").get()) return false;
  let data: { entries?: { title: string; body: string; gameName?: string; link?: string }[] };
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  for (const e of data.entries ?? []) createRule(ctx, null, e);
  ctx.db.prepare("INSERT INTO meta (key, value) VALUES ('rules_seeded', ?)").run(String(ctx.now()));
  return true;
}
