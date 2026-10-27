// Round 6 — two GM devices at once, remote device pause + PIN, Sub GM limits, stale settings forms.
import { api, browser, gmLogin, gmRoute, gmSetup, makeRound, newNight, phone, sleep, startServer, toasts } from './lib.mjs';
const R = makeRound('r06-multigm');
const s = await startServer('r06', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
try {
  const lap = await gmSetup(b, s, R, { viaUi: false });
  await newNight(lap, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT']]) ps.push(await phone(b, s, R, n, t));
  await api(lap.req, s.base, 'POST', '/api/night/start');
  const ph = await gmLogin(b, s, R, 'phone', 'gm-phone');
  const ids = ps.map((p) => p.id);
  const g = (await api(lap.req, s.base, 'POST', '/api/games', { name: 'Catan', participants: ids })).body.game;
  // 1. Both devices tap Start at once.
  await gmRoute(lap.page, 'dashboard');
  await gmRoute(ph.page, 'dashboard');
  await sleep(600);
  await Promise.all([
    lap.page.locator('tr', { hasText: 'Catan' }).getByRole('button', { name: 'Start' }).click().catch(() => {}),
    ph.page.locator('tr', { hasText: 'Catan' }).getByRole('button', { name: 'Start' }).click().catch(() => {}),
  ]);
  await sleep(800);
  const t1 = (await toasts(lap.page)) + ' / ' + (await toasts(ph.page));
  R.check(!/already|error|went wrong/i.test(t1), 'multi', 'two GMs starting the same game at once: no error', t1);
  // 2. Both enter different scores at the same moment.
  const fillScores = async (page, vals) => {
    const panel = page.locator('.panel').filter({ has: page.locator('strong', { hasText: /^Catan$/ }) });
    for (let i = 0; i < vals.length; i++) await panel.locator('.srow').nth(i).locator('input').fill(String(vals[i]));
    return panel.getByRole('button', { name: 'Save scores' });
  };
  const sa = await fillScores(lap.page, [3, 2, 2]);
  const sb = await fillScores(ph.page, [3, 5, 2]);
  await Promise.all([sa.click(), sb.click()]);
  await sleep(1000);
  const gg = (await night(lap)).games.find((x) => x.name === 'Catan');
  R.check(gg.leaderId === ids[0] || gg.leaderId === ids[1], 'multi', 'simultaneous score saves end in a consistent crown', JSON.stringify(gg.scores));
  // Both screens show the same scores after the dust settles?
  await sleep(1000);
  const readScores = async (page) => {
    const panel = page.locator('.panel').filter({ has: page.locator('strong', { hasText: /^Catan$/ }) });
    const out = [];
    for (let i = 0; i < 3; i++) out.push(await panel.locator('.srow').nth(i).locator('input').inputValue());
    return out.join(',');
  };
  const la = await readScores(lap.page);
  const pa = await readScores(ph.page);
  const server = ids.map((id) => gg.scores[id] ?? '').join(',');
  R.check(la === server && pa === server, 'multi', 'both GM screens show the saved scores after a clash', `laptop ${la} / phone ${pa} / saved ${server}`);
  // 3. Both submit the same result at once (idempotent) — and then different results.
  const body = { actualHours: 1, participants: ids.map((id, i) => ({ playerId: id, placement: i + 1 })) };
  const [r1, r2] = await Promise.all([api(lap.req, s.base, 'POST', `/api/games/${g.id}/result`, body), api(ph.req, s.base, 'POST', `/api/games/${g.id}/result`, body)]);
  R.check(r1.status === 200 && r2.status === 200, 'multi', 'same result from two devices: both succeed', `${r1.status}/${r2.status} ${JSON.stringify(r2.body).slice(0, 100)}`);
  const g2 = (await api(lap.req, s.base, 'POST', '/api/games', { name: 'Dice', participants: ids })).body.game;
  await api(lap.req, s.base, 'POST', `/api/games/${g2.id}/start`);
  const [d1, d2] = await Promise.all([
    api(lap.req, s.base, 'POST', `/api/games/${g2.id}/result`, { actualHours: 1, participants: ids.map((id, i) => ({ playerId: id, placement: i + 1 })) }),
    api(ph.req, s.base, 'POST', `/api/games/${g2.id}/result`, { actualHours: 1, participants: ids.map((id, i) => ({ playerId: id, placement: 3 - i })) }),
  ]);
  const okCount = [d1, d2].filter((x) => x.status === 200).length;
  R.check(okCount === 1, 'multi', 'conflicting results from two devices: exactly one wins', `${d1.status}/${d2.status}`);
  const loser = d1.status === 200 ? d2 : d1;
  R.check(/correct/i.test(loser.body.message ?? ''), 'multi', 'the losing device is told to use Correct result', JSON.stringify(loser.body));
  // 4. Phone pauses the laptop remotely; laptop unlocks with PIN.
  await gmRoute(ph.page, 'devices');
  await sleep(800);
  const pauseBtns = ph.page.getByRole('button', { name: 'Pause device' });
  R.check((await pauseBtns.count()) >= 1, 'devices', 'phone lists the laptop session with Pause device');
  await pauseBtns.first().click();
  await sleep(1500);
  const lapTxt = await lap.page.locator('body').innerText();
  R.check(/PIN/i.test(lapTxt), 'devices', 'paused laptop shows the PIN lock without refreshing', lapTxt.slice(0, 120));
  const pin = lap.page.getByPlaceholder('PIN');
  if (await pin.isVisible().catch(() => false)) {
    await pin.fill('0000');
    await lap.page.getByRole('button', { name: /unlock/i }).click();
    const bad = await toasts(lap.page);
    R.check(/pin|wrong|incorrect/i.test(bad), 'devices', 'wrong PIN is refused with a message', bad);
    await pin.fill('1234');
    await lap.page.getByRole('button', { name: /unlock/i }).click();
    await sleep(1500);
    R.check(!(await lap.page.getByPlaceholder('PIN').isVisible().catch(() => false)), 'devices', 'right PIN unlocks the laptop');
  }
  // PIN brute force: 20 wrong tries.
  const tries = [];
  for (let i = 0; i < 20; i++) tries.push((await api(lap.req, s.base, 'POST', '/api/gm/unlock', { pin: String(1000 + i) })).status);
  R.ok(`20 wrong PINs → statuses ${[...new Set(tries)].join(',')}`);
  // 5. Sub GM: what can they reach in the UI?
  await api(lap.req, s.base, 'POST', '/api/gm/gms', { name: 'Helper', password: 'helper pass', pin: '5555' });
  const subCtx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await api(subCtx.request, s.base, 'POST', '/api/gm/login', { name: 'Helper', password: 'helper pass', deviceType: 'phone' });
  const sub = await subCtx.newPage();
  R.watch(sub, 'sub-gm');
  await sub.goto(s.base + '/gm');
  await sleep(1200);
  for (const route of ['settings', 'library', 'handicaps', 'market', 'archive', 'devices']) {
    await gmRoute(sub, route);
    await sleep(600);
    const errs = await sub.locator('.toast.error').count();
    R.ok(`sub GM on ${route}: ${errs} error toasts`);
    if (errs > 1) R.bug('subgm', `Sub GM opening ${route} produces error toasts`, await sub.locator('.toast.error').allTextContents());
  }
  await gmRoute(sub, 'handicaps');
  R.check(/Master GM/.test(await sub.locator('body').innerText()), 'subgm', 'Sub GM sees that handicaps are Master-only');
  // 6. Stale settings: phone has Settings open, laptop changes fee; phone saves another field.
  await gmRoute(ph.page, 'settings');
  await sleep(800);
  await api(lap.req, s.base, 'PATCH', '/api/night/settings', { market: { feeFrac: 0.05 } });
  await api(ph.req, s.base, 'PATCH', '/api/night/settings', { market: { investCap: 30 } });
  const res = (await night(lap)).gm.settings.resolved.market;
  R.check(res.feeFrac === 0.05 && res.investCap === 30, 'settings', 'two devices editing different settings do not overwrite each other', JSON.stringify({ fee: res.feeFrac, cap: res.investCap }));
  // 7. Log out on the phone; laptop keeps working.
  await api(ph.req, s.base, 'POST', '/api/gm/logout');
  const still = await api(lap.req, s.base, 'GET', '/api/gm/me');
  R.check(still.status === 200, 'devices', 'logging out one device leaves the other signed in');
  await ph.page.reload();
  await sleep(1000);
  R.check(await ph.page.getByLabel('GM name').isVisible().catch(() => false), 'devices', 'logged-out phone shows the login screen');
} catch (e) {
  R.bug('harness', 'round crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
