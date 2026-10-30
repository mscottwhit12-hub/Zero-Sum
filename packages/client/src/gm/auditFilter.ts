/** Filters for the GM Audit screen: hide or show only the entries about a game, player, GM, kind of event, or text. */
import { describeEntry, NO_NAMES, type AuditEntry, type AuditNames } from './auditText';

export type RuleKind = 'game' | 'player' | 'gm' | 'type' | 'text';
export type Rule = { mode: 'hide' | 'only'; kind: RuleKind; value: string };

export const TYPES = ['Night', 'Games', 'Seating', 'Players', 'Market', 'Library & rules', 'GM accounts'] as const;
const typeOf = (action: string): (typeof TYPES)[number] => {
  const p = action.split('.')[0]!;
  if (['night', 'finale', 'vote'].includes(p)) return 'Night';
  if (['game', 'board', 'claim', 'reroll'].includes(p)) return 'Games';
  if (['seat', 'table'].includes(p)) return 'Seating';
  if (['player', 'device', 'hint', 'notify', 'mood', 'handicap', 'espionage', 'wiretap', 'gold'].includes(p)) return 'Players';
  if (p === 'market') return 'Market';
  if (['library', 'rule', 'sound'].includes(p)) return 'Library & rules';
  return 'GM accounts';
};

export type Facts = { games: string[]; players: string[]; gm: string; type: string; text: string };

const parse = (s: string | null): Record<string, unknown> => {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** What an entry is about: which games and players it mentions, who did it, what kind of event it is, and its readable text. */
export function factsOf(e: AuditEntry, names: AuditNames = NO_NAMES): Facts {
  const a = parse(e.after);
  const b = parse(e.before);
  const gameIds = new Set<string>();
  const playerIds = new Set<string>();
  const num = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? String(v) : null);
  const addGame = (v: unknown) => {
    const n = num(v && typeof v === 'object' ? (v as { id?: unknown }).id : v);
    if (n) gameIds.add(n);
  };
  const addPlayer = (v: unknown) => {
    const n = num(v && typeof v === 'object' ? (v as { playerId?: unknown }).playerId : v);
    if (n) playerIds.add(n);
  };
  if (e.entity === 'game') addGame(e.entityId);
  if (e.entity === 'player') addPlayer(e.entityId);
  for (const o of [a, b]) {
    addGame(o.gameId);
    if (Array.isArray(o.games)) o.games.forEach(addGame);
    for (const k of ['playerId', 'attackerId', 'defenderId', 'leaderId']) addPlayer(o[k]);
    if (Array.isArray(o.participants)) o.participants.forEach(addPlayer);
    for (const [k, v] of Object.entries(o)) {
      const m = /^players\.(\d+)\./.exec(k);
      if (m) playerIds.add(m[1]!);
      if (k.endsWith('eliminatedBy')) addPlayer(v);
      if (e.action === 'game.scores') addPlayer(k);
    }
  }
  const d = describeEntry(e, names);
  return {
    games: [...gameIds].map((id) => names.games[id] ?? `game #${id}`),
    players: [...playerIds].map((id) => names.players[id] ?? `player #${id}`),
    gm: e.gmName ?? 'system',
    type: typeOf(e.action),
    text: `${d.text} ${d.lines.join(' ')} ${e.action}`.toLowerCase(),
  };
}

const matches = (r: Rule, f: Facts) => {
  switch (r.kind) {
    case 'game': return f.games.includes(r.value);
    case 'player': return f.players.includes(r.value);
    case 'gm': return f.gm === r.value;
    case 'type': return f.type === r.value;
    case 'text': return f.text.includes(r.value.trim().toLowerCase());
  }
};

/** Hidden if any "hide" rule matches; shown only if every "only" rule matches. */
export function passes(rules: Rule[], f: Facts): boolean {
  return rules.every((r) => (r.mode === 'hide' ? !matches(r, f) : matches(r, f)));
}

export const ruleLabel = (r: Rule) => `${r.mode === 'hide' ? 'Hide' : 'Only'} ${r.kind === 'type' ? 'type' : r.kind === 'text' ? 'text' : r.kind}: ${r.value}`;
