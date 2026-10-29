// Ticket to Ride boards (USA + Europe) in the real app: tab, layout, final scores -> crown + result prefill + recap.
import { api, browser, gmLogin, gmRoute, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('ttr');
const s = await startServer('ttr', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const lib = (await api(gm.req, s.base, 'GET', '/api/library')).body.games;
  const usa = lib.find((g) => g.name === 'Ticket to Ride');
  const eu = lib.find((g) => g.name === 'Ticket to Ride: Europe');
  R.check(usa?.board === 'ticket-to-ride' && eu?.board === 'ticket-to-ride-europe', 'library', 'both Ticket to Ride games are in the default library with their boards');
  const ids = (await night(gm)).players.map((p) => p.id);
  const t1 = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'Big table', seats: 4 })).body.id;
  for (let i = 0; i < 4; i++) await api(gm.req, s.base, 'POST', `/api/tables/${t1}/seat`, { seat: i + 1, playerId: ids[i] });
  const g = (await api(gm.req, s.base, 'POST', '/api/games', { libraryGameId: usa.id, participants: ids, tableId: t1 })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/start`);
  const page = gm.page;
  await page.reload(); await sleep(1500);
  await page.locator('nav.side button.board', { hasText: 'Ticket to Ride' }).click(); await sleep(1500);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  R.check((await page.locator('.pp, [aria-label="All players"]').count()) > 0, 'board', 'USA board renders in the real app');
  await page.screenshot({ path: `${s.dir}/shots/01-usa-laptop.png`, fullPage: true });
  // Final scores for everyone via the board: type into each player's Final score box
  const boxes = page.getByLabel('Final score', { exact: true });
  const n = await boxes.count();
  const scores = [88, 120, 120, 64];
  for (let i = 0; i < Math.min(n, 4); i++) { await boxes.nth(i).fill(String(scores[i])); await boxes.nth(i).press('Enter'); await boxes.nth(i).blur(); await sleep(250); }
  await sleep(2000);
  const st = (await api(gm.req, s.base, 'GET', `/api/games/${g.id}/board`)).body;
  const fs = ids.map((id) => st.state?.players?.[id]?.finalScore ?? null);
  R.check(n >= 4 && fs.every((x) => x !== null), 'board', 'final scores typed on the board are saved', `${n} boxes; ${JSON.stringify(fs)}`);
  const ng = (await night(gm)).games.find((x) => x.id === g.id);
  R.check(ng.leaderId === null, 'crown', 'a tie at the top keeps no crown (locked rule: ties keep the current holder, here nobody)', JSON.stringify({ leader: ng.leaderId, scores: ng.scores }));
  await page.screenshot({ path: `${s.dir}/shots/02-usa-scored.png`, fullPage: true });
  const pgm = await gmLogin(b, s, R, 'phone', 'gm-phone');
  await gmRoute(pgm.page, `board-${g.id}`); await sleep(1500);
  await pgm.page.screenshot({ path: `${s.dir}/shots/03-usa-phone.png`, fullPage: true });
  const sw = await pgm.page.evaluate(() => document.documentElement.scrollWidth);
  R.check(sw <= 390, 'layout', 'phone: nothing wider than the screen', String(sw));
  // Europe
  const g2 = (await api(gm.req, s.base, 'POST', '/api/games', { libraryGameId: eu.id, participants: ids.slice(0, 3) })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g2.id}/start`);
  await page.reload(); await sleep(1500);
  await page.locator('nav.side button.board', { hasText: 'Europe' }).click(); await sleep(1500);
  R.check((await page.getByLabel('Final score', { exact: true }).count()) >= 1, 'board', 'Europe board renders (no table)');
  await page.screenshot({ path: `${s.dir}/shots/04-eu-laptop.png`, fullPage: true });
  R.check(errs.length === 0, 'client', 'no page errors on either board', errs.join(' | ').slice(0, 200));
  // Result + recap for USA
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: [ids[1], ids[2], ids[0], ids[3]].map((id, i) => ({ playerId: id, placement: i + 1 })) });
  await sleep(1500);
  await openApp(ps[0].page, 'Messages'); await sleep(900);
  const m = (await ps[0].page.textContent('body')) ?? '';
  R.check(/Ticket to Ride/i.test(m), 'recap', "Ann's phone gets her Ticket to Ride recap", m.replace(/\s+/g, ' ').slice(0, 160));
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close(); R.report(s); await s.stop();
}
