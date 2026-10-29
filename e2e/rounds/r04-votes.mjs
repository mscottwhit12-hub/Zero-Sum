// Round 4 — the incoming-call poll: answering, declining, ignoring, refreshing, changing your mind, voting late.
import { api, browser, dev, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer, toasts, home } from './lib.mjs';
const R = makeRound('r04-votes');
// 60× clock: a 300-min night opens Q1 after 30 game-min (30 s). Window 40 game-min (40 s).
const s = await startServer('r04', { scale: 60 });
const b = await browser();
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s, { length: 300, settings: { votes: { windowMinutes: 40 } } });
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV'], ['Eli', 'ELI']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  // Cat sits in the Market app when the call comes; Eli holds the phone sideways.
  await openApp(ps[2].page, 'Market');
  await ps[4].page.setViewportSize({ width: 844, height: 390 });
  let open = false;
  for (let i = 0; i < 60 && !open; i++) {
    await sleep(1000);
    open = !!(await api(gm.req, s.base, 'GET', '/api/night')).body.vote?.open;
  }
  R.check(open, 'vote', 'Q1 poll opens on schedule');
  await sleep(2000);
  const ringing = [];
  for (const p of ps) ringing.push(await p.page.locator('.call').isVisible().catch(() => false));
  R.check(ringing.slice(0, 4).every(Boolean), 'vote', 'incoming call rings on every upright phone (incl. one inside an app)', `ringing: ${ringing}`);
  await R.shot(ps[4].page, 'landscape-during-call', s.dir);
  const eliTxt = await ps[4].page.locator('body').innerText();
  R.ok(`landscape phone shows: ${eliTxt.slice(0, 60).replace(/\n/g, ' ')}`);
  await ps[4].page.setViewportSize({ width: 390, height: 844 });

  // Ann answers and votes for Ben, then changes her mind to herself.
  await ps[0].page.getByRole('button', { name: 'Answer' }).click();
  await ps[0].page.locator('button.pick', { hasText: 'Ben' }).click();
  await sleep(600);
  await ps[0].page.locator('button.pick', { hasText: 'Ann' }).click();
  await sleep(800);
  const t0 = await toasts(ps[0].page);
  R.ok(`change-vote toast: ${t0}`);
  // Refresh: the call must not come back.
  await ps[0].page.reload();
  await sleep(4500);
  R.check(!(await ps[0].page.locator('.call').isVisible().catch(() => false)), 'vote', 'after voting + refresh, the call does not ring again');
  // Ben declines; then refreshes.
  await ps[1].page.getByRole('button', { name: 'Decline' }).click();
  await ps[1].page.reload();
  await sleep(4500);
  R.check(!(await ps[1].page.locator('.call').isVisible().catch(() => false)), 'vote', 'decline + refresh does not ring again');
  const vb = await ps[1].page.locator('button.app', { hasText: 'Vote' }).isVisible().catch(() => false);
  R.check(vb, 'vote', 'Vote app is still on the home screen after declining');
  // Ben double-taps a vote.
  await openApp(ps[1].page, 'Vote');
  const btn = ps[1].page.locator('button.pick', { hasText: 'Cat' });
  await Promise.all([btn.click().catch(() => {}), btn.click({ force: true }).catch(() => {})]);
  await sleep(800);
  // Cat answers from inside the Market app.
  if (await ps[2].page.locator('.call').isVisible().catch(() => false)) {
    await ps[2].page.getByRole('button', { name: 'Answer' }).click();
    R.check(await ps[2].page.locator('button.pick').first().isVisible().catch(() => false), 'vote', 'answering from inside another app opens the Vote app');
    await ps[2].page.locator('button.pick', { hasText: 'Dev' }).click();
  }
  // Dev ignores the call completely. Wait for the window to close.
  const round = async () => (await api(gm.req, s.base, 'GET', '/api/night')).body.gm.vote;
  const gv = await round();
  R.ok(`GM vote view keys: ${Object.keys(gv ?? {}).join(',')}`);
  let closed = false;
  for (let i = 0; i < 120 && !closed; i++) {
    await sleep(1000);
    closed = !(await api(gm.req, s.base, 'GET', '/api/night')).body.vote?.open;
  }
  R.check(closed, 'vote', 'poll window closes');
  await sleep(1500);
  R.check(!(await ps[3].page.locator('.call').isVisible().catch(() => false)), 'vote', 'an ignored call stops ringing when the poll closes', 'call screen still up after the window closed');
  // Late vote via a stale tap.
  const late = await dev(ps[3], s, 'POST', '/api/vote', { targetId: ps[0].id });
  R.check(late.status >= 400, 'vote', 'a vote after the window closes is refused', JSON.stringify(late.body));
  const ballots = (await api(gm.req, s.base, 'GET', '/api/export/night.json?night=1')).body.votes?.[0]?.ballots ?? [];
  R.check(ballots.filter((x) => x.playerId === ps[1].id).length === 1, 'vote', 'double-tapped vote stored once');
  R.check(ballots.find((x) => x.playerId === ps[0].id)?.targetId === ps[0].id, 'vote', 'changing your vote keeps the last pick');
  // Vote for someone who left.
  await api(gm.req, s.base, 'POST', `/api/players/${ps[4].id}/leave`);
  R.ok('Eli left');
  await R.shot(ps[0].page, 'vote-closed', s.dir);
} catch (e) {
  R.bug('harness', 'round crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
