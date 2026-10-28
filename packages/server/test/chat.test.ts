import { describe, expect, it } from 'vitest';
import { computeNightState, currentNight } from '../src/services/state';
import { playerView, publicView } from '../src/services/views';
import { recordingBus } from '../src/context';
import { call, liveNight, makeApp } from './helpers';

type T = Awaited<ReturnType<typeof makeApp>>;
const as = (t: T, token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, payload: payload as object | undefined, headers: { 'x-device-token': token } });

describe('player chat', () => {
  it('one-to-one threads are reused; groups; messages kept with time; unread counts; members only', async () => {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 4);
    const [a, b, c, d] = devices as [{ id: number; token: string }, { id: number; token: string }, { id: number; token: string }, { id: number; token: string }];
    const dm = (await as(t, a.token, 'POST', '/api/me/chats', { members: [b.id] })).json().chat;
    expect(dm.kind).toBe('dm');
    expect((await as(t, b.token, 'POST', '/api/me/chats', { members: [a.id] })).json().chat.id).toBe(dm.id);
    const grp = (await as(t, a.token, 'POST', '/api/me/chats', { members: [b.id, c.id], name: 'Cartel' })).json().chat;
    expect(grp).toMatchObject({ kind: 'group', name: 'Cartel', members: [a.id, b.id, c.id].sort((x, y) => x - y) });
    const m1 = (await as(t, a.token, 'POST', `/api/me/chats/${dm.id}/messages`, { text: 'sell BEN', clientId: 'abc123' })).json().message;
    // double tap: same client id -> same message
    expect((await as(t, a.token, 'POST', `/api/me/chats/${dm.id}/messages`, { text: 'sell BEN', clientId: 'abc123' })).json().message.id).toBe(m1.id);
    expect(m1.createdAt).toBe(t.ctx.now());
    expect((await as(t, b.token, 'GET', '/api/me/chats')).json().chats.find((x: { id: number }) => x.id === dm.id).unread).toBe(1);
    expect((await as(t, d.token, 'GET', `/api/me/chats/${dm.id}`)).statusCode).toBe(404); // not a member
    expect((await as(t, d.token, 'POST', `/api/me/chats/${dm.id}/messages`, { text: 'hi' })).statusCode).toBe(404);
    await as(t, b.token, 'POST', `/api/me/chats/${dm.id}/read`, {});
    expect((await as(t, b.token, 'GET', '/api/me/chats')).json().chats.find((x: { id: number }) => x.id === dm.id).unread).toBe(0);
    expect((await as(t, a.token, 'POST', `/api/me/chats/${dm.id}/messages`, { text: '   ' })).json().error).toBe('chat_empty');
    // GM reads everything
    const gmList = (await call(t, gm, 'GET', '/api/gm/chats')).json().chats;
    expect(gmList.length).toBe(2);
    expect((await call(t, gm, 'GET', `/api/gm/chats/${dm.id}`)).json().messages[0].text).toBe('sell BEN');
    // export has it
    const exp = (await call(t, gm, 'GET', '/api/export/night.json?night=1')).json();
    expect(exp.chat.messages.length).toBe(1);
    // never in the public view
    const st = computeNightState(t.ctx, currentNight(t.ctx)!.id)!;
    expect(JSON.stringify(publicView(t.ctx, st))).not.toContain('sell BEN');
    expect(playerView(t.ctx, st, b.id)!.me.chatUnread).toBe(0);
  });

  it('pushes new messages to members only', async () => {
    const t = await makeApp();
    const bus = recordingBus();
    t.ctx.bus = bus.bus;
    const { devices } = await liveNight(t, 3);
    const [a, b, c] = devices as [{ id: number; token: string }, { id: number; token: string }, { id: number; token: string }];
    const dm = (await as(t, a.token, 'POST', '/api/me/chats', { members: [b.id] })).json().chat;
    await as(t, a.token, 'POST', `/api/me/chats/${dm.id}/messages`, { text: 'psst' });
    const pushes = bus.events.filter((e) => e.event === 'chat:message').map((e) => e.target);
    expect(pushes).toContain(a.id);
    expect(pushes).toContain(b.id);
    expect(pushes).not.toContain(c.id);
  });
});

describe('wiretap memo reward', () => {
  async function setup(mode: 'any' | 'pair') {
    const t = await makeApp();
    const { gm, devices } = await liveNight(t, 4);
    const [a, b, c, spy] = devices as [{ id: number; token: string }, { id: number; token: string }, { id: number; token: string }, { id: number; token: string }];
    const ab = (await as(t, a.token, 'POST', '/api/me/chats', { members: [b.id] })).json().chat;
    await as(t, a.token, 'POST', `/api/me/chats/${ab.id}/messages`, { text: 'A to B' });
    const memo = (await call(t, gm, 'POST', '/api/challenges', { playerId: spy.id, text: 'Do the thing', reward: { type: 'wiretap', mode } })).json();
    const id = memo.id;
    await as(t, spy.token, 'POST', `/api/me/challenges/${id}/read`);
    await as(t, spy.token, 'POST', `/api/me/challenges/${id}/respond`, { accept: true });
    await call(t, gm, 'POST', `/api/challenges/${id}/resolve`, { success: true });
    return { t, gm, a, b, c, spy, id, ab };
  }
  it('any: one random message from a chat the holder is not in; once only; victims are not told', async () => {
    const { t, spy, id, a, b } = await setup('any');
    const r = (await as(t, spy.token, 'POST', `/api/me/challenges/${id}/wiretap`, {})).json();
    expect(r.message.text).toBe('A to B');
    expect(r.thread.members.sort()).toEqual([a.id, b.id].sort());
    expect((await as(t, spy.token, 'POST', `/api/me/challenges/${id}/wiretap`, {})).json().message.id).toBe(r.message.id); // same result again
    const notes = t.ctx.db.prepare('SELECT COUNT(*) c FROM notification').get() as { c: number };
    expect(notes.c).toBe(0);
  });
  it('pair: only messages between the two chosen players; nothing between them leaves it unused', async () => {
    const { t, spy, id, a, b, c } = await setup('pair');
    const none = await as(t, spy.token, 'POST', `/api/me/challenges/${id}/wiretap`, { a: a.id, b: c.id });
    expect(none.json().error).toBe('wiretap_nothing');
    const r = (await as(t, spy.token, 'POST', `/api/me/challenges/${id}/wiretap`, { a: b.id, b: a.id })).json();
    expect(r.message.text).toBe('A to B');
  });
});
