import { describe, expect, it } from 'vitest';
import { makeApp, setupMaster } from './helpers';

describe('security', () => {
  it('GM login: after 5 wrong passwords the name is locked for a doubling wait; the right one clears it', async () => {
    const t = await makeApp();
    await setupMaster(t);
    const login = (password: string, name = 'Boss') => t.app.inject({ method: 'POST', url: '/api/gm/login', payload: { name, password } });
    for (let i = 0; i < 5; i++) expect((await login('nope')).statusCode).toBe(401);
    const locked = await login('correct horse');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().message).toMatch(/Wait 30 s/);
    t.clock.advance(31_000);
    expect((await login('nope')).statusCode).toBe(401); // 6th wrong: 60 s now
    expect((await login('correct horse')).statusCode).toBe(429);
    t.clock.advance(61_000);
    expect((await login('correct horse')).statusCode).toBe(200);
    expect((await login('nope')).statusCode).toBe(401); // cleared: counting again from zero
    expect((await login('correct horse')).statusCode).toBe(200);
  });

  it('device PIN unlock is braked the same way', async () => {
    const t = await makeApp();
    const gm = await setupMaster(t);
    const unlock = (pin: string) => t.app.inject({ method: 'POST', url: '/api/gm/unlock', payload: { pin }, headers: { cookie: gm } });
    for (let i = 0; i < 5; i++) expect((await unlock('0000')).statusCode).toBe(401);
    expect((await unlock('1234')).statusCode).toBe(429);
  });

  it('every response carries nosniff / no framing; pages would carry a strict CSP', async () => {
    const t = await makeApp();
    const r = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['content-security-policy']).toBeUndefined(); // JSON, not a page
  });
});
