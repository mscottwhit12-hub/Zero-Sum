// Uno, Parcheesi, Sorry!, Yahtzee boards in the real app: library entries, tab renders, one real action each, state saved, crown rule, phone width, no page errors.
import { api, browser, gmLogin, gmRoute, gmSetup, makeRound, newNight, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('no2');
const s = await startServer('no2', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const { phone } = await import('../rounds/lib.mjs');
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) await phone(b, s, R, n, t);
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const lib = (await api(gm.req, s.base, 'GET', '/api/library')).body.games;
  const ids = (await night(gm)).players.map((p) => p.id);
  const page = gm.page;
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const pgm = await gmLogin(b, s, R, 'phone', 'gm-phone');
  pgm.page.on('pageerror', (e) => errs.push(String(e)));
  const games = {};
  const make = async (name, key) => {
    const lg = lib.find((g) => g.name === name);
    R.check(lg?.board === key && lg?.leadMode === 'high', 'library', `${name} is in the default library with board "${key}"`, JSON.stringify(lg ?? null).slice(0, 160));
    const t = (await api(gm.req, s.base, 'POST', '/api/tables', { name: `T-${key}`, seats: 4 })).body.id;
    for (let i = 0; i < 4; i++) await api(gm.req, s.base, 'POST', `/api/tables/${t}/seat`, { seat: i + 1, playerId: ids[i] });
    const g = (await api(gm.req, s.base, 'POST', '/api/games', { libraryGameId: lg.id, participants: ids, tableId: t })).body.game;
    await api(gm.req, s.base, 'POST', `/api/games/${g.id}/start`);
    games[key] = { g, name };
    await page.reload(); await sleep(1500);
  };
  const open = async (key) => { await page.locator('nav.side button.board', { hasText: games[key].name }).click(); await sleep(1500); };
  const st = async (key) => JSON.stringify((await api(gm.req, s.base, 'GET', `/api/games/${games[key].g.id}/board`)).body.state ?? {});
  const leader = async (key) => (await night(gm)).games.find((x) => x.id === games[key].g.id)?.leaderId ?? null;
  const shot = (n) => page.screenshot({ path: `${s.dir}/shots/${n}.png`, fullPage: true });

  // UNO: Ann goes out, 30 points -> state saved, Ann leads
  await make('Uno', 'uno'); await open('uno'); await shot('uno-01');
  await page.locator('section.panel', { hasText: 'Round 1' }).locator('button.chip', { hasText: 'Ann' }).first().click(); await sleep(300);
  await page.locator('#un-points').fill('30'); await page.getByRole('button', { name: 'Add round' }).first().click(); await sleep(1500);
  R.check(/30/.test(await st('uno')), 'uno', 'a round is saved to the server', (await st('uno')).slice(0, 200));
  R.check((await leader('uno')) === ids[0], 'uno', 'crown is live: Ann leads after her round', String(await leader('uno')));
  await shot('uno-02');

  // PARCHEESI: Ann pawn out of the Nest, onto Home path, home
  await make('Parcheesi', 'parcheesi'); await open('parcheesi'); await shot('parcheesi-01');
  const pa = page.getByRole('button', { name: /Out of the Nest/ }).first();
  await pa.click(); await sleep(400);
  await page.getByRole('button', { name: 'Board to Home' }).first().click(); await sleep(1500);
  R.check(/home/i.test(await st('parcheesi')), 'parcheesi', 'pawn moves are saved to the server', (await st('parcheesi')).slice(0, 200));
  R.check((await leader('parcheesi')) != null, 'parcheesi', 'crown is live: someone with a pawn home leads', String(await leader('parcheesi')));
  await shot('parcheesi-02');

  // SORRY: out of Start, then home
  await make('Sorry!', 'sorry'); await open('sorry'); await shot('sorry-01');
  await page.getByRole('button', { name: 'Out of Start' }).first().click(); await sleep(400);
  await page.getByRole('button', { name: 'Board to Home' }).first().click(); await sleep(1500);
  R.check(/home/i.test(await st('sorry')), 'sorry', 'pawn moves are saved to the server', (await st('sorry')).slice(0, 200));
  R.check((await leader('sorry')) != null, 'sorry', 'crown is live after a pawn gets home', String(await leader('sorry')));
  await shot('sorry-02');

  // YAHTZEE: Yahtzee box scored 50; crown stays empty until the end
  await make('Yahtzee', 'yahtzee'); await open('yahtzee'); await shot('yahtzee-01');
  await page.locator('button.bbtn', { hasText: /^Yahtzee/ }).first().click(); await sleep(300);
  await page.getByRole('button', { name: /Scored 50/ }).first().click(); await sleep(1500);
  R.check(/50/.test(await st('yahtzee')), 'yahtzee', 'a box is saved to the server', (await st('yahtzee')).slice(0, 200));
  R.check((await leader('yahtzee')) == null, 'yahtzee', 'no crown before the game ends (Tate)', String(await leader('yahtzee')));
  await shot('yahtzee-02');

  // phone width for every board
  for (const key of Object.keys(games)) {
    await gmRoute(pgm.page, `board-${games[key].g.id}`); await sleep(1500);
    await pgm.page.screenshot({ path: `${s.dir}/shots/${key}-phone.png`, fullPage: true });
    const sw = await pgm.page.evaluate(() => document.documentElement.scrollWidth);
    R.check(sw <= 390, 'layout', `${key}: phone shows nothing wider than the screen`, String(sw));
  }
  R.check(errs.length === 0, 'client', 'no page errors', errs.join(' | ').slice(0, 300));
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close(); R.report(s); await s.stop();
}
