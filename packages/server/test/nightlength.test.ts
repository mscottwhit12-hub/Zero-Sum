import { describe, expect, it } from 'vitest';
import { computeNightState, currentNight } from '../src/services/state';
import { gmView } from '../src/services/views';
import { call, liveNight, makeApp } from './helpers';

const view = (t: Awaited<ReturnType<typeof makeApp>>) => gmView(t.ctx, computeNightState(t.ctx, currentNight(t.ctx)!.id)!);
const quarters = (t: Awaited<ReturnType<typeof makeApp>>) => computeNightState(t.ctx, currentNight(t.ctx)!.id)!.quarters;

describe('night length after the start', () => {
  it('keeps started quarters, re-spreads the rest, refuses lengths that are too short', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2); // 300 min: buffer 30, quarters of 60 starting 30/90/150/210
    t.clock.advance(100 * 60_000); // inside Q2
    const before = quarters(t);
    const r = await call(t, gm, 'PATCH', '/api/night', { lengthMinutes: 360 });
    expect(r.statusCode).toBe(200);
    const after = quarters(t);
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2)); // Q1 done, Q2 running: unchanged
    // Q3, Q4 spread from 150 to 360 - 36 = 324 → 87 each
    expect(after[2]!.startMin).toBeCloseTo(150);
    expect(after[3]!.endMin).toBeCloseTo(324);
    expect(after[3]!.endMin - after[3]!.startMin).toBeCloseTo(87);
    expect((await call(t, gm, 'PATCH', '/api/night', { lengthMinutes: 90 })).json().error).toBe('bad_length'); // < played
    expect((await call(t, gm, 'PATCH', '/api/night', { lengthMinutes: 170 })).json().error).toBe('bad_length'); // future quarters too short
    expect(view(t).night!.lengthMinutes).toBe(360);
  });

  it('running over: offers biggest extension first; no → next game; yes → extends and repeats at the new end', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 4, { start: false });
    // 60-minute night (no polls in the way)
    await call(t, gm, 'PATCH', '/api/night', { lengthMinutes: 60 });
    await call(t, gm, 'POST', '/api/night/start');
    const ids = devices.map((d) => d.id);
    const long = (await call(t, gm, 'POST', '/api/games', { name: 'Long', participants: ids.slice(0, 2), plannedDurationHours: 4 })).json().game;
    const short = (await call(t, gm, 'POST', '/api/games', { name: 'Short', participants: ids.slice(2), plannedDurationHours: 2 })).json().game;
    await call(t, gm, 'POST', `/api/games/${long.id}/start`);
    await call(t, gm, 'POST', `/api/games/${short.id}/start`);
    expect(view(t).gm.prompts.overrun).toBeNull();
    t.clock.advance(61 * 60_000);
    expect(view(t).gm.prompts.overrun).toMatchObject({ gameId: long.id, extendMinutes: 30 }); // 240 / 8
    await call(t, gm, 'POST', '/api/night/overrun', { gameId: long.id, accept: false });
    expect(view(t).gm.prompts.overrun).toMatchObject({ gameId: short.id, extendMinutes: 15 });
    await call(t, gm, 'POST', '/api/night/overrun', { gameId: short.id, accept: true });
    await call(t, gm, 'POST', '/api/night/overrun', { gameId: short.id, accept: true }); // double tap: no second extension
    expect(view(t).night!.lengthMinutes).toBe(75);
    expect(view(t).gm.prompts.overrun).toBeNull(); // new end not reached yet
    t.clock.advance(15 * 60_000);
    expect(view(t).gm.prompts.overrun).toMatchObject({ gameId: long.id }); // cycle repeats, declines reset
  });
});

describe('scheduling in the past', () => {
  it('a game scheduled for a time that has passed just starts (live night only)', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    const g = (await call(t, gm, 'POST', '/api/games', { name: 'Late one', participants: devices.map((d) => d.id), plannedStart: t.ctx.now() - 10 * 60_000 })).json().game;
    expect(g.status).toBe('active');
    const f = (await call(t, gm, 'POST', '/api/games', { name: 'Later', participants: devices.map((d) => d.id), plannedStart: t.ctx.now() + 60 * 60_000 })).json().game;
    expect(f.status).toBe('scheduled');
  });
});
