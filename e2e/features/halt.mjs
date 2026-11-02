// Halt a stock from the GM Market screen: positions close at full value, TV banner + phone alert, phone Market shows HALTED and refuses trades, relist works.
import { api, browser, dev, gmRoute, gmSetup, home, makeRound, newNight, openApp, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('halt');
const s = await startServer('halt', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
const shot = (p, n) => p.screenshot({ path: `${s.dir}/shots/${n}.png`, fullPage: true });
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const ids = (await night(gm)).players.map((p) => p.id);
  const sec = `p:${ids[1]}`;
  await sleep(1500);
  const buy = await dev(ps[0], s, 'POST', '/api/trade/buy', { securityId: sec, gold: 5 });
  const sh = await dev(ps[2], s, 'POST', '/api/trade/short', { securityId: sec, gold: 4 });
  R.check(buy.status === 200 && sh.status === 200, 'setup', 'Ann holds and Cat shorts BEN', `${buy.status} ${sh.status}`);

  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  R.watch(tv, 'tv');
  await tv.goto(s.base + '/display'); await sleep(2500);

  // GM halts BEN from the Market screen (confirm dialog accepted)
  const gp = gm.page;
  await gmRoute(gp, 'market'); await sleep(1500);
  const row = gp.locator('tr', { hasText: 'BEN' }).first();
  await shot(gp, '01-gm-market');
  await row.getByRole('button', { name: /Halt/ }).click(); await sleep(2500);
  R.check((await row.textContent())?.includes('Halted') && (await row.getByRole('button', { name: 'Relist' }).count()) === 1, 'gm', 'GM row shows Halted + Relist');
  await shot(gp, '02-gm-halted');

  // TV banner
  await sleep(500);
  const banner = (await tv.locator('.banner').first().textContent().catch(() => '')) ?? '';
  R.check(/BEN/.test(banner) && /suspended|halted/i.test(banner), 'tv', 'TV shows the alert banner', banner.slice(0, 160));
  await tv.screenshot({ path: `${s.dir}/shots/03-tv-banner.png` });

  // Ann's phone: a private message, HALTED in Market, trading off
  const pa = ps[0].page;
  await home(pa); await openApp(pa, 'Messages'); await sleep(900);
  R.check(/halted trading in BEN/.test((await pa.textContent('body')) ?? ''), 'phone', 'Ann is told her shares were closed at full value');
  await shot(pa, '04-phone-message');
  await home(pa); await openApp(pa, 'Market'); await sleep(700);
  R.check(/HALTED/.test((await pa.locator('button.r', { hasText: 'BEN' }).first().textContent()) ?? ''), 'phone', 'Market list marks BEN as HALTED');
  await pa.locator('button.r', { hasText: 'BEN' }).first().click(); await sleep(500);
  R.check((await pa.getByRole('button', { name: 'Buy', exact: true }).isDisabled()), 'phone', 'Buy is disabled on the halted stock');
  await shot(pa, '05-phone-market-halted');
  const r = await dev(ps[3], s, 'POST', '/api/trade/buy', { securityId: sec, gold: 2 });
  R.check(r.status === 409, 'server', 'a buy on the halted stock is refused', String(r.status));

  // relist
  await row.getByRole('button', { name: 'Relist' }).click(); await sleep(2000);
  R.check((await row.getByRole('button', { name: /Halt/ }).count()) === 1, 'gm', 'Relist puts the Halt button back');
  await shot(gp, '06-gm-relisted');
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close(); R.report(s); await s.stop();
}
