// iPhone home-screen app: manifest + icons served, meta tags on /play only, add-to-home-screen hint only in iPhone Safari.
import { startServer, makeRound, browser, api, gmSetup, newNight } from '../rounds/lib.mjs';
import { mkdirSync } from 'node:fs';
const R = makeRound('pwa');
const s = await startServer('pwa');
mkdirSync(`${s.dir}/shots`, { recursive: true });
const b = await browser();
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const req = gm.req;
  const man = await req.fetch(s.base + '/manifest.webmanifest');
  const mj = man.ok() ? JSON.parse(await man.text()) : {};
  R.check(man.ok() && mj.display === 'standalone' && mj.start_url === '/play', 'pwa', 'manifest served: standalone, starts at /play', `${man.status()} ${JSON.stringify(mj).slice(0, 120)}`);
  for (const f of ['/apple-touch-icon.png', '/icon-192.png', '/icon-512.png']) {
    const r = await req.fetch(s.base + f);
    R.check(r.ok() && /image\/png/.test(r.headers()['content-type'] ?? ''), 'pwa', `${f} served as PNG`, `${r.status()} ${r.headers()['content-type']}`);
  }
  const play = await (await req.fetch(s.base + '/play')).text();
  R.check(/apple-mobile-web-app-capable/.test(play) && /apple-touch-icon/.test(play) && /black-translucent/.test(play), 'pwa', '/play has the iPhone home-screen tags');
  const gmHtml = await (await req.fetch(s.base + '/gm')).text();
  R.check(!/manifest/.test(gmHtml), 'pwa', 'GM page is not installable as the player app');
  const iphone = async (standalone) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript((v) => Object.defineProperty(navigator, 'standalone', { get: () => v }), standalone);
    const page = await ctx.newPage();
    R.watch(page, `iphone-${standalone}`);
    await page.goto(s.base + '/play');
    await page.getByLabel('Display name').waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    return page;
  };
  const safari = await iphone(false);
  R.check(await safari.locator('.a2hs').isVisible(), 'pwa', 'iPhone Safari shows the Add to Home Screen hint before joining');
  await safari.screenshot({ path: `${s.dir}/shots/01-safari-hint.png` });
  await safari.getByRole('button', { name: 'Got it' }).click();
  R.check(!(await safari.locator('.a2hs').isVisible()), 'pwa', 'hint can be dismissed');
  const app = await iphone(true);
  R.check(!(await app.locator('.a2hs').isVisible()), 'pwa', 'no hint inside the home-screen app');
  const other = await iphone(undefined);
  R.check(!(await other.locator('.a2hs').isVisible()), 'pwa', 'no hint on non-iPhone browsers');
  await app.getByLabel('Display name').fill('Ann');
  await app.getByLabel(/Ticker/).fill('ANN');
  await app.getByRole('button', { name: /^(Join|Request to join)$/ }).click();
  await app.locator('button.app').first().waitFor({ timeout: 15000 }).catch(() => {});
  R.check((await app.locator('button.app').count()) > 0, 'pwa', 'joining from the home-screen app works');
  await app.screenshot({ path: `${s.dir}/shots/02-app-home.png` });
} catch (e) {
  R.bug('harness', 'crashed', String(e.message).split('\n')[0]);
}
R.report(s);
await b.close();
await s.stop();
process.exit(0);
