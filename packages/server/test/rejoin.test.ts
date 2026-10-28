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
