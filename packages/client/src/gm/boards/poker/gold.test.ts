import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import { SETTINGS, def, goldReport, init, recordAllPayments, recordPayment, setStack } from './def';

const T0 = 1_000_000_000_000;
const player = (id: number): BoardPlayer => ({ id, name: `P${id}`, color: null, avatarPath: null, seat: id });
const mk = (n: number, settings: Record<string, number> = {}): BoardContext =>
  ({
    players: Array.from({ length: n }, (_, i) => player(i + 1)),
    table: null,
    rerollsAllowed: false,
    rerollsLeft: {},
    useReroll: async () => undefined,
    settings: { ...Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default])), ...settings },
    startedAt: T0,
  }) as BoardContext;

describe('poker for gold: what the board reports to the server', () => {
  it('real money: no gold report (the server returns any holds)', () => {
    const c = mk(3, { currency: 0 });
    expect(goldReport(init(c), c)).toBeNull();
    expect(def.gold!(init(c), c)).toBeNull();
  });

  it('gold: held = gold marked in; payouts = chip value now', () => {
    const c = mk(3, { currency: 1, buyIn: 20, startStack: 2000, pointsPerUnit: 100 });
    let s = init(c);
    expect(goldReport(s, c)).toEqual({ held: {}, payouts: { 1: 20, 2: 20, 3: 20 } });
    s = recordPayment(s, c, 1, 'gold', T0);
    expect(goldReport(s, c)!.held).toEqual({ 1: 20 });
    s = recordAllPayments(s, c, 'gold', T0);
    s = setStack(s, c, 1, 3000, T0);
    s = setStack(s, c, 2, 1000, T0);
    expect(goldReport(s, c)).toEqual({ held: { 1: 20, 2: 20, 3: 20 }, payouts: { 1: 30, 2: 10, 3: 20 } });
  });
});
