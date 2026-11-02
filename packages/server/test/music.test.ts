import { describe, expect, it } from 'vitest';
import { recordingBus } from '../src/context';
import { AUDIO_DEFAULTS, matchTracks, musicForGm, musicForTv, ruleKeyFor, setNowPlaying } from '../src/services/music';
import { normTags, parseRange, sniffAudio } from '../src/services/sounds';
import { computeNightState, currentNight } from '../src/services/state';
import { gmView, publicView, tvView } from '../src/services/views';
import { deflateRawSync } from 'node:zlib';
import { unzip, zip, zipIndex } from '../src/services/zip';
import { FORBIDDEN_KEYS, call, liveNight, loginAs, makeApp, type TestApp } from './helpers';

const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(40)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(60)]);
const wavData = `data:audio/wav;base64,${WAV.toString('base64')}`;
const state = (t: TestApp) => computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
const tv = (t: TestApp) => tvView(t.ctx, state(t));
const gm$ = (t: TestApp) => gmView(t.ctx, state(t)).gm;
const upload = (t: TestApp, gm: string, name: string, tags: string, extra: Record<string, unknown> = {}) =>
  call(t, gm, 'POST', '/api/sounds', { name, kind: 'ambient', tags, data: wavData, ...extra });

describe('tags', () => {
  it('normTags: lowercase, trimmed, de-duplicated, capped; accepts a comma list or an array', () => {
    expect(normTags(' Ambient, SOUNDSCAPE ,ambient,, calm  down ')).toEqual(['ambient', 'soundscape', 'calm down']);
    expect(normTags(['Lobby', 'lobby', 5, null, 'a'.repeat(40)])).toEqual(['lobby', 'a'.repeat(24)]);
    expect(normTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length).toBe(12);
    expect(normTags(undefined)).toEqual([]);
    expect(normTags(['a, b', 'c'])).toEqual(['a', 'b', 'c']); // a comma always separates tags
  });
  it('sniffAudio goes by the bytes: a FLAC with an ID3 tag is still FLAC, and junk is refused', () => {
    expect(sniffAudio(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20), Buffer.from('fLaC')]))?.ext).toBe('flac');
    expect(sniffAudio(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)]))?.ext).toBe('mp3');
    expect(sniffAudio(WAV)?.ext).toBe('wav');
    expect(sniffAudio(Buffer.from('this is not audio'))).toBeNull();
  });
  it('matchTracks needs ALL the wanted tags, and nothing wanted means nothing', () => {
    const tr = [{ id: 1, tags: ['ambient', 'soundscape'] }, { id: 2, tags: ['ambient'] }, { id: 3, tags: ['lobby'] }];
    expect(matchTracks(tr, ['ambient']).map((x) => x.id)).toEqual([1, 2]);
    expect(matchTracks(tr, ['ambient', 'soundscape']).map((x) => x.id)).toEqual([1]);
    expect(matchTracks(tr, ['ambient', 'lobby'])).toEqual([]);
    expect(matchTracks(tr, [])).toEqual([]);
  });
  it('ruleKeyFor: each night state has a rule; the last quarter of a live night is final_round', () => {
    const q = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }];
    const st = (status: string, cq: number | null) => ({ night: { status, current_quarter: cq }, quarters: q }) as never;
    expect(ruleKeyFor(st('setup', null))).toBe('setup');
    expect(ruleKeyFor(st('joins_open', null))).toBe('joins_open');
    expect(ruleKeyFor(st('live', 2))).toBe('live');
    expect(ruleKeyFor(st('live', 4))).toBe('final_round');
    expect(ruleKeyFor(st('paused', 4))).toBe('paused');
    expect(ruleKeyFor(st('ended', null))).toBe('ended');
    expect(ruleKeyFor(st('archived', null))).toBe('ended');
  });
});

describe('uploading and editing music', () => {
  it('music needs a tag; a legacy theme counts as a tag; credit, licence and link are kept; bad links are dropped', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    expect((await call(t, gm, 'POST', '/api/sounds', { name: 'x', kind: 'ambient', data: wavData })).json().error).toBe('bad_tags');
    const a = (await upload(t, gm, 'Vanilla', ' Ambient, Soundscape ', { credit: 'Song: Vanilla. By LonePeak', license: 'Free with credit', sourceUrl: 'https://example.com/pack' })).json();
    expect(a).toMatchObject({ tags: ['ambient', 'soundscape'], credit: 'Song: Vanilla. By LonePeak', license: 'Free with credit', sourceUrl: 'https://example.com/pack' });
    const b = (await call(t, gm, 'POST', '/api/sounds', { name: 'Tavern', kind: 'ambient', theme: 'Tavern', sourceUrl: 'javascript:alert(1)', data: wavData })).json();
    expect(b.tags).toEqual(['tavern']);
    expect(b.sourceUrl).toBeNull();
    const list = gm$(t).sounds;
    expect(list.map((x) => x.name).sort()).toEqual(['Tavern', 'Vanilla']);
  });

  it('Master retags and re-credits a sound; music cannot end up with no tags; Sub GMs cannot', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const s = (await upload(t, gm, 'Track', 'ambient')).json();
    const r = (await call(t, gm, 'PATCH', `/api/sounds/${s.id}`, { tags: 'Calm, ambient', name: 'Renamed', credit: 'Credit' })).json();
    expect(r).toMatchObject({ name: 'Renamed', tags: ['calm', 'ambient'], credit: 'Credit' });
    expect((await call(t, gm, 'PATCH', `/api/sounds/${s.id}`, { tags: '' })).json().error).toBe('bad_tags');
    expect((await call(t, gm, 'PATCH', '/api/sounds/9999', { tags: 'x' })).statusCode).toBe(404);
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Sub', password: 'subpass123', pin: '5555' });
    const sub = await loginAs(t, 'Sub', 'subpass123');
    expect((await call(t, sub, 'PATCH', `/api/sounds/${s.id}`, { tags: 'x' })).statusCode).toBe(403);
    expect(gm$(t).sounds.find((x) => x.id === s.id)).toMatchObject({ name: 'Renamed', tags: ['calm', 'ambient'] });
  });
});

describe('music control', () => {
  async function night() {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const amb = (await upload(t, gm, 'Vanilla Sky', 'ambient, soundscape')).json();
    const blue = (await upload(t, gm, 'Blue Lagoon', 'ambient, soundscape')).json();
    const calm = (await upload(t, gm, 'Plain calm', 'ambient')).json();
    return { t, gm, amb, blue, calm };
  }

  it('manual: all-of tags, Master only, refuses a pool with no tracks, Stop and Auto work, all audited', async () => {
    const { t, gm, amb, blue } = await night();
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Sub', password: 'subpass123', pin: '5555' });
    const sub = await loginAs(t, 'Sub', 'subpass123');
    expect((await call(t, sub, 'POST', '/api/music', { mode: 'manual', tags: ['ambient'] })).statusCode).toBe(403);
    expect((await call(t, gm, 'POST', '/api/music', { mode: 'manual', tags: [] })).json().error).toBe('bad_tags');
    expect((await call(t, gm, 'POST', '/api/music', { mode: 'manual', tags: ['ambient', 'nope'] })).json().error).toBe('no_tracks_match');
    expect((await call(t, gm, 'POST', '/api/music', { mode: 'sideways' })).json().error).toBe('bad_music_mode');

    expect((await call(t, gm, 'POST', '/api/music', { mode: 'manual', tags: ['Ambient', 'soundscape'] })).statusCode).toBe(200);
    expect(gm$(t).music).toMatchObject({ mode: 'manual', tags: ['ambient', 'soundscape'], matching: 2, source: 'manual' });
    const m = tv(t).music;
    expect(m.tracks.map((x) => x.id).sort()).toEqual([amb.id, blue.id].sort());
    expect(m.key).toBe('manual|ambient+soundscape');

    expect((await call(t, gm, 'POST', '/api/music', { mode: 'off' })).statusCode).toBe(200);
    expect(gm$(t).music.mode).toBe('off');
    expect(tv(t).music.tracks).toEqual([]);
    expect(gm$(t).ambient.off).toBe(true); // the same flag the old Stop ambient button used

    await call(t, gm, 'POST', '/api/music', { mode: 'auto' });
    expect(gm$(t).music).toMatchObject({ mode: 'auto', tags: [] });
    expect(gm$(t).ambient.off).toBe(false);
    const actions = (t.ctx.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'music.set'").get() as { c: number }).c;
    expect(actions).toBeGreaterThanOrEqual(3);
  });

  it('Repeat and Skip: Skip bumps a counter the TV watches; Repeat is a boolean', async () => {
    const { t, gm } = await night();
    await call(t, gm, 'POST', '/api/music', { mode: 'manual', tags: ['ambient'] });
    const s0 = tv(t).music.skip;
    await call(t, gm, 'POST', '/api/music', { skip: true });
    await call(t, gm, 'POST', '/api/music', { skip: true });
    expect(tv(t).music.skip).toBe(s0 + 2);
    expect(tv(t).music.key).toBe('manual|ambient');
    await call(t, gm, 'POST', '/api/music', { repeat: true });
    expect(tv(t).music.repeat).toBe(true);
    expect(gm$(t).music.repeat).toBe(true);
    expect((await call(t, gm, 'POST', '/api/music', { repeat: 'yes' })).json().error).toBe('bad_music_repeat');
  });

  it('auto: night state picks the rule tag; ambient-only tracks are never auto-picked; no tagged track = quiet', async () => {
    const { t, gm } = await night();
    // Live night, default rule live -> focus, and nothing is tagged focus: quiet (not the ambient tracks).
    expect(tv(t).music).toMatchObject({ source: 'none', tracks: [] });
    expect(gm$(t).music).toMatchObject({ mode: 'auto', source: 'none', matching: 0 });
    await upload(t, gm, 'Focus one', 'focus');
    await upload(t, gm, 'Focus two', 'focus, calm');
    await upload(t, gm, 'Chill', 'intermission');
    expect(tv(t).music).toMatchObject({ source: 'rule', tag: 'focus', key: 'rule|focus' });
    expect(tv(t).music.tracks.map((x) => x.name).sort()).toEqual(['Focus one', 'Focus two']);
    await call(t, gm, 'POST', '/api/night/pause');
    expect(tv(t).music).toMatchObject({ source: 'rule', tag: 'intermission' });
    await call(t, gm, 'POST', '/api/night/resume');
    expect(tv(t).music.tag).toBe('focus');
    // The Master can point a rule at the ambient tag on purpose.
    expect((await call(t, gm, 'PUT', '/api/audio/settings', { rules: { live: 'ambient' } })).statusCode).toBe(200);
    expect(tv(t).music).toMatchObject({ source: 'rule', tag: 'ambient' });
    expect(tv(t).music.tracks.length).toBe(3);
  });

  it('auto: a running game’s library sound theme counts as a tag and wins over the night rule', async () => {
    const { t, gm } = await night();
    await upload(t, gm, 'Focus one', 'focus');
    await upload(t, gm, 'Tavern song', 'tavern');
    const lib = (await call(t, gm, 'POST', '/api/library', { name: 'Dungeon', minPlayers: 2, maxPlayers: 4, defaultDuration: 1, mode: 'coop', soundTheme: 'Tavern' })).json().game;
    const g = (await call(t, gm, 'POST', '/api/games', { libraryGameId: lib.id })).json().game;
    expect(tv(t).music.tag).toBe('focus');
    await call(t, gm, 'POST', `/api/games/${g.id}/start`);
    expect(tv(t).music).toMatchObject({ source: 'game', tag: 'tavern', key: 'game|tavern' });
    // A game theme with no track falls back to the rule.
    await call(t, gm, 'DELETE', `/api/sounds/${(gm$(t).sounds.find((x) => x.name === 'Tavern song')!).id}`);
    expect(tv(t).music).toMatchObject({ source: 'rule', tag: 'focus' });
    // Pausing hands the music to the intermission rule even with a game running.
    await upload(t, gm, 'Chill', 'intermission');
    await upload(t, gm, 'Tavern again', 'tavern');
    expect(tv(t).music.tag).toBe('tavern');
    await call(t, gm, 'POST', '/api/night/pause');
    expect(tv(t).music.tag).toBe('intermission');
  });

  it('now playing: only a real music track the TV says it started, and only while it is in the pool', async () => {
    const { t, gm, amb, calm } = await night();
    await call(t, gm, 'POST', '/api/music', { mode: 'manual', tags: ['soundscape'] });
    const rec = recordingBus();
    t.ctx.bus = rec.bus;
    setNowPlaying(t.ctx, amb.id);
    expect(gm$(t).music.now).toMatchObject({ id: amb.id, name: 'Vanilla Sky' });
    expect(rec.events.some((e) => e.channel === 'refresh')).toBe(true);
    setNowPlaying(t.ctx, 424242); // unknown: ignored
    setNowPlaying(t.ctx, 'x'); // junk: treated as nothing playing
    expect(gm$(t).music.now).toBeNull();
    setNowPlaying(t.ctx, calm.id); // not in the soundscape pool: not shown
    expect(gm$(t).music.now).toBeNull();
    setNowPlaying(t.ctx, amb.id);
    await call(t, gm, 'POST', '/api/music', { mode: 'off' });
    expect(gm$(t).music.now).toBeNull();
  });

  it('music reaches only the TV and the GM, never players', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    await upload(t, gm, 'Focus one', 'focus', { credit: 'secret credit text' });
    const pub = JSON.stringify(publicView(t.ctx, state(t)));
    expect(pub).not.toContain('Focus one');
    expect(pub).not.toContain('"music"');
    expect(pub).not.toContain('secret credit text');
    for (const k of FORBIDDEN_KEYS) expect(JSON.stringify(tv(t))).not.toContain(k);
  });
});

describe('audio settings', () => {
  it('defaults, Master-only, range-checked, partial updates, rules normalised, and sent to the TV', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    expect(gm$(t).audio).toEqual(AUDIO_DEFAULTS);
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Sub', password: 'subpass123', pin: '5555' });
    const sub = await loginAs(t, 'Sub', 'subpass123');
    expect((await call(t, sub, 'PUT', '/api/audio/settings', { volume: 10 })).statusCode).toBe(403);
    for (const bad of [{ volume: 101 }, { volume: -1 }, { crossfadeSeconds: 16 }, { duckPercent: 'loud' }, { duckReleaseSeconds: 11 }, { rules: 'x' }, { rules: { live: 5 } }, { rules: { live: 'calm, focus' } }]) {
      expect((await call(t, gm, 'PUT', '/api/audio/settings', bad)).json().error, JSON.stringify(bad)).toBe('bad_audio_setting');
    }
    expect(gm$(t).audio).toEqual(AUDIO_DEFAULTS);
    const r = (await call(t, gm, 'PUT', '/api/audio/settings', { volume: 35, crossfadeSeconds: 6.5, duckPercent: 10, rules: { joins_open: '  Lobby Music ', paused: '' } })).json();
    expect(r).toMatchObject({ volume: 35, crossfadeSeconds: 6.5, duckPercent: 10, duckReleaseSeconds: 2 });
    expect(r.rules).toMatchObject({ joins_open: 'lobby music', paused: '', live: 'focus', ended: 'celebration' });
    await upload(t, gm, 'Focus one', 'focus');
    expect(tv(t).music).toMatchObject({ volume: 0.35, crossfadeMs: 6500, duckLevel: 0.1, duckReleaseMs: 2000 });
  });
});

describe('bad stored data can never break the live broadcast', () => {
  it.each([
    ['null', 'null'],
    ['not JSON', '{{{nope'],
    ['a number', '5'],
    ['an array', '[1,2]'],
    ['volume as text', '{"volume":"loud"}'],
    ['volume out of range', '{"volume":9999,"crossfadeSeconds":-3}'],
    ['rules null', '{"rules":null}'],
    ['rule as a number', '{"rules":{"live":5}}'],
  ])('audio settings stored as %s: the TV still gets sane numbers', async (_label, stored) => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    await upload(t, gm, 'Focus one', 'focus');
    t.ctx.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('audio_settings', stored);
    expect(() => tv(t)).not.toThrow();
    expect(() => gm$(t)).not.toThrow();
    const m = tv(t).music;
    for (const n of [m.volume, m.crossfadeMs, m.duckLevel, m.duckReleaseMs]) expect(Number.isFinite(n)).toBe(true);
    expect(m.volume).toBeGreaterThanOrEqual(0);
    expect(m.volume).toBeLessThanOrEqual(1);
    expect(m.tag).toBe('focus');
  });

  it('corrupt music state and corrupt tags on a sound are ignored', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    await upload(t, gm, 'Focus one', 'focus');
    const nid = currentNight(t.ctx)!.id;
    for (const v of ['null', 'nope', '{"tags":"x","skip":"y","repeat":"z"}']) {
      t.ctx.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`music_state:${nid}`, v);
      expect(() => tv(t)).not.toThrow();
      expect(tv(t).music.skip).toBe(0);
    }
    t.ctx.db.prepare("UPDATE sound SET tags = '{{bad' WHERE name = 'Focus one'").run();
    expect(() => gm$(t)).not.toThrow();
    expect(tv(t).music.tracks).toEqual([]);
  });

  it('if building the music payload ever fails, the broadcast gets a quiet default instead of an error', async () => {
    const t = await makeApp();
    await liveNight(t, 2);
    const broken = { night: { id: 1, status: 'live', current_quarter: 2 }, quarters: undefined } as never;
    const quiet = musicForTv(t.ctx, broken);
    expect(quiet).toMatchObject({ key: 'error|', tracks: [] });
    expect(musicForGm(t.ctx, broken)).toMatchObject({ mode: 'auto', matching: 0, now: null });
  });
});

describe('serving sound files', () => {
  it('parseRange: single ranges, suffix ranges, and the cases that must be refused or ignored', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid');
    expect(parseRange('bytes=5-2', 1000)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-9', 1000)).toBeNull(); // several ranges: serve the whole file
    expect(parseRange('garbage', 1000)).toBeNull();
  });

  it('serves the file whole or in ranges (what Safari and seeking need), and FLAC files are served at all', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const body = Buffer.concat([Buffer.from('ID3'), Buffer.from(Array.from({ length: 300 }, (_, i) => i % 251))]);
    const s = (await upload(t, gm, 'Range me', 'x', { data: `data:audio/mpeg;base64,${body.toString('base64')}` })).json();
    const full = await t.app.inject({ method: 'GET', url: s.url });
    expect(full.statusCode).toBe(200);
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.rawPayload.equals(body)).toBe(true);
    const part = await t.app.inject({ method: 'GET', url: s.url, headers: { range: 'bytes=10-19' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 10-19/${body.length}`);
    expect(part.rawPayload.equals(body.subarray(10, 20))).toBe(true);
    const tail = await t.app.inject({ method: 'GET', url: s.url, headers: { range: 'bytes=-5' } });
    expect(tail.rawPayload.equals(body.subarray(body.length - 5))).toBe(true);
    const bad = await t.app.inject({ method: 'GET', url: s.url, headers: { range: `bytes=${body.length + 5}-` } });
    expect(bad.statusCode).toBe(416);
    expect(bad.headers['content-range']).toBe(`bytes */${body.length}`);
    const flac = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(40)]);
    const f = (await call(t, gm, 'POST', '/api/sounds', { name: 'A flac', kind: 'soundboard', data: `data:audio/flac;base64,${flac.toString('base64')}` })).json();
    expect(f.url.endsWith('.flac')).toBe(true);
    const got = await t.app.inject({ method: 'GET', url: f.url });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('audio/flac');
    expect((await t.app.inject({ method: 'GET', url: '/media/sounds/not-a-real-file.mp3' })).statusCode).toBe(404);
  });
});

describe('sound packs', () => {
  const manifest = (tracks: unknown[]) => JSON.stringify({ name: 'Ambient pack', tracks });
  const post = (t: TestApp, cookie: string, body: Buffer | string, type = 'application/zip') =>
    t.app.inject({ method: 'POST', url: '/api/sounds/pack', headers: { cookie, 'content-type': type }, payload: body });

  it('imports tagged, credited tracks; importing twice skips what is there', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const z = zip([
      {
        name: 'manifest.json',
        data: manifest([
          { file: 'a.wav', name: 'Vanilla Sky', tags: ['ambient', 'soundscape'], credit: 'Song: Vanilla Sky', source: 'https://example.com', license: 'Free with credit' },
          { file: 'b.mp3', name: 'Blue Lagoon', tags: 'ambient, soundscape' },
        ]),
      },
      { name: 'a.wav', data: WAV },
      { name: 'b.mp3', data: MP3 },
    ]);
    const r = await post(t, gm, z);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ pack: 'Ambient pack', added: 2, skipped: [] });
    const sounds = gm$(t).sounds;
    expect(sounds.find((x) => x.name === 'Vanilla Sky')).toMatchObject({ kind: 'ambient', tags: ['ambient', 'soundscape'], credit: 'Song: Vanilla Sky', license: 'Free with credit' });
    const file = await t.app.inject({ method: 'GET', url: sounds.find((x) => x.name === 'Blue Lagoon')!.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('audio/mpeg');
    expect(file.rawPayload.equals(MP3)).toBe(true);
    const again = (await post(t, gm, z)).json();
    expect(again).toEqual({ pack: 'Ambient pack', added: 0, skipped: ['Vanilla Sky', 'Blue Lagoon'] });
    expect(gm$(t).sounds.length).toBe(2);
  });

  it('a pack inside one top-level folder works; the files are identified by their bytes, not their names', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const z = zip([
      { name: 'My Pack/manifest.json', data: manifest([{ file: 'track.mp3', name: 'Really a wav', tags: ['x'] }]) },
      { name: 'My Pack/track.mp3', data: WAV },
    ]);
    expect((await post(t, gm, z)).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: gm$(t).sounds[0]!.url })).headers['content-type']).toBe('audio/wav');
  });

  it('checks everything first: one bad track means nothing is imported, and the message says which', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const z = zip([
      { name: 'manifest.json', data: manifest([{ file: 'ok.wav', name: 'Fine', tags: ['x'] }, { file: 'missing.wav', name: 'Gone', tags: ['x'] }, { file: 'bad.wav', name: 'Junk', tags: ['x'] }, { file: 'ok.wav', name: 'No tags', kind: 'ambient' }]) },
      { name: 'ok.wav', data: WAV },
      { name: 'bad.wav', data: Buffer.from('this is not audio') },
    ]);
    const r = await post(t, gm, z);
    expect(r.statusCode).toBe(400);
    const msg = r.json().message as string;
    expect(msg).toContain('Nothing was imported');
    expect(msg).toContain('Gone');
    expect(msg).toContain('Junk');
    expect(msg).toContain('No tags');
    expect(gm$(t).sounds).toEqual([]);
  });

  it('refuses non-zips, damaged zips, a missing manifest, empty bodies and Sub GMs', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const err = async (body: Buffer | string) => (await post(t, gm, body)).json();
    expect((await err(Buffer.from('not a zip at all'))).error).toBe('bad_pack');
    expect((await err(zip([{ name: 'a.wav', data: WAV }]))).message).toContain('manifest.json');
    expect((await err(zip([{ name: 'manifest.json', data: '{not json' }]))).message).toContain('not valid JSON');
    expect((await err(zip([{ name: 'manifest.json', data: '{"tracks":[]}' }]))).message).toContain('tracks');
    expect((await err(zip([{ name: 'a.wav', data: WAV }]).subarray(0, 30))).error).toBe('bad_pack');
    expect((await post(t, gm, Buffer.alloc(0))).statusCode).toBeGreaterThanOrEqual(400);
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Sub', password: 'subpass123', pin: '5555' });
    const sub = await loginAs(t, 'Sub', 'subpass123');
    expect((await post(t, sub, zip([{ name: 'manifest.json', data: manifest([{ file: 'a.wav', name: 'A', tags: ['x'] }]) }, { name: 'a.wav', data: WAV }]))).statusCode).toBe(403);
    expect((await call(t, null, 'POST', '/api/sounds/pack', {})).statusCode).toBe(401);
  });

  it('cue tracks in a pack name their cue; music tracks in a pack never become cues by accident', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const z = zip([{ name: 'manifest.json', data: manifest([{ file: 'g.wav', name: 'Gong', kind: 'cue', cue: 'achievement' }]) }, { name: 'g.wav', data: WAV }]);
    expect((await post(t, gm, z)).statusCode).toBe(200);
    expect(gm$(t).sounds[0]).toMatchObject({ kind: 'cue', theme: 'achievement', tags: [] });
    const bad = zip([{ name: 'manifest.json', data: manifest([{ file: 'g.wav', name: 'Gong2', kind: 'cue', cue: 'nope' }]) }, { name: 'g.wav', data: WAV }]);
    expect((await post(t, gm, bad)).json().message).toContain('Cue must be one of');
  });
});

/** A one-file deflate zip; `lie` overrides the uncompressed size the headers claim. */
function deflateZip(name: string, data: Buffer, lie?: number) {
  const raw = deflateRawSync(data);
  const nb = Buffer.from(name);
  const usize = lie ?? data.length;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(raw.length, 18);
  lh.writeUInt32LE(usize, 22);
  lh.writeUInt16LE(nb.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(raw.length, 20);
  cd.writeUInt32LE(usize, 24);
  cd.writeUInt16LE(nb.length, 28);
  const body = Buffer.concat([lh, nb, raw]);
  const cdb = Buffer.concat([cd, nb]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cdb.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cdb, end]);
}

describe('zip safety', () => {
  const MB = 1024 * 1024;
  it('reads deflate zips; refuses an oversized entry from its header without inflating it', () => {
    expect(unzip(deflateZip('a.txt', Buffer.from('hello'))).map((e) => e.data.toString())).toEqual(['hello']);
    const bomb = deflateZip('a.bin', Buffer.alloc(100 * MB)); // ~100 KB on disk
    expect(bomb.length).toBeLessThan(MB);
    expect(() => zipIndex(bomb, { maxEntryBytes: 31 * MB })).toThrow('zip_entry_too_large');
  });
  it('a zip that lies about its size still cannot inflate past the cap', () => {
    const liar = deflateZip('a.bin', Buffer.alloc(100 * MB), 1000);
    const [f] = zipIndex(liar, { maxEntryBytes: 31 * MB });
    expect(f!.size).toBe(1000);
    expect(() => f!.read()).toThrow('zip_corrupt');
  });
  it('zipIndex decompresses nothing until read() is called', () => {
    const idx = zipIndex(zip([{ name: 'a', data: 'x' }, { name: 'b', data: 'yy' }]));
    expect(idx.map((f) => [f.name, f.size])).toEqual([['a', 1], ['b', 2]]);
    expect(idx[1]!.read().toString()).toBe('yy');
  });
});

describe('zip reader', () => {
  it('reads what the writer wrote and refuses junk', () => {
    const z = zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: Buffer.from([0, 1, 2, 255]) }]);
    expect(unzip(z).map((e) => [e.name, e.data.length])).toEqual([['a.txt', 5], ['dir/b.bin', 4]]);
    expect(() => unzip(Buffer.from('nope'))).toThrow('not_a_zip');
    expect(() => unzip(zip([{ name: 'big', data: Buffer.alloc(5000) }]), { maxEntryBytes: 1000 })).toThrow('zip_entry_too_large');
    expect(() => unzip(zip([{ name: 'a', data: 'x' }, { name: 'b', data: 'y' }]), { maxEntries: 1 })).toThrow('zip_too_many_files');
  });
});
