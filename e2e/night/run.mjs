// Test night: 1 GM (laptop + phone, random switching), 10 player phones, 1 TV. Server at ZS_TIME_SCALE=60.
import { createRequire } from 'node:module';
// Loaded via require so NODE_PATH (a global Playwright install) works.
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { calibrateCatan, catanGame, riskGame, rng, scoreAt } from './models.mjs';

const B = process.env.BASE ?? 'http://localhost:8097';
const OUT = process.argv[2];
const PACK = process.argv[3];
const SEED = Number(process.env.SEED ?? 20261027);
mkdirSync(`${OUT}/shots`, { recursive: true });
const R = rng(SEED);
const U = (a, b) => a + (b - a) * R();
const pick = (a) => a[Math.floor(R() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ logging
const events = [];
const issues = [];
const clk = { nms: 0, status: 'setup', tradingClosed: false, gm: null, lat: [] };
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(1, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`;
const L = (who, msg) => {
  const line = `[${hhmm(clk.nms / 60000)}] ${who}: ${msg}`;
  console.log(line);
  events.push(line);
};
const ISSUE = (kind, msg) => {
  issues.push({ at: hhmm(clk.nms / 60000), kind, msg });
  L('ISSUE', `${kind}: ${msg}`);
};
const nowMin = () => clk.nms / 60000;
const until = async (min) => {
  while (nowMin() < min && clk.status !== 'ended') await sleep(60);
};
const waitGame = async (mins) => until(nowMin() + mins);

// ------------------------------------------------------------------ hidden-mechanics scan on everything clients receive
const FORBIDDEN = ['"drift"', '"causes"', '"fair"', '"target"', '"impulses"', '"shock"', '"lastFair"', '"leaverFair"', '"credential_hash"', '"pin_hash"', '"token_hash"', 'goldHidden', 'gold_hidden'];
const GM_ONLY = ['"gmOffset"', '"moodTerm"', '"ledger"', '"overrides"', '"baseline"'];
const leakHits = new Map();
const frames = { count: 0, bytes: 0 };
function scan(role, payload) {
  if (typeof payload !== 'string') return;
  frames.count++;
  frames.bytes += payload.length;
  const keys = role === 'gm' ? FORBIDDEN : [...FORBIDDEN, ...GM_ONLY];
  for (const k of keys)
    if (payload.includes(k)) {
      const key = `${role}:${k}`;
      if (!leakHits.has(key)) ISSUE('LEAK', `${k} reached a ${role} client: ${payload.slice(Math.max(0, payload.indexOf(k) - 80), payload.indexOf(k) + 80)}`);
      leakHits.set(key, (leakHits.get(key) ?? 0) + 1);
    }
}
const consoleErrors = [];
const meOf = new Map(); // page -> latest private `me` from its own socket stream
function parseFrames(page, payload) {
  for (const part of payload.split('\x1e')) {
    if (!part.startsWith('42')) continue;
    try {
      const [ev, data] = JSON.parse(part.slice(2));
      if (ev === 'snapshot' && data?.me) meOf.set(page, data.me);
      if (ev === 'player:update' && data) meOf.set(page, data);
    } catch {}
  }
}
function watch(page, role, name) {
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push({ at: hhmm(nowMin()), who: name, text: m.text().slice(0, 300) }));
  page.on('pageerror', (e) => consoleErrors.push({ at: hhmm(nowMin()), who: name, text: 'PAGEERROR ' + String(e).slice(0, 300) }));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => {
      const t = typeof f.payload === 'string' ? f.payload : '';
      scan(role, t);
      if (role === 'player') parseFrames(page, t);
    }),
  );
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('/socket.io/') && !u.includes('/api/')) return;
    if (u.includes('.pdf')) return;
    try {
      const t = await res.text();
      scan(role, t);
      if (role === 'player' && u.includes('/socket.io/')) parseFrames(page, t);
    } catch {}
  });
}
let shotN = 0;
const shot = async (page, label) => {
  try {
    await page.screenshot({ path: `${OUT}/shots/${String(++shotN).padStart(3, '0')}-${label}.png` });
  } catch {}
};

// ------------------------------------------------------------------ browser + GM
const browser = await chromium.launch();
const laptopCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const gmApi = laptopCtx.request;
const api = async (req, method, path, data, headers) => {
  const t0 = Date.now();
  const r = await req.fetch(B + path, { method, data, headers });
  clk.lat.push(Date.now() - t0);
  const body = await r.text();
  let j;
  try {
    j = JSON.parse(body);
  } catch {
    j = { raw: body };
  }
  if (!r.ok()) throw Object.assign(new Error(`${method} ${path} → ${r.status()} ${body.slice(0, 200)}`), { status: r.status(), body: j });
  return j;
};
const gmCall = (m, p, d) => api(gmApi, m, p, d);

await gmCall('POST', '/api/setup', { name: 'Tate', password: 'test pass 123', pin: '1234', deviceType: 'laptop' });
const phoneGmCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await api(phoneGmCtx.request, 'POST', '/api/gm/login', { name: 'Tate', password: 'test pass 123', deviceType: 'phone' });
const gmLaptop = await laptopCtx.newPage();
const gmPhone = await phoneGmCtx.newPage();
watch(gmLaptop, 'gm', 'gm-laptop');
watch(gmPhone, 'gm', 'gm-phone');
await gmLaptop.goto(B + '/gm');
await gmPhone.goto(B + '/gm');

// Finale timings ×60 so the TV finale plays at watchable real speed (test-only override; noted in report).
await gmCall('POST', '/api/nights', { name: 'Test Night 60x', lengthMinutes: 480, settings: { finale: { collapseSeconds: 600, podiumStepSeconds: 300, recapSlideSeconds: 480 }, handicap: { autoEnabled: true } } });

// GM device switching: one action at a time, random device each time.
let gmBusy = Promise.resolve();
const gmUse = { laptop: 0, phone: 0 };
function gmDo(label, fn) {
  const run = gmBusy.then(async () => {
    const dev = R() < 0.5 ? 'laptop' : 'phone';
    const page = dev === 'laptop' ? gmLaptop : gmPhone;
    gmUse[dev]++;
    try {
      await fn(page, dev);
      L(`GM(${dev})`, label);
    } catch (e) {
      ISSUE('GM-UI', `${label} on ${dev}: ${String(e.message ?? e).split('\n')[0].slice(0, 220)}`);
      await shot(page, `gm-fail-${dev}`);
    }
  });
  gmBusy = run.catch(() => {});
  return run;
}
const goRoute = async (page, r) => {
  await page.evaluate((x) => (location.hash = `/${x}`), r);
  await page.waitForTimeout(250);
};

// Library: import the test pack through the UI.
await gmDo('import catan-risk pack (Library → Import pack)', async (page) => {
  await goRoute(page, 'library');
  await page.locator('input[type=file]').first().setInputFiles(PACK);
  await page.waitForTimeout(800);
});
await gmCall('POST', '/api/night/open-joins');

// ------------------------------------------------------------------ TV
const tvCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const tv = await tvCtx.newPage();
watch(tv, 'tv', 'tv');
await tv.goto(B + '/display');
await tv.waitForTimeout(1500);
await tv.getByRole('button', { name: 'Enable audio' }).click().catch(() => {});

// ------------------------------------------------------------------ players
const NAMES = ['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Finn', 'Gus', 'Hana', 'Ivan', 'Jade'];
const TICK = ['ALI', 'BOB', 'CAR', 'DAN', 'EVE', 'FIN', 'GUS', 'HAN', 'IVN', 'JAD'];
const TYPES = ['holder', 'active trader', 'crown chaser', 'self-pumper', 'crypto gambler', 'fee-aware minimalist', 'contrarian', 'momentum chaser', 'event speculator', 'social / minter'];
const players = [];
for (let i = 0; i < 10; i++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, 'player', NAMES[i]);
  await page.goto(B + '/play');
  await page.getByLabel('Display name').fill(NAMES[i], { timeout: 15000 });
  await page.getByLabel(/Ticker/).fill(TICK[i]);
  await page.getByRole('button', { name: /^(Join|Request to join)$/ }).click();
  await page.locator('.home .grid, .icon').first().waitFor({ timeout: 20000 });
  const token = await page.evaluate(() => localStorage.getItem('gn_device'));
  const me = await api(ctx.request, 'GET', '/api/me', undefined, { 'x-device-token': token });
  players.push({ i, name: NAMES[i], ticker: TICK[i], type: TYPES[i], ctx, page, token, id: me.player.id, lock: Promise.resolve(), trades: 0, tradeErrors: [], votes: 0, memos: 0, mints: 0 });
  L(NAMES[i], `joined via phone UI as ${TICK[i]} (${TYPES[i]})`);
}
await shot(players[0].page, 'phone-home');

// Clock poller (GM view). Also measures API latency.
let polling = true;
(async () => {
  while (polling) {
    try {
      const s = await gmCall('GET', '/api/night');
      clk.nms = s.night.nightMs;
      clk.status = s.night.status;
      clk.tradingClosed = s.night.tradingClosed;
      clk.gm = s;
    } catch (e) {
      ISSUE('POLL', String(e.message).slice(0, 160));
    }
    await sleep(200);
  }
})();

await gmCall('POST', '/api/night/start');
L('GM', 'night started (API)');
await sleep(500);

// ------------------------------------------------------------------ per-player UI helpers
const withPhone = (p, fn) => {
  const run = p.lock.then(fn).catch((e) => ISSUE('PHONE-UI', `${p.name}: ${String(e.message ?? e).split('\n')[0].slice(0, 200)}`));
  p.lock = run;
  return run;
};
const me = async (p) => {
  for (let k = 0; k < 50 && !meOf.get(p.page); k++) await sleep(100);
  const m = meOf.get(p.page);
  if (!m) throw new Error('no private state received on the phone');
  return { me: m };
};
async function home(page) {
  for (const label of ['‹ All stocks', '‹ Home']) {
    const b = page.getByRole('button', { name: label });
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}
async function openApp(page, label) {
  await home(page);
  await page.locator('button.app', { hasText: label }).click({ timeout: 4000 });
  await page.waitForTimeout(150);
}
async function toastText(page) {
  await page.waitForTimeout(500);
  return (await page.locator('.toast').allTextContents().catch(() => [])).join(' | ');
}
async function uiBuy(p, ticker, goldAmt) {
  return withPhone(p, async () => {
    if (clk.tradingClosed || clk.status !== 'live') return;
    const page = p.page;
    await openApp(page, 'Market');
    await page.locator('button.r').filter({ has: page.locator('span.t', { hasText: new RegExp(`^${ticker}(\\b|$)`) }) }).first().click({ timeout: 4000 });
    await page.getByPlaceholder('Gold').first().fill(String(Math.round(goldAmt * 100) / 100));
    const buy = page.getByRole('button', { name: 'Buy', exact: true });
    if (await buy.isDisabled()) {
      await home(page);
      return;
    }
    await buy.click();
    const tt = await toastText(page);
    const err = await page.locator('.toast.error').count();
    if (err) p.tradeErrors.push(`buy ${ticker} ${goldAmt}: ${tt}`);
    else p.trades++;
    L(p.name, `BUY ${ticker} ${goldAmt.toFixed(1)}g → ${tt || 'ok'}`);
    await home(page);
  });
}
async function uiSellAll(p, ticker) {
  return withPhone(p, async () => {
    if (clk.tradingClosed || clk.status !== 'live') return;
    const page = p.page;
    await openApp(page, 'Market');
    await page.locator('button.r').filter({ has: page.locator('span.t', { hasText: new RegExp(`^${ticker}(\\b|$)`) }) }).first().click({ timeout: 4000 });
    const b = page.getByRole('button', { name: /Sell all unlocked/ });
    if (!(await b.isVisible().catch(() => false)) || (await b.isDisabled())) {
      await home(page);
      return;
    }
    await b.click();
    const tt = await toastText(page);
    if (await page.locator('.toast.error').count()) p.tradeErrors.push(`sell ${ticker}: ${tt}`);
    else p.trades++;
    L(p.name, `SELL ALL ${ticker} → ${tt || 'ok'}`);
    await home(page);
  });
}

// ------------------------------------------------------------------ trading behaviours (sim player types, compressed)
const pub = () => clk.gm;
const priceOf = (sec) => pub()?.market.find((m) => m.id === sec)?.price ?? 0;
const tickerOf = (sec) => pub()?.market.find((m) => m.id === sec)?.ticker;
const playerSec = (pid) => `p:${pid}`;
async function holdingsUnlocked(p) {
  const m = (await me(p)).me;
  const nms = clk.nms;
  return { m, pos: m.holdings.map((h) => ({ sec: h.securityId, valueH: h.valueH, costH: h.costBasisH, unlocked: h.lots.filter((l) => l.unlockNms <= nms).reduce((a, l) => a + l.sharesH, 0) })) };
}
async function takeProfit(p, minGain, maxLoss = -1) {
  const { pos } = await holdingsUnlocked(p);
  for (const x of pos) {
    const g = x.valueH / Math.max(1, x.costH) - 1;
    if (x.unlocked > 0 && (g >= minGain || g <= maxLoss)) await uiSellAll(p, tickerOf(x.sec));
  }
}
const cashG = async (p) => (await me(p)).me.cashH / 100;
const capG = async (p) => (await me(p)).me.capRemainingH / 100;
const crowned = () => (pub()?.games ?? []).filter((g) => g.status === 'active' && g.leaderId).map((g) => g.leaderId);

const behaviours = {
  async holder(p) {
    if (!p.did) {
      p.did = 1;
      await uiBuy(p, 'IDX', 10);
      await uiBuy(p, p.ticker, 8);
    }
    return U(60, 120);
  },
  async 'active trader'(p) {
    await takeProfit(p, 0.03, -0.06);
    const others = players.filter((q) => q !== p);
    if ((await capG(p)) > 4) await uiBuy(p, pick(others).ticker, U(3, 6));
    return U(10, 25);
  },
  async 'crown chaser'(p) {
    const c = crowned().filter((id) => id !== p.id);
    const { pos } = await holdingsUnlocked(p);
    for (const x of pos) if (x.unlocked > 0 && x.sec.startsWith('p:') && !c.includes(Number(x.sec.slice(2)))) await uiSellAll(p, tickerOf(x.sec));
    if (c.length && (await capG(p)) > 4) await uiBuy(p, tickerOf(playerSec(pick(c))), 4);
    return U(10, 20);
  },
  async 'self-pumper'(p) {
    if ((await capG(p)) > 1) await uiBuy(p, p.ticker, Math.min(4, await capG(p)));
    return 15;
  },
  async 'crypto gambler'(p) {
    await takeProfit(p, 0.08, -0.1);
    if ((await capG(p)) > 5) await uiBuy(p, 'COIN', 5);
    return U(8, 20);
  },
  async 'fee-aware minimalist'(p) {
    const t = nowMin();
    if (!p.did && t > 60) {
      p.did = 1;
      const top = pub().standings[0]?.playerId;
      await uiBuy(p, tickerOf(playerSec(top === p.id ? pub().standings[1].playerId : top)), 12);
    }
    if (p.did === 1 && t > 400) {
      p.did = 2;
      await takeProfit(p, -1);
    }
    return U(30, 50);
  },
  async contrarian(p) {
    await takeProfit(p, 0.05);
    const low = pub().market.filter((m) => m.kind === 'player' && m.playerId !== p.id).sort((a, b) => a.price - b.price)[0];
    if (low && (await capG(p)) > 4) await uiBuy(p, low.ticker, 4);
    return U(20, 30);
  },
  async 'momentum chaser'(p) {
    const { pos } = await holdingsUnlocked(p);
    for (const x of pos) if (x.unlocked > 0) await uiSellAll(p, tickerOf(x.sec));
    const up = pub()
      .market.filter((m) => m.history.length > 3)
      .map((m) => ({ m, ch: m.price / (m.history[Math.max(0, m.history.length - 6)] || m.price) - 1 }))
      .sort((a, b) => b.ch - a.ch)[0];
    if (up && up.ch > 0 && (await capG(p)) > 4) await uiBuy(p, up.m.ticker, 4);
    return U(12, 20);
  },
  async 'event speculator'(p) {
    await takeProfit(p, 0.1, -0.15);
    if ((await capG(p)) > 3) await uiBuy(p, pick(['SCIC', 'SHDW', 'DEAD']), 3);
    return U(15, 30);
  },
  async 'social / minter'(p) {
    if (R() < 0.3 && (await capG(p)) > 2) await uiBuy(p, pick(players.filter((q) => q !== p)).ticker, 2);
    await mint(p, 25);
    return U(25, 45);
  },
};
async function mint(p, taps) {
  return withPhone(p, async () => {
    await openApp(p.page, 'NFT Minter');
    const b = p.page.locator('button.mint');
    for (let k = 0; k < taps; k++) {
      if (await b.isDisabled().catch(() => true)) break;
      await b.click({ timeout: 1000 }).catch(() => {});
      p.mints++;
      await p.page.waitForTimeout(40);
    }
    await home(p.page);
  });
}
async function playerLoop(p) {
  await waitGame(U(2, 15));
  while (clk.status !== 'ended' && !clk.tradingClosed) {
    if (clk.status === 'live') {
      let next = 15;
      try {
        next = await behaviours[p.type](p);
      } catch (e) {
        ISSUE('BEHAVIOUR', `${p.name}: ${String(e.message).slice(0, 160)}`);
      }
      await waitGame(next);
    } else await sleep(300);
  }
}

// Incoming call + memo watchers (per phone).
async function watcher(p) {
  while (clk.status !== 'ended') {
    await sleep(700 + R() * 600);
    await withPhone(p, async () => {
      const page = p.page;
      const call = page.locator('.call');
      if (await call.isVisible().catch(() => false)) {
        if (!p.callShot) {
          p.callShot = 1;
          if (p.i === 0) await shot(page, `phone-incoming-call-${p.name}`);
        }
        const answer = R() < 0.85;
        await page.getByRole('button', { name: answer ? 'Answer' : 'Decline' }).click();
        if (!answer) {
          L(p.name, 'declined the call');
          p.declined = 1;
          return;
        }
        await castVote(p);
        return;
      }
      if (p.declined && R() < 0.15 && pub()?.vote?.open) {
        p.declined = 0;
        await openApp(page, 'Vote').catch(() => {});
        await castVote(p);
        return;
      }
      const badge = page.locator('button.app', { hasText: 'Messages' }).locator('.nb');
      if (await badge.isVisible().catch(() => false)) await readMessages(p);
    });
  }
}
async function castVote(p) {
  const page = p.page;
  const st = pub().standings;
  const r = R();
  const target = r < 0.5 ? st[0].playerId : r < 0.75 ? p.id : pick(players).id;
  const name = NAMES[players.findIndex((q) => q.id === target)];
  await page.locator('button.pick', { hasText: name }).first().click({ timeout: 4000 });
  await page.waitForTimeout(400);
  p.votes++;
  L(p.name, `voted for ${name}${target === p.id ? ' (self)' : ''}`);
  await home(page);
}
async function readMessages(p) {
  const page = p.page;
  await openApp(page, 'Messages');
  const dec = page.locator('button.mono').first();
  if (await dec.isVisible().catch(() => false)) {
    await dec.click();
    await page.waitForTimeout(1200);
    const acc = R() < 0.7;
    const b = page.getByRole('button', { name: acc ? 'Accept' : 'Reject', exact: true }).first();
    if (await b.isVisible().catch(() => false)) {
      if (p.i < 3) await shot(page, `phone-memo-${p.name}`);
      await b.click();
      p.memos++;
      L(p.name, `memo ${acc ? 'ACCEPTED' : 'rejected'}`);
    }
  }
  for (const m of await page.locator('button.tipc:not(.rd)').all()) await m.click().catch(() => {});
  await home(page);
}

// ------------------------------------------------------------------ GM UI actions
const gameByName = (name) => clk.gm?.games.find((g) => g.name === name);
async function gmStart(name) {
  await gmDo(`start ${name} (Up next → Start)`, async (page) => {
    await goRoute(page, 'dashboard');
    await page.locator('tr', { hasText: name }).getByRole('button', { name: 'Start' }).click({ timeout: 5000 });
    await page.waitForTimeout(300);
  });
}
async function gmScores(name, pl, values) {
  await gmDo(`scores ${name}: ${pl.map((p, k) => `${p.ticker}=${values[k]}`).join(' ')}`, async (page) => {
    await goRoute(page, 'dashboard');
    const panel = page.locator('.panel').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
    for (let k = 0; k < pl.length; k++) await panel.locator('.srow', { hasText: pl[k].name }).locator('input').fill(String(values[k]), { timeout: 4000 });
    const save = panel.getByRole('button', { name: 'Save scores' });
    if (await save.isDisabled()) return;
    await save.click();
    await page.waitForTimeout(300);
  });
}
async function gmResult(name, pl, place) {
  await gmDo(`result ${name}: ${pl.map((p, k) => `${p.ticker}#${place[k]}`).join(' ')} (wizard)`, async (page, dev) => {
    await goRoute(page, 'dashboard');
    const panel = page.locator('.panel').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
    await panel.getByRole('button', { name: 'Enter result' }).click({ timeout: 5000 });
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    const order = pl.map((p, k) => ({ p, pl: place[k] })).sort((a, b) => a.pl - b.pl);
    for (let k = 0; k < order.length; k++) {
      if (k > 0 && order[k].pl === order[k - 1].pl) await page.getByRole('button', { name: 'Next tap ties previous' }).click();
      await page.locator('button.name', { hasText: order[k].p.name }).click();
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.waitForTimeout(500);
    const hrs = await page.getByLabel(/Actual hours/).inputValue();
    if (name.startsWith('Catan A')) await shot(page, `gm-wizard-${dev}`);
    await page.getByRole('button', { name: 'Submit result' }).click();
    await page.waitForTimeout(400);
    L('GM', `${name} hours entered = ${hrs} (prefilled)`);
  });
}

// ------------------------------------------------------------------ schedule + game drivers
const cal = calibrateCatan();
L('MODEL', `Catan k=${cal.k}: median ${cal.median} turns (q1 ${cal.q1}, q3 ${cal.q3}); target median 71`);
const P = players;
const plan = [];
const results = [];
async function schedule(name, libName, pl) {
  const lib = clk.gm.gm.library.find((g) => g.name === libName);
  await gmCall('POST', '/api/games', { libraryGameId: lib.id, name, participants: pl.map((p) => p.id) });
}
async function runGame(name, libName, pl, model) {
  plan.push({ name, players: pl.map((p) => p.ticker), modelDuration: Math.round(model.durationMin), place: model.place, finalScore: model.finalVp ?? null });
  await gmStart(name);
  const g0 = nowMin();
  const riskCall = 440;
  const end = Math.min(g0 + model.durationMin, riskCall);
  const called = g0 + model.durationMin > riskCall;
  // Re-rolls during the game (dice games).
  const rerollAt = Array.from({ length: Math.floor(U(2, model.kind === 'risk' ? 7 : 5)) }, () => U(g0 + 5, end - 5)).sort((a, b) => a - b);
  let nextScore = g0 + U(15, 30);
  while (nowMin() < end && clk.status !== 'ended') {
    await sleep(80);
    if (rerollAt.length && nowMin() >= rerollAt[0]) {
      rerollAt.shift();
      const who = pick(pl);
      const g = gameByName(name);
      try {
        await gmCall('POST', '/api/rerolls', { gameId: g.id, playerId: who.id });
        L('GM', `re-roll logged: ${who.ticker} in ${name}`);
      } catch (e) {
        L('GM', `re-roll refused for ${who.ticker}: ${e.body?.error ?? e.message}`);
      }
    }
    if (nowMin() >= nextScore) {
      nextScore = nowMin() + U(15, 30);
      await gmScores(name, pl, scoreAt(model, nowMin() - g0));
    }
  }
  let place = model.place;
  if (called) {
    // The table calls it: placement by current territory, eliminated players by elimination order.
    const terr = scoreAt(model, nowMin() - g0);
    const order = pl.map((p, k) => ({ k, s: terr[k] > 0 ? 1000 + terr[k] : model.elimAt[k] })).sort((a, b) => b.s - a.s);
    place = Array(pl.length);
    order.forEach((o, idx) => (place[o.k] = idx + 1));
    L('GM', `${name} called at ${hhmm(nowMin())} (model wanted ${Math.round(model.durationMin)} min)`);
  }
  await gmScores(name, pl, scoreAt(model, Math.min(nowMin() - g0, model.durationMin)));
  await gmResult(name, pl, place);
  results.push({ name, place, called });
}

const night = (async () => {
  const A = [P[0], P[1], P[2], P[3]];
  const Bp = [P[4], P[5], P[6], P[7]];
  const gA = catanGame(R, 4, cal.k);
  const gB = catanGame(R, 4, cal.k);
  await schedule('Catan A', 'Catan', A);
  await schedule('Catan B', 'Catan', Bp);
  await until(8);
  const a = runGame('Catan A', 'Catan', A, gA);
  await until(12);
  const b = runGame('Catan B', 'Catan', Bp, gB);
  await Promise.all([a, b]);
  const riskP = [P[0], P[1], P[4], P[5], P[8], P[9]];
  const cP = [P[2], P[3], P[6], P[7]];
  const gR = riskGame(R, 6);
  const gC = catanGame(R, 4, cal.k);
  await schedule('Risk', 'Risk', riskP);
  await schedule('Catan C', 'Catan', cP);
  await waitGame(10);
  const risk = runGame('Risk', 'Risk', riskP, gR);
  await waitGame(2);
  await runGame('Catan C', 'Catan', cP, gC);
  let n = 0;
  const extra = ['Catan D', 'Catan E'];
  while (nowMin() + 10 + 100 < 440 && n < extra.length) {
    const gX = catanGame(R, 4, cal.k);
    await schedule(extra[n], 'Catan', cP);
    await waitGame(10);
    await runGame(extra[n], 'Catan', cP, gX);
    n++;
  }
  await risk;
})();

// Field actions: mood, espionage, notifications, intermission.
const field = (async () => {
  for (const at of [70, 200, 330]) {
    await until(at);
    for (const p of P) await gmCall('POST', '/api/mood', { playerId: p.id, mood: Math.ceil(U(0, 5)), selfAssessment: Math.ceil(U(0, 5)) }).catch((e) => ISSUE('MOOD', e.message));
    L('GM', `mood round at ${at} min (10 players, API)`);
  }
})();
const memos = [];
const spy = (async () => {
  const rewards = [{ type: 'gold' }, { type: 'peek' }, { type: 'dead_clue' }, { type: 'reroll' }];
  for (const [k, at] of [90, 180, 260, 350].entries()) {
    await until(at);
    const who = pick(P);
    try {
      const r = await gmCall('POST', '/api/challenges', { playerId: who.id, text: `Get ${pick(P.filter((q) => q !== who)).name} to say "synergy" before the next result.`, reward: rewards[k] });
      memos.push({ id: r.challenge?.id ?? r.id ?? r, who: who.ticker, at, reward: rewards[k].type });
      L('GM', `espionage memo → ${who.ticker} (${rewards[k].type})`);
    } catch (e) {
      ISSUE('ESPIONAGE', e.message);
    }
  }
})();
const resolver = (async () => {
  const done = new Set();
  while (clk.status !== 'ended' && nowMin() < 445) {
    await sleep(500);
    for (const c of clk.gm?.gm?.challenges ?? []) {
      if (done.has(c.id) || c.status !== 'accepted') continue;
      if (!c._seen) c._seen = nowMin();
      done.add(c.id);
      const success = R() < 0.6;
      setTimeout(async () => {
        try {
          await gmCall('POST', `/api/challenges/${c.id}/resolve`, { success });
          L('GM', `memo ${c.id} resolved: ${success ? 'SUCCESS' : 'fail'}`);
        } catch (e) {
          ISSUE('ESPIONAGE', `resolve ${c.id}: ${e.message}`);
        }
      }, U(20, 45) * 1000 / 60);
    }
  }
})();
const notes = (async () => {
  await until(150);
  await gmCall('POST', '/api/notifications', { to: { all: true }, message: 'Pizza is here. Kitchen in 5.' }).catch((e) => ISSUE('NOTIFY', e.message));
  L('GM', 'notification → all');
  await until(300);
  const g = clk.gm.games.find((x) => x.status === 'active');
  if (g) await gmCall('POST', '/api/notifications', { to: { gameId: g.id }, message: 'Ten-minute warning for this table.' }).catch((e) => ISSUE('NOTIFY', e.message));
  L('GM', `notification → ${g?.name}`);
})();
const intermission = (async () => {
  await until(240);
  await gmDo('pause 15 min (intermission)', async (page) => {
    await goRoute(page, 'dashboard');
    await page.getByPlaceholder('min').fill('15');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForTimeout(300);
  });
  await sleep(400);
  await shot(tv, 'tv-intermission');
  await shot(P[2].page, 'phone-pause-lock');
  // Idle players mint on the lock screen.
  await Promise.all(P.filter((p) => p.type === 'social / minter' || R() < 0.4).map((p) =>
    withPhone(p, async () => {
      const b = p.page.getByRole('button', { name: /Open NFT Minter/ });
      if (await b.isVisible().catch(() => false)) {
        await b.click();
        for (let k = 0; k < 30; k++) {
          await p.page.locator('button.mint').click({ timeout: 800 }).catch(() => {});
          p.mints++;
        }
        L(p.name, 'minted on the pause screen');
        await p.page.getByRole('button', { name: /‹/ }).first().click().catch(() => {});
      }
    }),
  ));
  await sleep((15 * 60 * 1000) / 60);
  await gmDo('resume', async (page) => {
    await goRoute(page, 'dashboard');
    await page.getByRole('button', { name: 'Resume' }).click({ timeout: 4000 });
  });
})();

// Periodic screenshots.
const shots = (async () => {
  let k = 0;
  while (clk.status !== 'ended') {
    await sleep(45000);
    k++;
    await shot(tv, `tv-${hhmm(nowMin()).replace(':', 'h')}`);
    await shot(k % 2 ? gmLaptop : gmPhone, `gm-${k % 2 ? 'laptop' : 'phone'}-${hhmm(nowMin()).replace(':', 'h')}`);
    await shot(P[k % 10].page, `phone-${P[k % 10].name}-${hhmm(nowMin()).replace(':', 'h')}`);
  }
})();

const loops = P.map((p) => playerLoop(p));
const watchers = P.map((p) => watcher(p));

// ------------------------------------------------------------------ close trading and end
await night;
await until(Math.max(nowMin() + 3, 450));
await gmDo('close trading', async (page) => {
  await goRoute(page, 'dashboard');
  await page.getByRole('button', { name: 'Close trading' }).first().click({ timeout: 4000 });
  await page.waitForTimeout(400);
});
await sleep(300);
await shot(P[1].page, 'phone-trading-closed');
await until(nowMin() + 10);
const beforeEnd = clk.gm;
await gmDo('end night', async (page) => {
  await goRoute(page, 'dashboard');
  await page.getByRole('button', { name: 'End night' }).first().click({ timeout: 4000 });
  await page.waitForTimeout(400);
});
const endWall = Date.now();
L('GM', 'night ended → finale');
// Finale on the TV (finale timings were ×60, so it plays at real speed).
for (let s = 0; s < 30; s++) {
  await sleep(4000);
  await shot(tv, `tv-finale-${String(s).padStart(2, '0')}`);
  const st = await gmCall('GET', '/api/night');
  if (st.night.recapDone) break;
}
L('TV', `finale ran ${((Date.now() - endWall) / 1000).toFixed(0)} real s`);
await sleep(2500);
for (const p of [P[0], P[4], P[9]]) await shot(p.page, `phone-statement-${p.name}`);
polling = false;

// ------------------------------------------------------------------ collect
const final = await gmCall('GET', '/api/night');
const exportJson = await gmCall('GET', `/api/export/night.json?night=${final.night.id}`);
const stmts = [];
for (const p of P) {
  const s = await api(p.ctx.request, 'GET', '/api/me/statement', undefined, { 'x-device-token': p.token }).catch((e) => ({ error: e.message }));
  const pdf = await p.ctx.request.get(B + '/api/me/statement.pdf', { headers: { 'x-device-token': p.token } });
  stmts.push({ name: p.name, statement: s, pdfStatus: pdf.status(), pdfBytes: (await pdf.body()).length });
}
writeFileSync(
  `${OUT}/result.json`,
  JSON.stringify({ seed: SEED, cal, plan, results, issues, consoleErrors, leaks: Object.fromEntries(leakHits), frames, gmUse, memos, latency: lat(clk.lat), players: P.map((p) => ({ name: p.name, ticker: p.ticker, type: p.type, id: p.id, trades: p.trades, tradeErrors: p.tradeErrors, votes: p.votes, memos: p.memos, mints: p.mints })), final, beforeEnd, exportJson, stmts }, null, 1),
);
writeFileSync(`${OUT}/events.log`, events.join('\n'));
function lat(a) {
  const s = [...a].sort((x, y) => x - y);
  return { n: s.length, p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
}
console.log('DONE', JSON.stringify({ issues: issues.length, consoleErrors: consoleErrors.length, leaks: leakHits.size, latency: lat(clk.lat) }));
await browser.close();
process.exit(0);
