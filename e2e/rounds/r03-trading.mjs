// Round 3 — trading the way people actually tap: double taps, odd numbers, selling too much, paused/closed markets.
import { api, browser, dev, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer, toasts, home } from './lib.mjs';
const R = makeRound('r03-trading');
const s = await startServer('r03', { scale: 1 });
const b = await browser();
const ledger = async (gm, id) => (await api(gm.req, s.base, 'GET', '/api/night')).body.gm.ledger.find((l) => l.playerId === id);
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const a = await phone(b, s, R, 'Ann', 'ANN');
  const bb = await phone(b, s, R, 'Ben', 'BEN');
  await api(gm.req, s.base, 'POST', '/api/night/start');
  await sleep(4000);
  const pg = a.page;
  const openStock = async (tk) => {
    await openApp(pg, 'Market');
    await pg.locator('.row-btn').filter({ has: pg.locator('span.mono', { hasText: new RegExp(`^${tk}`) }) }).first().click({ timeout: 5000 });
  };
  const tryBuy = async (amount, { taps = 1 } = {}) => {
    await pg.getByPlaceholder('Gold').fill(String(amount));
    const btn = pg.getByRole('button', { name: 'Buy', exact: true });
    if (await btn.isDisabled()) return { disabled: true, toast: '' };
    const clicks = [];
    for (let i = 0; i < taps; i++) clicks.push(btn.click({ force: true, timeout: 2000 }).catch(() => {}));
    await Promise.all(clicks);
    return { disabled: false, toast: await toasts(pg) };
  };
  const before = await ledger(gm, a.id);

  // 1. Triple-tap Buy for 5 gold.
  await openStock('BEN');
  const r1 = await tryBuy(5, { taps: 3 });
  await sleep(800);
  const trades1 = (await api(gm.req, s.base, 'GET', `/api/export/night.json?night=1`)).body.trades.filter((t) => t.playerId === a.id);
  R.check(trades1.length === 1, 'trade', 'triple-tapping Buy makes one trade', `${trades1.length} trades from one triple tap; toast: ${r1.toast}`);

  // 2. Odd amounts.
  for (const amt of ['0', '-5', '0.001', '1e3', '99999', '2.5']) {
    const r = await tryBuy(amt);
    const err = await pg.locator('.toast.error').count();
    R.ok(`amount ${amt}: ${r.disabled ? 'button disabled' : r.toast || '(no message)'}`);
    if (['0', '-5'].includes(amt)) R.check(r.disabled || err > 0, 'trade', `amount ${amt} refused`, r.toast);
    if (amt === '99999') R.check(r.disabled || err > 0, 'trade', 'amount over cash/cap refused with a message', r.toast);
    if (!r.disabled && !r.toast) R.bug('trade', `no feedback at all for amount ${amt}`);
    await sleep(1200);
  }
  // Trade per tick limit: two buys in the same tick on the same stock should explain why.
  const tt = (await api(gm.req, s.base, 'GET', `/api/export/night.json?night=1`)).body.trades.filter((t) => t.playerId === a.id);
  R.ok(`trades after odd amounts: ${tt.length}`);

  // 3. Sell straight after buying (lockout) — button state and message.
  await home(pg);
  await openStock('BEN');
  const sellAll = pg.getByRole('button', { name: /Sell all unlocked/ });
  const sellVisible = await sellAll.isVisible().catch(() => false);
  R.check(sellVisible, 'trade', 'holding shows a sell section');
  if (sellVisible) R.check(await sellAll.isDisabled(), 'trade', 'Sell all unlocked is disabled while shares are locked', 'sell enabled during lockout');
  const sellBox = pg.getByPlaceholder('Shares');
  if (await sellBox.isVisible().catch(() => false)) {
    await sellBox.fill('50');
    const sb = pg.getByRole('button', { name: 'Sell', exact: true });
    if (!(await sb.isDisabled())) {
      await sb.click();
      const t = await toasts(pg);
      R.check(/locked|minutes|not enough|can.t sell/i.test(t), 'trade', 'selling locked/too many shares explains why', `toast: "${t}"`);
    }
  }
  // Lockout is 5 real minutes at 1x; use the API with a fast-forward check after the round's other steps.

  // 4. Buy your own stock and the cap.
  await home(pg);
  await openStock('ANN');
  await pg.getByRole('button', { name: 'Max' }).click();
  const maxVal = await pg.getByPlaceholder('Gold').inputValue();
  R.ok(`Max fills ${maxVal}`);
  const r4 = await tryBuy(maxVal);
  R.check(!/error/i.test(r4.toast) || /cap|limit/i.test(r4.toast), 'trade', 'Max buy succeeds or explains the cap', r4.toast);
  await sleep(21000); // next tick
  const r5 = await tryBuy(5);
  R.check(r5.disabled || /cap|limit|invest/i.test(r5.toast), 'trade', 'buying past the invest cap is refused with a clear reason', `toast: "${r5.toast}"`);
  await home(pg);

  // 5. Pause → phones locked; API trade refused; resume.
  await api(gm.req, s.base, 'POST', '/api/night/pause', { minutes: 3 });
  await sleep(1500);
  const pr = await dev(bb, s, 'POST', '/api/trade/buy', { securityId: 'index', gold: 2 });
  R.check(pr.status >= 400, 'trade', 'trades refused while paused', JSON.stringify(pr.body));
  R.check(await bb.page.getByRole('button', { name: /Open NFT Minter/ }).isVisible().catch(() => false), 'pause', 'phones show the pause screen');
  await api(gm.req, s.base, 'POST', '/api/night/resume');
  await sleep(2000);
  R.check(!(await bb.page.getByRole('button', { name: /Open NFT Minter/ }).isVisible().catch(() => false)), 'pause', 'phones unlock on resume');

  // 6. Market screen open when trading closes; a stale tap after close.
  await openApp(bb.page, 'Market');
  await bb.page.locator('.row-btn').first().click();
  await bb.page.getByPlaceholder('Gold').fill('2');
  await api(gm.req, s.base, 'POST', '/api/night/close-trading');
  await sleep(1500);
  const buyBtn = bb.page.getByRole('button', { name: 'Buy', exact: true });
  const dis = await buyBtn.isDisabled().catch(() => true);
  if (!dis) {
    await buyBtn.click();
    const t = await toasts(bb.page);
    R.check(/closed/i.test(t), 'trade', 'a stale Buy tap after trading closed says the market is closed', `toast: "${t}"`);
  } else R.ok('Buy disabled as soon as trading closes');
  const ann = await ledger(gm, a.id);
  R.check(ann.cashH >= 0, 'ledger', 'cash never negative', `cash ${ann.cashH}`);
  R.ok(`Ann cash ${before.cashH} → ${ann.cashH}`);
  await R.shot(bb.page, 'market-after-close', s.dir);
} catch (e) {
  R.bug('harness', 'round crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
