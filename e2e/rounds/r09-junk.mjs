// Round 9 — junk input everywhere: html/script, markdown tricks, RTL text, bad settings, fake files.
import { api, browser, dev, gmRoute, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer, toasts, home, SCR, fixtures } from './lib.mjs';
fixtures();
const R = makeRound('r09-junk');
const s = await startServer('r09', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
const XSS = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  // 1. Junk in a phone join: RTL override name; fake avatar; huge avatar.
  const p = await phone(b, s, R, 'x', 'x', { join: false });
  await p.page.getByLabel('Display name').fill('‮evil‬ Bob');
  await p.page.getByLabel(/Ticker/).fill('RTL');
  await p.page.locator('input[type=file]').setInputFiles(`${SCR}/fake.png`);
  await sleep(500);
  const ft = await toasts(p.page);
  R.ok(`fake avatar: "${ft}"`);
  await p.page.locator('input[type=file]').setInputFiles(`${SCR}/huge.png`);
  await sleep(2500);
  const ht = await toasts(p.page);
  R.ok(`huge avatar: "${ht}"`);
  await p.page.getByRole('button', { name: /^(Join|Request to join)$/ }).click();
  await sleep(2000);
  R.check(await p.page.locator('button.icon').first().isVisible().catch(() => false), 'join', 'a big photo is resized and the join still works', await p.page.locator('body').innerText().then((x) => x.slice(0, 100)));
  p.token = await p.page.evaluate(() => localStorage.getItem('gn_device'));
  const q = await phone(b, s, R, 'Quinn', 'QUI');
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const st = await night(gm);
  const ids = st.players.map((x) => x.id);
  // Direct API: avatar that isn't an image.
  const fakeJoin = await api((await b.newContext()).request, s.base, 'POST', '/api/join', { displayName: 'Fakey', ticker: 'FAK', avatarData: 'data:image/png;base64,' + Buffer.from('hello world').toString('base64') });
  R.check(fakeJoin.status === 400, 'upload', 'a non-image avatar is refused', JSON.stringify(fakeJoin.body));
  // 2. Script/html in GM-written text: game name, library name, rule entry, memo text, custom reward, notification, night name.
  await api(gm.req, s.base, 'PATCH', '/api/night', { name: 'Night ' + XSS });
  const g = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Game ' + XSS, participants: ids })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/start`);
  await api(gm.req, s.base, 'POST', '/api/library', { name: 'Lib ' + XSS.slice(0, 40) });
  const rule = await api(gm.req, s.base, 'POST', '/api/rules', { title: 'Rule ' + XSS.slice(0, 60), body: '# Head\n- item\n[click](javascript:alert(1))\n[ok](https://example.com "x" onmouseover="window.__pwned=1")\n' + XSS, link: 'javascript:alert(1)' });
  R.ok(`rule with javascript: link → ${rule.status} ${JSON.stringify(rule.body).slice(0, 100)}`);
  await api(gm.req, s.base, 'POST', '/api/challenges', { playerId: ids[1], text: 'Memo ' + XSS, reward: { type: 'custom', text: 'Prize ' + XSS } });
  await api(gm.req, s.base, 'POST', '/api/notifications', { to: { all: true }, message: 'Note ' + XSS });
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/scores`, { scores: [{ playerId: ids[0], score: 3 }] }).catch(() => {});
  const tv = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  R.watch(tv, 'tv');
  await tv.goto(s.base + '/display');
  await sleep(4000);
  const pages = { tv, gm: gm.page, phone: q.page };
  for (const r of ['dashboard', 'games', 'library', 'rules', 'espionage', 'notify', 'players', 'archive']) {
    await gmRoute(gm.page, r);
    await sleep(400);
  }
  await openApp(q.page, 'Messages');
  await sleep(400);
  await q.page.locator('button.mono').first().click().catch(() => {});
  await sleep(1300);
  await home(q.page);
  await openApp(q.page, 'Rules');
  await sleep(600);
  await q.page.locator('text=Rule').first().click().catch(() => {});
  await sleep(500);
  for (const [k, pg] of Object.entries(pages)) {
    const pwned = await pg.evaluate(() => window.__pwned === 1);
    const imgs = await pg.locator('img[src="x"]').count();
    R.check(!pwned && imgs === 0, 'xss', `no script ran from GM text on the ${k}`, `pwned=${pwned} imgs=${imgs}`);
  }
  const jsLinks = await q.page.locator('a[href^="javascript"]').count();
  R.check(jsLinks === 0, 'xss', 'no javascript: links in the rulebook');
  // 3. Settings junk via the API the Settings screen uses.
  const junk = [
    { market: { feeFrac: 'abc' } },
    { market: { feeFrac: -1 } },
    { market: { tickSeconds: 1 } },
    { votes: { quarterCount: 0 } },
    { votes: { quarterCount: 2.5 } },
    { scoring: { placementMults: 'lots' } },
    { scoring: { placementMults: [1, 'x'] } },
    { handicap: { gainByLevel: [0, 0.1] } },
    { hints: { buy: { priceCommon: 0 } } },
    { market: null },
    [1, 2, 3],
    { __proto__: { polluted: true }, market: { feeFrac: 0.04 } },
  ];
  for (const j of junk) {
    const r = await api(gm.req, s.base, 'PATCH', '/api/night/settings', j);
    R.check(r.status === 400 || (r.status === 200 && JSON.stringify(j).includes('0.04')), 'settings', `junk settings ${JSON.stringify(j).slice(0, 50)} → ${r.status}`, JSON.stringify(r.body).slice(0, 160));
  }
  const after = (await night(gm)).gm.settings.resolved;
  R.check(typeof after.market.feeFrac === 'number' && after.market.feeFrac >= 0, 'settings', 'settings still valid after junk', JSON.stringify(after.market.feeFrac));
  R.check(({}).polluted === undefined, 'settings', 'no prototype pollution');
  // Settings screen: type a negative number and save → readable error.
  await gmRoute(gm.page, 'settings');
  await sleep(600);
  const fee = gm.page.locator('input[id="market.feeFrac"]');
  if (await fee.isVisible().catch(() => false)) {
    await fee.fill('-3');
    await gm.page.getByRole('button', { name: /^Save/ }).click();
    const t = await toasts(gm.page);
    R.check(/feeFrac|fee|must/i.test(t), 'settings', 'bad value on the Settings screen gives a readable error', t);
  } else R.bug('settings', 'could not find the fee field on the Settings screen');
  // 4. Library import of a broken file through the UI.
  await gmRoute(gm.page, 'library');
  await sleep(500);
  await gm.page.locator('input[type=file]').first().setInputFiles(`${SCR}/bad-pack.json`);
  await sleep(800);
  const it = await toasts(gm.page);
  R.check(it.length > 0 && !/SyntaxError|JSON at position|Unexpected/i.test(it), 'library', 'importing a broken pack file gives a readable message', `toast "${it}"`);
  // 5. Scores: huge counts of players / big payloads.
  const big = await api(gm.req, s.base, 'POST', '/api/notifications', { to: { all: true }, message: 'x'.repeat(2_000_000) });
  R.check(big.status === 413 || big.status === 400 || big.status === 200, 'limits', 'a 2 MB message is refused, not a crash', String(big.status));
  // 6. Phone-side junk: vote for nonsense, trade unknown stock, buy with string.
  const v = await dev(q, s, 'POST', '/api/vote', { targetId: 'lol' });
  const t1 = await dev(q, s, 'POST', '/api/trade/buy', { securityId: '../../etc', gold: 2 });
  const t2 = await dev(q, s, 'POST', '/api/trade/buy', { securityId: 'index', gold: '2; DROP TABLE player' });
  R.check([v, t1, t2].every((x) => x.status >= 400 && x.status < 500), 'api', 'nonsense phone requests get 4xx', [v, t1, t2].map((x) => x.status).join(','));
  await R.shot(tv, 'tv-junk', s.dir);
  await gmRoute(gm.page, 'dashboard');
  await R.shot(gm.page, 'gm-junk', s.dir);
} catch (e) {
  R.bug('harness', 'round crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
