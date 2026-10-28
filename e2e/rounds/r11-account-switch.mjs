// Round 11 — switching accounts on one browser: sign out + join as someone else in the same tab, with a second tab
// still open. The phone must land on home, the Minter must count for the account it shows, and no tab may mix accounts.
import { api, browser, gmSetup, home, makeRound, newNight, openApp, phone, sleep, startServer } from './lib.mjs';
const R = makeRound('r11');
const s = await startServer('r11', { scale: 1 });
const b = await browser();
const minter = async (gm, tok) => (await api(gm.req, s.base, 'GET', '/api/minter', undefined, { 'x-device-token': tok })).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ann = await phone(b, s, R, 'Ann', 'ANN');
  await phone(b, s, R, 'Bob', 'BOB');
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const p = ann.page;
  const tab2 = await ann.ctx.newPage(); // same browser = same identity
  R.watch(tab2, 'Ann-tab2');
  await tab2.goto(s.base + '/play'); await sleep(1500);
  await openApp(tab2, 'NFT Minter'); await sleep(800);

  await openApp(p, 'NFT Minter'); await sleep(800);
  for (let i = 0; i < 20; i++) await p.locator('button.mint').click({ timeout: 1000 }).catch(() => {});
  await sleep(3800);
  const annBefore = (await minter(gm, ann.token)).minted; // the server caps tap rate, so not every click counts
  R.check(annBefore > 0, 'minter', 'Ann mints', String(annBefore));

  await home(p); await openApp(p, 'Profile');
  await p.getByRole('button', { name: /Sign out/ }).click(); await sleep(1200);
  await p.getByLabel('Display name').fill('Zed', { timeout: 15000 });
  await p.getByLabel(/Ticker/).fill('ZED');
  await p.getByRole('button', { name: /^(Join|Request to join)$/ }).click(); await sleep(1500);
  for (const r of (await api(gm.req, s.base, 'GET', '/api/night')).body.gm.requests ?? []) await api(gm.req, s.base, 'POST', `/api/requests/${r.id}/approve`);
  await sleep(3500);
  R.check(await p.locator('button.icon').first().isVisible().catch(() => false), 'switch', 'after signing in as someone else the phone lands on home, not the old account\'s last app');
  const zed = await p.evaluate(() => localStorage.getItem('gn_device'));
  await openApp(p, 'NFT Minter'); await sleep(800);
  for (let i = 0; i < 7; i++) await p.locator('button.mint').click({ timeout: 1000 }).catch(() => {});
  // the second tab, still on Ann's Minter, taps too
  for (let i = 0; i < 5; i++) await tab2.locator('button.mint').click({ timeout: 500 }).catch(() => {});
  await sleep(4500);
  const a = await minter(gm, ann.token);
  const z = await minter(gm, zed);
  R.check(a.minted === annBefore, 'minter', 'Ann\'s count never changes after she signs out (no taps from either tab)', `Ann ${annBefore} -> ${a.minted}`);
  R.check(z.minted > 0 && z.minted <= 7, 'minter', 'Zed\'s Minter counts Zed\'s taps', `Zed ${z.minted}`);
  const t2 = (await tab2.textContent('body').catch(() => '')) ?? '';
  await home(tab2); await openApp(tab2, 'Profile'); await sleep(300);
  R.check(((await tab2.textContent('body')) ?? '').includes('Zed'), 'tabs', 'the other tab follows the new sign-in instead of mixing accounts', t2.replace(/\s+/g, ' ').slice(0, 80));
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
