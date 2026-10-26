import { describe, expect, it } from 'vitest';
import { computeNightState, currentNight } from '../src/services/state';
import { gmView, publicView } from '../src/services/views';
import { tickOnce } from '../src/tickLoop';
import { call, FORBIDDEN_KEYS, liveNight, makeApp, type TestApp } from './helpers';

const MIN = 60_000;
const dev = (t: TestApp, token: string, url: string) => t.app.inject({ method: 'GET', url, headers: { 'x-device-token': token } });
const state = (t: TestApp) => computeNightState(t.ctx, currentNight(t.ctx)!.id)!;

async function playedNight() {
  const t = await makeApp();
  const night = await liveNight(t, 3);
  const { gm, devices } = night;
  const [a, b, c] = devices as [{ id: number; token: string }, { id: number; token: string }, { id: number; token: string }];
  const g = (await call(t, gm, 'POST', '/api/games', { name: 'Cards', mode: 'competitive', plannedStart: t.clock.t, plannedDurationHours: 1, participants: [a.id, b.id, c.id] })).json().game;
  await call(t, gm, 'POST', `/api/games/${g.id}/start`);
  // A trade with a profit, sold at End.
  await t.app.inject({ method: 'POST', url: '/api/trade/buy', payload: { securityId: `p:${a.id}`, gold: 5 }, headers: { 'x-device-token': b.token } });
  return { t, gm, a, b, c, g };
}

describe('GM prompts', () => {
  it('close trading N min before the last planned end; end night after the final result; dismiss + re-prompt', async () => {
    const { t, gm, a, b, c, g } = await playedNight();
    const p0 = gmView(t.ctx, state(t)).gm.prompts;
    expect(p0.closeTradingAt).toBe(t.clock.t + 60 * MIN - 15 * MIN);
    expect(p0.endNight).toBe(false);
    await call(t, gm, 'POST', '/api/night/prompts/dismiss', { prompt: 'closeTrading' });
    expect(gmView(t.ctx, state(t)).gm.prompts.closeTradingAt).toBeNull();
    await call(t, gm, 'PATCH', `/api/games/${g.id}`, { plannedDurationHours: 2 }); // schedule moved → re-prompt
    expect(gmView(t.ctx, state(t)).gm.prompts.closeTradingAt).toBe(g.planned_start + 120 * MIN - 15 * MIN);

    await call(t, gm, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: [{ playerId: a.id, placement: 1 }, { playerId: b.id, placement: 2 }, { playerId: c.id, placement: 3 }] });
    expect(gmView(t.ctx, state(t)).gm.prompts.endNight).toBe(true);
    await call(t, gm, 'POST', '/api/night/prompts/dismiss', { prompt: 'endNight' });
    expect(gmView(t.ctx, state(t)).gm.prompts.endNight).toBe(false);
    const g2 = (await call(t, gm, 'POST', '/api/games', { name: 'Dice', mode: 'competitive', participants: [a.id, b.id] })).json().game;
    expect(gmView(t.ctx, state(t)).gm.prompts.endNight).toBe(false); // a game is still scheduled
    await call(t, gm, 'POST', `/api/games/${g2.id}/result`, { actualHours: 0.5, participants: [{ playerId: a.id, placement: 1 }, { playerId: b.id, placement: 2 }] });
    expect(gmView(t.ctx, state(t)).gm.prompts.endNight).toBe(true); // more games added → re-prompt
    await call(t, gm, 'POST', '/api/night/close-trading');
    expect(gmView(t.ctx, state(t)).gm.prompts.closeTradingAt).toBeNull();
  });
});

describe('finale', () => {
  it('End → server-timed finale (podium + recap) → phones unlock into statements + PDF; nothing hidden leaks', async () => {
    const { t, gm, a, b, c, g } = await playedNight();
    await call(t, gm, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: [{ playerId: a.id, placement: 1 }, { playerId: b.id, placement: 2 }, { playerId: c.id, placement: 3 }] });
    for (let i = 0; i < 15; i++) {
      t.clock.advance(20_000); // Alice won → her stock climbs toward its new fair price
      tickOnce(t.ctx);
    }
    await call(t, gm, 'POST', '/api/mood', { playerId: a.id, mood: 5, selfAssessment: 5 });
    await call(t, gm, 'POST', '/api/mood', { playerId: c.id, mood: 1, selfAssessment: 2 });
    t.ctx.db.prepare("INSERT INTO achievement (night_id, player_id, type, gold_h, gold_hidden, created_at) VALUES (?,?, 'oracle', 1, 1, 0)").run(currentNight(t.ctx)!.id, b.id);
    expect((await dev(t, a.token, '/api/me/statement')).json().error).toBe('night_not_over');

    expect((await call(t, gm, 'POST', '/api/night/end')).statusCode).toBe(200);
    const n = currentNight(t.ctx)!;
    expect(n.recap_until).toBeGreaterThan(t.clock.t);
    const pub = publicView(t.ctx, state(t));
    expect(pub.finale!.podium.map((p) => p.playerId)).toEqual([a.id, b.id, c.id]);
    const ids = pub.finale!.slides.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['top_trade', 'best_investment', 'mood', 'hours', 'achievements']));
    for (const k of FORBIDDEN_KEYS) expect(JSON.stringify(pub)).not.toContain(k);
    const ach = pub.finale!.slides.find((x) => x.id === 'achievements') as { items: object[] };
    for (const item of ach.items) expect(Object.keys(item).sort()).toEqual(['playerId', 'type']);

    expect((await dev(t, b.token, '/api/me/statement')).json().error).toBe('recap_running');
    t.clock.advance((n.recap_until! - t.clock.t) + 1000);
    tickOnce(t.ctx);
    expect(currentNight(t.ctx)!.recap_done).toBe(1);
    const s = (await dev(t, b.token, '/api/me/statement')).json();
    expect(s).toMatchObject({ rank: 2, achievements: ['oracle'], player: { id: b.id } });
    expect(s.trades.some((x: { forced: boolean; profitH: number }) => x.forced && x.profitH > 0)).toBe(true);
    for (const k of FORBIDDEN_KEYS) expect(JSON.stringify(s)).not.toContain(k);
    const pdf = await dev(t, b.token, '/api/me/statement.pdf');
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('GM can skip the finale (phones unlock now)', async () => {
    const { t, gm, a } = await playedNight();
    await call(t, gm, 'POST', '/api/night/end');
    expect((await dev(t, a.token, '/api/me/statement')).statusCode).toBe(409);
    await call(t, gm, 'POST', '/api/night/finale/skip');
    expect((await dev(t, a.token, '/api/me/statement')).statusCode).toBe(200);
  });
});

describe('exports and archive', () => {
  it('JSON + CSV for the Master only, without hidden mechanics; archive lists winners', async () => {
    const { t, gm, a, b, c, g } = await playedNight();
    await call(t, gm, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: [{ playerId: a.id, placement: 1 }, { playerId: b.id, placement: 2 }, { playerId: c.id, placement: 3 }] });
    t.ctx.db.prepare("INSERT INTO achievement (night_id, player_id, type, gold_h, gold_hidden, created_at) VALUES (?,?, 'oracle', 1, 1, 0)").run(currentNight(t.ctx)!.id, b.id);
    t.clock.advance(6 * MIN);
    tickOnce(t.ctx); // market tick + vote round (drift written once the window closes)
    await call(t, gm, 'POST', '/api/night/end');
    const json = await call(t, gm, 'GET', '/api/export/night.json');
    expect(json.headers['content-disposition']).toMatch(/attachment; filename=".+\.json"/);
    const body = json.body;
    for (const k of ['"drift"', '"causes"', '"fair"', '"target"', '"impulses"', '"gold_hidden"', '"hidden"']) expect(body).not.toContain(k);
    expect(JSON.parse(body).achievements.find((x: { type: string }) => x.type === 'oracle').goldH).toBeNull();

    const csv = (await call(t, gm, 'GET', '/api/export/standings.csv')).body;
    expect(csv.split('\r\n')[0]).toBe('﻿rank,player,ticker,net_worth_gold,gold');
    expect(csv).toContain('Alice');
    expect((await call(t, gm, 'GET', '/api/export/results.csv')).body).toContain('Cards,competitive,1,Alice,,1,1,');
    expect((await call(t, gm, 'GET', '/api/export/trades.csv')).body).toContain('auto-sell');
    expect((await call(t, null, 'GET', '/api/export/night.json')).statusCode).toBe(401);

    await call(t, gm, 'POST', '/api/night/archive');
    const nights = (await call(t, gm, 'GET', '/api/nights')).json().nights;
    expect(nights[0]).toMatchObject({ status: 'archived', players: 3, winners: ['Alice'] });
    const old = nights[0].id;
    await call(t, gm, 'POST', '/api/nights', { name: 'Next week' });
    expect((await call(t, gm, 'GET', `/api/export/standings.csv?night=${old}`)).body).toContain('Alice');
  });
});
