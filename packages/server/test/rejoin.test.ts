import { describe, expect, it } from 'vitest';
import { call, liveNight, makeApp } from './helpers';

const PHONE = 'phone-aaaaaaaaaaaaaaaa';
describe('rejoin from the phone the player joined on', () => {
  it('is approved at once; any other phone still needs a GM', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 0, { start: false });
    const j = (await call(t, null, 'POST', '/api/join', { displayName: 'Ann', ticker: 'ANN', phoneId: PHONE })).json();
    await call(t, gm, 'POST', '/api/night/start');
    const same = (await call(t, null, 'POST', '/api/join/rejoin', { playerId: j.playerId, phoneId: PHONE })).json();
    expect(same.approved).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: '/api/me', headers: { 'x-device-token': same.deviceToken } })).json().player.id).toBe(j.playerId);
    const other = (await call(t, null, 'POST', '/api/join/rejoin', { playerId: j.playerId, phoneId: 'phone-bbbbbbbbbbbbbbbb' })).json();
    expect(other.approved).toBe(false);
    const none = (await call(t, null, 'POST', '/api/join/rejoin', { playerId: j.playerId })).json();
    expect(none.approved).toBe(false);
    const pend = (await call(t, gm, 'GET', '/api/night')).json().gm.requests;
    expect(pend.length).toBe(2);
    const audit = t.ctx.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'device.auto_approve'").get() as { c: number };
    expect(audit.c).toBe(1);
  });
  it('late joiners keep their phone too', async () => {
    const t = await makeApp();
    const { gm } = await liveNight(t, 2);
    const j = (await call(t, null, 'POST', '/api/join', { displayName: 'Late', ticker: 'LAT', phoneId: PHONE })).json();
    expect(j.pending).toBe(true);
    const req = (await call(t, gm, 'GET', '/api/night')).json().gm.requests[0];
    const pid = (await call(t, gm, 'POST', `/api/requests/${req.id}/approve`)).json().playerId;
    expect((await call(t, null, 'POST', '/api/join/rejoin', { playerId: pid, phoneId: PHONE })).json().approved).toBe(true);
  });
});

describe('stale rejoin requests leave the GM list', () => {
  const pending = async (t: Awaited<ReturnType<typeof makeApp>>, gm: string) => (await call(t, gm, 'GET', '/api/night')).json().gm.requests as { id: number; playerId: number }[];
  const cancel = (t: Awaited<ReturnType<typeof makeApp>>, token?: string) => t.app.inject({ method: 'POST', url: '/api/join/cancel', headers: token ? { 'x-device-token': token } : {} });
  async function twoPlayers() {
    const t = await makeApp();
    const { gm } = await liveNight(t, 0, { start: false });
    const ann = (await call(t, null, 'POST', '/api/join', { displayName: 'Ann', ticker: 'ANN', phoneId: PHONE })).json();
    const ben = (await call(t, null, 'POST', '/api/join', { displayName: 'Ben', ticker: 'BEN', phoneId: 'phone-bbbbbbbbbbbbbbbb' })).json();
    await call(t, gm, 'POST', '/api/night/start');
    return { t, gm, ann: ann.playerId as number, ben: ben.playerId as number };
  }
  it('Cancel removes the pending request; cancelling twice or with a bad token is harmless', async () => {
    const { t, gm, ann } = await twoPlayers();
    const other = (await call(t, null, 'POST', '/api/join/rejoin', { playerId: ann, phoneId: 'phone-cccccccccccccccc' })).json();
    expect((await pending(t, gm)).length).toBe(1);
    expect((await cancel(t, other.deviceToken)).json()).toEqual({ ok: true, status: 'cancelled' });
    expect((await pending(t, gm)).length).toBe(0);
    expect((await t.app.inject({ method: 'GET', url: '/api/join/status', headers: { 'x-device-token': other.deviceToken } })).json().status).toBe('unknown');
    expect((await cancel(t, other.deviceToken)).statusCode).toBe(200);
    expect((await cancel(t, 'nonsense')).statusCode).toBe(200);
    expect((await cancel(t)).statusCode).toBe(200);
  });
  it("Cancel only removes that phone's own request", async () => {
    const { t, gm, ann, ben } = await twoPlayers();
    const a = (await call(t, null, 'POST', '/api/join/rejoin', { playerId: ann, phoneId: 'phone-cccccccccccccccc' })).json();
    await call(t, null, 'POST', '/api/join/rejoin', { playerId: ben, phoneId: 'phone-dddddddddddddddd' });
    await cancel(t, a.deviceToken);
    expect((await pending(t, gm)).map((r) => r.playerId)).toEqual([ben]);
  });
  it('a new request from the same phone replaces its older pending one (wrong name, closed tab, right name)', async () => {
    const { t, gm, ann, ben } = await twoPlayers();
    await call(t, null, 'POST', '/api/join/rejoin', { playerId: ann, phoneId: 'phone-cccccccccccccccc' });
    await call(t, null, 'POST', '/api/join/rejoin', { playerId: ben, phoneId: 'phone-cccccccccccccccc' });
    expect((await pending(t, gm)).map((r) => r.playerId)).toEqual([ben]);
    // Another phone's request is left alone.
    await call(t, null, 'POST', '/api/join/rejoin', { playerId: ann, phoneId: 'phone-dddddddddddddddd' });
    expect((await pending(t, gm)).length).toBe(2);
  });
  it('an auto-approved rejoin on the home phone also clears that phone\'s older pending request', async () => {
    const { t, gm, ann, ben } = await twoPlayers();
    await call(t, null, 'POST', '/api/join/rejoin', { playerId: ben, phoneId: PHONE }); // Ann's phone picks Ben: needs a GM
    expect((await pending(t, gm)).length).toBe(1);
    expect((await call(t, null, 'POST', '/api/join/rejoin', { playerId: ann, phoneId: PHONE })).json().approved).toBe(true);
    expect((await pending(t, gm)).length).toBe(0);
  });
  it('Cancel after the GM already approved reports it and leaves the approval intact', async () => {
    const { t, gm, ann } = await twoPlayers();
    const a = (await call(t, null, 'POST', '/api/join/rejoin', { playerId: ann, phoneId: 'phone-cccccccccccccccc' })).json();
    const [req] = await pending(t, gm);
    expect((await call(t, gm, 'POST', `/api/requests/${req!.id}/approve`)).statusCode).toBe(200);
    expect((await cancel(t, a.deviceToken)).json()).toEqual({ ok: true, status: 'approved' });
    expect((await t.app.inject({ method: 'GET', url: '/api/join/status', headers: { 'x-device-token': a.deviceToken } })).json().status).toBe('approved');
    expect((await t.app.inject({ method: 'GET', url: '/api/me', headers: { 'x-device-token': a.deviceToken } })).statusCode).toBe(200);
  });
});
