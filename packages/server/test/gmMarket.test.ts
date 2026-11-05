import { describe, expect, it } from 'vitest';
import { call, liveNight, makeApp } from './helpers';

describe('GM stock detail', () => {
  it('a GM can read a stock’s price history; a phone can’t use the GM route', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    const id = `p:${devices[0]!.id}`;
    const ok = await call(t, gm, 'GET', `/api/gm/market/${encodeURIComponent(id)}/history?minutes=30`);
    expect(ok.statusCode).toBe(200);
    expect(Array.isArray(ok.json().prices)).toBe(true);
    const phone = await t.app.inject({ method: 'GET', url: `/api/gm/market/${encodeURIComponent(id)}/history`, headers: { 'x-device-token': devices[0]!.token } });
    expect(phone.statusCode).toBe(401);
  });
});
