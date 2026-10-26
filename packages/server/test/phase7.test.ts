import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { recordingBus } from '../src/context';
import { seedRulesOnce } from '../src/services/rules';
import { computeNightState, currentNight } from '../src/services/state';
import { gmView, playerView, publicView, tvView } from '../src/services/views';
import { tickOnce } from '../src/tickLoop';
import { call, liveNight, loginAs, makeApp, type TestApp } from './helpers';

const RULES = fileURLToPath(new URL('../../../assets/house-rules.json', import.meta.url));
const dev = (t: TestApp, token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, payload: payload as object | undefined, headers: { 'x-device-token': token } });
const state = (t: TestApp) => computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
// Minimal valid WAV header + 4 bytes of silence.
const WAV = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0]),
  Buffer.from('data'), Buffer.from([4, 0, 0, 0, 0, 0, 0, 0]),
]);

describe('rulebook', () => {
  it('seeds house rules once; anyone reads; Master edits; links validated; library link cleared on delete', async () => {
    const t = await makeApp();
    expect(seedRulesOnce(t.ctx, RULES)).toBe(true);
    expect(seedRulesOnce(t.ctx, RULES)).toBe(false);
    const { gm } = await liveNight(t, 1);
    const rules = (await call(t, null, 'GET', '/api/rules')).json().rules;
    expect(rules.length).toBeGreaterThanOrEqual(5);
    // House rules must not leak hidden mechanics.
    const all = JSON.stringify(rules).toLowerCase();
    for (const w of ['drift', 'hidden', 'kingfall', 'mood', 'secretly']) expect(all).not.toContain(w);

    expect((await call(t, gm, 'POST', '/api/rules', { title: 'Dice Duel', gameName: 'Dice Duel', body: 'Roll high.', link: 'javascript:alert(1)' })).json().error).toBe('bad_link');
    const id = (await call(t, gm, 'POST', '/api/rules', { title: 'Dice Duel', gameName: 'Dice Duel', body: 'Roll **high**.', link: 'http://nas.local/dice.pdf' })).json().id;
    const lib = (await call(t, gm, 'POST', '/api/library', { name: 'Dice Duel', minPlayers: 2, maxPlayers: 4, defaultDuration: 0.5, mode: 'competitive', ruleEntryId: id })).json().game;
    expect((await call(t, null, 'GET', '/api/rules')).json().rules.find((r: { id: number }) => r.id === id).games).toEqual([{ id: lib.id, name: 'Dice Duel' }]);
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Helper', password: 'helper pass', pin: '5555' });
    const sub = await loginAs(t, 'Helper', 'helper pass');
    expect((await call(t, sub, 'PATCH', `/api/rules/${id}`, { title: 'x' })).statusCode).toBe(403);
    expect((await call(t, gm, 'DELETE', `/api/rules/${id}`)).statusCode).toBe(200);
    expect((await call(t, gm, 'GET', '/api/library')).json().games[0].ruleEntryId).toBeNull();
  });
});

describe('seating', () => {
  it('tables, seat moves and bumps, shrink drops seats; GM + TV only', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 3);
    const [a, b] = devices as [{ id: number; token: string }, { id: number; token: string }];
    const t1 = (await call(t, gm, 'POST', '/api/tables', { name: 'Kitchen', seats: 4 })).json().id;
    const t2 = (await call(t, gm, 'POST', '/api/tables', {})).json().id;
    expect((await call(t, gm, 'POST', '/api/tables', { seats: 99 })).json().error).toBe('bad_seats');
    await call(t, gm, 'POST', `/api/tables/${t1}/seat`, { seat: 1, playerId: a.id });
    await call(t, gm, 'POST', `/api/tables/${t1}/seat`, { seat: 4, playerId: b.id });
    await call(t, gm, 'POST', `/api/tables/${t2}/seat`, { seat: 2, playerId: a.id }); // move
    await call(t, gm, 'POST', `/api/tables/${t2}/seat`, { seat: 2, playerId: b.id }); // bump a
    let seating = tvView(t.ctx, state(t)).seating;
    expect(seating.find((x) => x.id === t1)!.assignments).toEqual([]);
    expect(seating.find((x) => x.id === t2)!.assignments).toEqual([{ seat: 2, playerId: b.id }]);
    await call(t, gm, 'POST', `/api/tables/${t1}/seat`, { seat: 4, playerId: a.id });
    await call(t, gm, 'PATCH', `/api/tables/${t1}`, { seats: 3, x: 1.7, y: 0.5 });
    seating = tvView(t.ctx, state(t)).seating;
    expect(seating.find((x) => x.id === t1)).toMatchObject({ seats: 3, x: 1, y: 0.5, assignments: [] });

    const g = (await call(t, gm, 'POST', '/api/games', { name: 'Cards', mode: 'competitive', tableId: t2 })).json().game;
    expect((await call(t, gm, 'POST', '/api/games', { name: 'Bad', mode: 'competitive', tableId: 999 })).json().error).toBe('bad_table');
    expect(tvView(t.ctx, state(t)).seating.find((x) => x.id === t2)!.gameId).toBe(g.id);
    expect(gmView(t.ctx, state(t)).gm.seating.length).toBe(2);
    for (const v of [publicView(t.ctx, state(t)), playerView(t.ctx, state(t), a.id)]) {
      expect(JSON.stringify(v)).not.toContain('"seating"');
      expect(JSON.stringify(v)).not.toContain('Kitchen');
    }
    await call(t, gm, 'DELETE', `/api/tables/${t2}`);
    expect(publicView(t.ctx, state(t)).games[0]!.tableId).toBeNull();
    void dev;
  });
});

describe('sounds', () => {
  it('upload validates and serves local files; soundboard + auto cues reach the TV only', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const rec = recordingBus();
    t.ctx.bus = rec.bus;
    const data = `data:audio/wav;base64,${WAV.toString('base64')}`;
    expect((await call(t, gm, 'POST', '/api/sounds', { name: 'Fake', kind: 'soundboard', data: `data:audio/wav;base64,${Buffer.from('nope').toString('base64')}` })).json().error).toBe('bad_audio');
    expect((await call(t, gm, 'POST', '/api/sounds', { name: 'X', kind: 'cue', theme: 'nope', data })).json().error).toBe('bad_cue');
    const s = (await call(t, gm, 'POST', '/api/sounds', { name: 'Gong', kind: 'cue', theme: 'achievement', data })).json();
    const file = await t.app.inject({ method: 'GET', url: s.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('audio/wav');
    expect(file.rawPayload.equals(WAV)).toBe(true);

    await call(t, gm, 'POST', '/api/sounds/play', { cue: 'final_round' });
    await call(t, gm, 'POST', '/api/sounds/play', { soundId: s.id });
    await call(t, gm, 'POST', '/api/night/pause');
    const plays = rec.events.filter((e) => e.event === 'sound:play');
    expect(plays.every((e) => e.channel === 'tv')).toBe(true);
    expect(plays.map((e) => (e.data as { cue?: string }).cue)).toEqual(['final_round', undefined, 'intermission']);
    expect((plays[1]!.data as { url: string }).url).toBe(s.url);

    // Ambient: library game theme ↔ ambient sound theme, while the game is active.
    await call(t, gm, 'POST', '/api/night/resume');
    await call(t, gm, 'POST', '/api/sounds', { name: 'Tavern', kind: 'ambient', theme: 'tavern', data });
    const lib = (await call(t, gm, 'POST', '/api/library', { name: 'Dungeon', minPlayers: 2, maxPlayers: 4, defaultDuration: 1, mode: 'coop', soundTheme: 'Tavern' })).json().game;
    const g = (await call(t, gm, 'POST', '/api/games', { libraryGameId: lib.id })).json().game;
    expect(tvView(t.ctx, state(t)).ambient).toBeNull();
    await call(t, gm, 'POST', `/api/games/${g.id}/start`);
    expect(tvView(t.ctx, state(t)).ambient).toMatchObject({ theme: 'tavern', gameId: g.id });
    await call(t, gm, 'POST', '/api/sounds/play', { ambient: 'off' });
    expect(tvView(t.ctx, state(t)).ambient).toBeNull();
  });
});

describe('NFT minter', () => {
  it('server-authoritative sync; pause bonus; leaderboard public; zero effect on gold; TV crawl', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 2);
    const [a, b] = devices as [{ id: number; token: string }, { id: number; token: string }];
    const cashBefore = playerView(t.ctx, state(t), a.id)!.me.cashH;
    expect((await dev(t, a.token, 'POST', '/api/minter/sync', { taps: 5 })).json()).toMatchObject({ minted: 5, credits: 5 });
    t.clock.advance(2000);
    const r = (await dev(t, a.token, 'POST', '/api/minter/sync', { taps: 1000, buys: ['laptop'] })).json();
    expect(r.minted).toBe(35); // taps clamped to 15/s × 2 s
    expect(r.tiers).toEqual({ laptop: 1 });
    expect(r.rejected).toEqual([]);
    expect((await dev(t, a.token, 'POST', '/api/minter/sync', { buys: ['breakroom'] })).json().rejected).toEqual(['breakroom']);

    await call(t, gm, 'POST', '/api/night/pause');
    t.clock.advance(1000);
    const p = (await dev(t, b.token, 'POST', '/api/minter/sync', { taps: 10 })).json();
    expect(p).toMatchObject({ minted: 20, mult: 2, paused: true }); // first sync: no elapsed time, taps doubled
    expect(p.shop.find((s: { id: string }) => s.id === 'breakroom').available).toBe(true);

    expect(publicView(t.ctx, state(t)).minter.leaderboard).toEqual([{ playerId: a.id, minted: 35 }, { playerId: b.id, minted: 20 }]);
    expect(playerView(t.ctx, state(t), a.id)!.me.cashH).toBe(cashBefore);

    const rec = recordingBus();
    t.ctx.bus = rec.bus;
    tickOnce(t.ctx); // starts the crawl clock
    t.clock.advance(10 * 60_000);
    tickOnce(t.ctx);
    const crawl = rec.events.find((e) => e.event === 'tv:crawl');
    expect(crawl?.channel).toBe('tv');
    expect(crawl?.data).toMatchObject({ kind: 'minter' });

    await call(t, gm, 'POST', '/api/night/end');
    const frozen = (await dev(t, a.token, 'POST', '/api/minter/sync', { taps: 10 })).json();
    expect(frozen).toMatchObject({ minted: 35, active: false });
  });
});
