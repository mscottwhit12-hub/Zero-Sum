// Nov 3 QoL: rename a sound after upload (soundboard button follows), music over 30 MB uploads from the Soundboard screen, a button that big is refused.
import { api, browser, gmSetup, makeRound, newNight, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('sounds3');
const s = await startServer('sounds3', { scale: 1 });
const b = await browser();
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s);
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const WAV = (mb) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(Math.round(mb * 1024 * 1024))]);
  const wavData = `data:audio/wav;base64,${WAV(0.001).toString('base64')}`;
  await api(gm.req, s.base, 'POST', '/api/sounds', { name: 'Airhorn', kind: 'soundboard', data: wavData });
  const page = gm.page;
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.reload(); await sleep(1500);
  await page.locator('nav.side button', { hasText: 'Soundboard' }).click(); await sleep(1200);
  await page.screenshot({ path: `${s.dir}/shots/01-sounds.png`, fullPage: true });

  // rename
  const nameIn = page.locator('input.namein').first();
  R.check((await nameIn.inputValue()) === 'Airhorn', 'rename', 'the library shows an editable name');
  await nameIn.fill('Big Airhorn'); await nameIn.blur(); await sleep(1500);
  const list = (await api(gm.req, s.base, 'GET', '/api/sounds')).body.sounds;
  R.check(list.some((x) => x.name === 'Big Airhorn'), 'rename', 'the new name is saved on the server', JSON.stringify(list.map((x) => x.name)));
  R.check((await page.locator('button.big', { hasText: 'Big Airhorn' }).count()) >= 1, 'rename', 'the soundboard button shows the new name');
  await nameIn.fill('   '); await nameIn.blur(); await sleep(800);
  R.check((await nameIn.inputValue()) === 'Big Airhorn', 'rename', 'an empty name puts the old one back');
  await page.screenshot({ path: `${s.dir}/shots/02-renamed.png`, fullPage: true });

  // 40 MB music via the upload form
  const up = async (name, kind, mb) => {
    const form = page.locator('form', { hasText: 'Upload a sound' });
    await form.locator('input[type=file]').setInputFiles({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: WAV(mb) });
    await form.locator('select').first().selectOption(kind);
    await form.locator('label', { hasText: 'Name' }).locator('input').fill(name);
    if (kind === 'ambient') await form.locator('label', { hasText: 'Tags' }).locator('input').fill('lobby');
    await form.getByRole('button', { name: /upload/i }).last().click();
    await sleep(3500);
  };
  await up('Long mix', 'ambient', 40);
  const after = (await api(gm.req, s.base, 'GET', '/api/sounds')).body.sounds;
  R.check(after.some((x) => x.name === 'Long mix' && x.kind === 'ambient'), 'music', 'a 40 MB music file uploads from the screen (over the old 30 MB limit)', JSON.stringify(after.map((x) => x.name)));
  await page.screenshot({ path: `${s.dir}/shots/03-music.png`, fullPage: true });
  await up('Big boom', 'soundboard', 40);
  const after2 = (await api(gm.req, s.base, 'GET', '/api/sounds')).body.sounds;
  R.check(!after2.some((x) => x.name === 'Big boom'), 'limit', 'a 40 MB soundboard button is refused');
  R.check(errs.length === 0, 'client', 'no page errors', errs.join(' | ').slice(0, 200));
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close(); R.report(s); await s.stop();
}
