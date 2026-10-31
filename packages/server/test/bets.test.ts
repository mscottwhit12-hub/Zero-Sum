import { describe, expect, it } from 'vitest';
import { computeNightState, currentNight } from '../src/services/state';
import { gmView, playerView } from '../src/services/views';
import { call, liveNight, makeApp, type TestApp } from './helpers';

const dev = (t: TestApp, token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, payload: payload as object | undefined, headers: { 'x-device-token': token } });

type D = { id: number; token: string };
async function setup(players = 3, game: Record<string, unknown> = {}) {
  const t = await makeApp();
  const night = await liveNight(t, players);
  const lib = (await call(t, night.gm, 'POST', '/api/library', { name: 'Card Game', minPlayers: 2, maxPlayers: 6, defaultDuration: 1, mode: 'competitive', ...game })).json().game;
  const ids = night.devices.map((d) => d.id);
  const g = (await call(t, night.gm, 'POST', '/api/games', { libraryGameId: lib.id, participants: ids })).json().game;
  const [a, b, c] = night.devices as [D, D, D];
  // everyone starts with their stake; top up so the limit, not cash, is what's being tested
  for (const d of night.devices) await call(t, night.gm, 'POST', '/api/night/adjustments', { playerId: d.id, gold: 20, reason: 'bankroll' });
  return { t, gm: night.gm, a, b, c, ids, game: g };
}
const cash = (t: TestApp, id: number) => computeNightState(t.ctx, currentNight(t.ctx)!.id)!.ledger.get(String(id))!.cashH;
const me = (t: TestApp, id: number) => playerView(t.ctx, computeNightState(t.ctx, currentNight(t.ctx)!.id)!, id)!.me;
const result = (s: Awaited<ReturnType<typeof setup>>, places: number[]) =>
  call(s.t, s.gm, 'POST', `/api/games/${s.game.id}/result`, { actualHours: 1, participants: s.ids.map((id, i) => ({ playerId: id, placement: places[i] })) });
/** Gold a player earned from the game itself in a recorded result (so tests can isolate the bet). */
const earned = (r: { json(): { gold: { playerId: number; goldH: number }[] } }, id: number) => r.json().gold.find((x) => x.playerId === id)!.goldH;
const offer = (s: Awaited<ReturnType<typeof setup>>, who: D, o: Record<string, unknown> = {}) =>
  dev(s.t, who.token, 'POST', '/api/me/bets', { gameId: s.game.id, kind: 'win', subjectId: s.a.id, oddsA: 3, oddsB: 1, stake: 1, ...o });

describe('bets: offer, accept, settle', () => {
  it('holds both stakes on accept and pays the winner both when the result is recorded', async () => {
    const s = await setup();
    const b0 = cash(s.t, s.b.id);
    const c0 = cash(s.t, s.c.id);
    const id = (await offer(s, s.b)).json().id; // Bob backs Alice to win at 3 to 1, risking 1 to win 3
    expect(cash(s.t, s.b.id)).toBe(b0); // nothing is held until someone takes it
    expect((await dev(s.t, s.b.token, 'POST', `/api/me/bets/${id}/accept`)).json().error).toBe('own_bet');
    expect((await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/accept`)).statusCode).toBe(200);
    expect(cash(s.t, s.b.id)).toBe(b0 - 100);
    expect(cash(s.t, s.c.id)).toBe(c0 - 300);
    const r = await result(s, [1, 2, 3]); // Alice wins: Bob (the offerer) wins
    expect(cash(s.t, s.b.id)).toBe(b0 + 300 + earned(r, s.b.id));
    expect(cash(s.t, s.c.id)).toBe(c0 - 300 + earned(r, s.c.id));
    const row = s.t.ctx.db.prepare('SELECT status, winner_id FROM bet WHERE id = ?').get(id) as { status: string; winner_id: number };
    expect(row).toEqual({ status: 'settled', winner_id: s.b.id });
  });

  it('the taker wins when the statement is false', async () => {
    const s = await setup();
    const id = (await offer(s, s.b)).json().id;
    await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/accept`);
    const c0 = cash(s.t, s.c.id);
    const r = await result(s, [2, 1, 3]); // Alice does not win
    expect(cash(s.t, s.c.id)).toBe(c0 + 400 + earned(r, s.c.id));
  });

  it('a tie returns both stakes', async () => {
    const s = await setup();
    const id = (await offer(s, s.b)).json().id;
    await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/accept`);
    await result(s, [1, 1, 3]);
    // Net bet money is zero for both: what was held came straight back (game gold and achievements are separate)
    const net = (pid: number) => (s.t.ctx.db.prepare("SELECT COALESCE(SUM(gold_h),0) g FROM adjustment WHERE kind = 'bet' AND player_id = ?").get(pid) as { g: number }).g;
    expect(net(s.b.id)).toBe(0);
    expect(net(s.c.id)).toBe(0);
    expect((s.t.ctx.db.prepare('SELECT status FROM bet WHERE id = ?').get(id) as { status: string }).status).toBe('tie');
  });

  it('place bets use the top N; an offer nobody took lapses with the game', async () => {
    const s = await setup();
    const id = (await offer(s, s.b, { kind: 'place', topN: 2, subjectId: s.b.id, oddsA: 1, oddsB: 2, stake: 2 })).json().id;
    expect((await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/accept`)).statusCode).toBe(200);
    const open = (await offer(s, s.c, { oddsA: 1, oddsB: 1 })).json().id;
    await result(s, [3, 2, 1]);
    expect((s.t.ctx.db.prepare('SELECT status, winner_id FROM bet WHERE id = ?').get(id) as { status: string; winner_id: number })).toEqual({ status: 'settled', winner_id: s.b.id });
    expect((s.t.ctx.db.prepare('SELECT status FROM bet WHERE id = ?').get(open) as { status: string }).status).toBe('expired');
  });

  it('a cancelled game refunds accepted bets', async () => {
    const s = await setup();
    const b0 = cash(s.t, s.b.id);
    const id = (await offer(s, s.b)).json().id;
    await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/accept`);
    await call(s.t, s.gm, 'POST', `/api/games/${s.game.id}/cancel`);
    expect(cash(s.t, s.b.id)).toBe(b0);
    expect((s.t.ctx.db.prepare('SELECT status FROM bet WHERE id = ?').get(id) as { status: string }).status).toBe('void');
  });

  it('the GM can void a live bet and stakes come back', async () => {
    const s = await setup();
    const c0 = cash(s.t, s.c.id);
    const id = (await offer(s, s.b)).json().id;
    await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/accept`);
    expect((await call(s.t, s.gm, 'POST', `/api/bets/${id}/void`, { reason: 'mistake' })).statusCode).toBe(200);
    expect(cash(s.t, s.c.id)).toBe(c0);
    expect((await call(s.t, s.gm, 'POST', `/api/bets/${id}/void`)).json().error).toBe('bet_closed');
  });
});

describe('bets: net worth', () => {
  it('a held stake leaves cash but not net worth, so a live bet never drops anyone down the leaderboard', async () => {
    const s = await setup();
    const nw = (id: number) => computeNightState(s.t.ctx, currentNight(s.t.ctx)!.id)!.standings.find((r) => r.playerId === String(id))!.netWorthH;
    const [nb, nc, cb] = [nw(s.b.id), nw(s.c.id), cash(s.t, s.b.id)];
    const id = (await offer(s, s.b)).json().id;
    await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/accept`);
    expect(cash(s.t, s.b.id)).toBe(cb - 100);
    expect(nw(s.b.id)).toBe(nb);
    expect(nw(s.c.id)).toBe(nc);
  });
});

describe('bets: limits and rules', () => {
  it('limits what either side can lose to 5 gold; 3 to 1 at 2 gold would put 6 at risk', async () => {
    const s = await setup();
    expect((await offer(s, s.b, { stake: 2 })).json().error).toBe('over_limit');
    expect((await offer(s, s.b, { stake: 1.66 })).statusCode).toBe(200);
    expect((await offer(s, s.b, { stake: 5, oddsA: 1, oddsB: 1 })).statusCode).toBe(200);
    expect((await offer(s, s.b, { stake: 5.5, oddsA: 1, oddsB: 1 })).json().error).toBe('over_limit');
    expect((await offer(s, s.b, { oddsA: 11 })).json().error).toBe('bad_odds');
    expect((await offer(s, s.b, { kind: 'place', topN: 1 })).json().error).toBe('bad_bet');
  });

  it('a High Roller ticket lifts the limit to 10 once', async () => {
    const s = await setup();
    expect((await offer(s, s.b, { stake: 10, oddsA: 1, oddsB: 1, ticket: true })).json().error).toBe('no_ticket');
    const ch = (await call(s.t, s.gm, 'POST', '/api/challenges', { playerId: s.b.id, text: 'Do the thing', reward: { type: 'high_roller' } })).json().id;
    await dev(s.t, s.b.token, 'POST', `/api/me/challenges/${ch}/read`);
    await dev(s.t, s.b.token, 'POST', `/api/me/challenges/${ch}/respond`, { accept: true });
    await call(s.t, s.gm, 'POST', `/api/challenges/${ch}/resolve`, { success: true });
    expect(me(s.t, s.b.id).bets.tickets).toBe(1);
    expect((await offer(s, s.b, { stake: 10, oddsA: 1, oddsB: 1 })).json().error).toBe('over_limit'); // no ticket flag
    expect((await offer(s, s.b, { stake: 11, oddsA: 1, oddsB: 1, ticket: true })).json().error).toBe('over_limit');
    expect((await offer(s, s.b, { stake: 10, oddsA: 1, oddsB: 1, ticket: true })).statusCode).toBe(200);
    expect(me(s.t, s.b.id).bets.tickets).toBe(0);
    expect((await offer(s, s.b, { stake: 10, oddsA: 1, oddsB: 1, ticket: true })).json().error).toBe('no_ticket');
  });

  it('targeted offers can only be taken, and seen, by that player; you can cancel your own open offer', async () => {
    const s = await setup();
    const id = (await offer(s, s.b, { targetId: s.c.id })).json().id;
    expect((await dev(s.t, s.a.token, 'POST', `/api/me/bets/${id}/accept`)).json().error).toBe('not_for_you');
    expect(me(s.t, s.a.id).bets.list.find((x) => x.id === id)).toBeUndefined();
    expect(me(s.t, s.c.id).bets.list.find((x) => x.id === id)).toBeDefined();
    expect((await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/cancel`)).statusCode).toBe(404);
    expect((await dev(s.t, s.b.token, 'POST', `/api/me/bets/${id}/cancel`)).statusCode).toBe(200);
    expect((await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/accept`)).json().error).toBe('bet_not_open');
  });

  it('needs the gold, an open game, and respects the open-offer cap and the off switch', async () => {
    const s = await setup();
    const poor = (await offer(s, s.b, { stake: 1 })).json().id;
    // Cara spends nearly everything: she can't cover 3 gold
    await call(s.t, s.gm, 'POST', '/api/night/adjustments', { playerId: s.c.id, gold: -(cash(s.t, s.c.id) / 100) + 1, reason: 'broke' });
    expect((await dev(s.t, s.c.token, 'POST', `/api/me/bets/${poor}/accept`)).json().error).toBe('insufficient_cash');
    for (let i = 0; i < 4; i++) await offer(s, s.a, { subjectId: s.b.id });
    expect((await offer(s, s.a, { subjectId: s.b.id })).statusCode).toBe(200); // 5th
    expect((await offer(s, s.a, { subjectId: s.b.id })).json().error).toBe('too_many_offers');
    await result(s, [1, 2, 3]);
    expect((await offer(s, s.b)).json().error).toBe('game_closed');
  });

  it('co-op games only take win bets', async () => {
    const s = await setup(3, { name: 'Coop Game', mode: 'coop' });
    expect((await offer(s, s.b, { kind: 'place', topN: 2 })).json().error).toBe('bad_bet');
    expect((await offer(s, s.b)).statusCode).toBe(200);
  });

  it('shows up in the GM view and the feed', async () => {
    const s = await setup();
    const id = (await offer(s, s.b)).json().id;
    await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/accept`);
    const st = computeNightState(s.t.ctx, currentNight(s.t.ctx)!.id)!;
    expect(gmView(s.t.ctx, st).gm.bets.map((x) => x.id)).toContain(id);
    const feed = s.t.ctx.db.prepare("SELECT message FROM feed_event WHERE type = 'bet'").all() as { message: string }[];
    expect(feed.map((f) => f.message)).toContain('feed.bet_accepted');
  });
});

describe('bets: safeguards', () => {
  it('only players in the game can be bet on, and a place bet can’t be a sure thing', async () => {
    const t = await makeApp();
    const night = await liveNight(t, 4);
    const lib = (await call(t, night.gm, 'POST', '/api/library', { name: 'Card Game', minPlayers: 2, maxPlayers: 6, defaultDuration: 1, mode: 'competitive' })).json().game;
    const three = night.devices.slice(0, 3);
    const g = (await call(t, night.gm, 'POST', '/api/games', { libraryGameId: lib.id, participants: three.map((d) => d.id) })).json().game;
    for (const d of night.devices) await call(t, night.gm, 'POST', '/api/night/adjustments', { playerId: d.id, gold: 20, reason: 'bankroll' });
    const [a, b] = three as [D, D];
    const outsider = night.devices[3]!;
    const post = (o: Record<string, unknown>) => dev(t, b.token, 'POST', '/api/me/bets', { gameId: g.id, kind: 'win', subjectId: a.id, oddsA: 1, oddsB: 1, stake: 1, ...o });
    expect((await post({ subjectId: outsider.id })).json().error).toBe('bad_subject');
    expect((await post({ kind: 'place', topN: 3 })).json().error).toBe('bad_bet'); // 3 players: top 3 can't lose
    expect((await post({ kind: 'place', topN: 2 })).statusCode).toBe(200);
  });

  it('ending the night returns the stakes held on games that never finished', async () => {
    const s = await setup();
    const b0 = cash(s.t, s.b.id);
    const c0 = cash(s.t, s.c.id);
    const id = (await offer(s, s.b)).json().id;
    await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/accept`);
    expect(cash(s.t, s.b.id)).toBe(b0 - 100);
    expect((await call(s.t, s.gm, 'POST', '/api/night/end')).statusCode).toBe(200);
    expect(cash(s.t, s.b.id)).toBe(b0);
    expect(cash(s.t, s.c.id)).toBe(c0);
    expect((s.t.ctx.db.prepare('SELECT status FROM bet WHERE id = ?').get(id) as { status: string }).status).toBe('void');
  });

  it('an offer from someone who has left can’t be taken', async () => {
    const s = await setup();
    const id = (await offer(s, s.b)).json().id;
    await call(s.t, s.gm, 'POST', `/api/players/${s.b.id}/leave`, { left: true });
    const r = await dev(s.t, s.c.token, 'POST', `/api/me/bets/${id}/accept`);
    expect(r.statusCode).toBe(409);
  });
});
