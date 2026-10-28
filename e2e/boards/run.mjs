// Per-game GM boards end to end with the Risk board: tab appears, edits save + move the crown, re-roll spends once,
// elimination hands over territories, a second GM sees changes, result pre-fills, recap reaches phones. Needs `npm run build`.
import { api, browser, gmLogin, gmRoute, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('boards');
const s = await startServer('boards', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
const board = async (gm, id) => (await api(gm.req, s.base, 'GET', `/api/games/${id}/board`)).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const lib = (await api(gm.req, s.base, 'GET', '/api/library')).body.games.find((g) => g.name === 'Risk');
  R.check(lib?.board === 'risk', 'library', 'Risk is in the default library with its board', JSON.stringify(lib));
  const ids = (await night(gm)).players.map((p) => p.id);
  const [ann, ben, cat, dev] = ids;
  const tid = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'Big table', seats: 4 })).body.id;
  for (let i = 0; i < 4; i++) await api(gm.req, s.base, 'POST', `/api/tables/${tid}/seat`, { seat: i + 1, playerId: ids[i] });
  const g = (await api(gm.req, s.base, 'POST', '/api/games', { libraryGameId: lib.id, participants: ids, tableId: tid })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/start`);
  const page = gm.page;
  await page.reload(); await sleep(1500);
  const tab = page.locator('nav.side button.board', { hasText: 'Risk' });
  R.check((await tab.count()) === 1, 'tab', 'a Risk tab appears when the game starts');
  await tab.click(); await sleep(1500);
  let bd = await board(gm, g.id);
  R.check(bd.version >= 1 && bd.state?.players?.[ann]?.territories === 11, 'load', 'board initialised and saved on first open', `v${bd.version} ann=${bd.state?.players?.[ann]?.territories}`);
  await page.screenshot({ path: `${s.dir}/shots/01-board-laptop.png`, fullPage: true });

  // Edit: select Ann, +5 territories twice -> 21 territories = 7 reinforcements; crown follows.
  await page.locator('button.seat', { hasText: 'Ann' }).first().click(); await sleep(200);
  await page.getByRole('button', { name: 'Territories plus 5' }).click();
  await page.getByRole('button', { name: 'Territories plus 5' }).click();
  await sleep(1500);
  bd = await board(gm, g.id);
  const ng = (await night(gm)).games.find((x) => x.id === g.id);
  R.check(bd.state.players[ann].territories === 21, 'edit', 'territory taps saved to the server', String(bd.state.players[ann].territories));
  R.check(ng.leaderId === ann && ng.scores[ann] === 7, 'crown', 'board score moves the crown', JSON.stringify({ leader: ng.leaderId, scores: ng.scores }));

  // Re-roll: double click spends exactly one.
  const before = (await night(gm)).gm.rerolls[ann];
  const rr = page.getByRole('button', { name: /Use a re-roll/ });
  await rr.dblclick().catch(() => {}); await sleep(1500);
  const after = (await night(gm)).gm.rerolls[ann];
  R.check(after === before - 1, 'reroll', 'double-clicking re-roll spends one token', `${before} -> ${after}`);

  // Second GM on a phone sees the change after an edit on the laptop.
  const gm2 = await gmLogin(b, s, R, 'phone', 'gm-phone');
  await gmRoute(gm2.page, `board-${g.id}`); await sleep(1500);
  await gm2.page.screenshot({ path: `${s.dir}/shots/02-board-phone.png`, fullPage: true });
  await page.locator('button.seat', { hasText: 'Ben' }).first().click(); await sleep(200);
  await page.getByRole('button', { name: 'Territories plus 1' }).click(); await sleep(2000);
  const benOnPhone = await gm2.page.locator('table').filter({ hasText: 'Ben' }).first().textContent().catch(() => '');
  R.check(/12/.test(benOnPhone ?? ''), 'sync', "the other GM's board reloads with the change", (benOnPhone ?? '').replace(/\s+/g, ' ').slice(0, 120));

  // Eliminate Dev by Ann: Dev's 10 territories go to Ann.
  await page.locator('button.seat', { hasText: 'Dev' }).first().click(); await sleep(200);
  await page.getByRole('button', { name: 'Eliminate Dev' }).click(); await sleep(200);
  await page.locator('button.big', { hasText: 'Ann' }).first().click(); await sleep(1500);
  bd = await board(gm, g.id);
  R.check(bd.state.players[dev].eliminated && bd.state.players[ann].territories === 31, 'elim', "eliminated player's territories go to the eliminator", `ann=${bd.state.players[ann].territories}`);

  // Result screen pre-filled from the board's finish order.
  await page.locator('section.panel').first().getByRole('button', { name: 'Enter result' }).click(); await sleep(1200);
  await page.screenshot({ path: `${s.dir}/shots/03-result-prefilled.png`, fullPage: true });
  const wizText = (await page.locator('.wizard, dialog, .modal, .overlay').first().textContent().catch(() => '')) ?? '';
  R.check(/1st/.test(wizText) || /1st/.test(await page.content()), 'result', 'result screen opens pre-filled from the board');
  await page.keyboard.press('Escape').catch(() => {});

  // Submit the result (board order) and check the recap reaches a phone.
  const placementsOrder = [ann, ben, cat, dev];
  await api(gm.req, s.base, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: placementsOrder.map((id, i) => ({ playerId: id, placement: i + 1 })) });
  await sleep(1500);
  const p = ps[0].page;
  await openApp(p, 'Messages'); await sleep(1000);
  const msgs = (await p.textContent('body')) ?? '';
  R.check(msgs.includes('Risk recap for Ann'), 'recap', "Ann's phone gets her Risk recap", msgs.replace(/\s+/g, ' ').slice(0, 160));
  const benMsgs = (await (async () => { await openApp(ps[1].page, 'Messages'); await sleep(800); return ps[1].page.textContent('body'); })()) ?? '';
  R.check(!benMsgs.includes('Risk recap for Ann') && benMsgs.includes('Risk recap for Ben'), 'recap', 'each player only gets their own recap');
  await p.screenshot({ path: `${s.dir}/shots/04-phone-recap.png`, fullPage: true });
  await page.reload(); await sleep(1200);
  R.check((await page.locator('nav.side button.board').count()) === 0, 'tab', 'the board tab goes away when the game ends');
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
