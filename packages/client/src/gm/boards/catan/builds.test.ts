import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import { SETTINGS, applyBuild, buildProblem, buildText, holder, init, pl, score, setSettlements } from './def';

const player = (id: number): BoardPlayer => ({ id, name: `P${id}`, color: null, avatarPath: null, seat: id });
const mk = (n: number): BoardContext =>
  ({
    players: Array.from({ length: n }, (_, i) => player(i + 1)),
    table: null,
    rerollsAllowed: true,
    rerollsLeft: {},
    useReroll: async () => undefined,
    settings: Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default])),
  }) as BoardContext;
const T = 1_000_000;

describe('player build entries (phone Catan app)', () => {
  it('approving applies: +1 settlement, settlement → city, award moves to the player', () => {
    const c = mk(3);
    let s = init(c);
    s = applyBuild(s, c, 1, 'settlement', T);
    expect(pl(s, c, 1)).toMatchObject({ settlements: 3, cities: 0 });
    s = applyBuild(s, c, 1, 'city', T);
    expect(pl(s, c, 1)).toMatchObject({ settlements: 2, cities: 1 });
    s = applyBuild(s, c, 2, 'longestRoad', T);
    expect(holder(s, c, 'longestRoad')).toBe(2);
    s = applyBuild(s, c, 3, 'longestRoad', T); // taken from player 2
    expect(holder(s, c, 'longestRoad')).toBe(3);
    expect(score(s, c)).toEqual({ 1: 4, 2: 2, 3: 4 });
  });

  it('entries that can no longer apply are flagged and do nothing', () => {
    const c = mk(3);
    let s = setSettlements(init(c), c, 1, 5, T);
    expect(buildProblem(s, c, 1, 'settlement')).toBe('No settlement pieces left.');
    expect(applyBuild(s, c, 1, 'settlement', T)).toBe(s);
    s = setSettlements(s, c, 2, 0, T);
    expect(buildProblem(s, c, 2, 'city')).toBe('No settlement to upgrade.');
    s = applyBuild(s, c, 3, 'largestArmy', T);
    expect(buildProblem(s, c, 3, 'largestArmy')).toBe('Already holds it.');
    expect(buildProblem(s, c, 9, 'settlement')).toBe('Not in this game.');
    expect(buildText('city')).toBe('upgraded a settlement to a city');
  });
});
