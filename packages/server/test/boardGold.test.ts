import { describe, expect, it } from 'vitest';
import { computeNightState, currentNight } from '../src/services/state';
import { splitPot } from '../src/services/boardGold';
import { call, liveNight, makeApp, type TestApp } from './helpers';

const st = (t: TestApp) => computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
const cash = (t: TestApp, id: number) => st(t).ledger.get(String(id))!.cashH;
const nw = (t: TestApp, id: number) => st(t).standings.find((r) => r.playerId === String(id))!.netWorthH;

async function pokerNight() {
  const t = await makeApp();
  const { gm, devices } = await liveNight(t, 4);
  const lib = (await call(t, gm, 'POST', '/api/library', { name: "Texas Hold'em", minPlayers: 2, maxPlayers: 10, leadMode: 'high', board: 'poker' })).json().game;
  const ids = devices.map((d) => d.id);
  const g = (await call(t, gm, 'POST', '/api/games', { libraryGameId: lib.id, participants: ids })).json().game;
  await call(t, gm, 'POST', `/api/games/${g.id}/start`);
  let version = 0;
  const save = async (gold: unknown, extra = 0) => {
    const r = await call(t, gm, 'PUT', `/api/games/${g.id}/board`, { state: { v: ++extra + version }, version, gold });
    expect(r.statusCode).toBe(200);
    version = r.json().version;
  };
  const all = (n: number) => Object.fromEntries(ids.map((id) => [id, n]));
  return { t, gm, ids, g, save, all };
}

describe('gold held by a board (poker for gold)', () => {
  it('holds gold out of cash but not net worth; lowering a hold gives the difference back', async () => {
    const { t, ids, save, all } = await pokerNight();
    const [a, b] = ids as [number, number];
    const c0 = cash(t, a);
    const n0 = nw(t, a);
    await save({ held: all(20), payouts: all(20) });
    expect(cash(t, a)).toBe(c0 - 2000);
    expect(nw(t, a)).toBe(n0); // still the player's gold
    await save({ held: { ...all(20), [a]: 10 }, payouts: all(20) });
    expect(cash(t, a)).toBe(c0 - 1000);
    // the same report again moves nothing
    await save({ held: { ...all(20), [a]: 10 }, payouts: all(20) });
    expect(cash(t, a)).toBe(c0 - 1000);
    expect(cash(t, b)).toBe(c0 - 2000);
    // switched to real money: every hold comes back
    await save(null);
    expect(cash(t, a)).toBe(c0);
    expect(cash(t, b)).toBe(c0);
  });

  it('a board without gold (no report) never touches gold; junk ids and amounts are ignored', async () => {
    const { t, ids, save } = await pokerNight();
    const c0 = cash(t, ids[0]!);
    await save(undefined);
    await save({ held: { 99999: 50, [ids[0]!]: -5, [ids[1]!]: 'x' }, payouts: {} });
    expect(cash(t, ids[0]!)).toBe(c0);
    expect(cash(t, ids[1]!)).toBe(c0);
  });

  it('the result pays the pot out by chip value, scaled to the pot (zero-sum)', async () => {
    const { t, gm, ids, g, save, all } = await pokerNight();
    const before = ids.map((id) => cash(t, id));
    await save({ held: all(20), payouts: all(20) });
    // Ann has 3/4 of the chips, Ben 1/4; the board's cash-outs only add up to 40 (a miscount): scaled to the 80 pot.
    await save({ held: all(20), payouts: { [ids[0]!]: 30, [ids[1]!]: 10 } });
    await call(t, gm, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: ids.map((id, i) => ({ playerId: id, placement: i + 1 })) });
    const game = (id: number) => (t.ctx.db.prepare("SELECT COALESCE(SUM(gold_h),0) s FROM adjustment WHERE player_id = ? AND kind = 'game_stake'").get(id) as { s: number }).s;
    expect(ids.map(game)).toEqual([4000, 0, -2000, -2000]);
    expect(ids.map(game).reduce((x, y) => x + y, 0)).toBe(0);
    expect(cash(t, ids[3]!)).toBeLessThan(before[3]!);
    // nothing still held: net worth now reflects the cash-out
    expect(t.ctx.db.prepare("SELECT COUNT(*) n FROM board_gold WHERE game_id = ? AND status = 'held'").get(g.id)).toEqual({ n: 0 });
  });

  it('cancelling the game, or ending the night with it running, gives every hold back', async () => {
    const one = await pokerNight();
    const c0 = cash(one.t, one.ids[0]!);
    await one.save({ held: one.all(20), payouts: one.all(20) });
    await call(one.t, one.gm, 'POST', `/api/games/${one.g.id}/cancel`);
    expect(cash(one.t, one.ids[0]!)).toBe(c0);

    const two = await pokerNight();
    const c1 = cash(two.t, two.ids[1]!);
    await two.save({ held: two.all(15), payouts: two.all(15) });
    await call(two.t, two.gm, 'POST', '/api/night/end');
    const adj = (two.t.ctx.db.prepare("SELECT COALESCE(SUM(gold_h),0) s FROM adjustment WHERE player_id = ? AND kind = 'game_stake'").get(two.ids[1]!) as { s: number }).s;
    expect(adj).toBe(0);
    expect(c1).toBeGreaterThan(0);
  });

  it('splitPot: exact, proportional, largest remainder', () => {
    expect([...splitPot(8000, new Map([[1, 3000], [2, 1000]]))]).toEqual([[1, 6000], [2, 2000]]);
    const odd = splitPot(100, new Map([[1, 1], [2, 1], [3, 1]]));
    expect([...odd.values()].reduce((a, b) => a + b, 0)).toBe(100);
    expect(splitPot(100, new Map())).toEqual(new Map());
  });
});
