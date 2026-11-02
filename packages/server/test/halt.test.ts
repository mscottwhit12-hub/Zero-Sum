import { valueH } from '@gn/engine';
import { describe, expect, it } from 'vitest';
import { computeNightState, currentNight } from '../src/services/state';
import { feedTail } from '../src/services/feed';
import { playerView, publicView } from '../src/services/views';
import { tickOnce } from '../src/tickLoop';
import { call, liveNight, makeApp, type TestApp } from './helpers';

const MIN = 60_000;
const dev = (t: TestApp, token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, payload: payload as object | undefined, headers: { 'x-device-token': token } });
const worth = (t: TestApp, id: number) => computeNightState(t.ctx, currentNight(t.ctx)!.id)!.standings.find((r) => Number(r.playerId) === id)!.netWorthH;

async function setup() {
  const t = await makeApp();
  const { gm, devices } = await liveNight(t, 3);
  const [a, b, c] = devices as { id: number; token: string }[] as [{ id: number; token: string }, { id: number; token: string }, { id: number; token: string }];
  t.clock.advance(MIN);
  tickOnce(t.ctx);
  const sec = `p:${b.id}`;
  expect((await dev(t, a.token, 'POST', '/api/trade/buy', { securityId: sec, gold: 6 })).statusCode).toBe(200); // a holds b's stock
  expect((await dev(t, c.token, 'POST', '/api/trade/short', { securityId: sec, gold: 4 })).statusCode).toBe(200); // c is short it
  expect((await dev(t, a.token, 'POST', '/api/trade/buy', { securityId: 'index', gold: 3 })).statusCode).toBe(200); // a also holds the index
  return { t, gm, a, b, c, sec };
}

describe('halting a stock', () => {
  it('closes every position at full value with no fee, freezes the price, blocks trading, and tells the story', async () => {
    const { t, gm, a, b, c, sec } = await setup();
    const priceBefore = (computeNightState(t.ctx, currentNight(t.ctx)!.id)!.securities.find((s) => s.id === sec)!).price;
    const [wa, wc] = [worth(t, a.id), worth(t, c.id)];

    const res = await call(t, gm, 'POST', `/api/securities/${encodeURIComponent(sec)}/halt`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ securityId: sec, positionsClosed: 2 });

    // 100% value: no fee, nobody is worse off (net worth normally counts holdings after the sell fee, so it can only go up).
    expect(worth(t, a.id)).toBeGreaterThanOrEqual(wa);
    expect(worth(t, c.id)).toBeGreaterThanOrEqual(wc);
    const forced = t.ctx.db.prepare('SELECT * FROM trade WHERE security_id = ? AND forced = 1 ORDER BY id').all(sec) as { player_id: number; side: string; shares_h: number; cash_h: number; fee_h: number; price: number; short: number }[];
    expect(forced[0]!.cash_h).toBe(valueH(forced[0]!.shares_h, priceBefore)); // exactly shares × price
    expect(forced.map((f) => [f.player_id, f.side, f.fee_h, f.price, f.short])).toEqual([
      [a.id, 'sell', 0, priceBefore, 0],
      [c.id, 'buy', 0, priceBefore, 1],
    ]);
    // Positions in the halted stock are gone; others stay.
    expect(t.ctx.db.prepare('SELECT COUNT(*) c FROM lot WHERE security_id = ?').get(sec)).toEqual({ c: 0 });
    expect(t.ctx.db.prepare('SELECT COUNT(*) c FROM lot WHERE security_id = ? AND player_id = ?').get('index', a.id)).toEqual({ c: 1 });

    // Story: a public feed item, a private message to each holder, an audit entry; public view flags the stock.
    expect(feedTail(t.ctx, currentNight(t.ctx)!.id, false).map((f) => f.message)).toContain('feed.stock_halted');
    const msgs = t.ctx.db.prepare("SELECT target, message FROM notification WHERE message LIKE 'Compliance has halted%' ORDER BY id").all() as { target: string; message: string }[];
    expect(msgs.map((m) => m.target)).toEqual([`player:${a.id}`, `player:${c.id}`]);
    expect(msgs[0]!.message).toContain('full value');
    expect(t.ctx.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'market.halt'").get()).toEqual({ c: 1 });
    const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    expect(publicView(t.ctx, st).market.find((m) => m.id === sec)?.halted).toBe(true);
    expect(publicView(t.ctx, st).market.find((m) => m.id === 'index')?.halted).toBeUndefined();

    // Nobody can trade it (even a player with nothing in it), but other stocks still trade.
    for (const [who, path, body] of [
      [a, 'buy', { securityId: sec, gold: 1 }],
      [b, 'buy', { securityId: sec, gold: 1 }],
      [a, 'sell', { securityId: sec, shares: 'all' }],
      [c, 'short', { securityId: sec, gold: 1 }],
      [c, 'cover', { securityId: sec, shares: 'all' }],
    ] as const) {
      const r = await dev(t, who.token, 'POST', `/api/trade/${path}`, body);
      expect([r.statusCode, r.json().error]).toEqual([409, 'halted']);
    }
    expect((await dev(t, b.token, 'POST', '/api/trade/buy', { securityId: `p:${a.id}`, gold: 1 })).statusCode).toBe(200);

    // The price stays frozen across ticks.
    for (let i = 0; i < 4; i++) {
      t.clock.advance(MIN);
      tickOnce(t.ctx);
    }
    const after = computeNightState(t.ctx, currentNight(t.ctx)!.id)!.securities.find((s) => s.id === sec)!;
    expect(after.price).toBe(priceBefore);
    expect(after.halted).toBe(true);
    expect(playerView(t.ctx, computeNightState(t.ctx, currentNight(t.ctx)!.id)!, a.id)!.me.holdings.find((h) => h.securityId === sec)).toBeUndefined();
  });

  it('refuses a second halt, unknown stocks, outsiders, and a finished night; relist reopens trading', async () => {
    const { t, gm, a, sec } = await setup();
    const url = (id: string, what = 'halt') => `/api/securities/${encodeURIComponent(id)}/${what}`;
    expect((await dev(t, a.token, 'POST', url(sec))).statusCode).toBeGreaterThanOrEqual(401); // a player is not a GM
    expect((await call(t, gm, 'POST', url('p:9999'))).statusCode).toBe(404);
    expect((await call(t, gm, 'POST', url(sec, 'relist'))).json().error).toBe('not_halted');
    expect((await call(t, gm, 'POST', url(sec))).statusCode).toBe(200);
    expect((await call(t, gm, 'POST', url(sec))).json().error).toBe('already_halted');

    expect((await call(t, gm, 'POST', url(sec, 'relist'))).statusCode).toBe(200);
    expect(feedTail(t.ctx, currentNight(t.ctx)!.id, false).map((f) => f.message)).toContain('feed.stock_relisted');
    t.clock.advance(MIN);
    tickOnce(t.ctx);
    expect((await dev(t, a.token, 'POST', '/api/trade/buy', { securityId: sec, gold: 1 })).statusCode).toBe(200);

    expect((await call(t, gm, 'POST', '/api/night/end')).statusCode).toBe(200);
    expect((await call(t, gm, 'POST', url(sec))).statusCode).toBe(409);
  });
});
