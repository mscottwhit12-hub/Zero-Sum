// Schedule timeline drag: earlier (still in the future) and later, laptop width.
import { api, browser, gmRoute, gmSetup, makeRound, newNight, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('sched');
const s = await startServer('sched', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const ids = (await night(gm)).players.map((p) => p.id);
  const t1 = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'T1', seats: 4 })).body.id;
  const now = Date.now();
  const g = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Clue', participants: ids, tableId: t1, plannedStart: now + 150 * 60_000, plannedDurationHours: 1 })).body.game;
  const gp = gm.page;
  await gmRoute(gp, 'games'); await sleep(1200);
  const pxMin = await gp.evaluate(() => { const a = [...document.querySelectorAll('.tick')].map((e) => e.getBoundingClientRect().left); return a.length > 1 ? (a[1] - a[0]) / 30 : 2; });
  const drag = async (min) => {
    const pxMin = await gp.evaluate(() => { const a = [...document.querySelectorAll('.tick')].map((e) => e.getBoundingClientRect().left); return a.length > 1 ? (a[1] - a[0]) / 30 : 2; });
    const bb = await gp.locator('.blk', { hasText: 'Clue' }).first().boundingBox();
    const before = (await night(gm)).games.find((x) => x.id === g.id).plannedStart;
    await gp.mouse.move(bb.x + 20, bb.y + bb.height / 2); await gp.mouse.down();
    await gp.mouse.move(bb.x + 20 + pxMin * min, bb.y + bb.height / 2, { steps: 12 }); await gp.mouse.up(); await sleep(1200);
    const after = (await night(gm)).games.find((x) => x.id === g.id).plannedStart;
    return Math.round((after - before) / 60000);
  };
  const e1 = await drag(-60);
  R.check(Math.abs(e1 + 60) <= 5, 'timeline', 'drag 60 min earlier (still future) moves the start', `${e1} min`);
  const l1 = await drag(30);
  R.check(Math.abs(l1 - 30) <= 5, 'timeline', 'drag 30 min later moves the start', `${l1} min`);
  const e2 = await drag(-45);
  R.check(Math.abs(e2 + 45) <= 5, 'timeline', 'drag 45 min earlier again', `${e2} min`);
} catch (e) { R.bug('harness', 'crashed', e.stack); } finally { await b.close(); R.report(s); await s.stop(); }
