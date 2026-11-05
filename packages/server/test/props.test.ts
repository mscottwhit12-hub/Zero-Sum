import { describe, expect, it } from 'vitest';
import { fitProp, propKind } from '@gn/engine';
import { computeNightState, currentNight } from '../src/services/state';
import { tvView } from '../src/services/views';
import { call, liveNight, makeApp, type TestApp } from './helpers';

const seating = (t: TestApp) => tvView(t.ctx, computeNightState(t.ctx, currentNight(t.ctx)!.id)!).seating;

describe('table props', () => {
  it('fitProp keeps a (turned) prop inside its table, shrinking it if needed', () => {
    const can = propKind('beer-can')!;
    expect(fitProp(can, { x: 2, y: -2, w: 0.1, rotation: 0 }, 0.3, 0.15)).toEqual({ x: 0.45, y: -(0.5 - (0.1 * 0.3) / 2 / 0.15), w: 0.1, rotation: 0 });
    const board = propKind('board-risk')!;
    const big = fitProp(board, { x: 0, y: 0, w: 1, rotation: 45 }, 0.3, 0.15);
    expect(big.w).toBeLessThan(1);
    const pw = big.w * 0.3, ph = pw / board.aspect, c = Math.SQRT1_2;
    expect((pw * c + ph * c) / 2).toBeLessThanOrEqual(0.15 / 2 + 1e-9);
  });

  it('add, move, turn, delete; stays on the table; a table with props can’t be resized', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const tid = (await call(t, gm, 'POST', '/api/tables', { name: 'Main', seats: 4 })).json().id;
    expect((await call(t, gm, 'POST', `/api/tables/${tid}/props`, { kind: 'nope' })).statusCode).toBe(400);
    const pid = (await call(t, gm, 'POST', `/api/tables/${tid}/props`, { kind: 'beer-can' })).json().id;
    let p = seating(t)[0]!.props[0]!;
    expect(p).toMatchObject({ id: pid, kind: 'beer-can', x: 0, y: 0, rotation: 0, gameId: null });
    await call(t, gm, 'PATCH', `/api/props/${pid}`, { x: 9, rotation: 30 });
    p = seating(t)[0]!.props[0]!;
    expect(p.x).toBeLessThan(0.5);
    expect(p.rotation).toBe(30);
    const r = await call(t, gm, 'PATCH', `/api/tables/${tid}`, { w: 0.5 });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toMatch(/props/);
    expect((await call(t, gm, 'PATCH', `/api/tables/${tid}`, { x: 0.3, rotation: 45 })).statusCode).toBe(200); // moving and turning still fine
    await call(t, gm, 'DELETE', `/api/props/${pid}`);
    expect(seating(t)[0]!.props).toEqual([]);
    expect((await call(t, gm, 'PATCH', `/api/tables/${tid}`, { w: 0.5 })).statusCode).toBe(200);
  });

  it('table colour: set, refuse junk, clear; the bottle prop is gone', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const tid = (await call(t, gm, 'POST', '/api/tables', { name: 'Main', seats: 4 })).json().id;
    expect(seating(t)[0]!.color).toBeNull();
    expect((await call(t, gm, 'PATCH', `/api/tables/${tid}`, { color: '#1F6B3A' })).statusCode).toBe(200);
    expect(seating(t)[0]!.color).toBe('#1f6b3a');
    expect((await call(t, gm, 'PATCH', `/api/tables/${tid}`, { color: 'red; x' })).statusCode).toBe(400);
    await call(t, gm, 'PATCH', `/api/tables/${tid}`, { name: 'Big' });
    expect(seating(t)[0]!.color).toBe('#1f6b3a');
    await call(t, gm, 'PATCH', `/api/tables/${tid}`, { color: null });
    expect(seating(t)[0]!.color).toBeNull();
    expect((await call(t, gm, 'POST', `/api/tables/${tid}/props`, { kind: 'bottle' })).statusCode).toBe(400);
  });

  it('a game starting at a table puts its mini board there; the result takes it away (hand-placed props stay)', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 3);
    const tid = (await call(t, gm, 'POST', '/api/tables', { name: 'Main', seats: 4 })).json().id;
    await call(t, gm, 'POST', `/api/tables/${tid}/props`, { kind: 'dice' });
    const lib = (await call(t, gm, 'POST', '/api/library', { name: 'Risk', board: 'risk', leadMode: 'high' })).json().game;
    const ids = devices.map((d) => d.id);
    const g = (await call(t, gm, 'POST', '/api/games', { libraryGameId: lib.id, participants: ids, tableId: tid })).json().game;
    await call(t, gm, 'POST', `/api/games/${g.id}/start`);
    expect(seating(t)[0]!.props.map((p) => [p.kind, p.gameId])).toEqual([['dice', null], ['board-risk', g.id]]);
    await call(t, gm, 'POST', `/api/games/${g.id}/result`, { actualHours: 1, participants: ids.map((id, i) => ({ playerId: id, placement: i + 1 })) });
    expect(seating(t)[0]!.props.map((p) => p.kind)).toEqual(['dice']);
  });
});
