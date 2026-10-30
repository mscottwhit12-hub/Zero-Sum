// Catan board in the real app: library entry (VP crown), tab, city upgrade + Longest Road move the crown, phone width + Points column, recap.
import { api, browser, gmLogin, gmRoute, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('catan');
const s = await startServer('catan', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const lib = (await api(gm.req, s.base, 'GET', '/api/library')).body.games;
  const cat = lib.find((g) => g.name === 'Catan');
  R.check(cat?.board === 'catan' && cat?.leadMode === 'high', 'library', 'Catan is in the default library with its board and VP crown', JSON.stringify(cat ?? null).slice(0, 160));
  const ids = (await night(gm)).players.map((p) => p.id);
  const t1 = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'Island', seats: 4 })).body.id;
  for (let i = 0; i < 4; i++) await api(gm.req, s.base, 'POST', `/api/tables/${t1}/seat`, { seat: i + 1, playerId: ids[i] });
  const g = (await api(gm.req, s.base, 'POST', '/api/games', { libraryGameId: cat.id, participants: ids, tableId: t1 })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/start`);
  const page = gm.page;
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.reload(); await sleep(1500);
  await page.locator('nav.side button.board', { hasText: 'Catan' }).click(); await sleep(1500);
  R.check((await page.locator('.pp').count()) >= 4, 'board', 'board renders with a panel per player');
  await page.screenshot({ path: `${s.dir}/shots/01-laptop.png`, fullPage: true });
  const panel = (i) => page.locator(`.right #catan-p-${ids[i]}`);
  await panel(0).getByRole('button', { name: /Upgrade a settlement/ }).click(); await sleep(600);
  await panel(1).getByRole('button', { name: /Longest Road/ }).click(); await sleep(2500);
  const st = (await api(gm.req, s.base, 'GET', `/api/games/${g.id}/board`)).body;
  R.check(JSON.stringify(st.state ?? {}).length > 20, 'board', 'board state saved to the server', JSON.stringify(st.state ?? {}).slice(0, 200));
  let ng = (await night(gm)).games.find((x) => x.id === g.id);
  R.check(ng.leaderId === ids[1] && ng.scores?.[ids[1]] === 4 && ng.scores?.[ids[0]] === 3, 'crown', 'crown follows victory points (Ben 4 with Longest Road, Ann 3 with a city)', JSON.stringify({ leader: ng.leaderId, scores: ng.scores }));
  await page.screenshot({ path: `${s.dir}/shots/02-laptop-mid.png`, fullPage: true });
  const pgm = await gmLogin(b, s, R, 'phone', 'gm-phone');
  await pgm.page.setViewportSize({ width: 360, height: 780 });
  await gmRoute(pgm.page, `board-${g.id}`); await sleep(1500);
  await pgm.page.screenshot({ path: `${s.dir}/shots/03-phone.png`, fullPage: true });
  const sw = await pgm.page.evaluate(() => document.documentElement.scrollWidth);
  R.check(sw <= 362, 'layout', 'phone 360: nothing wider than the screen', String(sw));
  const ptsRight = await pgm.page.evaluate(() => { const th = [...document.querySelectorAll('th')].find((x) => x.textContent.trim() === 'Points'); const sc = th?.closest('.scroll-x'); return th && sc ? th.getBoundingClientRect().right - sc.getBoundingClientRect().right : 999; });
  R.check(ptsRight <= 1, 'layout', 'phone 360: Points column visible without scrolling (bug C-14)', String(ptsRight));
  R.check(errs.length === 0, 'client', 'no page errors', errs.join(' | ').slice(0, 200));
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: [ids[1], ids[0], ids[2], ids[3]].map((id, i) => ({ playerId: id, placement: i + 1 })) });
  await sleep(1500);
  await openApp(ps[1].page, 'Messages'); await sleep(900);
  const m = (await ps[1].page.textContent('body')) ?? '';
  R.check(/Catan/i.test(m), 'recap', "Ben's phone gets his Catan recap", m.replace(/\s+/g, ' ').slice(0, 160));
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close(); R.report(s); await s.stop();
}
