import { describe, expect, it } from 'vitest';
import { queueImpulse, runTick } from '../src/services/market';
import { computeNightState, currentNight } from '../src/services/state';
import { tickOnce } from '../src/tickLoop';
import { call, liveNight, makeApp } from './helpers';

describe('market tick', () => {
  it('writes one price row per security, consumes impulses, and moves prices toward fair', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 3);
    const n = currentNight(t.ctx)!;
    // Alice pulls ahead on earned gold → her fair rises to the top of the range.
    await call(t, gm, 'POST', '/api/night/adjustments', { playerId: devices[0]!.id, gold: 10, reason: 'test' });
    queueImpulse(t.ctx, n.id, { securityId: `p:${devices[1]!.id}`, frac: 0.02, cause: 'trade_buy' });
    expect(runTick(t.ctx, n.id)).toBe(true);
    const st = computeNightState(t.ctx, n.id)!;
    expect(st.night.tick_count).toBe(1);
    expect(t.ctx.db.prepare('SELECT COUNT(*) c FROM price').get()).toEqual({ c: st.securities.length });
    expect(t.ctx.db.prepare('SELECT COUNT(*) c FROM impulse WHERE consumed_tick IS NULL').get()).toEqual({ c: 0 });
    const price = (pid: number) => st.securities.find((s) => s.id === `p:${pid}`)!.price;
    expect(price(devices[0]!.id)).toBeGreaterThan(55); // toward fair 72.5
    expect(price(devices[2]!.id)).toBeLessThan(55); // tied for last → fair 46.25
    expect(price(devices[1]!.id)).toBeGreaterThan(price(devices[2]!.id)); // same fair, plus the +2% impulse
  });

  it('respects tickSeconds, pause, and trading close', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    expect(tickOnce(t.ctx)).toBe(false); // started just now: not due
    t.clock.advance(19_000);
    expect(tickOnce(t.ctx)).toBe(false);
    t.clock.advance(1_000);
    expect(tickOnce(t.ctx)).toBe(true);
    expect(tickOnce(t.ctx)).toBe(false);

    await call(t, gm, 'POST', '/api/night/pause');
    t.clock.advance(120_000);
    expect(tickOnce(t.ctx)).toBe(false);
    await call(t, gm, 'POST', '/api/night/resume');
    expect(tickOnce(t.ctx)).toBe(false); // no catch-up burst on resume
    t.clock.advance(20_000);
    expect(tickOnce(t.ctx)).toBe(true);

    await call(t, gm, 'POST', '/api/night/close-trading');
    t.clock.advance(60_000);
    expect(tickOnce(t.ctx)).toBe(false);
    expect(currentNight(t.ctx)!.tick_count).toBe(2);
  });

  it('tick seconds is live-tunable', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    await call(t, gm, 'PATCH', '/api/night/settings', { market: { tickSeconds: 30 } });
    t.clock.advance(20_000);
    expect(tickOnce(t.ctx)).toBe(false);
    t.clock.advance(10_000);
    expect(tickOnce(t.ctx)).toBe(true);
  });

  it('is deterministic per night and tick (restart-safe randomness)', async () => {
    const a = await makeApp();
    const b = await makeApp();
    await liveNight(a, 3);
    await liveNight(b, 3);
    for (let i = 0; i < 5; i++) {
      runTick(a.ctx, currentNight(a.ctx)!.id);
      runTick(b.ctx, currentNight(b.ctx)!.id);
    }
    const crypto = (x: typeof a) => computeNightState(x.ctx, currentNight(x.ctx)!.id)!.securities.find((s) => s.kind === 'crypto')!.price;
    expect(crypto(a)).toBe(crypto(b));
  });

  it('tracks the current quarter on the night clock (pause excluded)', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    tickOnce(t.ctx);
    expect(currentNight(t.ctx)!.current_quarter).toBeNull();
    t.clock.advance(20 * 60_000);
    await call(t, gm, 'POST', '/api/night/pause');
    t.clock.advance(60 * 60_000); // paused time doesn't count
    await call(t, gm, 'POST', '/api/night/resume');
    tickOnce(t.ctx);
    expect(currentNight(t.ctx)!.current_quarter).toBeNull(); // 20 min of night: still in the 30-min buffer
    t.clock.advance(10 * 60_000);
    tickOnce(t.ctx);
    expect(currentNight(t.ctx)!.current_quarter).toBe(1);
  });
});
