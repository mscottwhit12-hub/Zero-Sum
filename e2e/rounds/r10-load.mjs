// Round 10 — a crowded night at 60×: 14 phones, 2 GMs, the TV. Everyone trades at once, refreshes at once,
// drops Wi-Fi, and the server crashes mid-night. Watch for errors, stuck screens and slow responses.
import { api, browser, dev, gmLogin, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer, home } from './lib.mjs';
const R = makeRound('r10-load');
const s = await startServer('r10', { scale: 60 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
const lat = [];
let netFails = 0;
const server5xx = [];
const timed = async (fn) => {
  const t0 = Date.now();
  const r = await fn();
  if (r.status === 0) netFails++;
  else lat.push(Date.now() - t0);
  if (r.status >= 500) server5xx.push(JSON.stringify(r.body).slice(0, 120));
  return r;
};
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s, { length: 480, settings: { handicap: { autoEnabled: true }, hints: { buy: { enabled: true } } } });
  const ph = await gmLogin(b, s, R, 'phone', 'gm-phone');
  const names = ['Ann', 'Ben', 'Cat', 'Dev', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon', 'Kim', 'Lou', 'Max', 'Nia'];
  const ps = [];
  for (const n of names) ps.push(await phone(b, s, R, n, n.toUpperCase()));
  const tv = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  R.watch(tv, 'tv');
  await tv.goto(s.base + '/display');
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const ids = ps.map((p) => p.id);
  // Three tables.
  const tables = [ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 14)];
  const games = [];
  for (const [k, t] of tables.entries()) {
    const g = (await api(gm.req, s.base, 'POST', '/api/games', { name: `Table ${k + 1}`, participants: t, plannedDurationHours: 1 + k })).body.game;
    await api(gm.req, s.base, 'POST', `/api/games/${g.id}/start`);
    games.push(g);
  }
  // 1. Everyone buys the same stock in the same second.
  const burst = await Promise.all(ps.map((p) => timed(() => dev(p, s, 'POST', '/api/trade/buy', { securityId: `p:${ids[0]}`, gold: 3 }))));
  R.check(burst.every((x) => x.status === 200), 'load', '14 simultaneous buys all succeed', burst.map((x) => x.status).join(','));
  // 2. Score storms from two GM devices while phones trade and tick.
  const stop = { v: false };
  const traders = ps.map(async (p, i) => {
    let n = 0;
    while (!stop.v) {
      const sec = ['index', 'crypto', `p:${ids[(i + 1) % ids.length]}`, 'dead', 'event-reroll'][n % 5];
      await timed(() => dev(p, s, 'POST', n % 3 === 2 ? '/api/trade/sell' : '/api/trade/buy', n % 3 === 2 ? { securityId: sec, sharesH: 10 } : { securityId: sec, gold: 1 }));
      n++;
      await sleep(400 + Math.random() * 900);
    }
  });
  const scorers = [gm, ph].map(async (dv, k) => {
    let n = 0;
    while (!stop.v) {
      const g = games[n % 3];
      const t = tables[n % 3];
      await timed(() => api(dv.req, s.base, 'POST', `/api/games/${g.id}/scores`, { scores: t.map((id) => ({ playerId: id, score: Math.floor(Math.random() * 10) })) }));
      n++;
      await sleep(700);
    }
  });
  await sleep(20000);
  // 3. Everyone refreshes at once.
  await Promise.all(ps.map((p) => p.page.reload().catch(() => {})));
  await sleep(6000);
  const homes = await Promise.all(ps.map((p) => p.page.locator('button.icon').first().isVisible().catch(() => false)));
  R.check(homes.every(Boolean), 'load', 'all 14 phones come back after refreshing at the same moment', homes.join(','));
  // 4. Half the room drops Wi-Fi for 15 s.
  await Promise.all(ps.slice(0, 7).map((p) => p.ctx.setOffline(true)));
  await sleep(15000);
  await Promise.all(ps.slice(0, 7).map((p) => p.ctx.setOffline(false)));
  await sleep(6000);
  // 5. Crash mid-night under load.
  await s.kill9();
  await sleep(2000);
  await s.start();
  await sleep(10000);
  const st = await night(gm);
  R.check(st.night.status === 'live' && st.games.filter((g) => g.status === 'active').length === 3, 'load', 'night and all 3 games survive a crash under load');
  // The handicap hourly check happens (60× → after ~60 s of night clock).
  await sleep(30000);
  stop.v = true;
  await Promise.all([...traders, ...scorers]);
  const st2 = await night(gm);
  R.check((st2.gm.handicap.log ?? []).some((e) => e.trigger === 'interval'), 'handicap', 'hourly handicap check ran under load', `log ${st2.gm.handicap.log?.length}`);
  // Results for all three tables while phones idle.
  for (const [k, g] of games.entries()) {
    const r = await api(gm.req, s.base, 'POST', `/api/games/${g.id}/result`, { actualHours: 1 + k * 0.5, participants: tables[k].map((id, i) => ({ playerId: id, placement: i + 1 })) });
    R.check(r.status === 200, 'load', `result for Table ${k + 1} saved`, JSON.stringify(r.body).slice(0, 120));
  }
  await sleep(3000);
  // Phones agree with the server.
  let mismatch = 0;
  const ledger = (await night(gm)).gm.ledger;
  for (const p of ps.slice(0, 6)) {
    await openApp(p.page, 'Wallet').catch(() => {});
    await sleep(300);
    const txt = await p.page.locator('body').innerText();
    const cash = (ledger.find((l) => l.playerId === p.id).cashH / 100).toFixed(1);
    if (!txt.includes(cash)) mismatch++;
    await home(p.page);
  }
  R.check(mismatch === 0, 'load', 'phone wallets match the server after the chaos', `${mismatch} of 6 phones show a different cash figure`);
  R.ok(`network failures (expected only during the crash window): ${netFails}`);
  const sorted = [...lat].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  R.ok(`requests ${lat.length}, p50 ${sorted[Math.floor(sorted.length / 2)]} ms, p95 ${p95} ms, max ${sorted.at(-1)} ms`);
  R.check(server5xx.length === 0, 'load', 'no 5xx under load', server5xx.slice(0, 3).join(' | '));
  R.check(p95 < 500, 'load', 'p95 API latency under 500 ms with 14 phones + 2 GMs + TV', `${p95} ms`);
  const errs = lat.length;
  await sleep(1000);
  const stuck = await Promise.all(ps.map((p) => p.page.locator('.call').isVisible().catch(() => false)));
  R.ok(`phones ringing at the end: ${stuck.filter(Boolean).length}`);
  await R.shot(tv, 'tv-load', s.dir);
  await R.shot(gm.page, 'gm-load', s.dir);
  await R.shot(ps[3].page, 'phone-load', s.dir);
} catch (e) {
  R.bug('harness', 'round crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
