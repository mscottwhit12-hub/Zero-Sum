import { describe, expect, it } from 'vitest';
import { computeNightState, currentNight } from '../src/services/state';
import { tvView } from '../src/services/views';
import { call, liveNight, makeApp } from './helpers';

describe('table rotation', () => {
  it('turns in 15° steps, wraps 0–345, keeps seats; shown in the seating view', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const id = (await call(t, gm, 'POST', '/api/tables', { name: 'Main', seats: 4 })).json().id;
    const rot = async (rotation: unknown) => {
      expect((await call(t, gm, 'PATCH', `/api/tables/${id}`, { rotation })).statusCode).toBe(200);
      return tvView(t.ctx, computeNightState(t.ctx, currentNight(t.ctx)!.id)!).seating.find((x) => x.id === id)!.rotation;
    };
    expect(await rot(15)).toBe(15);
    expect(await rot(22)).toBe(15); // snaps
    expect(await rot(-15)).toBe(345); // wraps
    expect(await rot(360)).toBe(0);
    expect(await rot('junk')).toBe(0); // ignored
    expect(await rot(90)).toBe(90);
    // other edits keep it
    await call(t, gm, 'PATCH', `/api/tables/${id}`, { name: 'Big' });
    expect(tvView(t.ctx, computeNightState(t.ctx, currentNight(t.ctx)!.id)!).seating.find((x) => x.id === id)!).toMatchObject({ name: 'Big', rotation: 90, seats: 4 });
  });
});
