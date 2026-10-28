// Seating floor plan: resize handles, drag players onto seats, swap, unseat, TV mirror. Needs `npm run build` first.
import { api, browser, gmLogin, gmRoute, gmSetup, makeRound, newNight, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('seating');
const s = await startServer('seating', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
const tbl = async (gm, id) => (await night(gm)).gm.seating.find((t) => t.id === id);
const box = async (loc) => (await loc.boundingBox());
async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await sleep(700);
}
const mid = (bb) => ({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV'], ['Eli', 'ELI'], ['Fay', 'FAY']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const t1 = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'Catan', seats: 4 })).body.id;
  const t2 = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'Risk', seats: 6, x: 0.6, y: 0.55 })).body.id;
  const page = gm.page;
  await gmRoute(page, 'seating');
  await sleep(800);
  await page.screenshot({ path: `${s.dir}/shots/01-initial.png` });

  // Select table 1 and resize.
  const body1 = page.locator('.tw').nth(0).locator('.body');
  await body1.click();
  await sleep(300);
  const before = await tbl(gm, t1);
  const hc = await box(page.locator('.tw.sel .hc'));
  await drag(page, mid(hc), { x: mid(hc).x + 80, y: mid(hc).y + 40 });
  let after = await tbl(gm, t1);
  R.check(after.w > before.w && after.h > before.h, 'resize', 'corner handle grows both', `${before.w.toFixed(3)}x${before.h.toFixed(3)} -> ${after.w.toFixed(3)}x${after.h.toFixed(3)}`);
  const hw = await box(page.locator('.tw.sel .hw'));
  const w2 = after.w; const h2 = after.h;
  await drag(page, mid(hw), { x: mid(hw).x + 50, y: mid(hw).y + 30 });
  after = await tbl(gm, t1);
  R.check(after.w > w2 && Math.abs(after.h - h2) < 1e-6, 'resize', 'right handle changes only width', `${w2.toFixed(3)}->${after.w.toFixed(3)} h ${h2.toFixed(3)}->${after.h.toFixed(3)}`);
  const hh = await box(page.locator('.tw.sel .hh'));
  const w3 = after.w; const h3 = after.h;
  await drag(page, mid(hh), { x: mid(hh).x + 30, y: mid(hh).y - 25 });
  after = await tbl(gm, t1);
  R.check(after.h < h3 && Math.abs(after.w - w3) < 1e-6, 'resize', 'bottom handle changes only height (shrinks)', `${h3.toFixed(3)}->${after.h.toFixed(3)}`);
  const hc2 = await box(page.locator('.tw.sel .hc'));
  await drag(page, mid(hc2), { x: mid(hc2).x - 600, y: mid(hc2).y - 400 });
  after = await tbl(gm, t1);
  R.check(after.w >= 0.1 - 1e-6 && after.h >= 0.07 - 1e-6, 'resize', 'shrinking stops at the minimum', `${after.w.toFixed(3)}x${after.h.toFixed(3)}`);
  const hc3 = await box(page.locator('.tw.sel .hc'));
  await drag(page, mid(hc3), { x: mid(hc3).x + 500, y: mid(hc3).y + 300 });
  after = await tbl(gm, t1);
  R.check(after.w <= 0.6 + 1e-6 && after.h <= 0.6 + 1e-6, 'resize', 'growing stops at the maximum', `${after.w.toFixed(3)}x${after.h.toFixed(3)}`);
  // Back to a sensible size for the rest.
  await api(gm.req, s.base, 'PATCH', `/api/tables/${t1}`, { w: 0.22, h: 0.13, x: 0.25, y: 0.3 });
  await sleep(600);

  // Move a table by dragging its body.
  const b2 = await box(page.locator('.tw').nth(1).locator('.body'));
  const m0 = await tbl(gm, t2);
  await drag(page, mid(b2), { x: mid(b2).x - 120, y: mid(b2).y + 20 });
  const m1 = await tbl(gm, t2);
  R.check(m1.x < m0.x && Math.abs(m1.w - m0.w) < 1e-6, 'move', 'dragging the body moves, size unchanged', `${m0.x.toFixed(3)}->${m1.x.toFixed(3)}`);
  await sleep(500);

  // Drag players from the tray onto seats.
  const chips = page.locator('.chip');
  R.check((await chips.count()) === 6, 'tray', 'six unseated chips', String(await chips.count()));
  const seatBox = async (ti, n) => box(page.locator('.tw').nth(ti).locator('.seat').nth(n));
  for (const [chipIdx, ti, seat] of [[0, 0, 0], [0, 0, 1], [0, 1, 0]]) {
    const c = await box(chips.nth(chipIdx));
    const sb = await seatBox(ti, seat);
    await drag(page, mid(c), mid(sb));
  }
  let st = (await night(gm)).gm.seating;
  const names = (await night(gm)).players;
  const nm = (id) => names.find((p) => p.id === id)?.displayName;
  const desc = (t) => t.assignments.map((a) => `${a.seat}:${nm(a.playerId)}`).join(',');
  R.check(st.find((t) => t.id === t1).assignments.length === 2 && st.find((t) => t.id === t2).assignments.length === 1, 'seat', 'three players seated by dragging from the tray', `${desc(st[0])} | ${desc(st[1])}`);
  await page.screenshot({ path: `${s.dir}/shots/02-seated.png` });

  // Swap: drag seat1 player (table 0) onto the table-1 occupied seat.
  const aSeat = st.find((t) => t.id === t1).assignments.find((a) => a.seat === 1).playerId;
  const bSeat = st.find((t) => t.id === t2).assignments.find((a) => a.seat === 1).playerId;
  await drag(page, mid(await seatBox(0, 0)), mid(await seatBox(1, 0)));
  st = (await night(gm)).gm.seating;
  const nowA = st.find((t) => t.id === t2).assignments.find((a) => a.seat === 1)?.playerId;
  const nowB = st.find((t) => t.id === t1).assignments.find((a) => a.seat === 1)?.playerId;
  R.check(nowA === aSeat && nowB === bSeat, 'swap', 'dropping on an occupied seat swaps the two players', `${desc(st[0])} | ${desc(st[1])}`);

  // Unseat by dropping on the tray.
  await drag(page, mid(await seatBox(0, 0)), mid(await box(page.locator('.tray'))));
  st = (await night(gm)).gm.seating;
  R.check(!st.find((t) => t.id === t1).assignments.some((a) => a.seat === 1), 'unseat', 'dropping a seated player on the tray unseats them', desc(st[0]));

  // A plain tap on a seated icon must not change anything.
  const pre = JSON.stringify(st.map((t) => t.assignments));
  const tapAt = mid(await seatBox(0, 1));
  await page.mouse.click(tapAt.x, tapAt.y); await sleep(500);
  R.check(JSON.stringify((await night(gm)).gm.seating.map((t) => t.assignments)) === pre, 'seat', 'tapping a seat changes nothing');

  // Dropping in empty space does nothing.
  await drag(page, mid(await seatBox(0, 1)), { x: 20 + (await box(page.locator('.plan'))).x, y: 10 + (await box(page.locator('.plan'))).y });
  R.check(JSON.stringify((await night(gm)).gm.seating.map((t) => t.assignments)) === pre, 'seat', 'dropping in empty space leaves the seat as is');

  // Fallback dropdowns still work.
  await page.locator('.tw').nth(0).locator('.body').click();
  await sleep(300);
  const sel = page.locator('select').first();
  await sel.selectOption({ index: 1 }).catch(() => {});
  await sleep(600);
  R.check((await night(gm)).gm.seating.find((t) => t.id === t1).assignments.some((a) => a.seat === 1), 'fallback', 'dropdown still assigns a seat');
  await page.screenshot({ path: `${s.dir}/shots/03-after.png`, fullPage: true });

  // Phone GM layout.
  const pgm = await gmLogin(b, s, R, 'phone', 'gm-phone');
  await gmRoute(pgm.page, 'seating');
  await sleep(900);
  await pgm.page.screenshot({ path: `${s.dir}/shots/04-gm-phone.png`, fullPage: true });

  // TV: rotating panel shows the full floor (dots only) and then a close-up per seated table.
  const tvctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvctx.newPage();
  R.watch(tv, 'tv');
  await tv.goto(s.base + '/display');
  const seatedNow = (await night(gm)).gm.seating.reduce((a, t) => a + t.assignments.length, 0);
  let seen = false;
  for (let i = 0; i < 90 && !seen; i++) { seen = (await tv.locator('.fp .tw').count()) > 0; if (!seen) await sleep(1000); }
  R.check(seen, 'tv', 'TV rotation shows the full floor plan');
  if (seen) {
    await sleep(300);
    R.check((await tv.locator('.fp .seat').count()) === 10, 'tv', 'floor draws every seat (4+6)', String(await tv.locator('.fp .seat').count()));
    R.check((await tv.locator('.fp .seat.dot').count()) === seatedNow, 'tv', 'floor: filled dots = seated players', `${await tv.locator('.fp .seat.dot').count()} vs ${seatedNow}`);
    R.check((await tv.locator('.fp .lbl, .fp .av, .fp img, .fp .num').count()) === 0, 'tv', 'floor: no names, avatars or seat numbers');
    R.check((await tv.locator('.fp .hd').count()) === 0 && (await tv.locator('.fp .tray').count()) === 0, 'tv', 'TV has no handles or tray');
    await tv.screenshot({ path: `${s.dir}/shots/05-tv-floor.png` });
  }
  let close = false;
  for (let i = 0; i < 30 && !close; i++) { close = (await tv.locator('.tv-table').count()) > 0; if (!close) await sleep(500); }
  R.check(close, 'tv', 'TV rotation shows a single-table close-up after the floor');
  if (close) {
    await sleep(300);
    const lbls = await tv.locator('.tv-table .lbl').allTextContents();
    R.check(lbls.length > 0 && lbls.every((x) => x.trim().length > 0), 'tv', 'close-up shows player names', lbls.join(','));
    const fsz = await tv.locator('.tv-table .lbl').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    R.check(fsz >= 20, 'tv', 'close-up names are readable size (>=20px at 1080p)', `${fsz}px`);
    await tv.screenshot({ path: `${s.dir}/shots/06-tv-table.png` });
  }
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
