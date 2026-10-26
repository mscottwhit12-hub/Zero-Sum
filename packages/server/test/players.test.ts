import { describe, expect, it } from 'vitest';
import { runTick } from '../src/services/market';
import { setBlocklist } from '../src/services/players';
import { computeNightState, currentNight } from '../src/services/state';
import { playerView, publicView } from '../src/services/views';
import { call, FORBIDDEN_KEYS, GM_ONLY_KEYS, liveNight, loginAs, makeApp, setupMaster } from './helpers';

const dev = (t: Awaited<ReturnType<typeof makeApp>>, token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, payload: payload as object | undefined, headers: { 'x-device-token': token } });

// 1×1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('join', () => {
  it('joins are GM-gated; self-register while open; names/tickers unique; blocklist', async () => {
    const t = await makeApp();
    const gm = await setupMaster(t);
    expect((await call(t, null, 'GET', '/api/join')).json().mode).toBe('closed');
    await call(t, gm, 'POST', '/api/nights', { name: 'N' });
    expect((await call(t, null, 'POST', '/api/join', { displayName: 'Ann', ticker: 'ANN' })).json().error).toBe('joins_closed');
    await call(t, gm, 'POST', '/api/night/open-joins');
    const r = await call(t, null, 'POST', '/api/join', { displayName: 'Ann', ticker: 'ann', color: '#336699', avatarData: PNG });
    expect(r.json()).toMatchObject({ pending: false, playerId: expect.any(Number) });
    expect((await dev(t, r.json().deviceToken, 'GET', '/api/me')).json().player).toMatchObject({ displayName: 'Ann', ticker: 'ANN' });
    expect((await call(t, null, 'POST', '/api/join', { displayName: 'ANN', ticker: 'ABC' })).json().error).toBe('name_taken');
    expect((await call(t, null, 'POST', '/api/join', { displayName: 'Bo', ticker: 'AN' })).json().error).toBe('bad_ticker');
    setBlocklist(['badword']);
    expect((await call(t, null, 'POST', '/api/join', { displayName: 'xBADWORDx', ticker: 'XYZ' })).json().error).toBe('name_blocked');
    setBlocklist([]);
    expect((await call(t, null, 'POST', '/api/join', { displayName: 'Cy', ticker: 'CYY', avatarData: 'data:image/gif;base64,R0lGOD' })).json().error).toBe('bad_avatar');
    const big = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(210 * 1024)]).toString('base64');
    expect((await call(t, null, 'POST', '/api/join', { displayName: 'Cy', ticker: 'CYY', avatarData: big })).json().error).toBe('avatar_too_large');
    const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    const avatar = st.players[0]!.avatar_path!;
    expect(avatar).toMatch(/^\/uploads\/avatars\/[a-f0-9]{24}\.png$/);
  });

  it('rejoin: pick name → GM approves → new device works; both devices stay active', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    const list = (await call(t, null, 'GET', '/api/join')).json();
    expect(list.mode).toBe('late');
    expect(list.players.map((p: { displayName: string }) => p.displayName)).toEqual(['Alice', 'Bob']);
    const req = (await call(t, null, 'POST', '/api/join/rejoin', { playerId: devices[0]!.id })).json();
    expect((await dev(t, req.deviceToken, 'GET', '/api/join/status')).json().status).toBe('pending');
    expect((await dev(t, req.deviceToken, 'GET', '/api/me')).statusCode).toBe(401);
    const pending = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    void pending;
    const reqs = (await call(t, gm, 'GET', '/api/night')).json().gm.requests;
    expect(reqs).toEqual([expect.objectContaining({ kind: 'rejoin', displayName: 'Alice' })]);
    await call(t, gm, 'POST', `/api/requests/${reqs[0].id}/approve`);
    expect((await dev(t, req.deviceToken, 'GET', '/api/join/status')).json().status).toBe('approved');
    expect((await dev(t, req.deviceToken, 'GET', '/api/me')).json().player.displayName).toBe('Alice');
    expect((await dev(t, devices[0]!.token, 'GET', '/api/me')).json().player.displayName).toBe('Alice');
  });

  it('late join: request → approve → frozen stake adjustment + stock at average price − penalty', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 3);
    await call(t, gm, 'POST', '/api/night/adjustments', { playerId: devices[0]!.id, gold: 10, reason: 'r' });
    const r = (await call(t, null, 'POST', '/api/join', { displayName: 'Late Larry', ticker: 'LATE' })).json();
    expect(r.pending).toBe(true);
    expect((await call(t, null, 'POST', '/api/join', { displayName: 'late larry', ticker: 'LLL' })).json().error).toBe('name_taken');
    const req = (await call(t, gm, 'GET', '/api/night')).json().gm.requests[0];
    expect(req).toMatchObject({ kind: 'late_join', displayName: 'Late Larry', ticker: 'LATE' });
    // Sub GMs may approve devices (field action).
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Helper', password: 'helper pass', pin: '5555' });
    const sub = await loginAs(t, 'Helper', 'helper pass');
    const okRes = await call(t, sub, 'POST', `/api/requests/${req.id}/approve`);
    const ok = okRes.json();
    const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    const larry = st.ledger.get(String(ok.playerId))!;
    // avg earned = (30 + 20 + 20) / 3 = 23.33 → 0.75 × 23.33 − 2 = 15.50
    expect(larry).toMatchObject({ stakeH: 0, adjustmentsH: 1550, cashH: 1550 });
    const sec = st.securities.find((s) => s.id === `p:${ok.playerId}`)!;
    expect(sec.price).toBe(52.5); // avg 55 − 0.05 × 50
    // Frozen: later changes to everyone's gold don't move it.
    await call(t, gm, 'POST', '/api/night/adjustments', { playerId: devices[1]!.id, gold: 50, reason: 'r' });
    expect(computeNightState(t.ctx, currentNight(t.ctx)!.id)!.ledger.get(String(ok.playerId))!.cashH).toBe(1550);
    expect((await dev(t, r.deviceToken, 'GET', '/api/me')).json().player.ticker).toBe('LATE');
  });

  it('denied requests never get a device', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    const req = (await call(t, null, 'POST', '/api/join/rejoin', { playerId: devices[1]!.id })).json();
    const id = (await call(t, gm, 'GET', '/api/night')).json().gm.requests[0].id;
    await call(t, gm, 'POST', `/api/requests/${id}/deny`);
    expect((await dev(t, req.deviceToken, 'GET', '/api/join/status')).json().status).toBe('denied');
    expect((await dev(t, req.deviceToken, 'GET', '/api/me')).statusCode).toBe(401);
  });
});

describe('trading', () => {
  it('buy → lot locked 5 min → sell FIFO; cap, fee, rate limit, frozen states; impulse queued', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 3);
    const a = devices[0]!.token;
    const sec = `p:${devices[1]!.id}`;
    // 10 gold at 55 with 3% fee: floor((1000 − 30)/55) = 17 sh → cost 9.35 + fee 0.28 = 9.63
    const buy = await dev(t, a, 'POST', '/api/trade/buy', { securityId: sec, gold: 10 });
    expect(buy.json()).toMatchObject({ side: 'buy', sharesH: 17, cashH: -963, feeH: 28 });
    expect(t.ctx.db.prepare("SELECT cause, frac FROM impulse").all()).toEqual([{ cause: 'trade_buy', frac: 0.02 }]);
    expect((await dev(t, a, 'POST', '/api/trade/buy', { securityId: sec, gold: 5 })).json().error).toBe('rate_limited');
    runTick(t.ctx, currentNight(t.ctx)!.id); // next tick: the rate limit resets, the lockout doesn't
    expect((await dev(t, a, 'POST', '/api/trade/sell', { securityId: sec, shares: 'all' })).json().error).toBe('locked');
    expect((await dev(t, a, 'POST', '/api/trade/buy', { securityId: 'crypto', gold: 16 })).json().error).toBe('insufficient_gold'); // cash 10.37
    await call(t, gm, 'POST', '/api/night/adjustments', { playerId: devices[0]!.id, gold: 30, reason: 'test' });
    expect((await dev(t, a, 'POST', '/api/trade/buy', { securityId: 'crypto', gold: 16 })).json().error).toBe('over_cap'); // 9.63 + 16 > 25
    expect((await dev(t, a, 'POST', '/api/trade/buy', { securityId: 'crypto', gold: 0.5 })).json().error).toBe('below_minimum');

    let n = currentNight(t.ctx)!;
    const view = playerView(t.ctx, computeNightState(t.ctx, n.id)!, devices[0]!.id)!;
    expect(view.me).toMatchObject({ cashH: 2000 + 3000 - 963, capRemainingH: 2500 - 963 });
    expect(view.me.holdings[0]).toMatchObject({ securityId: sec, sharesH: 17, lots: [{ sharesH: 17, unlockNms: 5 * 60_000 }] });

    t.clock.advance(5 * 60_000);
    const sell = await dev(t, a, 'POST', '/api/trade/sell', { securityId: sec, shares: 'all' });
    expect(sell.json()).toMatchObject({ side: 'sell', sharesH: 17 });
    expect(t.ctx.db.prepare('SELECT COUNT(*) c FROM lot').get()).toEqual({ c: 0 });

    await call(t, gm, 'POST', '/api/night/pause', { minutes: 10 });
    expect((await dev(t, a, 'POST', '/api/trade/buy', { securityId: sec, gold: 5 })).json().error).toBe('market_closed');
    n = currentNight(t.ctx)!;
    expect(publicView(t.ctx, computeNightState(t.ctx, n.id)!).night.pauseUntil).toBe(t.clock.t + 10 * 60_000);
    await call(t, gm, 'POST', '/api/night/resume');
    await call(t, gm, 'POST', '/api/night/close-trading');
    expect((await dev(t, a, 'POST', '/api/trade/buy', { securityId: sec, gold: 5 })).json().error).toBe('market_closed');
    expect((await dev(t, 'bogus', 'POST', '/api/trade/buy', { securityId: sec, gold: 5 })).statusCode).toBe(401);
  });

  it('holdings stay private: others only see public data', async () => {
    const t = await makeApp();
    const { devices } = await liveNight(t, 2);
    await dev(t, devices[0]!.token, 'POST', '/api/trade/buy', { securityId: 'index', gold: 5 });
    const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    const bobView = playerView(t.ctx, st, devices[1]!.id)!;
    expect(bobView.me.holdings).toEqual([]);
    const s = JSON.stringify(bobView);
    for (const k of [...FORBIDDEN_KEYS, ...GM_ONLY_KEYS]) expect(s).not.toContain(k);
    expect(s).not.toContain('"lots"' + ':[{"sharesH":9'); // Alice's lot is not in Bob's view
  });

  it('GM marks a player left (stock stays listed and decays) and overrides tickers', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    await call(t, gm, 'PATCH', `/api/players/${devices[1]!.id}`, { ticker: 'BBBB' });
    await call(t, gm, 'POST', `/api/players/${devices[1]!.id}/leave`);
    const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    const sec = st.securities.find((s) => s.id === `p:${devices[1]!.id}`)!;
    expect(sec).toMatchObject({ ticker: 'BBBB', left: true });
    expect((await dev(t, devices[1]!.token, 'POST', '/api/trade/buy', { securityId: 'index', gold: 5 })).json().error).toBe('player_left');
    expect((await call(t, null, 'GET', '/api/join')).json().players.map((p: { displayName: string }) => p.displayName)).toEqual(['Alice']);
  });
});
