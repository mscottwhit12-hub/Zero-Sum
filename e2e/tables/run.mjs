/**
 * Tables, props, colours, turning, and the layout audit (nothing crosses, overlaps or gets cut off).
 *   NODE_PATH=$(npm root -g) node e2e/tables/run.mjs     (or: npm run check -- --e2e tables)
 */
import { layoutProblems } from '../lib/audit.mjs';
import { gmRoute } from '../rounds/lib.mjs';
import { testNight } from '../lib/night.mjs';

const T = await testNight('tables', {
  players: 8,
  tables: [
    { name: 'Main', seats: 4, w: 0.3, h: 0.18, x: 0.2, y: 0.36, seat: [0, 1, 2, 3] },
    { name: 'Side', seats: 4, x: 0.55, y: 0.3, rotation: 45, color: '#e8e4dc' },
    { name: 'Poker Night', seats: 8, x: 0.47, y: 0.8, rotation: 15, color: '#7a4a24', seat: [4, 5, 6, 7], props: [{ kind: 'chips', x: -0.2, y: 0 }, { kind: 'cards', x: 0.15, y: 0.1 }, { kind: 'beer-can', x: 0.3, y: -0.2 }] },
    { name: 'Corner', seats: 4, x: 0.8, y: 0.72, rotation: 135, color: '#c9a46a', props: [{ kind: 'board-monopoly' }] },
  ],
  game: { game: 'Catan', table: 0, players: [0, 1, 2, 3] },
});
const { R, call, sleep } = T;
const page = T.gm.page;
const rotOf = (sel) => page.locator(sel).first().evaluate((el) => +(/rotate\((-?[\d.]+)deg\)/.exec(el.getAttribute('style') ?? '')?.[1] ?? 0));
const audit = async (p, where) => {
  const bad = await layoutProblems(p);
  R.check(bad.length === 0, 'layout', `${where}: nothing crosses, overlaps or is cut off`, bad.join(' | '));
};
const knobDrag = async (knob, center, deg) => {
  const k = await knob.boundingBox();
  const kx = k.x + k.width / 2, ky = k.y + k.height / 2;
  const a0 = Math.atan2(ky - center.y, kx - center.x), rr = Math.hypot(kx - center.x, ky - center.y);
  await page.mouse.move(kx, ky);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    const a = a0 + ((deg * Math.PI) / 180) * (i / 10);
    await page.mouse.move(center.x + rr * Math.cos(a), center.y + rr * Math.sin(a));
    await sleep(30);
  }
  await page.mouse.up();
  await sleep(1200);
};
const centre = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

try {
  // ── GM Seating: what was set up is drawn ─────────────────────────
  await T.gmAt('seating', [1280, 900]);
  await page.evaluate(() => document.querySelector('.fp')?.scrollIntoView({ block: 'center' }));
  R.check((await page.locator('.tw', { hasText: 'Main' }).locator('.prop').count()) === 1, 'props', 'Catan board placed on Main when the game started');
  R.check((await page.locator('.fp .prop').count()) === 5, 'props', 'all props drawn (1 board + 3 + 1)');
  R.check(await page.locator('.tw', { hasText: 'Side' }).locator('.body').evaluate((el) => getComputedStyle(el).backgroundColor === 'rgb(232, 228, 220)'), 'colour', 'Side drawn in its colour');
  const flat = await page.locator('.fp .lb strong, .fp .plbl strong').evaluateAll((els) => els.length > 0 && els.every((e) => { const r = e.getBoundingClientRect(); return r.width > r.height; }));
  R.check(flat, 'labels', 'every table label reads left to right');
  await audit(page, 'GM 1280');
  await T.shot(page, '01-gm-1280');

  // ── Props palette: add, no bottle, handles ───────────────────────
  await page.locator('.tw', { hasText: 'Side' }).locator('.body').click({ force: true });
  await sleep(600);
  R.check((await page.getByRole('button', { name: 'Add Bottle' }).count()) === 0, 'props', 'no bottle in the palette');
  for (const label of ['Joint', 'Pair of dice']) {
    await page.getByRole('button', { name: `Add ${label}` }).click();
    await sleep(700);
  }
  R.check((await page.locator('.tw', { hasText: 'Side' }).locator('.prop').count()) === 2, 'props', 'two props added from the palette');
  R.check((await page.locator('.tw.sel .hd').count()) === 0, 'props', 'resize handles hidden on a table with props');

  // ── Drag, resize and turn a prop (the chips on Poker Night, clear of the others) ──
  await page.evaluate(() => document.querySelector('.fp')?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await page.locator('.tw', { hasText: 'Poker Night' }).locator('.prop').first().click({ force: true });
  await sleep(600);
  const sel = page.locator('.fp .prop.psel');
  const b0 = await sel.boundingBox();
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await page.mouse.down();
  await page.mouse.move(b0.x + b0.width / 2 - 12, b0.y + b0.height / 2 + 12, { steps: 6 });
  await page.mouse.up();
  await sleep(900);
  const b1 = await page.locator('.fp .prop.psel').boundingBox();
  R.check(Math.hypot(b1.x - b0.x, b1.y - b0.y) > 8, 'props', 'prop dragged', JSON.stringify([b0, b1]));
  const h = await page.locator('.fp .prop.psel .phd').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 20, h.y + 20, { steps: 6 });
  await page.mouse.up();
  await sleep(900);
  const b2 = await page.locator('.fp .prop.psel').boundingBox();
  R.check(b2.width > b1.width * 1.1, 'props', 'prop resized with its corner handle', `${b1.width} → ${b2.width}`);
  await knobDrag(page.locator('.fp .prop.psel .prh'), await centre(page.locator('.fp .prop.psel')), 31);
  R.check((await rotOf('.fp .prop.psel')) === 30, 'turn', 'prop turned to 30° by its knob (15° steps)', String(await rotOf('.fp .prop.psel')));

  // ── Turn a table by its knob; buttons still work ─────────────────
  await page.locator('.tw', { hasText: 'Main' }).locator('.body').click({ force: true });
  await sleep(600);
  R.check((await page.locator('.trh').count()) === 1, 'turn', 'selected table shows its turn knob');
  await knobDrag(page.locator('.trh'), await centre(page.locator('.tw', { hasText: 'Main' })), 92);
  R.check((await rotOf('.tw.sel')) === 90, 'turn', 'table turned to 90° by its knob', String(await rotOf('.tw.sel')));
  await page.getByRole('button', { name: 'Turn left 15°' }).first().click();
  await sleep(900);
  R.check((await rotOf('.tw.sel')) === 75, 'turn', '⟲ button still turns 15°', String(await rotOf('.tw.sel')));

  // ── Colour by swatch ─────────────────────────────────────────────
  await page.getByRole('button', { name: 'Red felt' }).click();
  await sleep(900);
  R.check(await page.locator('.tw.sel .body').evaluate((el) => getComputedStyle(el).backgroundColor === 'rgb(140, 29, 42)'), 'colour', 'Red felt swatch paints the table');
  await page.getByRole('button', { name: 'Theme colour' }).click();
  await sleep(900);
  R.check(await page.locator('.tw.sel .body').evaluate((el) => !el.getAttribute('style')?.includes('background:')), 'colour', '✕ puts the theme colour back');
  await audit(page, 'GM 1280 after edits');

  // ── Other widths ─────────────────────────────────────────────────
  await T.gmAt('seating', [1920, 1080]);
  await audit(page, 'GM 1920');
  const ph = await T.gmPhone();
  await ph.page.reload();
  await sleep(800);
  await gmRoute(ph.page, 'seating');
  await sleep(1000);
  const sw = await ph.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  R.check(sw, 'layout', 'GM phone: Seating never scrolls sideways');
  await T.shot(ph.page, '02-gm-phone');

  // ── GM board view ────────────────────────────────────────────────
  await T.gmAt('seating', [1280, 900]);
  await page.locator('nav.side button.board', { hasText: 'Catan' }).click();
  await sleep(1500);
  R.check((await page.locator('.board-table .prop').count()) === 1, 'props', 'board view shows the Catan board on its table');

  // ── TV floor + close-ups ─────────────────────────────────────────
  for (const [w, hh] of [[1920, 1080], [1280, 720]]) {
    const tv = await T.tv(w, hh);
    let floor = false;
    const closes = new Set();
    for (let i = 0; i < 120 && (!floor || closes.size < 2); i++) {
      await sleep(1000);
      if (!floor && (await tv.locator('.fp .tw').count()) >= 4) {
        await sleep(900);
        floor = true;
        R.check((await tv.locator('.fp .prop').count()) >= 7, 'tv', `TV ${w}: floor plan shows the props`);
        await audit(tv, `TV ${w} floor`);
        await T.shot(tv, `03-tv-${w}-floor`);
      }
      const nm = (await tv.locator('.tv-table .tbl strong').count()) ? await tv.locator('.tv-table .tbl strong').first().textContent() : null;
      if (nm && !closes.has(nm) && closes.size < 2) {
        await sleep(900);
        closes.add(nm);
        await audit(tv, `TV ${w} close-up ${nm}`);
        await T.shot(tv, `04-tv-${w}-close-${closes.size}`);
      }
    }
    R.check(floor && closes.size > 0, 'tv', `TV ${w}: floor plan and a close-up came round`);
    await tv.context().close();
  }

  // ── The result takes the automatic board away; hand-placed stay ──
  const P = T.players;
  await call('POST', `/api/games/${T.game.id}/result`, { actualHours: 1, participants: [0, 1, 2, 3].map((i, k) => ({ playerId: P[i].id, placement: k + 1 })) });
  await T.gmAt('seating');
  R.check((await page.locator('.fp .prop').count()) === 6, 'props', 'auto board gone after the result; the 6 hand-placed props stay');
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await T.done();
}
