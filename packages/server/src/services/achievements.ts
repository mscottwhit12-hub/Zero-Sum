/**
 * Automatic achievement triggers (spec §14). Skill-based ones openly pay gold; vote-based ones are
 * presented as cosmetic but secretly pay a little (gold_hidden — never shown to anyone, folded into totals).
 * The real list comes later; DUMMY_ACHIEVEMENTS is the framework placeholder.
 */
import { DUMMY_ACHIEVEMENTS, evaluateAchievements } from '@gn/engine';
import type { Ctx } from '../context';
import { pushFeed } from './feed';
import { playCue } from './sounds';
import { loadResults, nightSettings, getNight, pid } from './state';

export function correctVotes(ctx: Ctx, nightId: number): Map<string, number> {
  const rows = ctx.db
    .prepare('SELECT b.player_id, COUNT(*) c FROM bounty_payout b JOIN vote_round v ON v.id = b.vote_round_id WHERE v.night_id = ? GROUP BY b.player_id')
    .all(nightId) as { player_id: number; c: number }[];
  return new Map(rows.map((r) => [pid(r.player_id), r.c]));
}

/** Evaluate and award anything new. Safe to call any time (idempotent). */
export function awardAchievements(ctx: Ctx, nightId: number): number {
  const n = getNight(ctx, nightId);
  if (!n) return 0;
  const awarded = new Set(
    (ctx.db.prepare('SELECT type, player_id FROM achievement WHERE night_id = ?').all(nightId) as { type: string; player_id: number }[]).map((a) => `${a.type}:${a.player_id}`),
  );
  const awards = evaluateAchievements({ results: loadResults(ctx, nightId), correctVotes: correctVotes(ctx, nightId), awarded }, DUMMY_ACHIEVEMENTS, nightSettings(n));
  if (!awards.length) return 0;
  const ins = ctx.db.prepare('INSERT OR IGNORE INTO achievement (night_id, player_id, type, gold_h, gold_hidden, created_at) VALUES (?,?,?,?,?,?)');
  ctx.db.transaction(() => {
    for (const a of awards) ins.run(nightId, Number(a.playerId), a.achievementId, a.goldH, a.goldHidden ? 1 : 0, ctx.now());
  })();
  for (const a of awards) {
    // Public: who and what. Gold is shown only for skill achievements; hidden gold is never sent.
    const data = { playerId: Number(a.playerId), type: a.achievementId, ...(a.goldHidden ? {} : { goldH: a.goldH }) };
    pushFeed(ctx, nightId, 'achievement', 'feed.achievement', data);
    ctx.bus.all('achievement:new', data);
  }
  playCue(ctx, 'achievement');
  ctx.bus.refresh(nightId);
  return awards.length;
}
