// Scrabble board in the real app: library entry, tab, turn scores saved, no live crown, end game -> crown to the top total, phone width, recap.
import { api, browser, gmLogin, gmRoute, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('scrabble');
const s = await startServer('scrabble', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const lib = (await api(gm.req, s.base, 'GET', '/api/library')).body.games;
  const scr = lib.find((g) => g.name === 'Scrabble');
  R.check(scr?.board === 'scrabble' && scr?.leadMode === 'high', 'library', 'Scrabble is in the default library with its board', JSON.stringify(scr ?? null).slice(0, 160));
  const ids = (await night(gm)).players.map((p) => p.id);
  const t1 = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'Word table', seats: 4 })).body.id;
  for (let i = 0; i < 4; i++) await api(gm.req, s.base, 'POST', `/api/tables/${t1}/seat`, { seat: i + 1, playerId: ids[i] });
  const g = (await api(gm.req, s.base, 'POST', '/api/games', { libraryGameId: scr.id, participants: ids, tableId: t1 })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/start`);
  const page = gm.page;
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.reload(); await sleep(1500);
  await page.locator('nav.side button.board', { hasText: 'Scrabble' }).click(); await sleep(1500);
  R.check((await page.locator('.pp').count()) >= 4, 'board', 'board renders with a panel per player');
  await page.screenshot({ path: `${s.dir}/shots/01-laptop.png`, fullPage: true });
  const panel = (i) => page.locator(`.right #scr-p-${ids[i]}`);
  const score = async (i, n) => { await panel(i).locator('input.score').fill(String(n)); await panel(i).getByRole('button', { name: 'Add', exact: true }).click(); await sleep(400); };
  await score(0, 12); await score(1, 30); await score(2, 8); await score(3, 21);
  await sleep(2000);
  const st = (await api(gm.req, s.base, 'GET', `/api/games/${g.id}/board`)).body;
  R.check(JSON.stringify(st.state ?? {}).includes('30'), 'board', 'turn scores saved to the server', JSON.stringify(st.state ?? {}).slice(0, 200));
  let ng = (await night(gm)).games.find((x) => x.id === g.id);
  R.check(ng.leaderId == null, 'crown', 'no live crown mid-game (final scores only)', JSON.stringify({ leader: ng.leaderId, scores: ng.scores }));
  await page.screenshot({ path: `${s.dir}/shots/02-laptop-mid.png`, fullPage: true });
  const pgm = await gmLogin(b, s, R, 'phone', 'gm-phone');
  await gmRoute(pgm.page, `board-${g.id}`); await sleep(1500);
  await pgm.page.screenshot({ path: `${s.dir}/shots/03-phone.png`, fullPage: true });
  const sw = await pgm.page.evaluate(() => document.documentElement.scrollWidth);
  R.check(sw <= 390, 'layout', 'phone: nothing wider than the screen', String(sw));
  await page.getByRole('button', { name: /End the game/ }).click(); await sleep(400);
  await page.getByRole('button', { name: /Stopped early/ }).click(); await sleep(400);
  await page.screenshot({ path: `${s.dir}/shots/04-end.png`, fullPage: true });
  await page.getByRole('button', { name: 'Apply and show final scores' }).click(); await sleep(2500);
  ng = (await night(gm)).games.find((x) => x.id === g.id);
  R.check(ng.leaderId === ids[1], 'crown', 'after ending, the crown goes to the top total (Ben, 30)', JSON.stringify({ leader: ng.leaderId, scores: ng.scores }));
  await page.screenshot({ path: `${s.dir}/shots/05-final.png`, fullPage: true });
  R.check(errs.length === 0, 'client', 'no page errors', errs.join(' | ').slice(0, 200));
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: [ids[1], ids[3], ids[0], ids[2]].map((id, i) => ({ playerId: id, placement: i + 1 })) });
  await sleep(1500);
  await openApp(ps[1].page, 'Messages'); await sleep(900);
  const m = (await ps[1].page.textContent('body')) ?? '';
  R.check(/Scrabble/i.test(m), 'recap', "Ben's phone gets his Scrabble recap", m.replace(/\s+/g, ' ').slice(0, 160));
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close(); R.report(s); await s.stop();
}
