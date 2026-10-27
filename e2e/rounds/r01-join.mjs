// Round 1 — joining: what real guests do at the door.
import { api, browser, dev, gmSetup, makeRound, newNight, phone, sleep, startServer, toasts } from './lib.mjs';
const R = makeRound('r01-join');
const s = await startServer('r01');
const b = await browser();
try {
  const gm = await gmSetup(b, s, R);
  R.check(await gm.page.getByText('No night yet').isVisible().catch(() => false), 'gm', 'setup through the UI lands on the dashboard');
  // Guest opens /play before the GM opened joins.
  const early = await phone(b, s, R, 'Early', 'ERL', { join: false });
  await early.page.waitForTimeout(4000);
  const earlyForm = await early.page.getByLabel('Display name').isVisible().catch(() => false);
  R.check(!earlyForm, 'join', 'no join form before the GM opens joins', 'join form visible before joins open');
  await newNight(gm, s);
  // Early phone: does it notice joins opened without a refresh?
  await early.page.waitForTimeout(6000);
  const earlyNow = await early.page.getByLabel('Display name').isVisible().catch(() => false);
  R.check(earlyNow, 'join', 'waiting phone shows the join form when joins open (no refresh)', 'waiting phone stays stuck until refreshed');
  if (!earlyNow) await early.page.reload();

  // 1. Double-tap Join.
  const a = await phone(b, s, R, 'Alice', 'ALI', { join: false });
  await a.page.getByLabel('Display name').fill('Alice');
  await a.page.getByLabel(/Ticker/).fill('ali');
  const btn = a.page.getByRole('button', { name: /^(Join|Request to join)$/ });
  await Promise.all([btn.click().catch(() => {}), btn.click({ force: true }).catch(() => {}), btn.dblclick({ force: true }).catch(() => {})]);
  await a.page.waitForTimeout(1500);
  const players1 = (await api(gm.req, s.base, 'GET', '/api/night')).body.players;
  R.check(players1.filter((p) => p.displayName === 'Alice').length === 1, 'join', 'double-tapping Join creates one player', `players named Alice: ${players1.filter((p) => p.displayName === 'Alice').length}`);
  R.check(players1.find((p) => p.displayName === 'Alice')?.ticker === 'ALI', 'join', 'lowercase ticker stored uppercase');

  // 2. Same name, different case; same ticker.
  const dup = await phone(b, s, R, 'alice', 'ALI', { join: false });
  await dup.page.getByLabel('Display name').fill('alice');
  await dup.page.getByLabel(/Ticker/).fill('ALI');
  await dup.page.getByRole('button', { name: /^(Join|Request to join)$/ }).click();
  const t1 = await toasts(dup.page);
  const err1 = await dup.page.locator('.error, .toast.error').allTextContents();
  R.check(!(await dup.page.locator('button.icon').first().isVisible().catch(() => false)), 'join', 'duplicate name/ticker refused', 'second Alice got in');
  R.check(/taken|in use|already/i.test(t1 + err1.join(' ')), 'join', 'duplicate shows a clear message', `message: "${t1} ${err1.join(' ')}"`);

  // 3. Reserved ticker, junk tickers, emoji / long / blank / html names.
  const cases = [
    ['Indy', 'IDX', /reserved|taken|not allowed|in use/i],
    ['Coin Guy', 'COIN', /reserved|taken|not allowed|in use/i],
    ['Num', '12A', /letter/i],
    ['😀😀😀', 'EMO', null],
    ['   ', 'SPC', /name/i],
    ['<img src=x onerror=alert(1)>', 'XSS', null],
    ['A'.repeat(40), 'LNG', null],
  ];
  for (const [name, tk, expectErr] of cases) {
    const q = await phone(b, s, R, `case-${tk}`, tk, { join: false });
    await q.page.getByLabel('Display name').fill(name);
    await q.page.getByLabel(/Ticker/).fill(tk);
    const submit = q.page.getByRole('button', { name: /^(Join|Request to join)$/ });
    if (await submit.isDisabled()) {
      R.ok(`submit disabled for ${JSON.stringify(name)} / ${tk}`);
      await q.ctx.close();
      continue;
    }
    await submit.click();
    const msg = (await toasts(q.page)) + ' ' + (await q.page.locator('.error').allTextContents()).join(' ');
    const joined = await q.page.locator('button.icon').first().isVisible().catch(() => false);
    if (expectErr) {
      R.check(!joined, 'join', `refused ${JSON.stringify(name)} / ${tk}`, `got in with ${tk}`);
      R.check(expectErr.test(msg), 'join', `clear message for ${tk}`, `message: "${msg.trim()}"`);
    } else if (joined) R.ok(`accepted ${JSON.stringify(name).slice(0, 20)} / ${tk}`);
    else R.ok(`refused ${JSON.stringify(name).slice(0, 20)} / ${tk}: ${msg.trim()}`);
    await q.ctx.close();
  }
  // XSS name must render as text on GM dashboard / TV.
  const tv = await b.newContext().then((c) => c.newPage());
  R.watch(tv, 'tv');
  await tv.goto(s.base + '/display');
  await tv.waitForTimeout(1500);
  R.check((await tv.locator('img[src="x"]').count()) === 0, 'xss', 'html in a name is not rendered on the TV');
  R.check((await gm.page.locator('img[src="x"]').count()) === 0, 'xss', 'html in a name is not rendered on the GM console');

  // 4. Refresh in the middle of joining (form filled, not submitted) and after joining.
  const r = await phone(b, s, R, 'Rae', 'RAE', { join: false });
  await r.page.getByLabel('Display name').fill('Rae');
  await r.page.reload();
  R.check(await r.page.getByLabel('Display name').isVisible(), 'join', 'refresh before submit returns to the form');
  await r.page.getByLabel('Display name').fill('Rae');
  await r.page.getByLabel(/Ticker/).fill('RAE');
  await r.page.getByRole('button', { name: /^(Join|Request to join)$/ }).click();
  await r.page.locator('button.icon').first().waitFor({ timeout: 8000 }).catch(() => {});
  await r.page.reload();
  await r.page.waitForTimeout(1500);
  R.check(await r.page.locator('button.icon').first().isVisible().catch(() => false), 'join', 'refresh after joining keeps you in');

  // 5. Same phone opens a second tab.
  const tab2 = await r.ctx.newPage();
  R.watch(tab2, 'Rae-tab2');
  await tab2.goto(s.base + '/play');
  await tab2.waitForTimeout(4500);
  R.check(await tab2.locator('button.icon').first().isVisible().catch(() => false), 'join', 'second tab on the same phone is the same player');

  // 6. Night starts; a late arrival joins (needs approval), then the GM double-taps Approve.
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const late = await phone(b, s, R, 'Late', 'LAT', { join: false });
  await late.page.getByLabel('Display name').fill('Late');
  await late.page.getByLabel(/Ticker/).fill('LAT');
  await late.page.getByRole('button', { name: /^(Join|Request to join)$/ }).click();
  await late.page.waitForTimeout(1000);
  await gm.page.waitForTimeout(800);
  const approve = gm.page.getByRole('button', { name: 'Approve' }).first();
  R.check(await approve.isVisible().catch(() => false), 'gm', 'late join request appears on the dashboard without refresh');
  await Promise.all([approve.click().catch(() => {}), approve.click({ force: true }).catch(() => {})]);
  await gm.page.waitForTimeout(800);
  const gmToasts = await toasts(gm.page);
  R.check(!/error|went wrong|not found/i.test(gmToasts), 'gm', 'double-tapping Approve shows no error', `toasts: ${gmToasts}`);
  await late.page.waitForTimeout(2500);
  R.check(await late.page.locator('button.icon').first().isVisible().catch(() => false), 'join', 'approved late joiner gets in without refreshing', 'late joiner still waiting');
  const pl = (await api(gm.req, s.base, 'GET', '/api/night')).body.players;
  R.check(pl.filter((p) => p.displayName === 'Late').length === 1, 'join', 'one Late player after double approve');

  // 7. Guest clears their browser (lost identity) and tries to rejoin by picking their name.
  const lost = await phone(b, s, R, 'Rae-again', 'RAE', { join: false });
  await lost.page.waitForTimeout(4500);
  const rejoinBtn = lost.page.getByRole('button', { name: /return to my desk|already playing/i }).first();
  R.check(await rejoinBtn.isVisible().catch(() => false), 'join', 'lost phone can find the rejoin option');
  if (await rejoinBtn.isVisible().catch(() => false)) {
    await rejoinBtn.click();
    await lost.page.getByRole('button', { name: 'Rae', exact: true }).click().catch((e) => R.bug('join', 'cannot pick own name to rejoin', e.message));
    await lost.page.waitForTimeout(800);
    await gm.page.waitForTimeout(800);
    const ap = gm.page.getByRole('button', { name: 'Approve' }).first();
    if (await ap.isVisible().catch(() => false)) await ap.click();
    await lost.page.waitForTimeout(2500);
    R.check(await lost.page.locator('button.icon').first().isVisible().catch(() => false), 'join', 'rejoined phone gets in after approval without refreshing');
  }
  // 8. Spam the join endpoint (someone mashing on a bad connection).
  const spam = await Promise.all(Array.from({ length: 15 }, (_, i) => api(late.ctx.request, s.base, 'POST', '/api/join', { displayName: 'Spam', ticker: 'SPM' })));
  const created = (await api(gm.req, s.base, 'GET', '/api/night')).body;
  const pend = (await api(gm.req, s.base, 'GET', '/api/night')).body.gm?.requests?.filter((r) => r.displayName === 'Spam').length ?? 0;
  R.check(pend <= 1, 'join', 'mashing join creates at most one pending request', `${pend} pending "Spam" requests`);
  R.ok(`spam statuses: ${[...new Set(spam.map((x) => x.status))].join(',')}`);
  await R.shot(gm.page, 'gm-after-joins', s.dir);
} catch (e) {
  R.bug('harness', 'round crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
