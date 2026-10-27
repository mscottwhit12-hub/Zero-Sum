import { describe, expect, it } from 'vitest';
import { computeNightState, currentNight } from '../src/services/state';
import { gmView, playerView, publicView } from '../src/services/views';
import { tickOnce } from '../src/tickLoop';
import { call, FORBIDDEN_KEYS, GM_ONLY_KEYS, liveNight, loginAs, makeApp, type TestApp } from './helpers';

const dev = (t: TestApp, token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, payload: payload as object | undefined, headers: { 'x-device-token': token } });
const tips = (t: TestApp, playerId: number) => t.ctx.db.prepare('SELECT hint_id, tier, source FROM hint_grant WHERE player_id = ? ORDER BY id').all(playerId) as { hint_id: string; tier: string; source: string }[];
const state = (t: TestApp) => computeNightState(t.ctx, currentNight(t.ctx)!.id)!;

async function playGame(t: TestApp, gm: string, ids: number[], hours: number, places: number[]) {
  const g = (await call(t, gm, 'POST', '/api/games', { name: `G${Math.random()}`, participants: ids, leadMode: 'manual' })).json().game;
  await call(t, gm, 'POST', `/api/games/${g.id}/start`);
  const r = await call(t, gm, 'POST', `/api/games/${g.id}/result`, { actualHours: hours, participants: ids.map((id, i) => ({ playerId: id, placement: places[i] })) });
  if (r.statusCode !== 200) throw new Error(r.body);
  return g.id as number;
}

describe('payout curve (linear default)', () => {
  it('6 players: 1 / .5 / .4 / .3 / .2 / .1', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 6);
    const ids = devices.map((d) => d.id);
    await playGame(t, gm, ids, 1, [1, 2, 3, 4, 5, 6]);
    const res = state(t).ledger;
    expect(ids.map((id) => res.get(String(id))!.resultsH)).toEqual([1800, 900, 720, 540, 360, 180]);
  });
});

describe('hint rewards', () => {
  it('win and last place of a qualifying game; tiers by length; short games pay nothing; corrections never double-pay', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 4);
    const ids = devices.map((d) => d.id);
    await playGame(t, gm, ids, 0.2, [1, 2, 3, 4]); // 12 min with 4 players: not eligible
    expect(tips(t, ids[0]!)).toEqual([]);
    const g = await playGame(t, gm, ids, 1.6, [1, 2, 3, 4]); // > 90 min: rarer
    expect(tips(t, ids[0]!)).toMatchObject([{ tier: 'rarer', source: 'game_win' }]);
    expect(tips(t, ids[3]!)).toMatchObject([{ tier: 'rarer', source: 'game_last' }]);
    expect(tips(t, ids[1]!)).toEqual([]);
    await call(t, gm, 'POST', `/api/games/${g}/correct`, { actualHours: 1.6, participants: ids.map((id, i) => ({ playerId: id, placement: [2, 1, 3, 4][i] })) });
    expect(tips(t, ids[0]!)).toHaveLength(1); // stays, no duplicate
    expect(tips(t, ids[1]!)).toMatchObject([{ source: 'game_win' }]);
    await playGame(t, gm, ids.slice(0, 3), 0.4, [1, 2, 3]); // 3 players, 24 min: not eligible
    expect(tips(t, ids[2]!)).toEqual([]);
    await playGame(t, gm, ids, 4.5, [1, 2, 3, 4]); // > 4 h: rarest
    expect(tips(t, ids[0]!).at(-1)).toMatchObject({ tier: 'rarest' });
  });

  it('no repeats inside a tier; tips reach only their player, as anonymous tips', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    for (let i = 0; i < 6; i++) expect((await call(t, gm, 'POST', '/api/tips', { playerId: devices[0]!.id, tier: 'rarer' })).statusCode).toBe(200);
    const got = tips(t, devices[0]!.id).map((x) => x.hint_id);
    expect(new Set(got).size).toBe(6);
    const st = state(t);
    const mine = playerView(t.ctx, st, devices[0]!.id)!;
    expect(mine.me.tips).toHaveLength(6);
    expect(playerView(t.ctx, st, devices[1]!.id)!.me.tips).toHaveLength(0);
    expect(JSON.stringify(publicView(t.ctx, st))).not.toContain('hintId');
    expect((await call(t, gm, 'POST', '/api/tips', { playerId: devices[0]!.id, tier: 'mega' })).json().error).toBe('bad_tier');
    // Sub GMs can send tips too.
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Helper', password: 'helper pass', pin: '5555' });
    const sub = await loginAs(t, 'Helper', 'helper pass');
    expect((await call(t, sub, 'POST', '/api/tips', { playerId: devices[1]!.id, tier: 'common' })).statusCode).toBe(200);
    // Reading clears the badge.
    const id = mine.me.tips[0]!.id;
    expect((await dev(t, devices[0]!.token, 'POST', `/api/me/tips/${id}/read`)).statusCode).toBe(200);
    expect((await dev(t, devices[1]!.token, 'POST', `/api/me/tips/${id}/read`)).statusCode).toBe(404);
  });

  it('buying is off by default; when on it costs cash, not earned gold; double taps are safe', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    const a = devices[0]!;
    expect((await dev(t, a.token, 'POST', '/api/me/tips/buy', { tier: 'common' })).json().error).toBe('tips_closed');
    await call(t, gm, 'PATCH', '/api/night/settings', { hints: { buy: { enabled: true } } });
    const before = state(t).ledger.get(String(a.id))!;
    const [r1, r2] = await Promise.all([dev(t, a.token, 'POST', '/api/me/tips/buy', { tier: 'common' }), dev(t, a.token, 'POST', '/api/me/tips/buy', { tier: 'common' })]);
    expect([r1.statusCode, r2.statusCode].filter((c) => c === 200).length).toBeGreaterThanOrEqual(1);
    const after = state(t).ledger.get(String(a.id))!;
    const bought = tips(t, a.id).length;
    expect(after.cashH).toBe(before.cashH - 500 * bought);
    expect(after.earnedH).toBe(before.earnedH);
    expect((await dev(t, a.token, 'POST', '/api/me/tips/buy', { tier: 'rarest' })).json().error).toBe('not_enough_gold');
  });

  it('re-roll trade-in: uses a token, then waits 2 night hours', async () => {
    const t = await makeApp();
    const { devices } = await liveNight(t, 1);
    const a = devices[0]!;
    expect((await dev(t, a.token, 'POST', '/api/me/tips/trade-reroll')).statusCode).toBe(200);
    expect(state(t).players[0]!.reroll_tokens_left).toBe(2);
    expect((await dev(t, a.token, 'POST', '/api/me/tips/trade-reroll')).json().error).toBe('tradein_cooldown');
    t.clock.advance(121 * 60_000);
    expect((await dev(t, a.token, 'POST', '/api/me/tips/trade-reroll')).statusCode).toBe(200);
    expect(t.ctx.db.prepare("SELECT COUNT(*) c FROM impulse WHERE cause = 'reroll_spend'").get()).toEqual({ c: 0 });
  });

  it('memo reward can be a tip; minter milestones pay tips', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    const a = devices[0]!;
    const c = (await call(t, gm, 'POST', '/api/challenges', { playerId: a.id, text: 'Do it', reward: { type: 'hint', tier: 'rarest' } })).json();
    const cid = c.id ?? c.challenge?.id;
    await dev(t, a.token, 'POST', `/api/me/challenges/${cid}/respond`, { accept: true });
    await call(t, gm, 'POST', `/api/challenges/${cid}/resolve`, { success: true });
    expect(tips(t, a.id)).toMatchObject([{ tier: 'rarest', source: 'memo' }]);
    // Minter: buy a server rack.
    t.ctx.db.prepare('INSERT INTO minter_state (player_id, night_id, minted, currency, tiers, updated_at) VALUES (?,?,?,?,?,?)').run(devices[1]!.id, currentNight(t.ctx)!.id, 5000, 5000, '{}', t.clock.t);
    const r = (await dev(t, devices[1]!.token, 'POST', '/api/minter/sync', { taps: 0, buys: ['rack'] })).json();
    expect(r.rejected).toEqual([]);
    expect(tips(t, devices[1]!.id)).toMatchObject([{ tier: 'common', source: 'minter' }]);
    await dev(t, devices[1]!.token, 'POST', '/api/minter/sync', { taps: 0, buys: ['rack'] });
    expect(tips(t, devices[1]!.id)).toHaveLength(1); // only the first rack pays
  });
});

describe('handicaps', () => {
  it('off by default: no checks; Master sets a manual level → hourly gift + tips; players never see the word', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 4);
    const ids = devices.map((d) => d.id);
    t.clock.advance(61 * 60_000);
    tickOnce(t.ctx);
    expect(t.ctx.db.prepare('SELECT COUNT(*) c FROM handicap_eval').get()).toEqual({ c: 0 });
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Helper', password: 'helper pass', pin: '5555' });
    const sub = await loginAs(t, 'Helper', 'helper pass');
    expect((await call(t, sub, 'PATCH', `/api/handicap/${ids[3]}`, { offset: 4 })).statusCode).toBe(403);
    expect((await call(t, gm, 'PATCH', `/api/handicap/${ids[3]}`, { offset: 9 })).json().error).toBe('bad_offset');
    expect((await call(t, gm, 'PATCH', `/api/handicap/${ids[3]}`, { offset: 4 })).json()).toMatchObject({ effective: 5 });
    t.clock.advance(61 * 60_000);
    tickOnce(t.ctx);
    const ev = t.ctx.db.prepare("SELECT player_id, effective, gift_h, credit_h FROM handicap_eval WHERE trigger = 'interval'").all() as { player_id: number; effective: number; gift_h: number; credit_h: number }[];
    expect(ev).toHaveLength(4);
    const d = ev.find((e) => e.player_id === ids[3])!;
    expect(d.effective).toBe(5);
    expect(d.gift_h).toBeGreaterThan(0);
    const st = state(t);
    const pv = playerView(t.ctx, st, ids[3]!)!;
    expect(pv.me.gifts).toHaveLength(1);
    const json = JSON.stringify(pv).toLowerCase();
    expect(json).not.toContain('handicap');
    for (const k of [...FORBIDDEN_KEYS, ...GM_ONLY_KEYS]) expect(JSON.stringify(pv)).not.toContain(k);
    expect(gmView(t.ctx, st).gm.handicap.players.find((p) => p.playerId === ids[3])).toMatchObject({ offset: 4, effective: 5 });
    // A second tick in the same hour doesn't pay again.
    tickOnce(t.ctx);
    expect(t.ctx.db.prepare("SELECT COUNT(*) c FROM handicap_eval WHERE trigger = 'interval'").get()).toEqual({ c: 4 });
  });

  it('auto: top half stay at 1, the struggling bottom get 2–5; gold gifts count toward rank', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 4);
    const ids = devices.map((d) => d.id);
    await call(t, gm, 'PATCH', '/api/night/settings', { handicap: { autoEnabled: true } });
    await playGame(t, gm, ids, 1, [1, 2, 3, 4]);
    await playGame(t, gm, ids, 1, [1, 2, 3, 4]);
    t.clock.advance(61 * 60_000);
    tickOnce(t.ctx);
    const lv = new Map((t.ctx.db.prepare("SELECT player_id, auto_level FROM handicap_eval WHERE trigger = 'interval'").all() as { player_id: number; auto_level: number }[]).map((r) => [r.player_id, r.auto_level]));
    expect(lv.get(ids[0]!)).toBe(1);
    expect(lv.get(ids[1]!)).toBe(1);
    expect(lv.get(ids[3]!)).toBe(5);
    expect(lv.get(ids[2]!)).toBeGreaterThanOrEqual(2);
    const gifts = t.ctx.db.prepare("SELECT SUM(gold_h) s FROM adjustment WHERE kind = 'gift' AND player_id = ?").get(ids[3]) as { s: number };
    expect(gifts.s).toBeGreaterThan(0);
    const l = state(t).ledger.get(String(ids[3]))!;
    expect(l.adjustmentsH).toBe(gifts.s); // folded into earned gold (rank)
  });
});

describe('index growth and crypto trend are hidden', () => {
  it('GM sees index terms; players and TV never do', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 4);
    const g = (await call(t, gm, 'POST', '/api/games', { name: 'Big', participants: devices.map((d) => d.id), leadMode: 'manual', plannedDurationHours: 2 })).json().game;
    await call(t, gm, 'POST', `/api/games/${g.id}/start`);
    t.clock.advance(30_000);
    tickOnce(t.ctx);
    const st = state(t);
    const terms = gmView(t.ctx, st).gm.indexTerms;
    expect(terms.drop).toBeGreaterThan(0);
    expect(terms.extra).toBeLessThan(0);
    expect(JSON.stringify(publicView(t.ctx, st))).not.toContain('indexTerms');
    expect(JSON.stringify(playerView(t.ctx, st, devices[0]!.id))).not.toContain('noise');
  });
});
