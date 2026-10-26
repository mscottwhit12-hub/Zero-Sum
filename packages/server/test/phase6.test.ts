import { describe, expect, it } from 'vitest';
import { computeNightState, currentNight } from '../src/services/state';
import { gmView, playerView, publicView } from '../src/services/views';
import { feedTail } from '../src/services/feed';
import { tickOnce } from '../src/tickLoop';
import { call, FORBIDDEN_KEYS, GM_ONLY_KEYS, liveNight, loginAs, makeApp, type TestApp } from './helpers';

const MIN = 60_000;
const dev = (t: TestApp, token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, payload: payload as object | undefined, headers: { 'x-device-token': token } });

function views(t: TestApp, playerId: number) {
  const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
  return { st, pub: publicView(t.ctx, st), me: playerView(t.ctx, st, playerId)!, gm: gmView(t.ctx, st) };
}
const feedKeys = (t: TestApp, gmOnly: boolean) => feedTail(t.ctx, currentNight(t.ctx)!.id, gmOnly).map((f) => f.message);

describe('votes', () => {
  it('opens at quarter start, closes after the window, resolves at quarter end; drift never leaves the server', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 3); // 300 min → Q1 = 30–90, window 30–35
    const [a, b, c] = devices as [{ id: number; token: string }, { id: number; token: string }, { id: number; token: string }];
    await call(t, gm, 'POST', '/api/night/adjustments', { playerId: a.id, gold: 10, reason: 'lead' });
    expect((await dev(t, a.token, 'POST', '/api/vote', { targetId: a.id })).statusCode).toBe(409); // pre-game buffer: no round

    t.clock.advance(30 * MIN);
    tickOnce(t.ctx);
    expect(views(t, a.id).me.me.vote).toMatchObject({ quarter: 1, open: true, myTarget: null });
    expect((await dev(t, a.token, 'POST', '/api/vote', { targetId: a.id })).statusCode).toBe(200);
    expect((await dev(t, b.token, 'POST', '/api/vote', { targetId: c.id })).statusCode).toBe(200);
    expect((await dev(t, b.token, 'POST', '/api/vote', { targetId: a.id })).statusCode).toBe(200); // change of mind
    expect((await dev(t, c.token, 'POST', '/api/vote', { targetId: c.id })).statusCode).toBe(200);
    expect(views(t, b.id).me.me.vote?.myTarget).toBe(a.id);
    expect(views(t, b.id).gm.gm.vote).toMatchObject({ ballotsCast: 3, eligible: 3 });

    t.clock.advance(6 * MIN);
    tickOnce(t.ctx);
    const round = t.ctx.db.prepare('SELECT status, drift FROM vote_round').get() as { status: string; drift: string };
    expect(round.status).toBe('closed');
    expect(Object.keys(JSON.parse(round.drift)).length).toBe(3);
    expect((await dev(t, c.token, 'POST', '/api/vote', { targetId: a.id })).statusCode).toBe(409);
    const v = views(t, a.id);
    for (const json of [JSON.stringify(v.pub), JSON.stringify(v.me), JSON.stringify(v.gm)]) for (const k of FORBIDDEN_KEYS) expect(json).not.toContain(k);
    for (const k of ['"ballotsCast"', ...GM_ONLY_KEYS]) expect(JSON.stringify(v.me)).not.toContain(k);

    t.clock.advance(60 * MIN);
    tickOnce(t.ctx);
    const paid = t.ctx.db.prepare('SELECT player_id, gold_h FROM bounty_payout ORDER BY player_id').all() as { player_id: number; gold_h: number }[];
    expect(paid.map((p) => p.player_id)).toEqual([a.id, b.id]); // both picked the leader
    expect(feedKeys(t, false)).toEqual(expect.arrayContaining(['feed.vote_open', 'feed.vote_resolved']));
  });

  it('ends a night mid-quarter: force-resolves and pays before auto-sell', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    await call(t, gm, 'POST', '/api/night/adjustments', { playerId: devices[0]!.id, gold: 5, reason: 'lead' });
    t.clock.advance(31 * MIN);
    tickOnce(t.ctx);
    await dev(t, devices[1]!.token, 'POST', '/api/vote', { targetId: devices[0]!.id });
    expect((await call(t, gm, 'POST', '/api/night/end')).statusCode).toBe(200);
    expect(t.ctx.db.prepare('SELECT player_id FROM bounty_payout').all()).toEqual([{ player_id: devices[1]!.id }]);
  });
});

describe('achievements', () => {
  it('hidden achievement gold counts in totals but is never itemized anywhere', async () => {
    const t = await makeApp();
    const { devices } = await liveNight(t, 2);
    const n = currentNight(t.ctx)!;
    t.ctx.db.prepare("INSERT INTO achievement (night_id, player_id, type, gold_h, gold_hidden, created_at) VALUES (?,?, 'oracle', 150, 1, 0)").run(n.id, devices[0]!.id);
    const v = views(t, devices[0]!.id);
    expect(v.me.me.achievements).toEqual([{ type: 'oracle', createdAt: 0 }]);
    expect(v.gm.gm.ledger.find((l) => l.playerId === devices[0]!.id)!.achievementsH).toBe(0);
    expect(v.me.me.cashH - views(t, devices[1]!.id).me.me.cashH).toBe(150);
    for (const json of [JSON.stringify(v.me), JSON.stringify(v.gm)]) expect(json).not.toContain('"goldH":150');
  });
});

describe('espionage', () => {
  it('assign → decrypt → accept → delayed anonymous reveal → success pays privately', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 3);
    const [a, b] = devices as [{ id: number; token: string }, { id: number; token: string }];
    const id = (await call(t, gm, 'POST', '/api/challenges', { playerId: a.id, text: 'Get Bob to say "banana".', reward: { type: 'gold' } })).json().id;
    expect(feedKeys(t, false)).toContain('feed.memo');
    expect(JSON.stringify(publicView(t.ctx, computeNightState(t.ctx, currentNight(t.ctx)!.id)!))).not.toContain('banana');
    expect(views(t, b.id).me.me.challenges).toEqual([]);
    expect(views(t, a.id).me.me.challenges[0]).toMatchObject({ id, status: 'sent', text: 'Get Bob to say "banana".' });

    await dev(t, a.token, 'POST', `/api/me/challenges/${id}/read`);
    expect((await dev(t, b.token, 'POST', `/api/me/challenges/${id}/respond`, { accept: true })).statusCode).toBe(404); // not yours
    expect((await dev(t, a.token, 'POST', `/api/me/challenges/${id}/respond`, { accept: true })).json().status).toBe('accepted');
    tickOnce(t.ctx);
    expect(feedKeys(t, false)).not.toContain('feed.memo_accepted'); // random 15–45 s delay
    t.clock.advance(46_000);
    tickOnce(t.ctx);
    expect(feedKeys(t, false)).toContain('feed.memo_accepted');

    const before = views(t, a.id).me.me.cashH;
    expect((await call(t, gm, 'POST', `/api/challenges/${id}/resolve`, { success: true })).json().status).toBe('succeeded');
    expect(views(t, a.id).me.me.cashH - before).toBe(300);
    expect(feedKeys(t, false)).not.toContain('feed.espionage_success_gm');
    expect(feedKeys(t, true)).toContain('feed.espionage_success_gm');
    expect(t.ctx.db.prepare("SELECT COUNT(*) c FROM impulse WHERE cause LIKE 'espionage%'").get()).toMatchObject({ c: expect.any(Number) });
    expect((await call(t, gm, 'POST', `/api/challenges/${id}/resolve`, { success: false })).statusCode).toBe(409);
  });

  it('reject → reassign → fail exposes the agent; peek reward shows one target once', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 3);
    const [a, b, c] = devices as [{ id: number; token: string }, { id: number; token: string }, { id: number; token: string }];
    const id = (await call(t, gm, 'POST', '/api/challenges', { playerId: a.id, text: 'Swap seats.', reward: { type: 'reroll' } })).json().id;
    expect((await call(t, gm, 'POST', `/api/challenges/${id}/reassign`, { playerId: b.id })).statusCode).toBe(409); // not rejected yet
    await dev(t, a.token, 'POST', `/api/me/challenges/${id}/respond`, { accept: false });
    const id2 = (await call(t, gm, 'POST', `/api/challenges/${id}/reassign`, { playerId: b.id })).json().id;
    expect(views(t, a.id).me.me.challenges).toEqual([]); // reassigned away
    await dev(t, b.token, 'POST', `/api/me/challenges/${id2}/respond`, { accept: true });
    await call(t, gm, 'POST', `/api/challenges/${id2}/resolve`, { success: false });
    const fail = feedTail(t.ctx, currentNight(t.ctx)!.id, false).find((f) => f.message === 'feed.espionage_fail')!;
    expect(fail.data).toMatchObject({ playerId: b.id });

    const pk = (await call(t, gm, 'POST', '/api/challenges', { playerId: c.id, text: 'Hum the anthem.', reward: { type: 'peek' } })).json().id;
    await dev(t, c.token, 'POST', `/api/me/challenges/${pk}/respond`, { accept: true });
    expect((await dev(t, c.token, 'POST', `/api/me/challenges/${pk}/peek`, { targetPlayerId: a.id })).statusCode).toBe(409); // not succeeded
    await call(t, gm, 'POST', `/api/challenges/${pk}/resolve`, { success: true });
    await dev(t, a.token, 'POST', '/api/trade/buy', { securityId: `p:${b.id}`, gold: 2 });
    const r = (await dev(t, c.token, 'POST', `/api/me/challenges/${pk}/peek`, { targetPlayerId: a.id })).json();
    expect(r.trades).toHaveLength(1);
    expect((await dev(t, c.token, 'POST', `/api/me/challenges/${pk}/peek`, { targetPlayerId: b.id })).statusCode).toBe(409);
    expect(views(t, c.id).me.me.challenges[0]!.peek).toMatchObject({ used: true, targetId: a.id });
  });
});

describe('field actions', () => {
  it('mood, re-rolls, notifications, offsets', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 3);
    const [a, b] = devices as [{ id: number; token: string }, { id: number; token: string }];

    const mood = (await call(t, gm, 'POST', '/api/mood', { playerId: a.id, mood: 5, selfAssessment: 4 })).json();
    expect(mood.impact).toBeGreaterThan(0);
    expect((await call(t, gm, 'POST', '/api/mood', { playerId: a.id, mood: 6, selfAssessment: 1 })).statusCode).toBe(400);
    expect(views(t, a.id).gm.gm.mood[0]).toMatchObject({ playerId: a.id, mood: 5 });
    expect(JSON.stringify(views(t, a.id).me)).not.toContain('"mood"');

    const lib = (await call(t, gm, 'POST', '/api/library', { name: 'Dice', minPlayers: 2, maxPlayers: 6, defaultDuration: 0.5, mode: 'competitive', rerollsAllowed: true })).json().game;
    const g = (await call(t, gm, 'POST', '/api/games', { libraryGameId: lib.id, participants: [a.id, b.id] })).json().game;
    expect((await call(t, gm, 'POST', '/api/rerolls', { gameId: g.id, playerId: a.id })).statusCode).toBe(409); // not active
    await call(t, gm, 'POST', `/api/games/${g.id}/start`);
    expect((await call(t, gm, 'POST', '/api/rerolls', { gameId: g.id, playerId: a.id })).json().left).toBe(2);
    expect(views(t, a.id).me.me.rerollsLeft).toBe(2);
    expect(feedKeys(t, false)).not.toContain('feed.reroll');

    await call(t, gm, 'POST', '/api/notifications', { to: { gameId: g.id }, message: 'Table 2, you are up.' });
    await call(t, gm, 'POST', '/api/notifications', { to: { all: true }, message: 'Pizza is here.' });
    expect(views(t, a.id).me.me.messages.map((m) => m.message)).toEqual(['Pizza is here.', 'Table 2, you are up.']);
    expect(views(t, devices[2]!.id).me.me.messages.map((m) => m.message)).toEqual(['Pizza is here.']);

    expect((await call(t, gm, 'PATCH', `/api/securities/${encodeURIComponent(`p:${a.id}`)}/offset`, { offset: 0.2 })).statusCode).toBe(200);
    expect(views(t, a.id).gm.gm.stocks.find((s) => s.securityId === `p:${a.id}`)!.gmOffset).toBe(0.2);
    expect((await call(t, gm, 'PATCH', '/api/securities/IDX/offset', { offset: 0.1 })).statusCode).toBeGreaterThanOrEqual(400);
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Helper', password: 'helper pass', pin: '5555' });
    const sub = await loginAs(t, 'Helper', 'helper pass');
    expect((await call(t, sub, 'PATCH', `/api/securities/${encodeURIComponent(`p:${a.id}`)}/offset`, { offset: 0 })).statusCode).toBe(403);
    expect((await call(t, sub, 'POST', '/api/mood', { playerId: b.id, mood: 2, selfAssessment: 4 })).statusCode).toBe(200); // field action
  });
});
