// Monopoly board in the real app: library entry, tab, add properties -> crown (Assets), bankruptcy, phone width, result + recap.
import { api, browser, gmLogin, gmRoute, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('monopoly');
const s = await startServer('monopoly', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const lib = (await api(gm.req, s.base, 'GET', '/api/library')).body.games;
  const mono = lib.find((g) => g.name === 'Monopoly');
  R.check(mono?.board === 'monopoly' && mono?.leadLabel === 'Assets', 'library', 'Monopoly is in the default library with its board and "Assets" crown', JSON.stringify(mono ?? null).slice(0, 160));
  const ids = (await night(gm)).players.map((p) => p.id);
  const t1 = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'Big table', seats: 4 })).body.id;
  for (let i = 0; i < 4; i++) await api(gm.req, s.base, 'POST', `/api/tables/${t1}/seat`, { seat: i + 1, playerId: ids[i] });
  const g = (await api(gm.req, s.base, 'POST', '/api/games', { libraryGameId: mono.id, participants: ids, tableId: t1 })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/start`);
  const page = gm.page;
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.reload(); await sleep(1500);
  await page.locator('nav.side button.board', { hasText: 'Monopoly' }).click(); await sleep(1500);
  R.check((await page.locator('.pp').count()) >= 4, 'board', 'board renders with a panel per player');
  await page.screenshot({ path: `${s.dir}/shots/01-laptop.png`, fullPage: true });
  // Ann gets Boardwalk, Ben gets Mediterranean (via each player's "Add a property")
  const add = async (name, key) => {
    await page.getByLabel(`Property for ${name}`).selectOption(key);
    await page.locator(`#mono-p-${ids[['Ann', 'Ben', 'Cat', 'Dev'].indexOf(name)]}`).getByRole('button', { name: 'Add', exact: true }).click();
    await sleep(400);
  };
  const medKey = await page.getByLabel('Property for Ben').locator('option').evaluateAll((os) => os.find((o) => /^Mediterranean/.test(o.textContent ?? ''))?.value ?? '');
  await add('Ann', 'boardwalk');
  if (medKey) await add('Ben', medKey);
  await sleep(2000);
  const st = (await api(gm.req, s.base, 'GET', `/api/games/${g.id}/board`)).body;
  R.check(JSON.stringify(st.state ?? {}).includes('boardwalk'), 'board', 'property given on the board is saved to the server');
  const ng = (await night(gm)).games.find((x) => x.id === g.id);
  R.check(ng.leaderId === ids[0], 'crown', 'crown goes to the player with the most assets (Ann, Boardwalk)', JSON.stringify({ leader: ng.leaderId, scores: ng.scores }));
  // Dev bankrupt
  await page.locator(`#mono-p-${ids[3]}`).getByRole('button', { name: /bankrupt/i }).click(); await sleep(300);
  await page.getByRole('button', { name: 'Yes, bankrupt' }).click(); await sleep(1500);
  R.check(/3 of 4 still in/.test((await page.textContent('body')) ?? ''), 'board', 'bankruptcy updates the players-left count');
  await page.screenshot({ path: `${s.dir}/shots/02-laptop-mid.png`, fullPage: true });
  // GM phone width
  const pgm = await gmLogin(b, s, R, 'phone', 'gm-phone');
  await gmRoute(pgm.page, `board-${g.id}`); await sleep(1500);
  await pgm.page.screenshot({ path: `${s.dir}/shots/03-phone.png`, fullPage: true });
  const sw = await pgm.page.evaluate(() => document.documentElement.scrollWidth);
  R.check(sw <= 390, 'layout', 'phone: nothing wider than the screen', String(sw));
  // Call time -> result screen pre-filled
  await page.getByRole('button', { name: 'Call time and finish' }).click(); await sleep(1500);
  await page.screenshot({ path: `${s.dir}/shots/04-result.png`, fullPage: true });
  R.check(errs.length === 0, 'client', 'no page errors', errs.join(' | ').slice(0, 200));
  // Result + recap
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: [ids[0], ids[1], ids[2], ids[3]].map((id, i) => ({ playerId: id, placement: i + 1 })) });
  await sleep(1500);
  await openApp(ps[0].page, 'Messages'); await sleep(900);
  const m = (await ps[0].page.textContent('body')) ?? '';
  R.check(/Monopoly/i.test(m), 'recap', "Ann's phone gets her Monopoly recap", m.replace(/\s+/g, ' ').slice(0, 160));
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close(); R.report(s); await s.stop();
}
