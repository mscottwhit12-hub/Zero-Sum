import { describe, expect, it } from 'vitest';
import { priceSeries, thin } from '../src/services/market';
import { currentNight } from '../src/services/state';
import { tickOnce } from '../src/tickLoop';
import { FORBIDDEN_KEYS, liveNight, makeApp } from './helpers';

const as = (t: Awaited<ReturnType<typeof makeApp>>, token: string | null, url: string) => t.app.inject({ method: 'GET', url, headers: token ? { 'x-device-token': token } : {} });

describe('thin', () => {
  it('keeps everything when short, else spreads evenly and keeps the first and last', () => {
    expect(thin([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const out = thin(rows, 200);
    expect(out.length).toBe(200);
    expect(out[0]).toBe(0);
    expect(out[199]).toBe(999);
    expect(out.every((v, i) => i === 0 || v > out[i - 1]!)).toBe(true);
  });
});

describe('stock chart history', () => {
  async function night(ticks: number) {
    const t = await makeApp();
    const { devices } = await liveNight(t, 3);
    for (let i = 0; i < ticks; i++) {
      t.clock.advance(20_000);
      tickOnce(t.ctx);
    }
    return { t, devices, nid: currentNight(t.ctx)!.id };
  }

  it('returns only the asked window; no minutes means the whole night', async () => {
    const { t, devices } = await night(100); // 100 ticks × 20 s ≈ 33 min
    const id = `p:${devices[0]!.id}`;
    const get = async (q = '') => (await as(t, devices[1]!.token, `/api/market/${encodeURIComponent(id)}/history${q}`)).json() as { prices: number[]; from: number; to: number };
    const full = await get();
    expect(full.prices.length).toBe(100);
    const ten = await get('?minutes=10');
    expect(ten.prices.length).toBe(31); // 10 min / 20 s, plus the tick sitting on the window edge
    expect(ten.to).toBe(full.to);
    expect(ten.from).toBeGreaterThanOrEqual(t.ctx.now() - 10 * 60_000);
    expect((await get('?minutes=30')).prices.length).toBeGreaterThan(ten.prices.length);
    expect((await get('?minutes=480')).prices.length).toBe(100); // longer than the night so far: everything
    expect(ten.prices.at(-1)).toBe(full.prices.at(-1));
  });

  it('thins a long night to a drawable size', async () => {
    const { t, nid } = await night(5);
    expect(priceSeries(t.ctx, nid, 'index', null, 3).prices.length).toBeLessThanOrEqual(3);
  });

  it('is private to players of this night, validates input and leaks no hidden numbers', async () => {
    const { t, devices } = await night(3);
    const id = `p:${devices[0]!.id}`;
    expect((await as(t, null, `/api/market/${id}/history`)).statusCode).toBe(401);
    const tok = devices[1]!.token;
    expect((await as(t, tok, '/api/market/nope/history')).statusCode).toBe(404);
    expect((await as(t, tok, `/api/market/${id}/history?minutes=-5`)).statusCode).toBe(400);
    expect((await as(t, tok, `/api/market/${id}/history?minutes=abc`)).statusCode).toBe(400);
    const body = (await as(t, tok, `/api/market/${id}/history?minutes=10`)).body;
    for (const k of FORBIDDEN_KEYS) expect(body).not.toContain(k);
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['from', 'prices', 'to']);
  });

  it('a window with fewer than two ticks still returns the latest two', async () => {
    const { t, nid, devices } = await night(4);
    t.clock.advance(60 * 60_000); // an hour passes with no ticks (e.g. paused)
    expect(priceSeries(t.ctx, nid, `p:${devices[0]!.id}`, 10).prices.length).toBe(2);
  });
});
