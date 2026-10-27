// Round 8 — Messages, tips, memos and the Minter under mashing.
import { api, browser, dev, gmRoute, gmSetup, makeRound, newNight, openApp, phone, sleep, startServer, toasts, home } from './lib.mjs';
const R = makeRound('r08-messages');
const s = await startServer('r08', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const [a, bn, c] = ps;
  // 1. Re-roll trade-in mashed 6× in parallel from the phone.
  const tr = await Promise.all(Array.from({ length: 6 }, () => dev(a, s, 'POST', '/api/me/tips/trade-reroll')));
  const okN = tr.filter((x) => x.status === 200).length;
  R.check(okN === 1, 'tips', 'mashing trade-in grants exactly one tip', `${okN} succeeded`);
  const tok = (await night(gm)).gm.rerolls[a.id];
  R.check(tok === 2, 'tips', 'mashing trade-in spends exactly one token', `tokens left ${tok}`);
  // Through the UI: tip line visible, cooldown message shown.
  await sleep(1500);
  await openApp(a.page, 'Messages');
  const txt = await a.page.locator('body').innerText();
  R.check(/Anonymous tip/.test(txt), 'tips', 'tip shows in Messages');
  R.check(/Next trade-in at/.test(txt), 'tips', 'trade-in cooldown is explained on the phone', txt.slice(0, 200));
  // Tap the tip 5× quickly.
  const tipBtn = a.page.locator('button.tip').first();
  for (let i = 0; i < 5; i++) await tipBtn.click({ force: true }).catch(() => {});
  await sleep(800);
  const errs = await a.page.locator('.toast.error').count();
  R.check(errs === 0, 'tips', 'tapping a tip repeatedly shows no errors');
  await home(a.page);
  // 2. Buying tips: enable, then spam with just enough gold for one.
  await api(gm.req, s.base, 'PATCH', '/api/night/settings', { hints: { buy: { enabled: true, priceRarest: 19 } } });
  const spam = await Promise.all(Array.from({ length: 5 }, () => dev(bn, s, 'POST', '/api/me/tips/buy', { tier: 'rarest' })));
  const bought = spam.filter((x) => x.status === 200).length;
  const cashB = (await night(gm)).gm.ledger.find((l) => l.playerId === bn.id).cashH;
  R.check(bought === 1 && cashB >= 0, 'tips', 'buy spam with gold for one tip buys one and never goes negative', `${bought} bought, cash ${cashB}`);
  await sleep(1200);
  await openApp(bn.page, 'Messages');
  const buyBtns = bn.page.getByRole('button', { name: /Buy a .* tip/ });
  R.check((await buyBtns.count()) === 3, 'tips', 'tip line shows three buy buttons when buying is on');
  R.check(await buyBtns.last().isDisabled(), 'tips', 'buy button disabled when you cannot afford it');
  await home(bn.page);
  // 3. Memo edge cases: reassign before the player answers; answering the stale memo.
  const m1 = (await api(gm.req, s.base, 'POST', '/api/challenges', { playerId: c.id, text: 'Say "synergy"', reward: { type: 'peek' } })).body;
  const mid = m1.id ?? m1.challenge?.id;
  await sleep(1200);
  await openApp(c.page, 'Messages');
  await c.page.locator('button.mono').first().click();
  await sleep(1200);
  const rej = c.page.getByRole('button', { name: 'Reject', exact: true }).first();
  await Promise.all([rej.click().catch(() => {}), rej.click({ force: true }).catch(() => {})]);
  await sleep(800);
  R.check((await c.page.locator('.toast.error').count()) === 0, 'memo', 'double-tapping Reject shows no error');
  const ra = await api(gm.req, s.base, 'POST', `/api/challenges/${mid}/reassign`, { playerId: a.id });
  R.check(ra.status === 200, 'memo', 'rejected memo can be reassigned', JSON.stringify(ra.body));
  const ra2 = await api(gm.req, s.base, 'POST', `/api/challenges/${mid}/reassign`, { playerId: bn.id });
  R.check(ra2.status === 409 && /rejected/i.test(ra2.body.message ?? ''), 'memo', 'reassigning twice is refused with a reason', JSON.stringify(ra2.body));
  await home(c.page);
  // Ann gets it: double-tap Accept; then GM resolves; peek twice.
  await sleep(1000);
  const mine = (await night(gm)).gm.challenges.find((x) => x.playerId === a.id && x.status !== 'reassigned');
  await dev(a, s, 'POST', `/api/me/challenges/${mine.id}/read`);
  const [x1, x2] = await Promise.all([dev(a, s, 'POST', `/api/me/challenges/${mine.id}/respond`, { accept: true }), dev(a, s, 'POST', `/api/me/challenges/${mine.id}/respond`, { accept: true })]);
  R.ok(`double accept: ${x1.status}/${x2.status}`);
  R.check(![x1, x2].some((x) => x.status >= 500), 'memo', 'double Accept never crashes');
  await api(gm.req, s.base, 'POST', `/api/challenges/${mine.id}/resolve`, { success: true });
  const p1 = await dev(a, s, 'POST', `/api/me/challenges/${mine.id}/peek`, { targetPlayerId: bn.id });
  const p2 = await dev(a, s, 'POST', `/api/me/challenges/${mine.id}/peek`, { targetPlayerId: c.id });
  R.check(p1.status === 200 && p2.status >= 400, 'memo', 'peek works once only', `${p1.status}/${p2.status}`);
  const pself = await dev(bn, s, 'POST', `/api/me/challenges/${mine.id}/peek`, { targetPlayerId: c.id });
  R.check(pself.status >= 400, 'memo', "you can't use someone else's peek");
  // 4. Notifications: long, HTML, empty game.
  const long = 'x'.repeat(700);
  const n1 = await api(gm.req, s.base, 'POST', '/api/notifications', { to: { all: true }, message: '<b>bold</b> <script>alert(1)</script> ' + long });
  R.check(n1.status === 200, 'notify', 'long html message accepted (trimmed)');
  const emptyGame = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Nobody' })).body.game;
  const n2 = await api(gm.req, s.base, 'POST', '/api/notifications', { to: { gameId: emptyGame.id }, message: 'hi' });
  R.check(n2.status === 400 && n2.body.message !== 'no_recipients', 'notify', 'messaging a game with no players gives a readable reason', JSON.stringify(n2.body));
  await sleep(1500);
  await openApp(bn.page, 'Messages');
  R.check((await bn.page.locator('b, script').filter({ hasText: /bold|alert/ }).count()) === 0, 'xss', 'html in a GM message is shown as text');
  await home(bn.page);
  // 5. Minter mashing: 300 taps in a burst, double-tap a tier purchase, minting while paused.
  await openApp(c.page, 'NFT Minter');
  const mint = c.page.locator('button.mint');
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) await mint.click({ force: true, timeout: 500 }).catch(() => {});
  const secs = (Date.now() - t0) / 1000;
  await sleep(4000);
  const mv = (await dev(c, s, 'GET', '/api/minter')).body;
  R.ok(`300 taps in ${secs.toFixed(1)} s → minted ${mv.minted}`);
  R.check(mv.minted <= Math.ceil(15 * (secs + 5)) + 5, 'minter', 'tap clamp holds under mashing', JSON.stringify(mv).slice(0, 160));
  const buyLaptop = c.page.getByRole('button', { name: /^15$|^\d+$/ }).first();
  await Promise.all([buyLaptop.click().catch(() => {}), buyLaptop.click({ force: true }).catch(() => {})]);
  await sleep(3500);
  const mv2 = (await dev(c, s, 'GET', '/api/minter')).body;
  R.ok(`after double-tap buy: ${JSON.stringify(mv2.tiers ?? mv2).slice(0, 120)}`);
  R.check((mv2.credits ?? 0) >= 0, 'minter', 'double-tap tier buy never goes negative');
  await home(c.page);
  // 6. Tip to someone who left.
  await api(gm.req, s.base, 'POST', `/api/players/${c.id}/leave`);
  const lt = await api(gm.req, s.base, 'POST', '/api/tips', { playerId: c.id, tier: 'common' });
  R.check(lt.status === 404 || lt.status === 409, 'tips', 'tip to a player who left is refused');
  await sleep(1500);
  const leftTxt = await c.page.locator('body').innerText();
  R.ok(`phone of the player who left shows: ${leftTxt.slice(0, 90).replace(/\n/g, ' ')}`);
  // GM tip log.
  await gmRoute(gm.page, 'notify');
  await sleep(800);
  R.check((await gm.page.locator('text=re-roll trade-in').count()) >= 1, 'tips', 'GM tip log shows the trade-in source');
  await R.shot(gm.page, 'gm-tips', s.dir);
} catch (e) {
  R.bug('harness', 'round crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
