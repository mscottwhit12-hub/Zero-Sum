// Oct 29 real-hardware feedback round, in real browsers: early vote + call hangs up after voting, shorting on the
// phone, Risk battles (GM panel + phone Risk app entry approved by the GM), FLAC upload, end-of-night package.
import { api, browser, dev, gmRoute, gmSetup, home, makeRound, newNight, openApp, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('oct29');
const s = await startServer('oct29', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
const shot = (p, n) => p.screenshot({ path: `${s.dir}/shots/${n}.png`, fullPage: true });
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const ids = (await night(gm)).players.map((p) => p.id);
  const gp = gm.page;
  const pa = ps[0].page;

  // 1. Early vote from the Dashboard button; the call rings; after voting the phone goes back home.
  await gmRoute(gp, 'dashboard'); await sleep(1200);
  await gp.getByRole('button', { name: 'Open next vote now' }).click(); await sleep(2500);
  const v = (await night(gm)).gm?.vote;
  R.check(v?.open === true, 'vote', 'GM opened the next vote early', JSON.stringify(v));
  await home(pa); await sleep(1500);
  R.check((await pa.locator('.call').count()) > 0, 'vote', 'phone rings for the early vote');
  await pa.locator('button.rb.a').click(); await sleep(800);
  await pa.locator('button.pick').nth(1).click(); await sleep(2500);
  R.check((await pa.locator('button.app').count()) > 0 && (await pa.locator('button.pick').count()) === 0, 'vote', 'after voting the call/vote screen closes back to home');

  // 2. Short on the phone (not own stock).
  await openApp(pa, 'Market'); await sleep(600);
  await pa.locator('button.r', { hasText: 'BEN' }).first().click(); await sleep(500);
  R.check((await pa.getByRole('button', { name: 'Short', exact: true }).count()) === 1, 'short', 'Short is offered on another player');
  await pa.locator('.cd', { hasText: 'Bet it falls' }).locator('input').fill('5');
  await pa.getByRole('button', { name: 'Short', exact: true }).click(); await sleep(1500);
  const me = (await dev(ps[0], s, 'GET', '/api/me')).body;
  const holdings = me?.state?.me?.holdings ?? me?.me?.holdings ?? [];
  await shot(pa, '01-phone-short');
  R.check(/Your short/.test((await pa.textContent('body')) ?? ''), 'short', 'the phone shows the open short', JSON.stringify(holdings).slice(0, 120));
  await pa.getByRole('button', { name: '‹ All stocks' }).click(); await sleep(300);
  await pa.locator('button.r', { hasText: 'ANN' }).first().click(); await sleep(500);
  R.check((await pa.getByRole('button', { name: 'Short', exact: true }).count()) === 0, 'short', 'no Short on your own stock');

  // 3. Risk: phone app for players in the game only; a logged battle is approved on the GM board.
  const lib = (await api(gm.req, s.base, 'GET', '/api/library')).body.games;
  const risk = lib.find((g) => g.board === 'risk');
  const g = (await api(gm.req, s.base, 'POST', '/api/games', { libraryGameId: risk.id, participants: ids.slice(0, 3) })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/start`);
  await gp.reload(); await sleep(1500);
  await gp.locator('nav.side button.board', { hasText: 'Risk' }).click(); await sleep(2000);
  await home(pa); await sleep(2500);
  R.check((await pa.locator('button.app', { hasText: 'Risk' }).count()) === 1, 'risk', 'Risk app appears for a player in the game');
  await home(ps[3].page); await sleep(500);
  R.check((await ps[3].page.locator('button.app', { hasText: 'Risk' }).count()) === 0, 'risk', 'no Risk app for a player not in the game');
  await openApp(pa, 'Risk'); await sleep(800);
  await pa.locator('select').first().selectOption({ label: 'Ben' });
  await pa.getByRole('spinbutton').first().fill('2');
  await pa.getByRole('button', { name: 'Send to GM' }).click(); await sleep(1500);
  await shot(pa, '02-phone-risk-app');
  const pw = await pa.evaluate(() => document.documentElement.scrollWidth);
  R.check(pw <= 390, 'layout', 'Risk app fits the phone', String(pw));
  await sleep(1500);
  R.check((await gp.getByRole('button', { name: 'Approve' }).count()) === 1, 'risk', 'GM board shows the player battle to approve');
  await shot(gp, '03-gm-risk-claim');
  const before = (await api(gm.req, s.base, 'GET', `/api/games/${g.id}/board`)).body.state.players;
  await gp.getByRole('button', { name: 'Approve' }).click(); await sleep(2500);
  const after = (await api(gm.req, s.base, 'GET', `/api/games/${g.id}/board`)).body.state.players;
  R.check(after[ids[0]].territories === before[ids[0]].territories + 2 && after[ids[1]].territories === before[ids[1]].territories - 2, 'risk', 'approving moves 2 territories Ben → Ann', `${before[ids[0]].territories}->${after[ids[0]].territories}`);
  R.check(/approved/.test((await pa.textContent('body')) ?? ''), 'risk', "Ann's phone shows the battle approved");
  // GM logs a battle directly
  await gp.getByLabel('Attacker', { exact: true }).selectOption({ label: 'Cat' });
  await gp.getByLabel('Defender', { exact: true }).selectOption({ label: 'Ann' });
  await gp.getByRole('button', { name: 'Log battle' }).click(); await sleep(2000);
  const after2 = (await api(gm.req, s.base, 'GET', `/api/games/${g.id}/board`)).body.state.players;
  R.check(after2[ids[2]].territories === after[ids[2]].territories + 1, 'risk', 'GM Battle panel moves a territory');

  // 4. FLAC upload is accepted (tiny file with a FLAC header).
  const flac = 'data:audio/flac;base64,' + Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(64)]).toString('base64');
  const up = await api(gm.req, s.base, 'POST', '/api/sounds', { name: 'Test flac', kind: 'soundboard', data: flac });
  R.check(up.status === 200, 'audio', 'FLAC upload accepted', String(up.status));

  // 5. End the night: package zip for the GM, stats + cards on the phone.
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/result`, { actualHours: 0.5, participants: ids.slice(0, 3).map((id, i) => ({ playerId: id, placement: i + 1 })) });
  await api(gm.req, s.base, 'POST', '/api/night/end');
  await api(gm.req, s.base, 'POST', '/api/night/finale/skip'); await sleep(2500);
  const zr = await gm.req.get(s.base + '/api/export/package.zip');
  const zb = await zr.body();
  R.check(zr.status() === 200 && zb.subarray(0, 2).toString() === 'PK' && zb.toString('latin1').includes('night-summary.pdf'), 'package', 'GM package zip downloads with the night summary', `${zr.status()} ${zb.length} bytes`);
  await pa.reload(); await sleep(3500);
  await shot(pa, '04-phone-statement');
  R.check((await pa.locator('.cards img').count()) === 3, 'package', 'phone statement shows 3 cards', String(await pa.locator('.cards img').count()));
  R.check(/Biggest backer/.test((await pa.textContent('body')) ?? ''), 'package', 'phone statement shows the new stats');
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close(); R.report(s); await s.stop();
}
