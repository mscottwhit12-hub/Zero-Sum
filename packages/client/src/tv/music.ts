/**
 * TV music player: plays the tag pool the server picked. The server decides WHAT (the pool, volume, fade and duck
 * settings, Repeat, Skip); this decides the order and does the audio:
 *  - shuffles the pool with no repeats until every track has played (a one-track pool just loops),
 *  - crossfades into the next track before the current one ends,
 *  - ducks (dips) under a stinger or cue and comes back,
 *  - tells the server which track it started, so the GM console can show it.
 * Kept out of App.svelte on purpose. `tick()` is public and the clock/audio are injectable so it can be tested.
 */
import type { TvMusic } from '../shared/types';

export type MusicCfg = TvMusic;

const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** The server's payload is trusted, but a bad number must never reach `audio.volume` (it throws) or stop the TV: clamp and default. */
export function sane(cfg: MusicCfg | null | undefined): MusicCfg | null {
  if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.tracks)) return null;
  return {
    key: String(cfg.key ?? ''),
    source: cfg.source,
    tag: cfg.tag ?? null,
    tracks: cfg.tracks.filter((t) => t && typeof t.id === 'number' && typeof t.url === 'string' && t.url),
    repeat: !!cfg.repeat,
    skip: num(cfg.skip, 0, 0, 1e9),
    volume: num(cfg.volume, 0.6, 0, 1),
    crossfadeMs: num(cfg.crossfadeMs, 4000, 0, 15_000),
    duckLevel: num(cfg.duckLevel, 0.25, 0, 1),
    duckReleaseMs: num(cfg.duckReleaseMs, 2000, 0, 10_000),
  };
}

/** Fisher–Yates. The first item is never `avoidFirst` when there is a choice, so a reshuffle doesn't replay the last track. */
export function shuffled<T>(items: readonly T[], avoidFirst?: T, rnd: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  if (a.length > 1 && avoidFirst !== undefined && a[0] === avoidFirst) {
    const k = 1 + Math.floor(rnd() * (a.length - 1));
    [a[0], a[k]] = [a[k]!, a[0]!];
  }
  return a;
}

/** Endless shuffle: every track once, then a fresh shuffle. */
export class ShuffleQueue {
  private ids: number[] = [];
  private order: number[] = [];
  private pos = -1;
  private last: number | undefined;
  constructor(private rnd: () => number = Math.random) {}

  /** Start over with a new pool. */
  reset(ids: number[]) {
    this.ids = [...ids];
    this.order = [];
    this.pos = -1;
    this.last = undefined;
  }

  /** The pool changed under us (a track was added or removed): keep the order, fit the changes in. */
  setIds(ids: number[]) {
    this.ids = [...ids];
    const have = new Set(ids);
    const played = this.order.slice(0, this.pos + 1).filter((i) => have.has(i));
    const upcoming = this.order.slice(this.pos + 1).filter((i) => have.has(i));
    const known = new Set([...played, ...upcoming]);
    for (const id of ids) if (!known.has(id)) upcoming.splice(Math.floor(this.rnd() * (upcoming.length + 1)), 0, id);
    this.order = [...played, ...upcoming];
    this.pos = played.length - 1;
  }

  next(): number | null {
    if (!this.ids.length) return null;
    if (this.pos + 1 >= this.order.length) {
      this.order = shuffled(this.ids, this.last, this.rnd);
      this.pos = -1;
    }
    this.pos++;
    this.last = this.order[this.pos]!;
    return this.last;
  }
}

/** The bits of HTMLAudioElement the player uses (so tests can fake it). */
export interface AudioLike {
  src: string;
  loop: boolean;
  volume: number;
  currentTime: number;
  readonly duration: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener?(type: string, fn: () => void): void;
}

const ATTACK_MS = 200;
const TICK_MS = 100;
/** If a stinger never reports it ended, stop ducking after this long. */
const DUCK_SAFETY_MS = 30_000;
/** Give up on a pool after this many failed tracks in a row (missing or broken files). */
const MAX_ERRORS = 4;

export class MusicPlayer {
  private els: [AudioLike, AudioLike];
  private gain: [number, number] = [0, 0];
  private target: [number, number] = [0, 0];
  private cur = -1;
  private cfg: MusicCfg | null = null;
  private key = '';
  private lastSkip = 0;
  private queue: ShuffleQueue;
  private enabled = false;
  private nextStarted = false;
  private duckHolds = 0;
  private duckLeftMs = 0;
  private duckGain = 1;
  private errors = 0;
  /** Gave up on this pool after repeated errors; wakes on a new pool, a Skip or a changed track list. */
  private halted = false;
  private ids = '';
  private nowId: number | null | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  /** Last known settings, so stopping fades out at the same volume instead of cutting. */
  private xf = 0;
  private vol = 0;
  private duckLevel = 1;
  private duckRelease = 0;

  constructor(
    private report: (trackId: number | null) => void,
    mk: () => AudioLike = () => new Audio(),
    rnd: () => number = Math.random,
  ) {
    this.queue = new ShuffleQueue(rnd);
    this.els = [mk(), mk()];
    this.els.forEach((el, i) => {
      el.addEventListener('ended', () => i === this.cur && !this.nextStarted && this.advance());
      el.addEventListener('error', () => i === this.cur && this.failed());
      el.addEventListener('playing', () => i === this.cur && (this.errors = 0));
    });
  }

  /** Browsers need one click before audio can play (the TV's "Enable audio" button). */
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.lastTick = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      this.tick(now - this.lastTick);
      this.lastTick = now;
    }, TICK_MS);
    this.update(this.cfg);
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const el of this.els) el.pause();
  }

  /** Feed the latest server config (or null for none). Safe to call on every state update. */
  update(raw: MusicCfg | null) {
    const cfg = sane(raw);
    this.cfg = cfg;
    if (cfg) {
      this.xf = cfg.crossfadeMs;
      this.vol = cfg.volume;
      this.duckLevel = cfg.duckLevel;
      this.duckRelease = cfg.duckReleaseMs;
    }
    if (!cfg || !cfg.tracks.length) {
      this.key = cfg?.key ?? '';
      this.stopAll();
      return;
    }
    const ids = cfg.tracks.map((t) => t.id);
    const idsKey = ids.join(',');
    if (cfg.key !== this.key) {
      this.key = cfg.key;
      this.lastSkip = cfg.skip;
      this.errors = 0;
      this.halted = false;
      this.ids = idsKey;
      this.queue.reset(ids);
      this.advance();
    } else {
      this.queue.setIds(ids);
      if (idsKey !== this.ids) {
        this.ids = idsKey;
        this.errors = 0;
        this.halted = false;
      }
      if (cfg.skip !== this.lastSkip) {
        this.lastSkip = cfg.skip;
        this.errors = 0;
        this.halted = false;
        this.advance();
      } else if (this.cur < 0 && !this.halted) this.advance();
    }
    if (this.cur >= 0) this.els[this.cur]!.loop = cfg.repeat;
  }

  /** Dip under a one-shot sound for as long as it plays. Returns a function that ends the dip early (call it if the sound never started). */
  duckWhile(a: { addEventListener(type: string, fn: () => void): void }): () => void {
    this.duckHolds++;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      this.duckHolds = Math.max(0, this.duckHolds - 1);
    };
    for (const ev of ['ended', 'error', 'pause']) a.addEventListener(ev, release);
    setTimeout(release, DUCK_SAFETY_MS);
    return release;
  }

  /** Dip for a fixed time (the synthesized cue tones have no audio element). */
  duckFor(ms: number) {
    this.duckLeftMs = Math.max(this.duckLeftMs, ms);
  }

  /** One step of fades and ducking; `dtMs` since the last step. */
  tick(dtMs: number) {
    const cfg = this.cfg;
    const xf = this.xf;
    for (const i of [0, 1] as const) {
      const diff = this.target[i] - this.gain[i];
      const step = xf > 0 ? dtMs / xf : 1;
      this.gain[i] = Math.abs(diff) <= step ? this.target[i] : this.gain[i] + Math.sign(diff) * step;
      if (this.target[i] === 0 && this.gain[i] <= 0.001 && i !== this.cur) this.els[i].pause();
    }
    // Ducking: dip fast, come back over the release time.
    const ducking = this.duckHolds > 0 || this.duckLeftMs > 0;
    this.duckLeftMs = Math.max(0, this.duckLeftMs - dtMs);
    const want = ducking ? this.duckLevel : 1;
    if (want < this.duckGain) this.duckGain = Math.max(want, this.duckGain - dtMs / ATTACK_MS);
    else if (want > this.duckGain) this.duckGain = this.duckRelease > 0 ? Math.min(want, this.duckGain + dtMs / this.duckRelease) : want;
    for (const i of [0, 1] as const) this.els[i].volume = Math.min(1, Math.max(0, this.vol * this.gain[i] * this.duckGain));
    // Start the next track so it overlaps the end of this one (never longer than half of a short track).
    if (cfg && this.cur >= 0 && !cfg.repeat && !this.nextStarted) {
      const el = this.els[this.cur]!;
      const d = el.duration;
      if (Number.isFinite(d) && d > 0 && d - el.currentTime <= Math.min(xf / 1000, d / 2) + 0.15) this.advance();
    }
  }

  private advance() {
    const cfg = this.cfg;
    if (!cfg || !this.enabled) return;
    const id = this.queue.next();
    const track = cfg.tracks.find((t) => t.id === id);
    if (!track) return;
    const to = this.cur < 0 ? 0 : (1 - this.cur) as 0 | 1;
    const el = this.els[to];
    el.loop = false;
    el.src = track.url;
    this.gain[to] = cfg.crossfadeMs > 0 ? 0 : 1;
    this.target[to] = 1;
    if (this.cur >= 0) this.target[this.cur] = 0;
    this.cur = to;
    this.nextStarted = false;
    el.loop = cfg.repeat;
    void el.play().catch(() => this.failed());
    this.setNow(track.id);
  }

  /** A track failed to load or play: try the next one, but stop after a few misses in a row. */
  private failed() {
    if (++this.errors >= MAX_ERRORS) {
      this.halted = true;
      this.stopAll();
      return;
    }
    this.nextStarted = true;
    setTimeout(() => {
      this.nextStarted = false;
      this.advance();
    }, 500);
  }

  private stopAll() {
    this.target = [0, 0];
    this.cur = -1;
    this.nextStarted = false;
    this.setNow(null);
  }

  private setNow(id: number | null) {
    const same = (this.nowId ?? null) === id; // nothing reported yet counts as "nothing playing": no need to say so
    this.nowId = id;
    if (same) return;
    try {
      this.report(id);
    } catch {
      /* the report is only a display hint for the GM; music must carry on */
    }
  }
}
