// Round 7 — night lifecycle mistakes: pause spam, odd pause lengths, ending with games running, double End,
// refreshing during the finale, and phones from last night after a new one starts.
import { api, browser, dev, gmLogin, gmRoute, gmSetup, makeRound, newNight, phone, sleep, startServer, toasts } from './lib.mjs';
const R = makeRound('r07-lifecycle');
const s = await startServer('r07', { scale: 60 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  // Finale ×60 so it plays in real seconds.
  await newNight(gm, s, { length: 120, settings: { finale: { collapseSeconds: 300, podiumStepSeconds: 180, recapSlideSeconds: 120 } } });
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT']]) ps.push(await phone(b, s, R, n, t));
  const ph = await gmLogin(b, s, R, 'phone', 'gm-phone');
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const ids = ps.map((p) => p.id);
  // 1. Pause length junk through the UI.
  await gmRoute(gm.page, 'dashboard');
  for (const v of ['0', '-5', '9999', '2.5']) {
    await gm.page.getByPlaceholder('min').fill(v);
    await gm.page.getByRole('button', { name: 'Pause', exact: true }).click();
    await sleep(500);
    const st = (await night(gm)).night;
    const t = await toasts(gm.page);
    R.ok(`pause "${v}" → ${st.status}, until ${st.pauseUntil ? Math.round((st.pauseUntil - st.serverTime) / 60000) + ' game-min' : 'none'}; toast "${t.slice(-80)}"`);
    if (v === '-5' || v === '0') R.check(st.status === 'live' || !st.pauseUntil || st.pauseUntil >= st.serverTime, 'pause', `pause "${v}" does not create a countdown in the past`, JSON.stringify(st));
    if (st.status === 'paused') {
      await api(gm.req, s.base, 'POST', '/api/night/resume');
      await sleep(300);
    }
  }
  // 2. Pause/resume spam from both devices.
  const spam = [];
  for (let i = 0; i < 8; i++) {
    spam.push(api(gm.req, s.base, 'POST', '/api/night/pause', {}));
    spam.push(api(ph.req, s.base, 'POST', '/api/night/resume'));
  }
  const res = await Promise.all(spam);
  R.check(!res.some((x) => x.status >= 500), 'pause', 'pause/resume spam from two devices never errors 500');
  await api(gm.req, s.base, 'POST', '/api/night/resume');
  await sleep(800);
  const pz = (await api(gm.req, s.base, 'GET', '/api/export/night.json?night=1')).body;
  R.ok(`pause spans after spam: ${pz.night?.pauses?.length ?? 'n/a'}`);
  const st2 = (await night(gm)).night;
  R.check(st2.status === 'live', 'pause', 'night ends up live after spam + resume');
  await sleep(1500);
  const locked = [];
  for (const p of ps) locked.push(await p.page.getByRole('button', { name: /Open NFT Minter/ }).isVisible().catch(() => false));
  R.check(locked.every((x) => !x), 'pause', 'no phone stuck on the pause screen after spam', String(locked));
  // 3. Night clock sanity: night time should not exceed wall time.
  const nm = (await night(gm)).night.nightMs;
  R.ok(`night clock after spam: ${Math.round(nm / 60000)} game-min`);
  // 4. Games still running at End; one finished.
  const g1 = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Done game', participants: ids })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g1.id}/start`);
  await sleep(3000);
  await api(gm.req, s.base, 'POST', `/api/games/${g1.id}/result`, { actualHours: 0.5, participants: ids.map((id, i) => ({ playerId: id, placement: i + 1 })) });
  const g2 = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Still running', participants: ids })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${g2.id}/start`);
  await dev(ps[0], s, 'POST', '/api/trade/buy', { securityId: `p:${ids[1]}`, gold: 5 });
  await sleep(1500);
  // GM sees a warning before ending with a game running?
  await gmRoute(gm.page, 'dashboard');
  await sleep(500);
  let dialogText = '';
  gm.page.once('dialog', (d) => (dialogText = d.message()));
  await api(gm.req, s.base, 'POST', '/api/night/close-trading');
  const ct2 = await api(gm.req, s.base, 'POST', '/api/night/close-trading');
  R.check(ct2.status < 500, 'end', 'closing trading twice is harmless', JSON.stringify(ct2.body));
  // Double-tap End from both devices.
  const [e1, e2] = await Promise.all([api(gm.req, s.base, 'POST', '/api/night/end'), api(ph.req, s.base, 'POST', '/api/night/end')]);
  R.check([e1, e2].some((x) => x.status === 200) && ![e1, e2].some((x) => x.status >= 500), 'end', 'End from two devices at once: one ends, no crash', `${e1.status}/${e2.status} ${JSON.stringify(e2.body).slice(0, 100)}`);
  const ended = await night(gm);
  R.check(ended.night.status === 'ended', 'end', 'night ended');
  const still = ended.games.find((x) => x.name === 'Still running');
  R.ok(`game running at End is now: ${still?.status}`);
  R.check(still?.status !== 'active', 'end', 'a game still running at End does not stay "active" forever', `status ${still?.status}`);
  // 5. TV + phone refresh mid-finale.
  const tv = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  R.watch(tv, 'tv');
  await tv.goto(s.base + '/display');
  await sleep(4000);
  await tv.reload();
  await ps[0].page.reload();
  await sleep(4000);
  await R.shot(tv, 'tv-after-refresh-mid-finale', s.dir);
  const tvT = await tv.locator('body').innerText();
  R.ok(`TV after refresh mid-finale: ${tvT.slice(0, 80).replace(/\n/g, ' ')}`);
  let done = false;
  for (let i = 0; i < 90 && !done; i++) {
    await sleep(1000);
    done = (await night(gm)).night.recapDone;
  }
  R.check(done, 'finale', 'finale finishes after refreshes');
  await sleep(2500);
  const stTxt = await ps[0].page.locator('body').innerText();
  R.check(/Final Account Statement/i.test(stTxt), 'finale', 'phone shows the statement after the finale (without another refresh)', stTxt.slice(0, 120));
  // Statement totals match the GM ledger.
  const sAnn = (await dev(ps[0], s, 'GET', '/api/me/statement')).body;
  const ledger = (await night(gm)).gm.ledger.find((l) => l.playerId === ids[0]);
  R.check(sAnn.goldH === ledger.cashH, 'finale', 'statement gold equals final cash', `${sAnn.goldH} vs ${ledger.cashH}`);
  // Replay / skip finale spam.
  const rr = await Promise.all([api(gm.req, s.base, 'POST', '/api/night/finale/replay'), api(gm.req, s.base, 'POST', '/api/night/finale/skip'), api(ph.req, s.base, 'POST', '/api/night/finale/replay')]);
  R.check(!rr.some((x) => x.status >= 500), 'finale', 'replay/skip spam is harmless');
  // 6. Trades / votes / tips after End are refused cleanly.
  const late = await dev(ps[1], s, 'POST', '/api/trade/buy', { securityId: 'index', gold: 2 });
  R.check(late.status >= 400 && late.status < 500, 'end', 'trading after End is refused', JSON.stringify(late.body));
  const lateTip = await api(gm.req, s.base, 'POST', '/api/tips', { playerId: ids[0], tier: 'common' });
  R.check(lateTip.status >= 400 && lateTip.status < 500, 'end', 'sending a tip after End is refused cleanly', JSON.stringify(lateTip.body));
  // 7. Archive, start a new night; last night's phones and TV.
  const ar = await api(gm.req, s.base, 'POST', '/api/night/archive');
  R.check(ar.status === 200, 'archive', 'archive works', JSON.stringify(ar.body));
  await newNight(gm, s, { length: 120 });
  await sleep(2500);
  const oldPhone = await ps[2].page.locator('body').innerText();
  R.ok(`old phone after a new night opens: ${oldPhone.slice(0, 100).replace(/\n/g, ' ')}`);
  await sleep(5000);
  const oldAfter = await ps[2].page.locator('body').innerText();
  R.check(/Display name|Join|desk/i.test(oldAfter), 'archive', "last night's phone drops to the join screen on its own (no refresh)", oldAfter.slice(0, 120));
  await R.shot(ps[2].page, 'old-phone-new-night', s.dir);
  await sleep(3000);
  R.check(!(await tv.locator('body').innerText()).includes('Still running'), 'archive', 'TV switches to the new night on its own');
} catch (e) {
  R.bug('harness', 'round crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
