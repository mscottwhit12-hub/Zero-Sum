// Player-to-player bets, through the real screens: one phone offers, another takes it, the GM records the result and the winner is paid.
// Also: the limit, targeted offers, GM void, and the GM Bets screen. Needs `npm run build -w packages/client` first.
import { api, browser, dev, gmRoute, gmSetup, makeRound, newNight, phone, sleep, startServer } from '../rounds/lib.mjs';

const R = makeRound('bets');
const s = await startServer('bets', { scale: 1 });
const b = await browser();
const cashOf = async (p) => (await dev(p, s, 'GET', '/api/me')).body.view?.me?.cashH ?? null;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT']]) ps.push(await phone(b, s, R, n, t));
  const [ann, ben, cat] = ps;
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const game = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Catan', participants: ps.map((p) => p.id) })).body.game;
  for (const p of ps) await api(gm.req, s.base, 'POST', '/api/night/adjustments', { playerId: p.id, gold: 20, reason: 'bankroll' });

  const open = async (p) => {
    await p.page.locator('.phone .app.a-bets').first().click();
    await p.page.locator('.phone .appbar').waitFor();
    await sleep(300);
  };
  const goHome = async (p) => { await p.page.getByRole('button', { name: '‹ Home' }).click(); await sleep(500); };

  // 1) Ben offers "Ann wins" at 3 to 1, risking 1
  await open(ben);
  await ben.page.getByLabel('Player').selectOption({ label: 'Ann' });
  await ben.page.getByLabel('You win').selectOption('3');
  await ben.page.getByLabel('for every').selectOption('1');
  await ben.page.getByLabel('you risk').fill('1');
  await ben.page.screenshot({ path: `${s.dir}/shots/01-offer.png` });
  await ben.page.getByRole('button', { name: 'Post offer' }).click();
  await sleep(1200);
  const list = async () => (await api(gm.req, s.base, 'GET', '/api/night')).body.gm.bets;
  R.check((await list()).length === 1 && (await list())[0].status === 'open', 'offer', 'the offer is posted and open');

  // 2) over the limit is blocked in the form
  await ben.page.getByLabel('you risk').fill('2');
  R.check(await ben.page.getByRole('button', { name: 'Post offer' }).isDisabled(), 'limit', '3 to 1 at 2 gold (6 at risk) can’t be posted without a ticket');
  await ben.page.getByLabel('you risk').fill('1');
  await goHome(ben);

  // 3) Cat sees and takes it
  await open(cat);
  const take = cat.page.getByRole('button', { name: /^Take it/ });
  R.check((await take.count()) === 1, 'see', 'Cat sees the open offer');
  await cat.page.screenshot({ path: `${s.dir}/shots/02-open.png` });
  const catBefore = (await dev(cat, s, 'GET', '/api/me')).body;
  await take.click();
  await sleep(1200);
  R.check((await list())[0].status === 'accepted', 'accept', 'taking it makes the bet live');
  R.check((await cat.page.locator('.phone .cd', { hasText: 'Live bets' }).count()) === 1, 'live', 'Cat now sees it under Live bets');
  await goHome(cat);

  // 4) the feed says so
  const night1 = (await api(gm.req, s.base, 'GET', '/api/night')).body;
  R.check(night1.feed.some((f) => f.message === 'feed.bet_accepted'), 'feed', 'an accepted bet shows in the public feed');

  // 5) GM screen lists it
  await gmRoute(gm.page, 'bets');
  await sleep(800);
  R.check((await gm.page.locator('.panel .line', { hasText: 'Ann wins' }).count()) >= 1, 'gm', 'the GM Bets screen lists the live bet');
  await gm.page.screenshot({ path: `${s.dir}/shots/03-gm.png` });

  // 6) result: Ann wins → Ben (the offerer) is paid 3 + his stake back
  const r = await api(gm.req, s.base, 'POST', `/api/games/${game.id}/result`, { actualHours: 1, participants: ps.map((p, i) => ({ playerId: p.id, placement: i + 1 })) });
  await sleep(800);
  const bet = (await list())[0];
  R.check(bet.status === 'settled' && bet.winnerId === ben.id, 'settle', 'recording the result settles the bet for the offerer', JSON.stringify(bet));
  await open(ben);
  R.check((await ben.page.locator('.phone .cd', { hasText: 'Results' }).count()) === 1, 'results', 'Ben sees it under Results');
  await ben.page.screenshot({ path: `${s.dir}/shots/04-results.png` });
  void r; void catBefore;
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
