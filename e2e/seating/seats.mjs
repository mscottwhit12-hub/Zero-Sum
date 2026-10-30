// Moving an empty seat around its table: GM Seating tab (drag), saved on the server, mirrored on the TV, reset.
// Needs `npm run build -w packages/client` first.
import { api, browser, gmRoute, gmSetup, makeRound, newNight, phone, sleep, startServer } from '../rounds/lib.mjs';

const R = makeRound('seat-move');
const s = await startServer('seat-move', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
const tbl = async (gm, id) => (await night(gm)).gm.seating.find((t) => t.id === id);
const mid = (bb) => ({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
async function drag(page, from, to, steps = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await sleep(900);
}
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  const ids = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN']]) ids.push((await phone(b, s, R, n, t)).id);
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const t1 = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'Catan', seats: 4, x: 0.3, y: 0.4 })).body.id;
  const page = gm.page;
  await gmRoute(page, 'seating');
  await sleep(1000);
  R.check((await tbl(gm, t1)).seatPos === null, 'default', 'a new table has evenly spaced seats (no stored positions)');

  const seats = () => page.locator('.tw .seat.empty');
  const table = async () => await page.locator('.tw').first().boundingBox();
  const seat1 = async () => await page.locator('.tw .seat', { hasText: /^1$/ }).first().boundingBox();

  // 1) drag empty seat 1 (top-left area) to below the table, far to the right
  const tb = await table();
  const before = await seat1();
  const target = { x: tb.x + tb.width * 0.8, y: tb.y + tb.height + 70 };
  await drag(page, mid(before), target);
  const t = await tbl(gm, t1);
  R.check(Array.isArray(t.seatPos) && t.seatPos.length === 4, 'saved', 'dragging an empty seat saves positions for all 4 seats', JSON.stringify(t.seatPos));
  const after = await seat1();
  R.check(Math.abs(mid(after).x - mid(before).x) > 40, 'moved', 'seat 1 is drawn somewhere new', `${Math.round(mid(before).x)} -> ${Math.round(mid(after).x)}`);
  // it stays around the table: the centre is within one seat + margin of the table's box edge
  const tb2 = await table();
  const c = mid(after);
  const near = c.x >= tb2.x - 60 && c.x <= tb2.x + tb2.width + 60 && c.y >= tb2.y - 60 && c.y <= tb2.y + tb2.height + 60;
  R.check(near, 'around', 'the moved seat sits next to the table, not out on the floor', JSON.stringify({ c, tb2 }));
  // on the bottom edge (fraction 0.5..0.75 of the loop; this table is wider than tall)
  R.check(t.seatPos[0] > 0.45 && t.seatPos[0] < 0.75, 'edge', 'dragged below the table: seat 1 is on the bottom edge', String(t.seatPos[0]));
  await page.screenshot({ path: `${s.dir}/shots/01-moved.png` });

  // 2) drop onto another seat: it never ends up on top of it
  const seat2 = await page.locator('.tw .seat', { hasText: /^2$/ }).first().boundingBox();
  await drag(page, mid(await seat1()), mid(seat2));
  const t2 = await tbl(gm, t1);
  const pos = [...t2.seatPos].sort((a, b2) => a - b2);
  const gaps = pos.map((v, i) => (i ? v - pos[i - 1] : v + 1 - pos[pos.length - 1]));
  R.check(Math.min(...gaps) > 0.03, 'overlap', 'dropping on another seat keeps the seats apart', JSON.stringify(t2.seatPos));

  // 3) seated players keep dragging as before: a seated seat is not movable, the player is
  await api(gm.req, s.base, 'POST', `/api/tables/${t1}/seat`, { seat: 3, playerId: ids[0] });
  await sleep(800);
  const posBefore = JSON.stringify((await tbl(gm, t1)).seatPos);
  const who = await page.locator('.tw .seat .who').first().boundingBox();
  await drag(page, mid(who), { x: mid(who).x + 5, y: mid(who).y + 90 }); // dropped on empty floor: nothing changes
  const st = await tbl(gm, t1);
  R.check(JSON.stringify(st.seatPos) === posBefore, 'occupied', 'dragging a seated player does not move the seat', JSON.stringify(st.seatPos));
  R.check(st.assignments.length === 1 && st.assignments[0].seat === 3, 'occupied', 'the player is still in seat 3');

  // 4) TV mirrors the layout: wait for the rotating panel to reach the floor plan, then compare against the GM plan
  const tvCtx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  await tv.goto(s.base + '/display');
  const gotFloor = await tv.locator('.fp .seat').first().waitFor({ timeout: 90000 }).then(() => true, () => false);
  R.check(gotFloor, 'tv', 'the TV reaches the floor plan and draws seats');
  if (gotFloor) {
    const fp = await tv.locator('.fp .plan .tw').first().boundingBox();
    const sb = await tv.locator('.fp .plan .tw .seat').all();
    const ys = [];
    for (const x of sb) ys.push(mid(await x.boundingBox()).y);
    // seat 1 was moved to the bottom edge, so at least one seat now sits below the table's lower edge
    R.check(ys.some((y) => y > fp.y + fp.height), 'tv', 'a seat moved to the bottom edge shows below the table on the TV', JSON.stringify({ ys: ys.map(Math.round), bottom: Math.round(fp.y + fp.height) }));
    await tv.screenshot({ path: `${s.dir}/shots/02-tv.png` });
  }

  // 5) changing the seat count goes back to even spacing; reset button works
  await page.locator('.tw').first().locator('.body').click();
  await sleep(400);
  R.check((await page.getByRole('button', { name: 'Even out seats' }).count()) === 1, 'reset', 'a moved table offers "Even out seats"');
  await page.getByRole('button', { name: 'Even out seats' }).click();
  await sleep(900);
  R.check((await tbl(gm, t1)).seatPos === null, 'reset', 'Even out seats goes back to even spacing');
  R.check((await page.getByRole('button', { name: 'Even out seats' }).count()) === 0, 'reset', 'the button disappears once seats are even');

} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
