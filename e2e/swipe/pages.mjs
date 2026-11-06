// Phone home-screen pages: swipe right to the full-screen leaderboard, swipe/tap back, no Standings app. Needs `npm run build -w packages/client` first.
import { api, browser, gmSetup, makeRound, newNight, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('swipe-pages');
const s = await startServer('swipe-pages', { scale: 1 });
const b = await browser();
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const p = await phone(b, s, R, 'Ann', 'ANN');
  await phone(b, s, R, 'Ben', 'BEN');
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const page = p.page;
  await sleep(1500);
  const pagerX = () => page.evaluate(() => Math.round(document.querySelector('.phone .pager').getBoundingClientRect().x - document.querySelector('.phone').getBoundingClientRect().x));
  const swipe = async (dx) => { // touch-like drag across the home screen with the mouse
    const bx = await page.evaluate(() => { const r = document.querySelector('.phone').getBoundingClientRect(); return r.x + r.width / 2; });
    await page.mouse.move(bx, 400); await page.mouse.down(); await page.mouse.move(bx + dx, 405, { steps: 10 }); await page.mouse.up(); await sleep(500);
  };
  R.check((await page.locator('.phone .app.a-standings').count()) === 0, 'removed', 'there is no Standings app icon any more');
  R.check((await pagerX()) === 0, 'start', 'starts on the home page');
  { // a slow short drag (a quick 40 px flick counts as a swipe since the Nov 5 swipe-back fix)
    const bx = await page.evaluate(() => { const r = document.querySelector('.phone').getBoundingClientRect(); return r.x + r.width / 2; });
    await page.mouse.move(bx, 400); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(bx + 4 * i, 400 + i / 2); await sleep(45); }
    await page.mouse.up(); await sleep(500);
  }
  R.check((await pagerX()) === 0, 'short', 'a slow short drag snaps back to home');
  await swipe(-150);
  R.check((await pagerX()) === 0, 'no-overscroll', 'swiping left on home does nothing');
  await swipe(-150);
  await swipe(180);
  const w = await page.evaluate(() => document.querySelector('.phone').getBoundingClientRect().width);
  R.check((await pagerX()) === Math.round(w) || Math.abs((await pagerX()) - w) < 2, 'board', 'swiping right brings in the leaderboard', String(await pagerX()));
  R.check((await page.locator('.phone .lb .sr').count()) === 2, 'rows', 'leaderboard lists both players');
  R.check((await page.locator('.phone .dock').count()) === 0, 'dock', 'dock is hidden on the leaderboard page');
  await page.screenshot({ path: `${s.dir}/shots/board.png` });
  await swipe(-180);
  R.check((await pagerX()) === 0, 'back', 'swiping left returns to home');
  await page.locator('.phone .dot').first().click(); await sleep(500);
  R.check(Math.abs((await pagerX()) - w) < 2, 'dot', 'tapping the left dot opens the leaderboard');
  await page.locator('.phone .dot').nth(1).click(); await sleep(600);
  R.check((await page.locator('.phone .dock').count()) === 1, 'dock-back', 'home shows the dock again');
  // taps still open apps; vertical drag is not a swipe
  await page.locator('.phone .app').first().click(); await sleep(600);
  R.check((await page.locator('.phone .appbar').count()) === 1, 'tap', 'tapping an app still opens it');
  await page.screenshot({ path: `${s.dir}/shots/app.png` });
  console.log(s.dir);
} catch (e) { R.bug('harness', 'crashed', e.stack); } finally { await b.close(); R.report(s); await s.stop(); }
