import { describe, expect, it } from 'vitest';
import { call, loginAs, makeApp, setupMaster } from './helpers';

describe('first run', () => {
  it('needs setup until a Master exists; no default credentials', async () => {
    const t = await makeApp();
    expect((await call(t, null, 'GET', '/api/setup/status')).json()).toEqual({ needsSetup: true });
    expect((await call(t, null, 'POST', '/api/gm/login', { name: 'admin', password: 'admin', deviceType: 'laptop' })).statusCode).toBe(401);
    const c = await setupMaster(t);
    expect(c).toMatch(/^gn_gm=/);
    expect((await call(t, null, 'GET', '/api/setup/status')).json()).toEqual({ needsSetup: false });
    const again = await call(t, null, 'POST', '/api/setup', { name: 'Evil', password: 'password123', pin: '0000' });
    expect(again.statusCode).toBe(409);
  });

  it('validates password and PIN', async () => {
    const t = await makeApp();
    expect((await call(t, null, 'POST', '/api/setup', { name: 'Boss', password: 'short', pin: '1234' })).json().error).toBe('bad_password');
    expect((await call(t, null, 'POST', '/api/setup', { name: 'Boss', password: 'long enough', pin: '12a' })).json().error).toBe('bad_pin');
  });

  it('stores only hashes', async () => {
    const t = await makeApp();
    await setupMaster(t);
    const row = t.ctx.db.prepare('SELECT credential_hash, pin_hash FROM game_master').get() as { credential_hash: string; pin_hash: string };
    expect(row.credential_hash).toMatch(/^scrypt\$/);
    expect(row.credential_hash).not.toContain('correct horse');
    expect(row.pin_hash).not.toContain('1234');
  });
});

describe('login and roles', () => {
  it('requires the device type and the right password', async () => {
    const t = await makeApp();
    await setupMaster(t);
    expect((await call(t, null, 'POST', '/api/gm/login', { name: 'Boss', password: 'correct horse' })).json().error).toBe('bad_device_type');
    expect((await call(t, null, 'POST', '/api/gm/login', { name: 'Boss', password: 'wrong', deviceType: 'phone' })).statusCode).toBe(401);
    const c = await loginAs(t, 'Boss', 'correct horse', 'phone');
    expect((await call(t, c, 'GET', '/api/gm/me')).json().gm).toMatchObject({ name: 'Boss', role: 'master', deviceType: 'phone', paused: false });
    await call(t, c, 'POST', '/api/gm/device-type', { deviceType: 'laptop' });
    expect((await call(t, c, 'GET', '/api/gm/me')).json().gm.deviceType).toBe('laptop');
  });

  it('Sub GMs: Master-only creation; no setup/settings; deactivation kills sessions', async () => {
    const t = await makeApp();
    const m = await setupMaster(t);
    const created = await call(t, m, 'POST', '/api/gm/gms', { name: 'Helper', password: 'helper pass', pin: '5555' });
    expect(created.statusCode).toBe(200);
    const s = await loginAs(t, 'Helper', 'helper pass');
    expect((await call(t, s, 'POST', '/api/gm/gms', { name: 'X', password: 'xxxxxxxx', pin: '1111' })).statusCode).toBe(403);
    expect((await call(t, s, 'POST', '/api/nights', { name: 'N' })).statusCode).toBe(403);
    expect((await call(t, s, 'PATCH', '/api/night/settings', {})).statusCode).toBe(403);
    expect((await call(t, s, 'GET', '/api/gm/audit')).statusCode).toBe(403);
    expect((await call(t, null, 'GET', '/api/gm/me')).statusCode).toBe(401);
    await call(t, m, 'DELETE', `/api/gm/gms/${created.json().id}`);
    expect((await call(t, s, 'GET', '/api/gm/me')).statusCode).toBe(401);
  });
});

describe('remote device lock', () => {
  it('phone pauses the laptop; laptop writes are blocked; PIN unlocks', async () => {
    const t = await makeApp();
    await setupMaster(t);
    const laptop = await loginAs(t, 'Boss', 'correct horse', 'laptop');
    const phone = await loginAs(t, 'Boss', 'correct horse', 'phone');
    const lap = { id: (await call(t, laptop, 'GET', '/api/gm/me')).json().gm.sessionId as number };
    const sessions = (await call(t, phone, 'GET', '/api/gm/sessions')).json().sessions as { id: number; deviceType: string; current: boolean }[];
    expect(sessions.some((s) => s.id === lap.id && !s.current)).toBe(true);
    const self = sessions.find((s) => s.current)!;
    expect((await call(t, phone, 'POST', `/api/gm/sessions/${self.id}/pause`)).json().error).toBe('cannot_pause_self');
    expect((await call(t, phone, 'POST', `/api/gm/sessions/${lap.id}/pause`)).statusCode).toBe(200);

    expect((await call(t, laptop, 'POST', '/api/nights', { name: 'N' })).statusCode).toBe(423);
    expect((await call(t, laptop, 'GET', '/api/gm/me')).json().gm.paused).toBe(true);
    expect((await call(t, laptop, 'POST', '/api/gm/unlock', { pin: '9999' })).statusCode).toBe(401);
    expect((await call(t, laptop, 'POST', '/api/gm/unlock', { pin: '1234' })).statusCode).toBe(200);
    expect((await call(t, laptop, 'POST', '/api/nights', { name: 'N' })).statusCode).toBe(200);

    await call(t, phone, 'POST', `/api/gm/sessions/${lap.id}/pause`);
    await call(t, phone, 'POST', `/api/gm/sessions/${lap.id}/resume`);
    expect((await call(t, laptop, 'GET', '/api/gm/me')).json().gm.paused).toBe(false);
  });

  it('every GM write lands in the audit log', async () => {
    const t = await makeApp();
    const m = await setupMaster(t);
    await call(t, m, 'POST', '/api/gm/gms', { name: 'Helper', password: 'helper pass', pin: '5555' });
    const actions = (await call(t, m, 'GET', '/api/gm/audit')).json().entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['setup.master', 'gm.login', 'gm.create_sub']));
    const audit = JSON.stringify((await call(t, m, 'GET', '/api/gm/audit')).json());
    expect(audit).not.toContain('helper pass');
  });
});
