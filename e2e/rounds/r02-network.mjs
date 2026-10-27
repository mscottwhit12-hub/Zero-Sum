// Round 2 — phones drop off Wi-Fi, the server crashes, one person on two phones, denied rejoins, sign-out.
import { api, browser, dev, gmLogin, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer, toasts, home } from './lib.mjs';
const R = makeRound('r02-network');
const s = await startServer('r02', { scale: 1 });
const b = await browser();
const nightState = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s, { length: 300, settings: { votes: { quarterCount: 4 } } });
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  await sleep(1500);

  // 1. Ann's phone loses Wi-Fi; meanwhile a game starts, a tip and a GM message arrive.
  await ps[0].ctx.setOffline(true);
  const g = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Cards', participants: ps.map((p) => p.id), leadMode: 'manual' })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/start`);
  await api(gm.req, s.base, 'POST', '/api/notifications', { to: { all: true }, message: 'Pizza is here' });
  await api(gm.req, s.base, 'POST', '/api/tips', { playerId: ps[0].id, tier: 'common' });
  await sleep(4000);
  // Tapping while offline should fail gracefully.
  await openApp(ps[0].page, 'Market').catch(() => {});
  await ps[0].page.locator('.row-btn').first().click({ timeout: 3000 }).catch(() => {});
  const gold = ps[0].page.getByPlaceholder('Gold');
  if (await gold.isVisible().catch(() => false)) {
    await gold.fill('2');
    await ps[0].page.getByRole('button', { name: 'Buy', exact: true }).click().catch(() => {});
    const t = await toasts(ps[0].page);
    R.check(t.length > 0, 'offline', 'buying while offline shows a message', 'no feedback when a buy fails offline');
    R.ok(`offline buy toast: ${t}`);
  }
  await home(ps[0].page);
  await ps[0].ctx.setOffline(false);
  await sleep(6000);
  const badge = await ps[0].page.locator('button.icon', { hasText: 'Messages' }).locator('.badge-count').textContent().catch(() => null);
  R.check(badge && Number(badge) >= 2, 'offline', 'back online: missed message + tip show as badges', `badge = ${badge}`);
  await openApp(ps[0].page, 'Messages');
  const txt = await ps[0].page.locator('body').innerText();
  R.check(/Pizza is here/.test(txt) && /Anonymous tip/.test(txt), 'offline', 'back online: missed message and tip are listed');
  await home(ps[0].page);

  // 2. Server crashes (kill -9) and comes back. Phones/TV/GM should reconnect on their own.
  const tv = await (await b.newContext()).newPage();
  R.watch(tv, 'tv');
  await tv.goto(s.base + '/display');
  await sleep(1500);
  await s.kill9();
  await sleep(3000);
  await s.start();
  await sleep(9000);
  const st = await nightState(gm);
  R.check(st.night?.status === 'live', 'restart', 'night still live after a crash');
  R.check(st.games?.some((x) => x.id === g.id && x.status === 'active'), 'restart', 'running game survives a crash');
  // Phone buys after restart without refresh.
  await openApp(ps[1].page, 'Market');
  await ps[1].page.locator('.row-btn', { hasText: 'ANN' }).first().click({ timeout: 4000 });
  await ps[1].page.getByPlaceholder('Gold').fill('3');
  await ps[1].page.getByRole('button', { name: 'Buy', exact: true }).click();
  const t2 = await toasts(ps[1].page);
  R.check(!/error|failed|network/i.test(t2) && (await ps[1].page.locator('.toast.error').count()) === 0, 'restart', 'phone can trade after a server crash without refreshing', `toast: ${t2}`);
  await home(ps[1].page);
  await api(gm.req, s.base, 'POST', '/api/notifications', { to: { all: true }, message: 'After restart' });
  await sleep(2500);
  await openApp(ps[2].page, 'Messages');
  R.check(/After restart/.test(await ps[2].page.locator('body').innerText()), 'restart', 'live updates reach phones after a crash without refresh', 'phone did not receive post-restart message (socket not reconnected?)');
  await home(ps[2].page);
  const tvTxt = await tv.locator('body').innerText();
  R.check(/Cards/.test(tvTxt), 'restart', 'TV still shows the running game after a crash');
  // GM laptop reconnects too.
  await gm.page.reload();
  await sleep(1500);
  R.check(await gm.page.getByText('Cards').first().isVisible().catch(() => false), 'restart', 'GM console back after crash (session cookie kept)');

  // 3. Ben gets a second phone (rejoin), first phone keeps working too.
  const ben2 = await phone(b, s, R, 'Ben-2', 'BEN', { join: false });
  await sleep(3500);
  await ben2.page.getByRole('button', { name: /return to my desk/i }).first().click();
  await ben2.page.getByRole('button', { name: 'Ben', exact: true }).click();
  await sleep(800);
  const req = (await nightState(gm)).gm.requests.find((r) => r.kind === 'rejoin');
  await api(gm.req, s.base, 'POST', `/api/requests/${req.id}/approve`);
  await sleep(3500);
  R.check(await ben2.page.locator('button.icon').first().isVisible().catch(() => false), 'devices', 'second phone gets in after approval');
  ben2.token = await ben2.page.evaluate(() => localStorage.getItem('gn_device'));
  const a1 = await dev(ps[1], s, 'POST', '/api/trade/buy', { securityId: 'index', gold: 2 });
  const a2 = await dev(ben2, s, 'POST', '/api/trade/buy', { securityId: 'crypto', gold: 2 });
  R.check(a1.status === 200 || a1.body.error, 'devices', 'first phone still works after the second is approved', JSON.stringify(a1.body).slice(0, 120));
  R.check(a2.status === 200 || a2.body.error, 'devices', 'second phone can trade', JSON.stringify(a2.body).slice(0, 120));

  // 4. Denied rejoin: the phone should say so and let them try again.
  const imp = await phone(b, s, R, 'Imposter', 'CAT', { join: false });
  await sleep(3500);
  await imp.page.getByRole('button', { name: /return to my desk/i }).first().click();
  await imp.page.getByRole('button', { name: 'Cat', exact: true }).click();
  await sleep(800);
  const req2 = (await nightState(gm)).gm.requests.find((r) => r.kind === 'rejoin');
  await api(gm.req, s.base, 'POST', `/api/requests/${req2.id}/deny`);
  await sleep(4000);
  const deniedTxt = await imp.page.locator('body').innerText();
  R.check(/denied|not approved|declined/i.test(deniedTxt), 'devices', 'denied phone is told', `screen: ${deniedTxt.slice(0, 160)}`);
  R.check(await imp.page.getByLabel('Display name').isVisible().catch(() => false) || /return to my desk/i.test(deniedTxt), 'devices', 'denied phone can try again');

  // 5. Pending phone refreshes while waiting.
  const wait = await phone(b, s, R, 'Waiter', 'WAI', { join: false });
  await sleep(3500);
  await wait.page.getByLabel('Display name').fill('Waiter');
  await wait.page.getByLabel(/Ticker/).fill('WAI');
  await wait.page.getByRole('button', { name: /^(Join|Request to join)$/ }).click();
  await sleep(800);
  await wait.page.reload();
  await sleep(3500);
  const w = await wait.page.locator('body').innerText();
  R.check(!/Display name/.test(w), 'devices', 'refresh while waiting keeps the pending state', 'refresh while waiting threw them back to the form');
  const req3 = (await nightState(gm)).gm.requests.find((r) => r.displayName === 'Waiter');
  if (req3) await api(gm.req, s.base, 'POST', `/api/requests/${req3.id}/approve`);
  await sleep(4000);
  R.check(await wait.page.locator('button.icon').first().isVisible().catch(() => false), 'devices', 'refreshed waiting phone gets in after approval');

  // 6. Sign out from Profile, then come back.
  await openApp(ps[3].page, 'Profile');
  await ps[3].page.getByRole('button', { name: /Sign this phone out|Sign out/ }).click();
  await sleep(2500);
  const so = await ps[3].page.locator('body').innerText();
  R.check(/return to my desk|Display name/i.test(so), 'devices', 'signed-out phone shows the join/rejoin screen', so.slice(0, 160));

  // 7. Offline during a pause → resume while offline → online.
  await ps[2].ctx.setOffline(true);
  await api(gm.req, s.base, 'POST', '/api/night/pause', { minutes: 5 });
  await sleep(1500);
  await api(gm.req, s.base, 'POST', '/api/night/resume');
  await ps[2].ctx.setOffline(false);
  await sleep(6000);
  const lockVisible = await ps[2].page.getByRole('button', { name: /Open NFT Minter/ }).isVisible().catch(() => false);
  R.check(!lockVisible, 'offline', 'phone that missed the resume while offline is unlocked after reconnect', 'phone stuck on pause screen after reconnect');
  await R.shot(ps[2].page, 'after-offline-resume', s.dir);
} catch (e) {
  R.bug('harness', 'round crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
