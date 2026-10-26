const { chromium } = require('playwright');
const { execSync } = require('child_process');
const BASE = 'http://localhost:18080';
const SHOTS = '/tmp/claude-0/shots';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const browser = await chromium.launch();
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const gm = await laptop.newPage();
  const errors = [];
  gm.on('pageerror', (e) => errors.push('gm: ' + e.message));
  gm.on('console', (m) => m.type() === 'error' && errors.push('gm console: ' + m.text()));

  // First run
  await gm.goto(BASE + '/gm');
  await gm.getByText('First-run setup').waitFor();
  await gm.screenshot({ path: `${SHOTS}/01-first-run.png` });
  await gm.getByLabel('GM name').fill('Boss');
  await gm.getByLabel('Password (8+ characters)').fill('correct horse');
  await gm.getByLabel('Confirm password').fill('correct horse');
  await gm.getByLabel('Unlock PIN (4–8 digits)').fill('1234');
  await gm.getByRole('button', { name: 'Laptop' }).click();
  await gm.getByRole('button', { name: 'Create Master GM' }).click();
  await gm.getByText('No night yet').waitFor();
  log('setup ok');

  // Night
  await gm.getByRole('button', { name: 'Create night' }).click();
  await gm.getByRole('button', { name: 'Open joins' }).waitFor();
  await gm.getByRole('button', { name: 'Open joins' }).click();
  await gm.getByRole('button', { name: 'Start night' }).waitFor();
  execSync('DATA_DIR=/tmp/claude-0/gn-e2e npx tsx packages/server/src/scripts/seed-demo-players.ts 8', { cwd: '/home/claude/game-night', stdio: 'pipe' });
  await gm.reload();
  await gm.getByText('8 players').waitFor();
  await gm.getByRole('button', { name: 'Start night' }).click();
  await gm.getByText('Market open').first().waitFor();
  log('night live');

  // Schedule 3 games from the library
  await gm.goto(BASE + '/gm#/games');
  const schedule = async (label, players, time) => {
    await gm.locator('select').first().selectOption({ label });
    if (time) await gm.locator('input[type=time]').fill(time);
    for (const p of players) await gm.getByRole('button', { name: p, exact: true }).click();
    await gm.getByRole('button', { name: 'Schedule', exact: true }).click();
    await gm.waitForTimeout(400);
  };
  await schedule('Example: Trick-Taking Card Game', ['Avery', 'Blake', 'Casey', 'Devon'], '20:00');
  await schedule('Example: Push-Your-Luck Dice Game', ['Emery', 'Finley', 'Gray'], '20:05');
  await schedule('Example: Co-op Puzzle Game', ['Harper', 'Avery', 'Emery'], '21:30');
  await gm.screenshot({ path: `${SHOTS}/03-games-schedule.png`, fullPage: true });
  log('scheduled');

  // Start two games from the dashboard; tap leaders
  await gm.goto(BASE + '/gm#/dashboard');
  let tt = Date.now();
  await gm.getByRole('button', { name: 'Start', exact: true }).first().click();
  log('start#1 click took', Date.now() - tt); tt = Date.now();
  await gm.waitForTimeout(300);
  await gm.getByRole('button', { name: 'Start', exact: true }).first().click();
  log('start#2 click took', Date.now() - tt); tt = Date.now();
  await gm.waitForTimeout(500);
  tt = Date.now();
  await gm.locator('.panel', { hasText: 'Tap the current leader' }).first().getByRole('button', { name: 'Blake' }).click();
  log('tap#1 took', Date.now() - tt); tt = Date.now();
  await gm.waitForTimeout(300);
  await gm.locator('.panel', { hasText: 'Tap the current leader' }).nth(1).getByRole('button', { name: 'Finley' }).click();
  log('tap#2 took', Date.now() - tt);
  await gm.waitForTimeout(500);
  await gm.screenshot({ path: `${SHOTS}/02-dashboard-laptop.png`, fullPage: true });
  log('games started, crowns tapped');

  // TV
  const tvCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const tv = await tvCtx.newPage();
  tv.on('pageerror', (e) => errors.push('tv: ' + e.message));
  await tv.goto(BASE + '/display');
  await tv.getByText('Now playing').waitFor();
  await tv.waitForTimeout(500);
  await tv.screenshot({ path: `${SHOTS}/06-tv-before.png` });

  // Result wizard for the first active game
  await gm.getByRole('button', { name: 'Enter result' }).first().click();
  await gm.getByText('Step 1 of 3').waitFor();
  await gm.screenshot({ path: `${SHOTS}/04a-wizard-step1.png` });
  await gm.getByRole('button', { name: 'Next', exact: true }).click();
  for (const p of ['Blake', 'Avery', 'Devon', 'Casey']) await gm.locator('.sheet').getByRole('button', { name: new RegExp(`^${p}$`) }).click();
  await gm.screenshot({ path: `${SHOTS}/04b-wizard-step2.png` });
  await gm.getByRole('button', { name: 'Next', exact: true }).click();
  await gm.locator('.sheet input[type=number]').fill('1');
  await gm.screenshot({ path: `${SHOTS}/04c-wizard-step3.png` });
  const t0 = Date.now();
  await gm.getByRole('button', { name: 'Submit result' }).click();
  await tv.getByText(/reports a strong quarter/).first().waitFor({ timeout: 3000 });
  const visibleMs = Date.now() - t0;
  log(`result visible on TV after ${visibleMs} ms (click → TV render)`);
  await tv.waitForTimeout(300);
  await tv.screenshot({ path: `${SHOTS}/07-tv-after-result.png` });

  // Other screens
  for (const [route, file] of [['players', '05-players'], ['library', '08-library'], ['settings', '09-settings'], ['devices', '10-devices'], ['audit', '11-audit']]) {
    await gm.goto(`${BASE}/gm#/${route}`);
    await gm.waitForTimeout(600);
    await gm.screenshot({ path: `${SHOTS}/${file}.png`, fullPage: route !== 'settings' });
  }

  // Phone layout (second GM session) + remote pause of the laptop
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', (e) => errors.push('phone: ' + e.message));
  await phone.goto(BASE + '/gm');
  await phone.getByLabel('GM name').fill('Boss');
  await phone.getByLabel('Password').fill('correct horse');
  await phone.getByRole('button', { name: 'Phone' }).click();
  await phone.getByRole('button', { name: 'Sign in' }).click();
  await phone.getByText('Active games').waitFor();
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: `${SHOTS}/12-dashboard-phone.png`, fullPage: true });
  await phone.getByRole('button', { name: 'More' }).click();
  await phone.getByRole('button', { name: 'Devices & GMs' }).click();
  await phone.getByRole('button', { name: 'Pause device' }).first().click();
  await gm.getByText('Device paused').waitFor({ timeout: 3000 });
  await gm.screenshot({ path: `${SHOTS}/13-laptop-paused.png` });
  await gm.getByPlaceholder('PIN').fill('1234');
  await gm.getByRole('button', { name: 'Unlock' }).click();
  await gm.getByText('Dashboard').first().waitFor();
  log('remote pause + PIN unlock ok');

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => {
  console.error('E2E FAILED', e);
  process.exit(1);
});
