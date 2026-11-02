import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicPlayer, ShuffleQueue, sane, shuffled, type AudioLike, type MusicCfg } from './music';

/** A stand-in for an <audio> element: setting src restarts it; `fire` raises an event. */
function fakeAudio(duration: number) {
  const listeners: Record<string, (() => void)[]> = {};
  let src = '';
  const el = {
    get src() {
      return src;
    },
    set src(v: string) {
      src = v;
      el.currentTime = 0;
    },
    loop: false,
    volume: 0,
    currentTime: 0,
    duration,
    paused: true,
    plays: 0,
    play() {
      el.paused = false;
      el.plays++;
      return Promise.resolve();
    },
    pause() {
      el.paused = true;
    },
    addEventListener(type: string, fn: () => void) {
      (listeners[type] ??= []).push(fn);
    },
    fire(type: string) {
      (listeners[type] ?? []).forEach((f) => f());
    },
  };
  return el;
}

const cfg = (o: Partial<MusicCfg> = {}): MusicCfg => ({
  key: 'rule|focus',
  source: 'rule',
  tag: 'focus',
  tracks: [
    { id: 1, name: 'a', url: '/a' },
    { id: 2, name: 'b', url: '/b' },
    { id: 3, name: 'c', url: '/c' },
  ],
  repeat: false,
  skip: 0,
  volume: 0.6,
  crossfadeMs: 4000,
  duckLevel: 0.25,
  duckReleaseMs: 2000,
  ...o,
});

function setup(duration = 30) {
  const els: ReturnType<typeof fakeAudio>[] = [];
  const reports: (number | null)[] = [];
  const p = new MusicPlayer(
    (id) => reports.push(id),
    () => {
      const e = fakeAudio(duration);
      els.push(e);
      return e as unknown as AudioLike;
    },
    () => 0.5,
  );
  /** Run `sec` seconds of music: time passes in 100 ms steps and playing elements advance. */
  const run = (sec: number) => {
    for (let i = 0; i < sec * 10; i++) {
      p.tick(100);
      for (const e of els) if (!e.paused) e.currentTime += 0.1;
    }
  };
  return { p, els, reports, run, plays: () => els.reduce((n, e) => n + e.plays, 0) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('shuffle', () => {
  it('shuffled keeps every item and avoids starting with the one just played', () => {
    for (let i = 0; i < 50; i++) {
      const out = shuffled([1, 2, 3, 4], 2);
      expect([...out].sort()).toEqual([1, 2, 3, 4]);
      expect(out[0]).not.toBe(2);
    }
    expect(shuffled([7], 7)).toEqual([7]);
    expect(shuffled([])).toEqual([]);
  });
  it('ShuffleQueue deals every track once per round, never repeating across the seam', () => {
    const q = new ShuffleQueue();
    q.reset([1, 2, 3, 4]);
    const seen = Array.from({ length: 40 }, () => q.next()!);
    for (let r = 0; r < 10; r++) expect(new Set(seen.slice(r * 4, r * 4 + 4)).size).toBe(4);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(new ShuffleQueue().next()).toBeNull();
  });
  it('a track added or removed mid-round fits in without repeats', () => {
    const q = new ShuffleQueue();
    q.reset([1, 2, 3]);
    q.next();
    q.setIds([1, 2, 3, 4]);
    const rest = [q.next(), q.next(), q.next()];
    expect(new Set(rest).size).toBe(3);
    q.setIds([1]);
    expect(q.next()).toBe(1);
  });
});

describe('MusicPlayer', () => {
  it('is silent until Enable audio, then starts a track, fades it in and reports it', () => {
    const s = setup();
    s.p.update(cfg());
    expect(s.reports).toEqual([]);
    expect(s.els.every((e) => e.paused)).toBe(true);
    s.p.enable();
    expect(s.reports.length).toBe(1);
    s.run(2);
    expect(s.els[0]!.volume).toBeCloseTo(0.3, 1); // halfway through a 4 s fade-in at volume 0.6
    s.run(3);
    expect(s.els[0]!.volume).toBeCloseTo(0.6, 2);
  });

  it('starts the next track before the end, overlapping, then pauses the old one', () => {
    const s = setup(30);
    s.p.enable();
    s.p.update(cfg());
    s.run(22);
    expect(s.reports.length).toBe(1); // 8 s left of 30: not yet
    s.run(5); // inside the last 4 s: the next track has started under it
    expect(s.reports.length).toBe(2);
    expect(s.els.every((e) => !e.paused)).toBe(true);
    s.run(6); // the old one has faded out and stopped
    expect(s.els.some((e) => e.paused)).toBe(true);
  });

  it('plays every track before any repeats, round after round', () => {
    const s = setup(30);
    s.p.enable();
    s.p.update(cfg());
    s.run(400);
    const r = s.reports as number[];
    expect(new Set(r.slice(0, 3)).size).toBe(3);
    expect(new Set(r.slice(3, 6)).size).toBe(3);
    expect(r[3]).not.toBe(r[2]);
  });

  it('Skip moves to the next track once; the same skip value again does nothing', () => {
    const s = setup(300);
    s.p.enable();
    s.p.update(cfg());
    s.run(5);
    const n = s.reports.length;
    s.p.update(cfg({ skip: 1 }));
    expect(s.reports.length).toBe(n + 1);
    s.p.update(cfg({ skip: 1 }));
    expect(s.reports.length).toBe(n + 1);
  });

  it('Repeat holds the current track (loop on), and turning it off lets the music move on', () => {
    const s = setup(30);
    s.p.enable();
    s.p.update(cfg({ repeat: true }));
    expect(s.reports.length).toBe(1);
    expect(s.els.some((e) => !e.paused && e.loop)).toBe(true);
    s.run(120);
    expect(s.reports.length).toBe(1);
    s.p.update(cfg({ repeat: false }));
    s.run(40);
    expect(s.reports.length).toBeGreaterThan(1);
  });

  it('a one-track pool keeps playing itself with a crossfade', () => {
    const s = setup(20);
    s.p.enable();
    s.p.update(cfg({ tracks: [{ id: 7, name: 'only', url: '/o' }] }));
    s.run(60);
    expect(s.plays()).toBeGreaterThanOrEqual(3);
  });

  it('ducks under a stinger to the set level, then comes back over the release time', () => {
    const s = setup(300);
    s.p.enable();
    s.p.update(cfg());
    s.run(10);
    const full = s.els[0]!.volume;
    const stinger = fakeAudio(5);
    s.p.duckWhile(stinger);
    s.run(1);
    expect(s.els[0]!.volume).toBeLessThanOrEqual(full * 0.26);
    stinger.fire('ended');
    s.run(1);
    expect(s.els[0]!.volume).toBeLessThan(full * 0.8); // still on its way back
    s.run(2);
    expect(s.els[0]!.volume).toBeCloseTo(full, 2);
    s.p.duckFor(1500);
    s.run(1);
    expect(s.els[0]!.volume).toBeLessThan(full * 0.5);
    s.run(6);
    expect(s.els[0]!.volume).toBeCloseTo(full, 2);
  });

  it('a new pool crossfades in; a null config fades the music out and reports it stopped', () => {
    const s = setup(300);
    s.p.enable();
    s.p.update(cfg());
    s.run(8);
    s.p.update(cfg({ key: 'manual|ambient', tracks: [{ id: 9, name: 'z', url: '/z' }] }));
    expect(s.reports.at(-1)).toBe(9);
    s.run(10);
    s.p.update(null);
    expect(s.reports.at(-1)).toBeNull();
    s.run(1);
    expect(s.els.some((e) => e.volume > 0)).toBe(true); // fading, not cut
    s.run(6);
    expect(s.els.every((e) => e.paused && e.volume === 0)).toBe(true);
  });

  it('enabling audio with nothing configured plays and reports nothing', () => {
    const s = setup();
    s.p.enable();
    expect(s.reports).toEqual([]);
    expect(s.els.every((e) => e.paused)).toBe(true);
  });

  it('a malformed payload cannot throw or set an invalid volume', () => {
    const s = setup(300);
    s.p.enable();
    const bad = { ...cfg(), volume: NaN, crossfadeMs: -5, duckLevel: 7, tracks: [...cfg().tracks, { id: 'x', url: 5 }, null] } as unknown as MusicCfg;
    expect(() => s.p.update(bad)).not.toThrow();
    s.run(5);
    for (const e of s.els) expect(e.volume >= 0 && e.volume <= 1).toBe(true);
    expect(sane({ tracks: 'nope' } as unknown as MusicCfg)).toBeNull();
    expect(sane(null)).toBeNull();
    expect(sane(bad)!.tracks.length).toBe(3);
    expect(sane(bad)!.volume).toBe(0.6);
    expect(() => s.p.update(undefined as unknown as MusicCfg)).not.toThrow();
  });

  it('a failing report callback does not stop the music', () => {
    const els: ReturnType<typeof fakeAudio>[] = [];
    const p = new MusicPlayer(
      () => {
        throw new Error('socket gone');
      },
      () => {
        const e = fakeAudio(30);
        els.push(e);
        return e as unknown as AudioLike;
      },
      () => 0.5,
    );
    p.enable();
    expect(() => p.update(cfg())).not.toThrow();
    expect(els.some((e) => !e.paused)).toBe(true);
  });

  it('an empty pool is quiet', () => {
    const s = setup();
    s.p.enable();
    s.p.update(cfg({ key: 'none|focus', tracks: [] }));
    expect(s.els.every((e) => e.paused)).toBe(true);
  });

  it('a track shorter than the crossfade does not chain-start the whole pool at once', () => {
    const s = setup(3);
    s.p.enable();
    s.p.update(cfg());
    s.run(12);
    expect(s.plays()).toBeLessThanOrEqual(10);
  });

  it('gives up after several broken tracks in a row instead of looping on errors', () => {
    const s = setup(30);
    s.p.enable();
    s.p.update(cfg());
    for (let i = 0; i < 6; i++) {
      for (const e of s.els) e.fire('error');
      vi.advanceTimersByTime(600);
    }
    expect(s.reports.at(-1)).toBeNull();
    // Later state updates don't hammer the broken pool again...
    const plays = s.plays();
    for (let i = 0; i < 5; i++) s.p.update(cfg());
    expect(s.plays()).toBe(plays);
    // ...but a Skip tries again.
    s.p.update(cfg({ skip: 1 }));
    expect(s.plays()).toBe(plays + 1);
  });
});
