import { describe, expect, it } from 'vitest';
import { computeNightState, currentNight } from '../src/services/state';
import { publicView } from '../src/services/views';
import { call, liveNight, makeApp } from './helpers';

describe('GM finale control', () => {
  it('steps forward/back while playing, pauses (phones held) and plays on; TV state carries the clock', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 3);
    await call(t, gm, 'POST', '/api/night/end');
    const night = () => publicView(t.ctx, computeNightState(t.ctx, currentNight(t.ctx)!.id)!).night!;
    const el = () => {
      const c = night().finaleCtl!;
      return c.pausedEl ?? (t.clock.t - c.start) / 1000;
    };
    const segs = night().finaleSegments!;
    expect(segs.slice(0, 4).map((x) => x.label)).toEqual(['collapse', 'place3', 'place2', 'place1']);
    expect(el()).toBe(0);
    const ctl = (action: string) => call(t, gm, 'POST', '/api/night/finale/control', { action });
    expect((await ctl('next')).statusCode).toBe(200);
    expect(el()).toBe(segs[1]!.at); // jumped to 3rd place, still playing
    t.clock.advance(2000);
    expect(el()).toBe(segs[1]!.at + 2);
    await ctl('prev');
    expect(el()).toBe(segs[1]!.at); // 2 s into a part: back to its start (like a music player)…
    await ctl('prev');
    expect(el()).toBe(0); // …and again: the part before
    await ctl('pause');
    t.clock.advance(60_000);
    expect(el()).toBe(0); // frozen
    expect(night().recapUntil!).toBeGreaterThan(t.clock.t + 3600_000); // phones held while paused
    await ctl('next');
    expect(el()).toBe(segs[1]!.at); // stepping while paused stays paused
    await ctl('play');
    t.clock.advance(1000);
    expect(el()).toBe(segs[1]!.at + 1);
    expect((await ctl('dance')).statusCode).toBe(409);
  });
});
