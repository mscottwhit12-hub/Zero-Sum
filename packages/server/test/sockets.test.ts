import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { runTick } from '../src/services/market';
import { currentNight } from '../src/services/state';
import { call, FORBIDDEN_KEYS, GM_ONLY_KEYS, liveNight, loginAs, makeApp, type TestApp } from './helpers';

const open: { t: TestApp; sockets: Socket[] }[] = [];
afterEach(async () => {
  for (const o of open.splice(0)) {
    o.sockets.forEach((s) => s.close());
    o.t.io?.close();
    await o.t.app.close();
  }
});

async function boot(players = 3) {
  const t = await makeApp({ sockets: true });
  const night = await liveNight(t, players);
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = t.app.server.address() as { port: number };
  const entry = { t, sockets: [] as Socket[] };
  open.push(entry);
  const url = `http://127.0.0.1:${addr.port}`;
  const client = (auth: Record<string, unknown>, cookie?: string) => {
    const s = connect(url, { path: '/socket.io', transports: ['websocket'], auth, extraHeaders: cookie ? { cookie } : undefined, forceNew: true, reconnection: false });
    entry.sockets.push(s);
    return s;
  };
  return { t, ...night, client };
}

const once = <T = unknown>(s: Socket, ev: string, ms = 2000) =>
  new Promise<T>((res, rej) => {
    const to = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms);
    s.once(ev, (d: T) => {
      clearTimeout(to);
      res(d);
    });
  });

const noHidden = (payload: unknown, extra: string[] = []) => {
  const s = JSON.stringify(payload);
  for (const k of [...FORBIDDEN_KEYS, ...extra]) expect(s, `leaked ${k}`).not.toContain(k);
};

describe('sockets', () => {
  it('TV gets a public snapshot with no hidden or GM-only fields', async () => {
    const { client } = await boot();
    const snap = await once<Record<string, unknown>>(client({ role: 'tv' }), 'snapshot');
    expect(snap.role).toBe('tv');
    expect((snap.market as unknown[]).length).toBe(8);
    expect((snap.standings as unknown[]).length).toBe(3);
    noHidden(snap, [...GM_ONLY_KEYS, '"me"', '"holdings"', '"cashH"']);
  });

  it('a player gets their own wallet; unknown devices are rejected', async () => {
    const { client, devices } = await boot();
    const snap = await once<{ me: { id: number; cashH: number; holdings: unknown[] } }>(client({ role: 'player', deviceToken: devices[1]!.token }), 'snapshot');
    expect(snap.me).toMatchObject({ id: devices[1]!.id, cashH: 2000, holdings: [] });
    noHidden(snap, GM_ONLY_KEYS);
    const err = await once<Error>(client({ role: 'player', deviceToken: 'nope' }), 'connect_error');
    expect(err.message).toBe('unknown_device');
  });

  it('GM sockets need the session cookie and get the GM view (still no hidden mechanics)', async () => {
    const { client, gm } = await boot();
    const err = await once<Error>(client({ role: 'gm' }), 'connect_error');
    expect(err.message).toBe('unauthorized');
    const snap = await once<{ gm: { ledger: unknown[]; stocks: unknown[] } }>(client({ role: 'gm' }, gm), 'snapshot');
    expect(snap.gm.ledger).toHaveLength(3);
    expect(snap.gm.stocks).toHaveLength(3);
    noHidden(snap);
  });

  it('a tick pushes role-filtered updates to every audience in well under a second', async () => {
    const { t, client, gm, devices } = await boot();
    const tv = client({ role: 'tv' });
    const pl = client({ role: 'player', deviceToken: devices[0]!.token });
    const g = client({ role: 'gm' }, gm);
    await Promise.all([once(tv, 'snapshot'), once(pl, 'snapshot'), once(g, 'snapshot')]);
    const started = Date.now();
    const waits = [once<unknown>(tv, 'state:update'), once<unknown>(pl, 'player:update'), once<{ gm?: unknown }>(g, 'state:update')] as const;
    runTick(t.ctx, currentNight(t.ctx)!.id);
    const [tvU, plU, gmU] = (await Promise.all(waits)) as [unknown, unknown, { gm?: unknown }];
    expect(Date.now() - started).toBeLessThan(1000);
    noHidden(tvU, [...GM_ONLY_KEYS, '"me"']);
    noHidden(plU, GM_ONLY_KEYS);
    noHidden(gmU);
    expect(gmU.gm).toBeDefined();
  });

  it('a remotely paused GM device drops to the public view and gets the lock event', async () => {
    const { t, client, gm } = await boot();
    const phone = await loginAs(t, 'Boss', 'correct horse', 'phone');
    const lapId = (await call(t, gm, 'GET', '/api/gm/me')).json().gm.sessionId;
    const lap = client({ role: 'gm' }, gm);
    await once(lap, 'snapshot');
    const lock = once<{ paused: boolean }>(lap, 'gm:device_pause');
    await call(t, phone, 'POST', `/api/gm/sessions/${lapId}/pause`);
    expect(await lock).toEqual({ paused: true });
    const upd = once<Record<string, unknown>>(lap, 'state:update');
    runTick(t.ctx, currentNight(t.ctx)!.id);
    const u = await upd;
    expect(u.gm).toBeUndefined(); // TV-style view only
    const snap = await once<Record<string, unknown>>(client({ role: 'gm' }, gm), 'snapshot');
    expect(snap.gm).toMatchObject({ paused: true });
    expect(snap.ledger).toBeUndefined();
  });

  it('feed events: public ones reach players, GM-only ones do not', async () => {
    const { t, client, gm, devices } = await boot();
    const pl = client({ role: 'player', deviceToken: devices[0]!.token });
    const g = client({ role: 'gm' }, gm);
    await Promise.all([once(pl, 'snapshot'), once(g, 'snapshot')]);
    const seenByPlayer: unknown[] = [];
    pl.on('feed:new', (f) => seenByPlayer.push(f));
    const gmFeed = once<{ type: string; gmOnly: boolean }>(g, 'feed:new');
    await call(t, gm, 'POST', '/api/night/adjustments', { playerId: devices[0]!.id, gold: 1, reason: 'x' });
    expect(await gmFeed).toMatchObject({ type: 'adjustment', gmOnly: true });
    const pubFeed = once<{ message: string }>(pl, 'feed:new');
    await call(t, gm, 'POST', '/api/night/pause');
    expect((await pubFeed).message).toBe('feed.paused');
    expect(seenByPlayer.some((f) => (f as { type: string }).type === 'adjustment')).toBe(false);
  });
});
