/**
 * A ready-made test night for browser checks: one call starts a fresh server, signs in the Master GM, creates and
 * starts a night with players, and (optionally) tables, a running game and props.
 *
 *   import { testNight } from '../lib/night.mjs';
 *   const T = await testNight('mycheck', { players: 4, tables: [{ name: 'Main', seats: 4, seat: [0, 1, 2, 3] }] });
 *   try {
 *     await T.gmAt('seating');                  // GM laptop page on a screen
 *     T.R.check(await T.gm.page.locator('.tw').count() === 1, 'gm', 'one table drawn');
 *   } finally { await T.done(); }               // prints the ROUND line, stops the server
 *
 * Players join through the API by default (fast); pass `phones: true` to join on real phone pages instead
 * (T.players[i].page). Everything else in e2e/rounds/lib.mjs still works alongside (api, sleep, gmLogin, …).
 */
import { api, browser, gmLogin, gmRoute, gmSetup, makeRound, newNight, phone, sleep, startServer } from '../rounds/lib.mjs';

const NAMES = [['Ann', 'ANN'], ['Benedict', 'BEN'], ['Cat', 'CAT'], ['Devonshire', 'DEV'], ['Eve', 'EVE'], ['Fitzgerald', 'FTZ'], ['Gus', 'GUS'], ['Hannah', 'HAN'], ['Ivy', 'IVY'], ['Jo', 'JOJ'], ['Kit', 'KIT'], ['Lou', 'LOU']];

/**
 * @param {string} name  output folder / round name (e2e/.out/out/<name>)
 * @param {object} o
 * @param {number} [o.players=4]         how many players join (up to 12; long names included on purpose)
 * @param {boolean} [o.phones=false]     join on real phone pages (slower) instead of the API
 * @param {boolean} [o.start=true]       start the night after joining
 * @param {object[]} [o.tables=[]]       tables: { name, seats, x, y, w, h, rotation, color, seat: [player index…], props: [{ kind, x, y, w, rotation }] }
 * @param {{ game: string, table?: number, players?: number[] }} [o.game]  start a library game (by name) at table index `table`
 * @param {object} [o.settings]          night settings overrides
 * @param {number} [o.scale=1]           test time scale
 */
export async function testNight(name, o = {}) {
  const { players = 4, phones = false, start = true, tables = [], game, settings = {}, scale = 1 } = o;
  const R = makeRound(name);
  const s = await startServer(name, { scale });
  const b = await browser();
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s, { settings });
  const P = [];
  for (const [n, t] of NAMES.slice(0, players)) {
    if (phones) {
      const p = await phone(b, s, R, n, t);
      P.push({ name: n, ticker: t, id: p.id, token: p.token, page: p.page, ctx: p.ctx });
    } else {
      const r = await api(gm.req, s.base, 'POST', '/api/join', { displayName: n, ticker: t });
      P.push({ name: n, ticker: t, id: r.body.playerId, token: r.body.deviceToken });
    }
  }
  if (start) await api(gm.req, s.base, 'POST', '/api/night/start');
  const call = (method, path, data) => api(gm.req, s.base, method, path, data);
  const T = { R, s, b, gm, players: P, tables: [], game: null, call, sleep };
  for (const t of tables) {
    const { seat = [], props = [], rotation, color, ...base } = t;
    const r = await call('POST', '/api/tables', base);
    if (r.status !== 200) throw new Error(`table ${t.name}: ${JSON.stringify(r.body)}`);
    const id = r.body.id;
    for (const [i, pi] of seat.entries()) await call('POST', `/api/tables/${id}/seat`, { seat: i + 1, playerId: P[pi].id });
    for (const p of props) await call('POST', `/api/tables/${id}/props`, p);
    if (rotation !== undefined || color !== undefined) await call('PATCH', `/api/tables/${id}`, { rotation, color });
    T.tables.push({ id, name: t.name });
  }
  if (game) {
    const lib = (await call('GET', '/api/library')).body.games;
    const lg = lib.find((x) => x.name === game.game);
    if (!lg) throw new Error(`no library game ${game.game}`);
    const who = (game.players ?? P.map((_, i) => i)).map((i) => P[i].id);
    const g = (await call('POST', '/api/games', { libraryGameId: lg.id, participants: who, tableId: game.table === undefined ? undefined : T.tables[game.table].id })).body.game;
    await call('POST', `/api/games/${g.id}/start`);
    T.game = g;
  }
  /** Open the GM laptop page on a screen (size optional: [w, h]); reloads so it shows the latest state. */
  T.gmAt = async (screen, size) => {
    if (size) await gm.page.setViewportSize({ width: size[0], height: size[1] });
    await gm.page.reload();
    await sleep(800);
    await gmRoute(gm.page, screen);
    await sleep(800);
    return gm.page;
  };
  /** A second GM signed in on a phone (390 px). */
  T.gmPhone = async () => gmLogin(b, s, R, 'phone', 'gm-phone');
  /** A TV page at the given size. */
  T.tv = async (w = 1920, h = 1080) => {
    const page = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
    R.watch(page, `tv-${w}`);
    await page.goto(s.base + '/display');
    return page;
  };
  /** The GM's view of the night (what the GM console is drawn from). */
  T.state = async () => (await call('GET', '/api/night')).body;
  T.shot = (page, label) => page.screenshot({ path: `${s.dir}/shots/${label}.png` }).catch(() => {});
  /** Print the ROUND summary and stop everything. Call in `finally`. */
  T.done = async () => {
    await b.close().catch(() => {});
    R.report(s);
    await s.stop();
  };
  return T;
}
