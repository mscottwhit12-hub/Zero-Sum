import { toH, type GoldH } from './money';
import type { GameResult } from './scoring';
import type { Settings } from './settings';

export type AchievementKind = 'skill' | 'vote';

export interface AchievementContext {
  /** Submitted results in submission order. */
  results: GameResult[];
  /** Correct quarterly votes per player so far. */
  correctVotes: Map<string, number>;
  /** Already awarded, as `${achievementId}:${playerId}`. */
  awarded: Set<string>;
}

export interface AchievementDef {
  id: string;
  /** skill = openly worth gold; vote = presented as cosmetic, secretly pays a little. */
  kind: AchievementKind;
  /** 'player' = once per player per night; 'night' = once per night total. */
  once: 'player' | 'night';
  /** Player ids that qualify right now (before de-dupe). */
  check(ctx: AchievementContext): string[];
}

export interface Award {
  achievementId: string;
  playerId: string;
  goldH: GoldH;
  /** True when the gold must never be shown to players (vote-based). */
  goldHidden: boolean;
}

/** Players who won a game: placement 1 (competitive/team) or coop win. DNF excluded. */
export function winners(r: GameResult): string[] {
  if (r.mode === 'coop') return r.coopWon ? r.participants.filter((p) => !p.dnf).map((p) => p.playerId) : [];
  return r.participants.filter((p) => !p.dnf && p.placement === 1).map((p) => p.playerId);
}

function countBy(results: GameResult[], f: (r: GameResult) => string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of results) for (const id of f(r)) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

const atLeast = (m: Map<string, number>, n: number) => [...m].filter(([, v]) => v >= n).map(([k]) => k);

/** Dummy set until the user supplies the real list. Names/text live in copy/en.json. */
export const DUMMY_ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first_blood',
    kind: 'skill',
    once: 'night',
    check: (ctx) => {
      const first = ctx.results.find((r) => winners(r).length > 0);
      return first ? winners(first) : [];
    },
  },
  { id: 'hat_trick', kind: 'skill', once: 'player', check: (ctx) => atLeast(countBy(ctx.results, winners), 3) },
  {
    id: 'regular',
    kind: 'skill',
    once: 'player',
    check: (ctx) => atLeast(countBy(ctx.results, (r) => r.participants.map((p) => p.playerId)), 4),
  },
  { id: 'oracle', kind: 'vote', once: 'player', check: (ctx) => atLeast(ctx.correctVotes, 2) },
];

/** New awards only. Re-run after every result, vote resolution, etc. */
export function evaluateAchievements(ctx: AchievementContext, defs: AchievementDef[], settings: Settings): Award[] {
  const out: Award[] = [];
  const seen = new Set(ctx.awarded);
  for (const d of defs) {
    if (d.once === 'night' && [...seen].some((k) => k.startsWith(`${d.id}:`))) continue;
    const goldH = toH(settings.achievements.gold[d.id] ?? 0);
    for (const pid of d.check(ctx)) {
      const key = `${d.id}:${pid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ achievementId: d.id, playerId: pid, goldH, goldHidden: d.kind === 'vote' });
    }
  }
  return out;
}
