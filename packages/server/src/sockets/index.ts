import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { Bus, Ctx } from '../context';
import { authFromToken, type GmAuth } from '../services/gm';
import { playerFromDevice } from '../services/players';
import { computeNightState, currentNight } from '../services/state';
import { gmView, playerView, publicView } from '../services/views';

export const GM_COOKIE = 'gn_gm';

type Role = { kind: 'gm'; auth: GmAuth } | { kind: 'player'; playerId: number } | { kind: 'tv' };

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Socket.IO with server-side role resolution. Rooms: 'public' (tv + players), 'tv', 'gm',
 * `player:<id>`, `gms:<sessionId>`. Clients get a role-filtered snapshot on connect/reconnect
 * and role-filtered updates on every refresh.
 */
export function attachSockets(ctx: Ctx, server: HttpServer): { io: Server; bus: Bus } {
  const io = new Server(server, { path: '/socket.io', serveClient: false });

  io.use((socket, next) => {
    const want = (socket.handshake.auth as { role?: string })?.role;
    if (want === 'gm') {
      const auth = authFromToken(ctx, parseCookies(socket.handshake.headers.cookie)[GM_COOKIE]);
      if (!auth) return next(new Error('unauthorized'));
      socket.data.role = { kind: 'gm', auth } satisfies Role;
    } else if (want === 'player') {
      const p = playerFromDevice(ctx, (socket.handshake.auth as { deviceToken?: string }).deviceToken);
      if (!p) return next(new Error('unknown_device'));
      socket.data.role = { kind: 'player', playerId: p.id } satisfies Role;
    } else {
      socket.data.role = { kind: 'tv' } satisfies Role;
    }
    next();
  });

  io.on('connection', (socket: Socket) => {
    const role = socket.data.role as Role;
    if (role.kind === 'gm') {
      // A remotely paused GM device only gets the public (TV-style) view.
      socket.join([role.auth.paused ? 'public' : 'gm', `gms:${role.auth.sessionId}`]);
    } else if (role.kind === 'player') {
      socket.join(['public', `player:${role.playerId}`]);
    } else {
      socket.join(['public', 'tv']);
    }
    socket.emit('snapshot', snapshotFor(ctx, role));
  });

  // Coalesce refreshes: many writes in one tick → one broadcast.
  const pending = new Set<number>();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    for (const nightId of pending) broadcastState(ctx, io, nightId);
    pending.clear();
  };

  const bus: Bus = {
    all: (event, data) => void io.emit(event, data),
    gm: (event, data) => void io.to('gm').emit(event, data),
    tv: (event, data) => void io.to('tv').emit(event, data),
    player: (playerId, event, data) => void io.to(`player:${playerId}`).emit(event, data),
    gmSession: (sessionId, event, data) => {
      const room = `gms:${sessionId}`;
      if (event === 'gm:device_pause') {
        const paused = !!(data as { paused?: boolean }).paused;
        io.in(room).socketsLeave(paused ? 'gm' : 'public');
        io.in(room).socketsJoin(paused ? 'public' : 'gm');
      }
      io.to(room).emit(event, data);
    },
    refresh: (nightId) => {
      pending.add(nightId);
      if (!scheduled) {
        scheduled = true;
        setImmediate(flush);
      }
    },
  };
  return { io, bus };
}

function snapshotFor(ctx: Ctx, role: Role) {
  const n = currentNight(ctx);
  const base = { role: role.kind, ...(role.kind === 'gm' ? { gm: { name: role.auth.name, role: role.auth.role, deviceType: role.auth.deviceType, paused: role.auth.paused } } : {}) };
  if (!n) return { ...base, night: null };
  const st = computeNightState(ctx, n.id)!;
  if (role.kind === 'gm') return { ...base, ...(role.auth.paused ? publicView(ctx, st) : gmView(ctx, st)) };
  if (role.kind === 'player') return { ...base, ...(playerView(ctx, st, role.playerId) ?? publicView(ctx, st)) };
  return { ...base, ...publicView(ctx, st) };
}

/** One state computation, three filtered audiences. */
function broadcastState(ctx: Ctx, io: Server, nightId: number) {
  const st = computeNightState(ctx, nightId);
  if (!st) return;
  const pub = publicView(ctx, st);
  io.to('public').emit('state:update', pub);
  io.to('gm').emit('state:update', gmView(ctx, st, pub));
  for (const p of st.players) {
    const room = io.sockets.adapter.rooms.get(`player:${p.id}`);
    if (room && room.size) io.to(`player:${p.id}`).emit('player:update', playerView(ctx, st, p.id, pub)!.me);
  }
}
