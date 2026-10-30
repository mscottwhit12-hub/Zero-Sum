import { describe, expect, it } from 'vitest';
import { computeNightState, currentNight } from '../src/services/state';
import { gmView, publicView } from '../src/services/views';
import { call, liveNight, loginAs, makeApp } from './helpers';

async function boardNight() {
  const t = await makeApp();
  const { gm, devices } = await liveNight(t, 4);
  const lib = (await call(t, gm, 'POST', '/api/library', { name: 'Risk', minPlayers: 2, maxPlayers: 6, rerollsAllowed: true, leadMode: 'high', board: 'risk' })).json().game;
  const plain = (await call(t, gm, 'POST', '/api/library', { name: 'Plain', board: 'Not A Key!' })).json().game;
  const ids = devices.map((d) => d.id);
  const g = (await call(t, gm, 'POST', '/api/games', { libraryGameId: lib.id, participants: ids })).json().game;
  await call(t, gm, 'POST', `/api/games/${g.id}/start`);
  return { t, gm, devices, ids, lib, plain, g };
}

describe('game boards', () => {
  it('library and packs carry a board key; junk keys are dropped; games expose it', async () => {
    const { t, gm, lib, plain, g } = await boardNight();
    expect(lib.board).toBe('risk');
    expect(plain.board).toBeNull();
    const pack = (await call(t, gm, 'GET', '/api/library/export')).json();
    expect(pack.games.find((x: { name: string }) => x.name === 'Risk').board).toBe('risk');
    const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    expect(gmView(t.ctx, st).games.find((x) => x.id === g.id)!.board).toBe('risk');
  });

  it('saves versioned state; stale writes refused; repeating the same save is harmless', async () => {
    const { t, gm, g } = await boardNight();
    expect((await call(t, gm, 'GET', `/api/games/${g.id}/board`)).json()).toEqual({ state: null, version: 0, claims: [] });
    const s1 = { v: 1, players: { 1: { territories: 10 } } };
    expect((await call(t, gm, 'PUT', `/api/games/${g.id}/board`, { state: s1, version: 0 })).json()).toEqual({ version: 1 });
    // same save again (double tap / retry): no-op success, same version
    expect((await call(t, gm, 'PUT', `/api/games/${g.id}/board`, { state: s1, version: 0 })).json()).toEqual({ version: 1 });
    // a second GM still on version 0 with different state: refused
    const stale = await call(t, gm, 'PUT', `/api/games/${g.id}/board`, { state: { v: 1, players: {} }, version: 0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('board_stale');
    expect((await call(t, gm, 'GET', `/api/games/${g.id}/board`)).json()).toEqual({ state: s1, version: 1, claims: [] });
    expect((await call(t, gm, 'PUT', `/api/games/${g.id}/board`, { state: 'nope', version: 1 })).json().error).toBe('bad_board_state');
  });

  it('board edits reach the audit log as what changed (player + before/after), not the whole board', async () => {
    const { t, gm, g, ids } = await boardNight();
    const p = String(ids[0]);
    const put = (state: unknown, version: number) => call(t, gm, 'PUT', `/api/games/${g.id}/board`, { state, version });
    const edits = async () => ((await call(t, gm, 'GET', '/api/gm/audit?limit=50')).json().entries as { action: string; entity: string; entityId: string; before: string | null; after: string }[]).filter((e) => e.action === 'board.edit');
    // first save: only what was actually set (blank defaults are not "changes"); the board's own log is skipped
    await put({ v: 1, players: { [p]: { territories: 12, armies: 0, eliminated: false, continents: [] } }, log: [{ id: 1, kind: 'territories', from: 0, to: 12 }], seq: 1 }, 0);
    let e = await edits();
    expect(e).toHaveLength(1);
    expect(e[0]!.entity).toBe('game');
    expect(e[0]!.entityId).toBe(String(g.id));
    expect(JSON.parse(e[0]!.after)).toEqual({ [`players.${p}.territories`]: 12 });
    // second save: territories 12 → 15 shows both sides
    await put({ v: 1, players: { [p]: { territories: 15, armies: 0, eliminated: false, continents: [] } }, log: [{ id: 1 }, { id: 2 }], seq: 2 }, 1);
    e = await edits();
    expect(e).toHaveLength(2);
    expect(JSON.parse(e[0]!.before!)).toEqual({ [`players.${p}.territories`]: 12 });
    expect(JSON.parse(e[0]!.after)).toEqual({ [`players.${p}.territories`]: 15 });
    // saving the same state again (double tap) and a save that only touches the log add nothing
    await put({ v: 1, players: { [p]: { territories: 15, armies: 0, eliminated: false, continents: [] } }, log: [{ id: 1 }, { id: 2 }, { id: 3 }], seq: 3 }, 2);
    expect(await edits()).toHaveLength(2);
    // the audit screen gets names for the ids it mentions
    const names = (await call(t, gm, 'GET', '/api/gm/audit?limit=5')).json().names;
    expect(names.players[p]).toBeTruthy();
    expect(names.games[String(g.id)]).toBe('Risk');
  });

  it('a game without a board refuses; a finished game is closed', async () => {
    const { t, gm, ids, plain, g } = await boardNight();
    const pg = (await call(t, gm, 'POST', '/api/games', { libraryGameId: plain.id, participants: ids })).json().game;
    expect((await call(t, gm, 'GET', `/api/games/${pg.id}/board`)).json().error).toBe('no_board');
    await call(t, gm, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: ids.map((id, i) => ({ playerId: id, placement: i + 1 })) });
    expect((await call(t, gm, 'PUT', `/api/games/${g.id}/board`, { state: { v: 1 }, version: 0 })).json().error).toBe('board_closed');
  });

  it('recap goes to each participant once, privately, when the result is submitted', async () => {
    const { t, gm, ids, g } = await boardNight();
    const recap = [...ids.map((id) => ({ playerId: id, text: `Recap for ${id}` })), { playerId: 99999, text: 'stranger' }, { playerId: ids[0], text: 'dupe' }];
    await call(t, gm, 'PUT', `/api/games/${g.id}/board`, { state: { v: 1 }, version: 0, recap });
    const result = { actualHours: 1, participants: ids.map((id, i) => ({ playerId: id, placement: i + 1 })) };
    await call(t, gm, 'POST', `/api/games/${g.id}/result`, result);
    await call(t, gm, 'POST', `/api/games/${g.id}/result`, result); // double submit
    await call(t, gm, 'POST', `/api/games/${g.id}/correct`, { ...result, actualHours: 2 }); // correction
    const rows = t.ctx.db.prepare("SELECT target, message FROM notification WHERE message LIKE 'Recap%' OR message IN ('stranger','dupe')").all() as { target: string; message: string }[];
    expect(rows.map((r) => r.target).sort()).toEqual(ids.map((id) => `player:${id}`).sort());
    expect(rows.every((r) => r.message === `Recap for ${r.target.split(':')[1]}`)).toBe(true);
  });

  it('re-roll request ids never spend twice', async () => {
    const { t, gm, ids, g } = await boardNight();
    const before = (t.ctx.db.prepare('SELECT reroll_tokens_left l FROM player WHERE id = ?').get(ids[0]) as { l: number }).l;
    const body = { gameId: g.id, playerId: ids[0], requestId: 'req-abcdef12' };
    const [a, b2] = await Promise.all([call(t, gm, 'POST', '/api/rerolls', body), call(t, gm, 'POST', '/api/rerolls', body)]);
    expect(a.statusCode).toBe(200);
    expect(b2.statusCode).toBe(200);
    const after = (t.ctx.db.prepare('SELECT reroll_tokens_left l FROM player WHERE id = ?').get(ids[0]) as { l: number }).l;
    expect(after).toBe(before - 1);
  });

  it('board settings: Master only, reset with null, in the GM view and never in the public view', async () => {
    const { t, gm, g } = await boardNight();
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Sub', password: 'subpass123', pin: '5555' });
    const sub = await loginAs(t, 'Sub', 'subpass123');
    expect((await call(t, sub, 'PATCH', '/api/boards/risk/settings', { reinforceMin: 4 })).statusCode).toBe(403);
    expect((await call(t, gm, 'PATCH', '/api/boards/risk/settings', { reinforceMin: 4, logMax: 300 })).json().settings).toEqual({ reinforceMin: 4, logMax: 300 });
    expect((await call(t, gm, 'PATCH', '/api/boards/risk/settings', { logMax: null })).json().settings).toEqual({ reinforceMin: 4 });
    expect((await call(t, gm, 'PATCH', '/api/boards/risk/settings', { 'bad key': 1 })).json().error).toBe('bad_settings');
    await call(t, gm, 'PUT', `/api/games/${g.id}/board`, { state: { secretBoardThing: 1 }, version: 0 });
    const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    expect(gmView(t.ctx, st).gm.boardSettings).toEqual({ risk: { reinforceMin: 4 } });
    const pub = JSON.stringify(publicView(t.ctx, st));
    expect(pub).not.toContain('boardSettings');
    expect(pub).not.toContain('secretBoardThing');
  });
});

describe('player battle entries (Risk)', () => {
  it('a player logs a battle; GMs see it; the first decision counts; the phone shows standings and status', async () => {
    const { t, gm, devices, ids, g } = await boardNight();
    const dev = (payload: unknown) => t.app.inject({ method: 'POST', url: `/api/games/${g.id}/claims`, payload: payload as object, headers: { 'x-device-token': devices[0]!.token } });
    const r = await dev({ defenderId: ids[1], territories: 2, rounds: 3 });
    expect(r.statusCode).toBe(200);
    const claim = r.json().claim;
    expect(claim.payload).toMatchObject({ attackerId: ids[0], defenderId: ids[1], territories: 2, rounds: 3, attackerLosses: null });
    expect((await dev({ defenderId: ids[0], territories: 1 })).statusCode).toBe(400);
    expect((await call(t, gm, 'GET', `/api/games/${g.id}/board`)).json().claims).toHaveLength(1);
    expect((await call(t, gm, 'POST', `/api/claims/${claim.id}/decide`, { approve: true })).statusCode).toBe(200);
    expect((await call(t, gm, 'POST', `/api/claims/${claim.id}/decide`, { approve: false })).statusCode).toBe(409);
    expect((await call(t, gm, 'GET', `/api/games/${g.id}/board`)).json().claims).toHaveLength(0);
    const { playerView } = await import('../src/services/views');
    const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    const me = playerView(t.ctx, st, ids[0]!)!.me!;
    expect(me.boardGames).toHaveLength(1);
    expect(me.boardGames[0]!.myClaims[0]!.status).toBe('approved');
  });
});
