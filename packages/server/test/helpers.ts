import { buildApp, type App } from '../src/app';
import type { Config } from '../src/context';
import { openDb } from '../src/db';
import { createPlayer } from '../src/services/players';

export const T0 = Date.UTC(2026, 9, 24, 19, 0, 0);

export const testConfig: Config = { port: 0, host: '127.0.0.1', dataDir: '/tmp/gn-test', mediaDir: '/tmp/gn-test-media', secureCookies: false };

export interface TestApp extends App {
  clock: { t: number; advance(ms: number): void };
}

export async function makeApp(opts: { sockets?: boolean } = {}): Promise<TestApp> {
  const clock = { t: T0, advance(ms: number) { clock.t += ms; } };
  const built = await buildApp({ db: openDb(':memory:'), config: testConfig, now: () => clock.t, sockets: opts.sockets ?? false });
  return { ...built, clock };
}

export function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : String(raw);
  return String(first).split(';')[0]!;
}

export async function setupMaster(t: App, deviceType = 'laptop') {
  const res = await t.app.inject({ method: 'POST', url: '/api/setup', payload: { name: 'Boss', password: 'correct horse', pin: '1234', deviceType } });
  if (res.statusCode !== 200) throw new Error(res.body);
  return cookieOf(res);
}

export async function loginAs(t: App, name: string, password: string, deviceType = 'phone') {
  const res = await t.app.inject({ method: 'POST', url: '/api/gm/login', payload: { name, password, deviceType } });
  if (res.statusCode !== 200) throw new Error(res.body);
  return cookieOf(res);
}

export const call = (t: App, cookie: string | null, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  t.app.inject({ method, url, payload: payload as object | undefined, headers: cookie ? { cookie } : {} });

/** Master + night with joins open + N players. Returns device tokens. */
export async function liveNight(t: TestApp, n = 3, opts: { start?: boolean; settings?: unknown } = {}) {
  const gm = await setupMaster(t);
  await call(t, gm, 'POST', '/api/nights', { name: 'Test', lengthMinutes: 300, settings: opts.settings ?? {} });
  await call(t, gm, 'POST', '/api/night/open-joins');
  const devices: { id: number; token: string }[] = [];
  const names = ['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Finn'];
  for (let i = 0; i < n; i++) {
    const { player, deviceToken } = createPlayer(t.ctx, { displayName: names[i], ticker: names[i]!.slice(0, 3).toUpperCase() });
    devices.push({ id: player.id, token: deviceToken });
  }
  if (opts.start !== false) {
    const r = await call(t, gm, 'POST', '/api/night/start');
    if (r.statusCode !== 200) throw new Error(r.body);
  }
  return { gm, devices };
}

/** Strings that must never reach a client (hidden mechanics / internals). */
export const FORBIDDEN_KEYS = ['"drift"', '"causes"', '"fair"', '"target"', '"impulses"', '"shock"', '"lastFair"', '"leaverFair"', '"credential_hash"', '"pin_hash"', '"token_hash"', 'goldHidden', 'gold_hidden'];
export const GM_ONLY_KEYS = ['"indexTerms"', '"gmOffset"', '"moodTerm"', '"ledger"', '"overrides"', '"baseline"'];
