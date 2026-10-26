import { describe, expect, it } from 'vitest';
import { transition } from '../src/services/night';
import { createPlayer } from '../src/services/players';
import { computeNightState, currentNight } from '../src/services/state';
import { call, liveNight, loginAs, makeApp, setupMaster } from './helpers';

describe('state machine (pure)', () => {
  it('allows only the documented transitions', () => {
    expect(transition('setup', false, 'openJoins')).toEqual({ status: 'joins_open', tradingClosed: false });
    expect(transition('joins_open', false, 'start')).toEqual({ status: 'live', tradingClosed: false });
    expect(transition('live', false, 'pause')).toEqual({ status: 'paused', tradingClosed: false });
    expect(transition('paused', false, 'resume')).toEqual({ status: 'live', tradingClosed: false });
    expect(transition('paused', false, 'closeTrading')).toEqual({ status: 'paused', tradingClosed: true });
    expect(transition('live', true, 'closeTrading')).toEqual({ error: 'already_closed' });
    expect(transition('live', false, 'end')).toEqual({ status: 'ended', tradingClosed: true });
    expect(transition('ended', true, 'archive')).toEqual({ status: 'archived', tradingClosed: true });
    for (const [s, a] of [
      ['setup', 'start'],
      ['live', 'resume'],
      ['paused', 'pause'],
      ['joins_open', 'end'],
      ['ended', 'resume'],
      ['live', 'archive'],
    ] as const)
      expect(transition(s, false, a)).toEqual({ error: 'bad_transition' });
  });
});

describe('night lifecycle', () => {
  it('create → joins → start → pause/resume → close trading → end → archive → new night', async () => {
    const t = await makeApp();
    const gm = await setupMaster(t);
    expect((await call(t, gm, 'POST', '/api/nights', { name: 'Fri', lengthMinutes: 300 })).statusCode).toBe(200);
    expect((await call(t, gm, 'POST', '/api/nights', { name: 'Again' })).json().error).toBe('night_in_progress');
    expect((await call(t, gm, 'POST', '/api/night/start')).json().error).toBe('bad_transition');
    await call(t, gm, 'POST', '/api/night/open-joins');
    expect((await call(t, gm, 'POST', '/api/night/start')).json().error).toBe('no_players');
    createPlayer(t.ctx, { displayName: 'Alice', ticker: 'ali' });
    createPlayer(t.ctx, { displayName: 'Bob', ticker: 'BOB' });
    expect(() => createPlayer(t.ctx, { displayName: 'alice', ticker: 'ALX' })).toThrow(/name_taken/);
    expect(() => createPlayer(t.ctx, { displayName: 'Al', ticker: 'ALI' })).toThrow(/ticker_taken/);
    expect(() => createPlayer(t.ctx, { displayName: 'Cee', ticker: 'IDX' })).toThrow(/ticker_taken/);

    expect((await call(t, gm, 'POST', '/api/night/start')).json()).toEqual({ status: 'live', tradingClosed: false });
    expect(() => createPlayer(t.ctx, { displayName: 'Late', ticker: 'LAT' })).toThrow(/joins_closed/);
    const n = currentNight(t.ctx)!;
    let st = computeNightState(t.ctx, n.id)!;
    expect(st.securities.map((s) => s.kind)).toEqual(['player', 'player', 'index', 'crypto', 'event', 'event', 'dead']);
    expect(st.securities[0]!.price).toBe(55);
    expect(st.standings.map((r) => r.netWorthH)).toEqual([2000, 2000]); // stake 20.0 each

    // Night clock excludes pauses.
    t.clock.advance(10 * 60_000);
    await call(t, gm, 'POST', '/api/night/pause');
    t.clock.advance(30 * 60_000);
    expect(computeNightState(t.ctx, n.id)!.nightMs).toBe(10 * 60_000);
    await call(t, gm, 'POST', '/api/night/resume');
    t.clock.advance(5 * 60_000);
    expect(computeNightState(t.ctx, n.id)!.nightMs).toBe(15 * 60_000);

    expect((await call(t, gm, 'POST', '/api/night/close-trading')).json()).toEqual({ status: 'live', tradingClosed: true });
    expect((await call(t, gm, 'POST', '/api/night/end')).json()).toEqual({ status: 'ended', tradingClosed: true });
    st = computeNightState(t.ctx, n.id)!;
    t.clock.advance(60 * 60_000);
    expect(computeNightState(t.ctx, n.id)!.nightMs).toBe(st.nightMs); // frozen at end
    expect(t.ctx.db.prepare('SELECT COUNT(*) c FROM standings_snapshot').get()).toEqual({ c: 1 });
    expect((await call(t, gm, 'POST', '/api/night/archive')).json().status).toBe('archived');
    expect((await call(t, gm, 'POST', '/api/nights', { name: 'Next' })).statusCode).toBe(200);
  });

  it('End while paused closes the pause and ends the night', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    await call(t, gm, 'POST', '/api/night/pause');
    expect((await call(t, gm, 'POST', '/api/night/end')).json().status).toBe('ended');
    expect(t.ctx.db.prepare('SELECT COUNT(*) c FROM night_pause WHERE ended_at IS NULL').get()).toEqual({ c: 0 });
  });

  it('End auto-sells lots at the pre-crash price with the 10% profit fee', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    const n = currentNight(t.ctx)!;
    // Alice holds 0.40 shares of her own stock bought for 18.00; price is 55 → 22.00 → profit 4.00 → fee 0.40
    t.ctx.db
      .prepare('INSERT INTO lot (night_id, player_id, security_id, shares_h, cost_basis_h, created_nms, unlock_nms) VALUES (?,?,?,?,?,?,?)')
      .run(n.id, devices[0]!.id, `p:${devices[0]!.id}`, 40, 1800, 0, 1e12);
    t.ctx.db.prepare("INSERT INTO trade (night_id, player_id, security_id, side, shares_h, price, cash_h, tick, created_at) VALUES (?,?,?, 'buy', 40, 45, -1800, 0, 0)").run(n.id, devices[0]!.id, `p:${devices[0]!.id}`);
    await call(t, gm, 'POST', '/api/night/end');
    const forced = t.ctx.db.prepare('SELECT cash_h, fee_h, forced FROM trade WHERE forced = 1').all();
    expect(forced).toEqual([{ cash_h: 2160, fee_h: 40, forced: 1 }]);
    expect(t.ctx.db.prepare('SELECT COUNT(*) c FROM lot').get()).toEqual({ c: 0 });
    const ledger = computeNightState(t.ctx, n.id)!.ledger;
    expect(ledger.get(String(devices[0]!.id))!.cashH).toBe(2000 - 1800 + 2160);
  });

  it('Sub GMs cannot run night controls', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Helper', password: 'helper pass', pin: '5555' });
    const sub = await loginAs(t, 'Helper', 'helper pass');
    expect((await call(t, sub, 'POST', '/api/night/pause')).statusCode).toBe(403);
  });
});

describe('broadcasts', () => {
  it('creating a night pushes an update to open screens', async () => {
    const t = await makeApp();
    const gm = await setupMaster(t);
    const { bus, events } = (await import('../src/context')).recordingBus();
    t.ctx.bus = bus;
    await call(t, gm, 'POST', '/api/nights', { name: 'N' });
    expect(events.some((e) => e.channel === 'refresh')).toBe(true);
  });
});

describe('settings and gold', () => {
  it('live settings changes re-score immediately; invalid changes are rejected; null resets', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const n = currentNight(t.ctx)!;
    expect((await call(t, gm, 'PATCH', '/api/night/settings', { market: { tickSeconds: 5 } })).json().error).toBe('bad_settings');
    const res = await call(t, gm, 'PATCH', '/api/night/settings', { stake: { startingGold: 30 } });
    expect(res.json().resolved.stake.startingGold).toBe(30);
    expect(computeNightState(t.ctx, n.id)!.standings[0]!.netWorthH).toBe(3000);
    await call(t, gm, 'PATCH', '/api/night/settings', { stake: null });
    expect(computeNightState(t.ctx, n.id)!.standings[0]!.netWorthH).toBe(2000);
  });

  it('manual adjustments need a reason and change gold', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    expect((await call(t, gm, 'POST', '/api/night/adjustments', { playerId: devices[1]!.id, gold: 5 })).json().error).toBe('reason_required');
    expect((await call(t, gm, 'POST', '/api/night/adjustments', { playerId: devices[1]!.id, gold: 5.25, reason: 'House rule' })).json().goldH).toBe(525);
    const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    expect(st.standings[0]).toMatchObject({ playerId: String(devices[1]!.id), netWorthH: 2525, rank: 1 });
    const audit = t.ctx.db.prepare("SELECT action FROM audit_log WHERE action = 'gold.adjust'").all();
    expect(audit).toHaveLength(1);
  });

  it('night length is editable live and moves the quarters', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    await call(t, gm, 'PATCH', '/api/night', { lengthMinutes: 200 });
    const q = computeNightState(t.ctx, currentNight(t.ctx)!.id)!.quarters;
    expect(q.map((x) => [x.startMin, x.endMin])).toEqual([
      [20, 60],
      [60, 100],
      [100, 140],
      [140, 180],
    ]);
  });
});
