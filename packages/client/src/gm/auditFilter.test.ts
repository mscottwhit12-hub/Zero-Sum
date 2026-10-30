import { describe, expect, it } from 'vitest';
import type { AuditEntry } from './auditText';
import { factsOf, passes, type Rule } from './auditFilter';

const names = { players: { '12': 'Ann', '13': 'Ben' }, games: { '5': 'Risk', '6': 'Catan', '9': 'Risk' }, tables: {}, library: {} };
let id = 0;
const entry = (action: string, o: { gm?: string | null; entity?: string; entityId?: string; before?: unknown; after?: unknown } = {}): AuditEntry => ({
  id: ++id, gmName: o.gm === undefined ? 'Tate' : o.gm, action, entity: o.entity ?? 'x', entityId: o.entityId ?? null, createdAt: 0,
  before: o.before === undefined ? null : JSON.stringify(o.before), after: o.after === undefined ? null : JSON.stringify(o.after),
});
const risk = entry('board.edit', { entity: 'game', entityId: '5', after: { 'players.12.territories': 15 } });
const risk2 = entry('game.start', { entity: 'game', entityId: '9', after: { participants: [12, 13] } }); // another night's Risk
const catan = entry('game.scores', { entity: 'game', entityId: '6', after: { '13': 7 } });
const claim = entry('claim.approve', { entity: 'board_claim', entityId: '1', after: { attackerId: 12, defenderId: 13, territories: 2, gameId: 5 } });
const gold = entry('gold.adjust', { entity: 'adjustment', after: { playerId: 13, goldH: 100, reason: '' } });
const login = entry('gm.login', { gm: 'Sam', after: { deviceType: 'phone' } });
const all = [risk, risk2, catan, claim, gold, login];
const keep = (rules: Rule[]) => all.filter((e) => passes(rules, factsOf(e, names))).map((e) => e.action + (e.entityId ? `:${e.entityId}` : ''));

describe('audit filters', () => {
  it('knows which games and players an entry is about', () => {
    expect(factsOf(risk, names)).toMatchObject({ games: ['Risk'], players: ['Ann'], type: 'Games' });
    expect(factsOf(claim, names)).toMatchObject({ games: ['Risk'], players: ['Ann', 'Ben'] });
    expect(factsOf(catan, names)).toMatchObject({ games: ['Catan'], players: ['Ben'] });
    expect(factsOf(gold, names)).toMatchObject({ games: [], players: ['Ben'], type: 'Players' });
    expect(factsOf(login, names)).toMatchObject({ gm: 'Sam', type: 'GM accounts' });
  });
  it('hide everything from the game Risk (every Risk game, any night, including battle approvals)', () => {
    expect(keep([{ mode: 'hide', kind: 'game', value: 'Risk' }])).toEqual(['game.scores:6', 'gold.adjust', 'gm.login']);
  });
  it('show only a game, a player, a GM or a kind of event; rules combine', () => {
    expect(keep([{ mode: 'only', kind: 'game', value: 'Catan' }])).toEqual(['game.scores:6']);
    expect(keep([{ mode: 'only', kind: 'player', value: 'Ben' }])).toEqual(['game.start:9', 'game.scores:6', 'claim.approve:1', 'gold.adjust']);
    expect(keep([{ mode: 'only', kind: 'gm', value: 'Sam' }])).toEqual(['gm.login']);
    expect(keep([{ mode: 'only', kind: 'type', value: 'Games' }, { mode: 'hide', kind: 'game', value: 'Risk' }])).toEqual(['game.scores:6']);
    expect(keep([{ mode: 'hide', kind: 'type', value: 'Games' }, { mode: 'hide', kind: 'gm', value: 'Sam' }])).toEqual(['gold.adjust']);
  });
  it('text search matches the plain-language sentence, case-insensitively; no rules shows everything', () => {
    expect(keep([{ mode: 'only', kind: 'text', value: 'TERRITORIES' }])).toEqual(['board.edit:5', 'claim.approve:1']);
    expect(keep([{ mode: 'hide', kind: 'text', value: 'gold' }])).toHaveLength(5);
    expect(keep([])).toHaveLength(6);
  });
});
