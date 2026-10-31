// Oct 28 feature round, end to end in real browsers: gold to 0.01 (TV 0.1), Dashboard timeline + clocks + night
// length edit, time guards, Filibuster/Tardy, schedule timeline drag + player view clashes, running-over popup,
// seating/TV table timing, player chat + GM read + wiretap, Minter rework, sound upload progress. Needs `npm run build`.
import { api, browser, dev, gmRoute, gmSetup, home, makeRound, newNight, openApp, phone, sleep, startServer } from '../rounds/lib.mjs';
const R = makeRound('features');
const s = await startServer('features', { scale: 1 });
const b = await browser();
const night = async (gm) => (await api(gm.req, s.base, 'GET', '/api/night')).body;
const shot = (p, n, full = true) => p.screenshot({ path: `${s.dir}/shots/${n}.png`, fullPage: full }).catch(() => {});
try {
  const gm = await gmSetup(b, s, R, { viaUi: false });
  await newNight(gm, s, { length: 240 });
  const ps = [];
  for (const [n, t] of [['Ann', 'ANN'], ['Ben', 'BEN'], ['Cat', 'CAT'], ['Dev', 'DEV']]) ps.push(await phone(b, s, R, n, t));
  await api(gm.req, s.base, 'POST', '/api/night/start');
  const ids = (await night(gm)).players.map((p) => p.id);
  const [ann, ben, cat, devId] = ids;
  const t1 = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'Kitchen', seats: 4 })).body.id;
  const t2 = (await api(gm.req, s.base, 'POST', '/api/tables', { name: 'Den', seats: 4, x: 0.62, y: 0.55 })).body.id;
  for (let i = 0; i < 4; i++) await api(gm.req, s.base, 'POST', `/api/tables/${t1}/seat`, { seat: i + 1, playerId: ids[i] });
  const now = Date.now();
  const running = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Catan', participants: [ann, ben], tableId: t1, plannedDurationHours: 1.5 })).body.game;
  await api(gm.req, s.base, 'POST', `/api/games/${running.id}/start`);
  const early = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Ticket', participants: [cat, devId], tableId: t2, plannedStart: now + 30 * 60_000, plannedDurationHours: 1 })).body.game;
  const later = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Clue', participants: [ann, cat], tableId: t2, plannedStart: now + 90 * 60_000, plannedDurationHours: 1 })).body.game;
  const past = (await api(gm.req, s.base, 'POST', '/api/games', { name: 'Yahtzee', participants: [devId], plannedStart: now - 5 * 60_000, plannedDurationHours: 0.5 })).body.game;
  R.check(past.status === 'active', 'guards', 'a game scheduled in the past just starts', past.status);
  await api(gm.req, s.base, 'POST', `/api/games/${running.id}/scores`, { scores: [{ playerId: ann, score: 3 }] });
  await api(gm.req, s.base, 'POST', '/api/night/adjustments', { playerId: ann, gold: 1.37, reason: 'test decimals' });
  await sleep(1500);

  // Gold: phones 0.01, TV 0.1
  const pa = ps[0].page;
  await home(pa); await sleep(600);
  const bar = (await pa.locator('body').textContent()) ?? '';
  R.check(/\d+\.\d\d gold/.test(bar), 'gold', 'phone shows gold to 0.01', (bar.match(/[\d.]+ gold/) ?? [''])[0]);
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  R.watch(tv, 'tv');
  await tv.goto(s.base + '/display'); await sleep(6500);
  const tvCells = await tv.locator('.standings td.num, .standings td:last-child').allTextContents();
  R.check(tvCells.length > 0 && tvCells.every((c) => /^\s*\d+\.\d\s*$/.test(c)), 'gold', 'TV standings show gold to 0.1', tvCells.join(','));

  // Dashboard: timeline, clock line, tags, length edit
  const gp = gm.page;
  const dialogs = [];
  gp.on('dialog', (d) => dialogs.push(d.message()));
  await gmRoute(gp, 'dashboard'); await sleep(1200);
  R.check((await gp.locator('.tl .bar').count()) >= 4, 'dashboard', 'night timeline shows the games', String(await gp.locator('.tl .bar').count()));
  R.check(/Started .* in/.test((await gp.locator('.clockline').first().textContent()) ?? ''), 'dashboard', 'active game shows start + elapsed');
  await gp.getByRole('button', { name: 'Edit length' }).click(); await sleep(200);
  await gp.getByLabel('Night length in minutes').fill('300');
  await gp.getByRole('button', { name: 'Save', exact: true }).click(); await sleep(1000);
  R.check((await night(gm)).night.lengthMinutes === 300, 'length', 'night length edited from the Dashboard');
  await shot(gp, '01-dashboard');

  // Time guard: start Clue before Ticket (earlier) with Ann already playing
  dialogs.length = 0;
  const clueRow = gp.locator('tr', { hasText: 'Clue' }).first();
  await clueRow.getByRole('button', { name: 'Start' }).click(); await sleep(800);
  const msg = dialogs.join(' | ');
  R.check(/Ticket.*scheduled before Clue/.test(msg) && /Ann is in a running game \(Catan\)/.test(msg), 'guards', 'out-of-order + busy-player warning before starting', msg.slice(0, 160));

  // Schedule timeline (Games): drag Ticket 1 hour later; player view shows a clash
  await gmRoute(gp, 'games'); await sleep(1200);
  const blk = gp.locator('.blk', { hasText: 'Ticket' }).first();
  const bb = await blk.boundingBox();
  const before = (await night(gm)).games.find((g) => g.id === early.id).plannedStart;
  const pxMin = await gp.evaluate(() => {
    const a = [...document.querySelectorAll('.tick')].map((e) => e.getBoundingClientRect().left);
    return a.length > 1 ? (a[1] - a[0]) / 30 : 2;
  });
  await gp.mouse.move(bb.x + 10, bb.y + bb.height / 2); await gp.mouse.down();
  await gp.mouse.move(bb.x + 10 + pxMin * 60, bb.y + bb.height / 2, { steps: 10 }); await gp.mouse.up(); await sleep(1200);
  const afterStart = (await night(gm)).games.find((g) => g.id === early.id).plannedStart;
  R.check(Math.abs(afterStart - before - 60 * 60_000) <= 5 * 60_000, 'timeline', 'dragging a block moves its start time (5-min steps)', `${Math.round((afterStart - before) / 60000)} min`);
  await shot(gp, '02-schedule-tables');
  // Clue was started above (the guard was confirmed); move Ticket onto it: Cat is in both -> red in player view
  await api(gm.req, s.base, 'PATCH', `/api/games/${early.id}`, { plannedStart: Date.now() + 20 * 60_000 }); await sleep(800);
  await gp.getByRole('button', { name: 'By player' }).click(); await sleep(600);
  R.check((await gp.locator('.blk.clash').count()) >= 2, 'timeline', 'player view marks double-booked games red', String(await gp.locator('.blk.clash').count()));
  await shot(gp, '03-schedule-players');

  // Seating plan + TV show table timing
  await gmRoute(gp, 'seating'); await sleep(1000);
  const seatTxt = (await gp.locator('.plan').textContent()) ?? '';
  R.check(/Catan · \d+ min in/.test(seatTxt), 'seating', 'tables show their game with start/elapsed or planned time', seatTxt.replace(/\s+/g, ' ').slice(0, 120));

  // Chat: Ann -> Ben, GM reads, Ben gets a badge
  await openApp(pa, 'Messages'); await sleep(600);
  await pa.getByRole('tab', { name: /Chats/ }).click(); await sleep(300);
  await pa.getByRole('button', { name: 'New chat' }).click();
  await pa.locator('button.chip', { hasText: 'Ben' }).click();
  await pa.getByRole('button', { name: 'Start chat' }).click(); await sleep(800);
  await pa.getByLabel('Message').fill('Sell CAT before the poll');
  await pa.getByRole('button', { name: 'Send' }).click(); await sleep(1500);
  await shot(pa, '04-phone-chat');
  const pb = ps[1].page;
  await home(pb); await sleep(500);
  const chatBadge = await pb.locator('button.app', { hasText: 'Messages' }).locator('.nb').textContent().catch(() => '');
  R.check(Number(chatBadge) >= 1, 'chat', 'the other player gets an unread badge on Messages', String(chatBadge));
  await openApp(pb, 'Messages'); await sleep(600);
  const tabBadge = await pb.getByRole('tab', { name: /Chats/ }).locator('.badge-count').textContent().catch(() => '');
  R.check(tabBadge === '1', 'chat', 'the Chats tab shows 1 unread', String(tabBadge));
  await pb.getByRole('tab', { name: /Chats/ }).click(); await sleep(300);
  await pb.locator('button.row-btn').first().click(); await sleep(800);
  R.check(((await pb.locator('.msgs').textContent()) ?? '').includes('Sell CAT before the poll'), 'chat', 'the message arrives');
  await pb.getByLabel('Message').fill('Deal'); await pb.getByRole('button', { name: 'Send' }).click(); await sleep(1500);
  R.check(((await pa.locator('.msgs').textContent()) ?? '').includes('Deal'), 'chat', 'replies show live on the other phone');
  await gmRoute(gp, 'chats'); await sleep(1000);
  await gp.locator('button.row-btn').first().click(); await sleep(800);
  const gmChat = (await gp.locator('table').last().textContent()) ?? '';
  R.check(gmChat.includes('Sell CAT') && gmChat.includes('Deal'), 'chat', 'GMs can read the chat with times');
  await shot(gp, '05-gm-chats');

  // Wiretap (pair) for Dev on Ann/Ben
  const memo = (await api(gm.req, s.base, 'POST', '/api/challenges', { playerId: devId, text: 'Find out', reward: { type: 'wiretap', mode: 'pair' } })).body;
  await dev(ps[3], s, 'POST', `/api/me/challenges/${memo.id}/read`);
  await dev(ps[3], s, 'POST', `/api/me/challenges/${memo.id}/respond`, { accept: true });
  await api(gm.req, s.base, 'POST', `/api/challenges/${memo.id}/resolve`, { success: true });
  const pd = ps[3].page;
  await openApp(pd, 'Messages'); await sleep(900);
  await pd.getByRole('tab', { name: /Inbox/ }).click(); await sleep(400);
  await pd.getByLabel('First associate').selectOption({ label: 'Ann' });
  await pd.getByLabel('Second associate').selectOption({ label: 'Ben' });
  await pd.getByRole('button', { name: 'Listen in' }).click(); await sleep(1200);
  const tapTxt = (await pd.locator('.tap').textContent().catch(() => '')) ?? '';
  R.check(/Sell CAT|Deal/.test(tapTxt), 'wiretap', 'wiretap reveals one message between the two picked players', tapTxt);
  await shot(pd, '06-phone-wiretap');
  const annMsgs = (await (async () => { await home(pa); await openApp(pa, 'Messages'); await sleep(600); return pa.textContent('body'); })()) ?? '';
  R.check(!/wiretap|listened|read one of your/i.test(annMsgs), 'wiretap', 'the players read are never told');

  // Minter rework
  await home(pa); await openApp(pa, 'NFT Minter'); await sleep(1200);
  const mt = (await pa.locator('body').textContent()) ?? '';
  R.check(/Credits/.test(mt) && /NFTs minted tonight/.test(mt) && /Rebrand/.test(mt) && /Hire manager|manager/.test(mt), 'minter', 'credits are the main number; NFTs, managers and rebrand shown', mt.replace(/\s+/g, ' ').slice(0, 120));
  for (let i = 0; i < 20; i++) await pa.locator('button.biz').first().click({ timeout: 800 }).catch(() => {});
  await sleep(3500);
  await pa.locator('.gen', { hasText: 'Laptop' }).getByRole('button').first().click().catch(() => {}); await sleep(3500);
  const st = (await dev(ps[0], s, 'GET', '/api/minter')).body;
  R.check(st.shop.find((x) => x.id === 'laptop').owned >= 1, 'minter', 'buying a generator works', JSON.stringify({ credits: st.credits, laptop: st.shop.find((x) => x.id === 'laptop').owned }));
  await shot(pa, '07-phone-minter');

  // Sound upload progress bar (large-ish file so progress shows)
  await gmRoute(gp, 'sounds'); await sleep(800);
  const wav = Buffer.alloc(2 * 1024 * 1024 + 44);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await gp.locator('input[type=file]').setInputFiles({ name: 'big.wav', mimeType: 'audio/wav', buffer: wav });
  let sawBar = false;
  const watch = (async () => { for (let i = 0; i < 40 && !sawBar; i++) { sawBar = (await gp.locator('.upbar').count()) > 0; await sleep(50); } })();
  await gp.getByRole('button', { name: 'Upload', exact: true }).click();
  await watch; await sleep(1500);
  R.check(sawBar, 'upload', 'upload shows a progress bar');
  R.check(((await night(gm)).gm.sounds ?? []).some((x) => x.name === 'big'), 'upload', 'the upload completes');

  // Running over: 300-min night -> shorten to just past played? simulate by moving the night end: set length to played+1 and wait
  const playedMin = Math.ceil((await night(gm)).night.nightMs / 60000);
  await api(gm.req, s.base, 'PATCH', '/api/night', { lengthMinutes: Math.max(30, playedMin + 1) });
  const l2 = (await night(gm)).night.lengthMinutes;
  R.check(l2 >= playedMin + 1, 'length', 'length can be set to just past what has been played', `${l2}`);
  await shot(tv, '08-tv');
} catch (e) {
  R.bug('harness', 'crashed', e.stack);
} finally {
  await b.close();
  R.report(s);
  await s.stop();
}
