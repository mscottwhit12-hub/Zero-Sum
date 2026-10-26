import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { seedLibraryOnce } from '../src/services/library';
import { computeNightState, currentNight } from '../src/services/state';
import { gmView, publicView } from '../src/services/views';
import { call, FORBIDDEN_KEYS, liveNight, loginAs, makeApp } from './helpers';

const PACK = fileURLToPath(new URL('../../../assets/sample-library.json', import.meta.url));

describe('library', () => {
  it('seeds the generic examples once, never again', async () => {
    const t = await makeApp();
    expect(seedLibraryOnce(t.ctx, PACK)).toBe(true);
    const gm = await (await import('./helpers')).setupMaster(t);
    const games = (await call(t, gm, 'GET', '/api/library')).json().games;
    expect(games.length).toBe(5);
    expect(games.every((g: { name: string }) => g.name.startsWith('Example:'))).toBe(true);
    for (const g of games) await call(t, gm, 'DELETE', `/api/library/${g.id}`);
    expect(seedLibraryOnce(t.ctx, PACK)).toBe(false);
    expect((await call(t, gm, 'GET', '/api/library')).json().games).toEqual([]);
  });

  it('CRUD with validation; Master only; import/export round-trip', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2, { start: false });
    const bad = await call(t, gm, 'POST', '/api/library', { name: 'X', minPlayers: 5, maxPlayers: 2 });
    expect(bad.json().error).toBe('bad_max_players');
    const created = (await call(t, gm, 'POST', '/api/library', { name: 'Quick Dice', minPlayers: 2, maxPlayers: 6, defaultDuration: 0.5, mode: 'competitive', rerollsAllowed: true })).json().game;
    expect(created).toMatchObject({ name: 'Quick Dice', rerollsAllowed: true, defaultDuration: 0.5 });
    expect((await call(t, gm, 'POST', '/api/library', { name: 'quick dice' })).json().error).toBe('name_taken');
    expect((await call(t, gm, 'PATCH', `/api/library/${created.id}`, { mode: 'coop' })).json().game.mode).toBe('coop');
    const pack = (await call(t, gm, 'GET', '/api/library/export')).json();
    expect(pack.format).toBe('game-night-pack/1');
    pack.games.push({ name: 'Imported Game', minPlayers: 3, maxPlayers: 5, defaultDuration: 1, mode: 'team' });
    expect((await call(t, gm, 'POST', '/api/library/import', pack)).json()).toEqual({ added: 1, updated: 1 });
    expect((await call(t, gm, 'POST', '/api/library/import', { games: [{ name: '' }] })).json().error).toBe('bad_pack_entry');
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Helper', password: 'helper pass', pin: '5555' });
    const sub = await loginAs(t, 'Helper', 'helper pass');
    expect((await call(t, sub, 'POST', '/api/library', { name: 'Nope' })).statusCode).toBe(403);
    expect((await call(t, sub, 'GET', '/api/library')).statusCode).toBe(200);
  });
});

async function nightWithGame(players = 4, game: Record<string, unknown> = {}) {
  const t = await makeApp();
  const night = await liveNight(t, players);
  const lib = (await call(t, night.gm, 'POST', '/api/library', { name: 'Card Game', minPlayers: 2, maxPlayers: 6, defaultDuration: 1, mode: 'competitive', ...game })).json().game;
  const ids = night.devices.map((d) => d.id);
  const g = (await call(t, night.gm, 'POST', '/api/games', { libraryGameId: lib.id, participants: ids })).json().game;
  return { t, ...night, ids, game: g, lib };
}

describe('schedule and results', () => {
  it('schedule copies library defaults; start → wizard → final; gold lands, TV sees it', async () => {
    const { t, gm, ids, game } = await nightWithGame(4);
    expect(game).toMatchObject({ name: 'Card Game', mode: 'competitive', status: 'scheduled', planned_duration_hours: 1 });
    expect((await call(t, gm, 'POST', `/api/games/${game.id}/start`)).json().game.status).toBe('active');
    t.clock.advance(30 * 60_000);
    await call(t, gm, 'POST', '/api/night/pause');
    t.clock.advance(15 * 60_000);
    await call(t, gm, 'POST', '/api/night/resume');
    t.clock.advance(30 * 60_000);
    // 75 min wall, 15 paused → 1.0 h
    expect((await call(t, gm, 'GET', `/api/games/${game.id}/prefill`)).json().suggestedHours).toBe(1);

    const res = await call(t, gm, 'POST', `/api/games/${game.id}/result`, {
      actualHours: 1,
      participants: [
        { playerId: ids[0], placement: 1 },
        { playerId: ids[1], placement: 2 },
        { playerId: ids[2], placement: 3 },
        { playerId: ids[3], dnf: true },
      ],
    });
    // gold = 1h × 4 players × mult × 3
    expect(res.json().gold.map((x: { goldH: number }) => x.goldH)).toEqual([1200, 600, 300, 0]);
    const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    // 3200 + first_blood achievement (skill, 2 gold)
    expect(st.standings[0]).toMatchObject({ playerId: String(ids[0]), netWorthH: 3400, rank: 1 });
    const pub = publicView(t.ctx, st);
    expect(pub.games[0]).toMatchObject({ status: 'final', hours: 1 });
    expect(pub.feed[0]).toMatchObject({ type: 'result', message: 'feed.game_result' });
    expect((await call(t, gm, 'POST', `/api/games/${game.id}/result`, { actualHours: 1, participants: [{ playerId: ids[0], placement: 1 }] })).json().error).toBe('game_not_open');
    expect(t.ctx.db.prepare('SELECT COUNT(*) c FROM standings_snapshot').get()).toEqual({ c: 1 });
  });

  it('team and co-op wizards', async () => {
    const team = await nightWithGame(4, { name: 'Team Game', mode: 'team' });
    const r1 = await call(team.t, team.gm, 'POST', `/api/games/${team.game.id}/result`, {
      actualHours: 0.5,
      participants: [
        { playerId: team.ids[0], team: 'A', placement: 1 },
        { playerId: team.ids[1], team: 'A', placement: 1 },
        { playerId: team.ids[2], team: 'B', placement: 2 },
        { playerId: team.ids[3], team: 'B', placement: 2 },
      ],
    });
    expect(r1.json().gold.map((x: { goldH: number }) => x.goldH)).toEqual([600, 600, 300, 300]);

    const coop = await nightWithGame(3, { name: 'Coop Game', mode: 'coop' });
    const parts = coop.ids.map((playerId) => ({ playerId }));
    expect((await call(coop.t, coop.gm, 'POST', `/api/games/${coop.game.id}/result`, { actualHours: 1, participants: parts })).json().error).toBe('bad_result');
    const r2 = await call(coop.t, coop.gm, 'POST', `/api/games/${coop.game.id}/result`, { actualHours: 1, participants: parts, coopWon: false });
    expect(r2.json().gold.map((x: { goldH: number }) => x.goldH)).toEqual([225, 225, 225]); // 1 × 3 × 0.25 × 3
  });

  it('rejects bad wizard input', async () => {
    const { t, gm, ids, game } = await nightWithGame(3);
    const post = (body: unknown) => call(t, gm, 'POST', `/api/games/${game.id}/result`, body);
    expect((await post({ actualHours: 1, participants: [] })).json().error).toBe('bad_participants');
    expect((await post({ actualHours: 0, participants: [{ playerId: ids[0], placement: 1 }] })).json().error).toBe('bad_result');
    expect((await post({ actualHours: 1, participants: [{ playerId: ids[0] }] })).json().error).toBe('bad_result');
    expect((await post({ actualHours: 1, participants: [{ playerId: 999, placement: 1 }] })).json().error).toBe('unknown_player');
  });

  it('corrections re-derive gold, keep price history, and hit the GM-only feed', async () => {
    const { t, gm, ids, game } = await nightWithGame(2);
    await call(t, gm, 'POST', `/api/games/${game.id}/result`, { actualHours: 1, participants: [{ playerId: ids[0], placement: 1 }, { playerId: ids[1], placement: 2 }] });
    const n = currentNight(t.ctx)!;
    const before = computeNightState(t.ctx, n.id)!.ledger.get(String(ids[0]))!.resultsH;
    const fix = await call(t, gm, 'POST', `/api/games/${game.id}/correct`, { actualHours: 1, participants: [{ playerId: ids[0], placement: 2 }, { playerId: ids[1], placement: 1 }] });
    expect(fix.statusCode).toBe(200);
    const after = computeNightState(t.ctx, n.id)!.ledger;
    expect(after.get(String(ids[1]))!.resultsH).toBe(before);
    const st = computeNightState(t.ctx, n.id)!;
    expect(gmView(t.ctx, st).gm.feed[0]).toMatchObject({ type: 'correction', gmOnly: true });
    expect(publicView(t.ctx, st).feed.some((f) => f.type === 'correction')).toBe(false);
    expect(t.ctx.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'game.correct'").get()).toEqual({ c: 1 });
  });

  it('Sub GMs can run games but not schedule them', async () => {
    const { t, gm, ids, game } = await nightWithGame(2);
    await call(t, gm, 'POST', '/api/gm/gms', { name: 'Helper', password: 'helper pass', pin: '5555' });
    const sub = await loginAs(t, 'Helper', 'helper pass');
    expect((await call(t, sub, 'POST', '/api/games', { name: 'X' })).statusCode).toBe(403);
    expect((await call(t, sub, 'POST', `/api/games/${game.id}/start`)).statusCode).toBe(200);
    expect((await call(t, sub, 'POST', `/api/games/${game.id}/leader`, { playerId: ids[0] })).statusCode).toBe(200);
    expect((await call(t, sub, 'POST', `/api/games/${game.id}/result`, { actualHours: 1, participants: [{ playerId: ids[0], placement: 1 }, { playerId: ids[1], placement: 2 }] })).statusCode).toBe(200);
  });
});

describe('leader taps', () => {
  it('crown on the TV; dethroned is public; kingfall is GM-only and queues a hidden crypto spike', async () => {
    const { t, gm, ids, game } = await nightWithGame(3);
    await call(t, gm, 'POST', `/api/games/${game.id}/start`);
    expect((await call(t, gm, 'POST', `/api/games/${game.id}/leader`, { playerId: 999 })).json().error).toBe('not_a_participant');
    await call(t, gm, 'POST', `/api/games/${game.id}/leader`, { playerId: ids[0] });
    const n = currentNight(t.ctx)!;
    expect(publicView(t.ctx, computeNightState(t.ctx, n.id)!).games[0]!.leaderId).toBe(ids[0]);

    t.clock.advance(5 * 60_000);
    const quick = (await call(t, gm, 'POST', `/api/games/${game.id}/leader`, { playerId: ids[1] })).json();
    expect(quick).toMatchObject({ changed: true, dethroned: true });
    expect(t.ctx.db.prepare('SELECT COUNT(*) c FROM impulse').get()).toEqual({ c: 0 }); // held 5 min: no kingfall

    t.clock.advance(16 * 60_000);
    await call(t, gm, 'POST', `/api/games/${game.id}/leader`, { playerId: ids[2] });
    expect(t.ctx.db.prepare("SELECT cause, frac FROM impulse").all()).toEqual([{ cause: 'kingfall', frac: 0.1 }]);
    const st = computeNightState(t.ctx, n.id)!;
    const pub = publicView(t.ctx, st);
    expect(pub.feed.filter((f) => f.type === 'dethroned')).toHaveLength(2);
    expect(pub.feed.some((f) => f.type === 'kingfall')).toBe(false);
    expect(gmView(t.ctx, st).gm.feed.some((f) => f.type === 'kingfall')).toBe(true);
    for (const k of FORBIDDEN_KEYS) expect(JSON.stringify(pub)).not.toContain(k);
    // Same leader again: no-op
    expect((await call(t, gm, 'POST', `/api/games/${game.id}/leader`, { playerId: ids[2] })).json().changed).toBe(false);
  });
});
