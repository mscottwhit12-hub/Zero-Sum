// Shared harness for the human-behaviour bug rounds.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
// Loaded via require so NODE_PATH (a global Playwright install) works.
const { chromium } = createRequire(import.meta.url)('playwright');
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo root (the rounds start their own server from it). */
export const REPO = resolve(HERE, '../..');
/** Output (servers' data, screenshots, reports, generated fixtures). Gitignored. */
export const SCR = process.env.E2E_OUT ?? resolve(REPO, 'e2e/.out');
mkdirSync(`${SCR}/out`, { recursive: true });

/** Test fixtures for round 9, generated on first use (no binaries in the repo). */
export function fixtures() {
  if (!existsSync(`${SCR}/fake.png`)) writeFileSync(`${SCR}/fake.png`, 'not an image at all');
  if (!existsSync(`${SCR}/bad-pack.json`)) writeFileSync(`${SCR}/bad-pack.json`, '{"oops": tru');
  if (!existsSync(`${SCR}/huge.png`)) {
    // 3000×3000 uncompressed-ish PNG (~27 MB): the join form must resize it.
    const w = 3000, h = 3000;
    const row = Buffer.alloc(1 + w * 3, 0); row[0] = 0;
    for (let i = 1; i < row.length; i += 3) row[i] = 255;
    const raw = Buffer.concat(Array.from({ length: h }, () => row));
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    writeFileSync(`${SCR}/huge.png`, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]));
  }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let portSeq = 8200;
export async function startServer(name, { scale = 1, keepData = false } = {}) {
  const dir = `${SCR}/out/${name}`;
  if (!keepData) rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${dir}/data`, { recursive: true });
  mkdirSync(`${dir}/media`, { recursive: true });
  mkdirSync(`${dir}/shots`, { recursive: true });
  const port = portSeq++;
  const log = `${dir}/server.log`;
  const s = { dir, port, base: `http://localhost:${port}`, log, proc: null, scale };
  s.start = async () => {
    const out = [];
    s.proc = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'packages/server/src/main.ts'], {
      cwd: REPO,
      env: { ...process.env, PORT: String(port), DATA_DIR: `${dir}/data`, MEDIA_DIR: `${dir}/media`, ZS_TIME_SCALE: String(scale) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    s.proc.stdout.on('data', (d) => out.push(d));
    s.proc.stderr.on('data', (d) => out.push(d));
    s.flush = () => writeFileSync(log, Buffer.concat(out), { flag: 'w' });
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`${s.base}/api/health`);
        if (r.ok) return;
      } catch {}
      await sleep(150);
    }
    s.flush();
    throw new Error('server did not start: ' + readFileSync(log, 'utf8').slice(-2000));
  };
  s.stop = async () => {
    if (!s.proc) return;
    s.flush?.();
    const p = s.proc;
    const done = new Promise((r) => p.once('exit', r));
    try { process.kill(-p.pid, 'SIGTERM'); } catch {}
    await Promise.race([done, sleep(4000)]);
    try { process.kill(-p.pid, 'SIGKILL'); } catch {}
    s.proc = null;
  };
  s.kill9 = async () => {
    s.flush?.();
    const p = s.proc;
    const done = new Promise((r) => p.once('exit', r));
    try { process.kill(-p.pid, 'SIGKILL'); } catch {}
    await Promise.race([done, sleep(3000)]);
    s.proc = null;
  };
  /** 5xx responses and unhandled errors in the server log. */
  s.serverErrors = () => {
    s.flush?.();
    const txt = existsSync(log) ? readFileSync(log, 'utf8') : '';
    return txt.split('\n').filter((l) => /"statusCode":5\d\d|"level":50|"level":60|Unhandled|TypeError|ReferenceError|SqliteError|tick failed/.test(l)).map((l) => l.slice(0, 400));
  };
  await s.start();
  return s;
}

export function makeRound(name) {
  const issues = [];
  const notes = [];
  const consoleErrors = [];
  let shotN = 0;
  const R = {
    name,
    issues,
    notes,
    consoleErrors,
    bug(area, what, detail = '') {
      issues.push({ area, what, detail: String(detail).slice(0, 500) });
      console.log(`  BUG [${area}] ${what} ${detail ? '— ' + String(detail).slice(0, 200) : ''}`);
    },
    ok(what) {
      notes.push(what);
    },
    check(cond, area, what, detail) {
      if (!cond) R.bug(area, what, detail);
      else R.ok(what);
      return !!cond;
    },
    watch(page, who) {
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const txt = m.text();
        // Expected 4xx from deliberately bad input are logged by the browser as failed resources; keep them separately.
        consoleErrors.push({ who, text: txt.slice(0, 300) });
      });
      page.on('pageerror', (e) => {
        consoleErrors.push({ who, text: 'PAGEERROR ' + String(e).slice(0, 300) });
        R.bug('client', `uncaught page error on ${who}`, String(e));
      });
      page.on('dialog', (d) => d.accept().catch(() => {}));
    },
    async shot(page, label, dir) {
      try {
        await page.screenshot({ path: `${dir}/shots/${String(++shotN).padStart(2, '0')}-${label}.png` });
      } catch {}
    },
    report(server) {
      const se = server ? server.serverErrors() : [];
      for (const l of se) R.bug('server', 'server error in log', l);
      const pageErrs = consoleErrors.filter((c) => c.text.startsWith('PAGEERROR'));
      const out = { name, bugs: issues, passed: notes.length, consoleErrors: consoleErrors.length, pageErrors: pageErrs.length, serverErrors: se.length };
      writeFileSync(`${SCR}/out/${name}.json`, JSON.stringify({ ...out, notes, consoleErrors }, null, 1));
      console.log(`ROUND ${name}: ${issues.length} bugs, ${notes.length} checks passed, ${consoleErrors.length} console errors (${pageErrs.length} page errors), ${se.length} server errors`);
      return out;
    },
  };
  return R;
}

export async function browser() {
  return chromium.launch();
}

export async function api(req, base, method, path, data, headers) {
  let r;
  try {
    r = await req.fetch(base + path, { method, data, headers, failOnStatusCode: false });
  } catch (e) {
    return { status: 0, body: { error: 'network', message: String(e.message).split('\n')[0] } };
  }
  let body;
  const text = await r.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: r.status(), body };
}

/** Master GM on a laptop context (setup through the real Setup screen). Returns { ctx, page, req }. */
export async function gmSetup(b, s, R, { viaUi = true, deviceType = 'laptop' } = {}) {
  const ctx = await b.newContext({ viewport: deviceType === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: deviceType === 'phone', hasTouch: deviceType === 'phone' });
  const page = await ctx.newPage();
  R.watch(page, `gm-${deviceType}`);
  await page.goto(s.base + '/gm');
  if (viaUi) {
    await page.getByLabel('GM name').fill('Tate');
    await page.getByLabel('Password (8+ characters)').fill('test pass 123');
    await page.getByLabel('Confirm password').fill('test pass 123');
    await page.getByLabel(/Unlock PIN/).fill('1234');
    await page.getByRole('button', { name: deviceType === 'phone' ? 'Phone' : 'Laptop', exact: true }).click();
    await page.getByRole('button', { name: 'Create Master GM' }).click();
    await page.waitForTimeout(1000);
  } else {
    await api(ctx.request, s.base, 'POST', '/api/setup', { name: 'Tate', password: 'test pass 123', pin: '1234', deviceType });
    await page.reload();
  }
  return { ctx, page, req: ctx.request };
}

export async function gmLogin(b, s, R, deviceType = 'phone', label = 'gm2') {
  const ctx = await b.newContext({ viewport: deviceType === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: deviceType === 'phone', hasTouch: deviceType === 'phone' });
  const r = await api(ctx.request, s.base, 'POST', '/api/gm/login', { name: 'Tate', password: 'test pass 123', deviceType });
  if (r.status !== 200) throw new Error('login failed ' + JSON.stringify(r.body));
  const page = await ctx.newPage();
  R.watch(page, label);
  await page.goto(s.base + '/gm');
  await page.waitForTimeout(500);
  return { ctx, page, req: ctx.request };
}

export async function newNight(gm, s, { length = 300, settings = {} } = {}) {
  await api(gm.req, s.base, 'POST', '/api/nights', { name: 'Bug night', lengthMinutes: length, settings });
  await api(gm.req, s.base, 'POST', '/api/night/open-joins');
}

/** A phone that joins through the real join form. */
export async function phone(b, s, R, name, ticker, { join = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  R.watch(page, name);
  await page.goto(s.base + '/play');
  const p = { name, ticker, ctx, page, token: null, id: null };
  if (join) {
    await page.getByLabel('Display name').fill(name, { timeout: 15000 });
    await page.getByLabel(/Ticker/).fill(ticker);
    await page.getByRole('button', { name: /^(Join|Request to join)$/ }).click();
    await page.locator('button.icon').first().waitFor({ timeout: 15000 }).catch(() => {});
    p.token = await page.evaluate(() => localStorage.getItem('gn_device'));
    if (p.token) {
      const me = await api(ctx.request, s.base, 'GET', '/api/me', undefined, { 'x-device-token': p.token });
      p.id = me.body?.player?.id ?? null;
    }
  }
  return p;
}

export async function dev(p, s, method, path, data) {
  return api(p.ctx.request, s.base, method, path, data, { 'x-device-token': p.token });
}

export async function home(page) {
  for (let i = 0; i < 3; i++) {
    const b = page.getByRole('button', { name: /^‹/ }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
    else break;
  }
}
export async function openApp(page, label) {
  await home(page);
  await page.locator('button.icon', { hasText: label }).click({ timeout: 5000 });
  await page.waitForTimeout(200);
}
export async function toasts(page) {
  await page.waitForTimeout(400);
  return (await page.locator('.toast').allTextContents().catch(() => [])).join(' | ');
}
export async function gmRoute(page, r) {
  await page.evaluate((x) => (location.hash = `/${x}`), r);
  await page.waitForTimeout(300);
}
