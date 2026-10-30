// Clue board in the real app: library entry (manual crown), tab, no crown, wrong accusation -> out, phone width, solve -> result + recap.
import { api, browser, gmLogin, gmRoute, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('clue');
const s = await startServer('clue', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const lib = (await api(gm.req, s.base, 'GET', '/api/library')).body.games;
  const clue = lib.find((g) => g.name === 'Clue');
  R.check(clue?.board === 'clue' && clue?.leadMode === 'manual', 'library', 'Clue is in the default library with its board and a manual crown', JSON.stringify(clue ?? null).slice(0, 160));
  const ids = (await night(gm)).players.map((p) => p.id);
  const t1 = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'Study', seats: 4 })).body.id;
  for (let i = 0; i < 4; i++) await api(gm.req, s.base, 'POST', `/api/tables/${t1}/seat`, { seat: i + 1, playerId: ids[i] });
  const g = (await api(gm.req, s.base, 'POST', '/api/games', { libraryGameId: clue.id, participants: ids, tableId: t1 })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/start`);
  const page = gm.page;
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.reload(); await sleep(1500);
  await page.locator('nav.side button.board', { hasText: 'Clue' }).click(); await sleep(1500);
  R.check((await page.locator('.pp').count()) >= 4, 'board', 'board renders with a panel per player');
  await page.screenshot({ path: `${s.dir}/shots/01-laptop.png`, fullPage: true });
  const panel = (i) => page.locator(`.right #clue-p-${ids[i]}`);
  // no crown during Clue (Tate): the board offers no crown button
  R.check((await page.getByRole('button', { name: /crown/i }).count()) === 0, 'crown', 'no crown button on the Clue board');
  let ng;
  // Dev accuses wrong -> out
  await panel(3).getByRole('button', { name: 'Wrong accusation' }).click(); await sleep(300);
  await panel(3).getByRole('button', { name: 'Yes, wrong' }).click(); await sleep(1500);
  R.check(/Out of the turn order/.test((await panel(3).textContent()) ?? ''), 'board', 'wrong accusation puts Dev out (still shows cards)');
  const st = (await api(gm.req, s.base, 'GET', `/api/games/${g.id}/board`)).body;
  R.check(JSON.stringify(st.state ?? {}).includes('"wrong":1'), 'board', 'wrong accusation saved to the server', JSON.stringify(st.state ?? {}).slice(0, 200));
  await page.screenshot({ path: `${s.dir}/shots/02-laptop-mid.png`, fullPage: true });
  // GM phone width
  const pgm = await gmLogin(b, s, R, 'phone', 'gm-phone');
  await gmRoute(pgm.page, `board-${g.id}`); await sleep(1500);
  await pgm.page.screenshot({ path: `${s.dir}/shots/03-phone.png`, fullPage: true });
  const sw = await pgm.page.evaluate(() => document.documentElement.scrollWidth);
  R.check(sw <= 390, 'layout', 'phone: nothing wider than the screen', String(sw));
  // Ann solves it
  await panel(0).getByRole('button', { name: 'Correct accusation' }).click(); await sleep(300);
  await panel(0).getByRole('button', { name: 'Yes, solved it' }).click(); await sleep(2000);
  ng = (await night(gm)).games.find((x) => x.id === g.id);
  R.check(ng.leaderId == null, 'crown', 'still no crown after the case is solved (the result decides)', JSON.stringify({ leader: ng.leaderId }));
  await page.screenshot({ path: `${s.dir}/shots/04-solved.png`, fullPage: true });
  const body = (await page.textContent('body')) ?? '';
  R.check(!/envelope contains|solution:/i.test(body), 'hidden', 'no solution envelope shown on the board');
  R.check(errs.length === 0, 'client', 'no page errors', errs.join(' | ').slice(0, 200));
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: [ids[0], ids[1], ids[2], ids[3]].map((id, i) => ({ playerId: id, placement: i + 1 })) });
  await sleep(1500);
  await openApp(ps[0].page, 'Messages'); await sleep(900);
  const m = (await ps[0].page.textContent('body')) ?? '';
  R.check(/Clue/i.test(m), 'recap', "Ann's phone gets her Clue recap", m.replace(/\s+/g, ' ').slice(0, 160));
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close(); R.report(s); await s.stop();
}
