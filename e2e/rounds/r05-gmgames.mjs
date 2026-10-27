// Round 5 — GM game-running mistakes: double taps, tied/DNF results, cancelling, junk scores, corrections.
import { api, browser, gmRoute, gmSetup, makeRound, newNight, phone, sleep, startServer, toasts } from './lib.mjs';
const R = makeRound('r05-gmgames');
const s = await startServer('r05', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
const exp = async (gm) => (await api(gm.req, s.base, 'GET', '/api/export/night.json?night=1')).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const page = gm.page;
  const ids = ps.map((p) => p.id);
  const sched = async (name, extra = {}) => (await api(gm.req, s.base, 'POST', '/api/games', { name, participants: ids, ...extra })).body.game;

  // 1. Double-tap Start.
  await sched('Catan');
  await gmRoute(page, 'dashboard');
  const start = page.locator('tr', { hasText: 'Catan' }).getByRole('button', { name: 'Start' });
  await Promise.all([start.click().catch(() => {}), start.click({ force: true }).catch(() => {})]);
  await sleep(800);
  const tz = await toasts(page);
  R.check(!/error|not scheduled|went wrong/i.test(tz) || /started/i.test(tz), 'gm', 'double-tapping Start is harmless', `toasts: ${tz}`);
  R.check((await night(gm)).games.filter((g) => g.name === 'Catan' && g.status === 'active').length === 1, 'gm', 'one active Catan after double Start');

  // 2. Score entry junk.
  const panel = page.locator('.panel').filter({ has: page.locator('strong', { hasText: /^Catan$/ }) });
  const rows = panel.locator('.srow');
  R.check((await rows.count()) === 4, 'scores', 'score rows for all 4 players');
  for (const [v, ok] of [['-3', true], ['2.5', true], ['1e9', false], ['abc', false], ['', null]]) {
    await rows.nth(0).locator('input').fill(v).catch(() => {});
    const save = panel.getByRole('button', { name: 'Save scores' });
    if (await save.isDisabled()) {
      R.ok(`score "${v}": save disabled`);
      continue;
    }
    await save.click();
    const t = await toasts(page);
    R.ok(`score "${v}": ${t}`);
    if (ok === false) R.check(/number|score/i.test(t) || (await page.locator('.toast.error').count()) > 0, 'scores', `junk score "${v}" refused with a message`, t);
    await sleep(500);
  }
  // Double-tap Save.
  await rows.nth(1).locator('input').fill('7');
  const save = panel.getByRole('button', { name: 'Save scores' });
  await Promise.all([save.click().catch(() => {}), save.click({ force: true }).catch(() => {})]);
  await sleep(800);
  R.check(!/went wrong|error/i.test(await toasts(page)), 'scores', 'double-tapping Save scores is harmless');
  const crown = (await night(gm)).games.find((g) => g.name === 'Catan')?.leaderId;
  R.check(crown === ids[1], 'scores', 'crown follows the highest score after junk entries', `leader ${crown}`);

  // 3. Result wizard: open, close, reopen, double-submit.
  await panel.getByRole('button', { name: 'Enter result' }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Close' }).click();
  await panel.getByRole('button', { name: 'Enter result' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  for (const n of ['Ben', 'Ann', 'Cat', 'Dev']) await page.locator('button.name', { hasText: n }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const hrs = page.getByLabel(/Actual hours/);
  R.ok(`prefilled hours ${await hrs.inputValue()}`);
  await hrs.fill('0');
  const submit = page.getByRole('button', { name: 'Submit result' });
  if (!(await submit.isDisabled())) {
    await submit.click();
    const t = await toasts(page);
    R.check(/hour/i.test(t) || (await page.locator('.toast.error').count()) > 0, 'wizard', '0 hours is refused with a message', t);
  } else R.ok('0 hours: submit disabled');
  await hrs.fill('1.5');
  await Promise.all([submit.click().catch(() => {}), submit.click({ force: true }).catch(() => {})]);
  await sleep(1200);
  const e1 = await exp(gm);
  const catan = e1.games.find((g) => g.name === 'Catan');
  R.check(catan?.status === 'final', 'wizard', 'result saved');
  const l1 = (await night(gm)).gm.ledger;
  const benGold = l1.find((l) => l.playerId === ids[1]).resultsH;
  R.check(benGold === 1800, 'wizard', 'double-tapped Submit pays once (1.5 h × 4 × 1 × 3 = 18 gold)', `Ben results ${benGold}`);

  // 4. Everyone tied; everyone DNF.
  const tie = await sched('Tie game');
  await api(gm.req, s.base, 'POST', `/api/games/${tie.id}/start`);
  const tr = await api(gm.req, s.base, 'POST', `/api/games/${tie.id}/result`, { actualHours: 1, participants: ids.map((id) => ({ playerId: id, placement: 1 })) });
  R.check(tr.status === 200, 'results', 'all-tied result accepted', JSON.stringify(tr.body).slice(0, 160));
  const dnf = await sched('Disaster');
  await api(gm.req, s.base, 'POST', `/api/games/${dnf.id}/start`);
  const dr = await api(gm.req, s.base, 'POST', `/api/games/${dnf.id}/result`, { actualHours: 1, participants: ids.map((id) => ({ playerId: id, dnf: true })) });
  R.ok(`all-DNF result: ${dr.status} ${JSON.stringify(dr.body).slice(0, 120)}`);
  R.check(dr.status !== 500, 'results', 'all-DNF result does not crash');

  // 5. Cancel an active game; index dip returns.
  const big = await sched('Long game', { plannedDurationHours: 4 });
  await api(gm.req, s.base, 'POST', `/api/games/${big.id}/start`);
  await sleep(500);
  const dropBefore = (await night(gm)).gm.indexTerms.drop;
  await api(gm.req, s.base, 'POST', `/api/games/${big.id}/cancel`);
  await sleep(500);
  const dropAfter = (await night(gm)).gm.indexTerms.drop;
  R.check(dropBefore > 0 && dropAfter === 0, 'index', 'cancelling a running game gives back its index dip', `${dropBefore} → ${dropAfter}`);

  // 6. Start while paused; result for a never-started game; game with no players.
  await api(gm.req, s.base, 'POST', '/api/night/pause', {});
  const ns = await sched('During pause');
  const sp = await api(gm.req, s.base, 'POST', `/api/games/${ns.id}/start`);
  R.check(sp.status >= 400 && sp.status < 500, 'gm', 'starting a game while paused is refused', JSON.stringify(sp.body));
  await gmRoute(page, 'dashboard');
  await sleep(500);
  const startBtn = page.locator('tr', { hasText: 'During pause' }).getByRole('button', { name: 'Start' });
  R.check(await startBtn.isDisabled().catch(() => false), 'gm', 'Start button disabled while paused');
  await api(gm.req, s.base, 'POST', '/api/night/resume');
  const never = await sched('Never started');
  const nr = await api(gm.req, s.base, 'POST', `/api/games/${never.id}/result`, { actualHours: 1, participants: ids.map((id, i) => ({ playerId: id, placement: i + 1 })) });
  R.ok(`result on unstarted game: ${nr.status}`);
  const empty = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Open table' })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${empty.id}/start`);
  await gmRoute(page, 'dashboard');
  await sleep(600);
  const openPanel = page.locator('.panel').filter({ has: page.locator('strong', { hasText: /^Open table$/ }) });
  R.check((await openPanel.locator('.srow').count()) === 4, 'scores', 'game without listed players offers score rows for everyone');
  await openPanel.locator('.srow').nth(2).locator('input').fill('5');
  await openPanel.getByRole('button', { name: 'Save scores' }).click();
  await sleep(500);
  R.check((await night(gm)).games.find((g) => g.name === 'Open table')?.leaderId === ids[2], 'scores', 'scores work for a game without listed players');

  // 7. Correction: Ann and Ben swapped.
  const cr = await api(gm.req, s.base, 'POST', `/api/games/${catan.id}/correct`, { actualHours: 1.5, participants: [ids[0], ids[1], ids[2], ids[3]].map((id, i) => ({ playerId: id, placement: i + 1 })) });
  R.check(cr.status === 200, 'results', 'correction accepted');
  const l2 = (await night(gm)).gm.ledger;
  R.check(l2.find((l) => l.playerId === ids[0]).resultsH > l2.find((l) => l.playerId === ids[1]).resultsH, 'results', 'correction re-scores gold');

  // 8. Same game name twice; delete a library game that a scheduled game uses.
  const lib = (await api(gm.req, s.base, 'POST', '/api/library', { name: 'Temp', minPlayers: 2, maxPlayers: 6 })).body.game;
  await api(gm.req, s.base, 'POST', '/api/games', { libraryGameId: lib.id, participants: ids });
  await api(gm.req, s.base, 'POST', '/api/games', { libraryGameId: lib.id, participants: ids });
  const del = await api(gm.req, s.base, 'DELETE', `/api/library/${lib.id}`);
  R.check(del.status === 200, 'library', 'deleting a library game in use is allowed');
  await gmRoute(page, 'games');
  await sleep(600);
  R.check((await page.locator('tr', { hasText: 'Temp' }).count()) >= 2, 'library', 'scheduled games survive the library delete');
  await R.shot(page, 'games-screen', s.dir);
  await gmRoute(page, 'dashboard');
  await R.shot(page, 'dashboard', s.dir);
} catch (e) {
  R.bug('harness', 'round crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
