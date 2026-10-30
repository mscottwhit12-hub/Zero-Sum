import { describe, expect, it } from 'vitest';
import { describeEntry, type AuditEntry } from './auditText';

const names = { players: { '12': 'Ann', '13': 'Ben' }, games: { '5': 'Risk' }, tables: { '2': 'Big table' }, library: { '7': 'Risk' } };
const entry = (action: string, o: Partial<Omit<AuditEntry, 'before' | 'after'>> & { before?: unknown; after?: unknown } = {}): AuditEntry => ({
  id: 1, gmName: 'Tate', action, entity: o.entity ?? 'x', entityId: o.entityId ?? null, createdAt: 0,
  before: o.before === undefined ? null : JSON.stringify(o.before),
  after: o.after === undefined ? null : JSON.stringify(o.after),
});

describe('audit text', () => {
  it('a board edit names the player and shows territories before and after', () => {
    const d = describeEntry(entry('board.edit', { entity: 'game', entityId: '5', before: { 'players.12.territories': 12 }, after: { 'players.12.territories': 15 } }), names);
    expect(d.text).toBe('Tate edited the board in Risk');
    expect(d.lines).toEqual(['Ann · territories: 12 → 15']);
  });
  it('a board edit that set several things, a count, and an elimination', () => {
    const d = describeEntry(entry('board.edit', { entity: 'game', entityId: '5', before: { 'players.13.eliminated': null }, after: { 'players.13.eliminated': true, 'players.13.eliminatedBy': 12, _more: 3 } }), names);
    expect(d.lines).toContain('Ben · eliminated: — → yes');
    expect(d.lines).toContain('Ben · eliminated by: — → Ann');
    expect(d.lines).toContain('…and 3 more changes');
  });
  it('gold, seats, results and scores read as sentences', () => {
    expect(describeEntry(entry('gold.adjust', { after: { playerId: 12, goldH: 500, reason: 'bonus' } }), names).text).toBe('Tate gave 5.00 gold to Ann (“bonus”)');
    expect(describeEntry(entry('gold.adjust', { after: { playerId: 12, goldH: -250, reason: '' } }), names).text).toBe('Tate took 2.50 gold from Ann');
    expect(describeEntry(entry('seat.assign', { entityId: '2', after: { seat: 3, playerId: 12 } }), names).text).toBe('Tate seated Ann at seat 3 of Big table');
    expect(describeEntry(entry('seat.assign', { entityId: '2', after: { seat: 3, playerId: null } }), names).text).toBe('Tate emptied seat 3 at Big table');
    const r = describeEntry(entry('game.result', { entityId: '5', after: { actualHours: 2, participants: [{ playerId: 13, placement: 2 }, { playerId: 12, placement: 1 }] } }), names);
    expect(r.text).toBe('Tate recorded the result of Risk: 1. Ann, 2. Ben (2 h)');
    const s = describeEntry(entry('game.scores', { entityId: '5', before: { '12': 10 }, after: { '12': 12, '13': 3 } }), names);
    expect(s.lines).toEqual(['Ann: 10 → 12', 'Ben: — → 3']);
  });
  it('settings changes list each changed setting; rule edits do not dump the body', () => {
    const d = describeEntry(entry('night.settings', { before: { market: { tickSeconds: 20, feeFrac: 0.03 } }, after: { market: { tickSeconds: 25, feeFrac: 0.03 } } }), names);
    expect(d.lines).toEqual(['market tick seconds: 20 → 25']);
    const r = describeEntry(entry('rule.update', { before: { title: 'Old', body_markdown: 'long', game_name: 'x' }, after: { title: 'New', body: 'long2', gameName: 'x' } }), names);
    expect(r.lines).toEqual(['title: Old → New']);
  });
  it('night actions, system entries and unknown ids stay readable', () => {
    expect(describeEntry(entry('night.closeTrading'), names).text).toBe('Tate closed trading');
    expect(describeEntry({ ...entry('wiretap.use', { after: { playerId: 13 } }), gmName: null }, names).text).toBe('Ben used a wiretap');
    expect(describeEntry(entry('seat.assign', { entityId: '9', after: { seat: 1, playerId: 99 } }), names).text).toBe('Tate seated player #99 at seat 1 of table #9');
    expect(describeEntry(entry('something.new'), names).text).toBe('Tate: something new');
  });
});
