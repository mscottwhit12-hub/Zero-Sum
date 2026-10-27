import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { Bus, Ctx } from '../context';
import { authFromToken, type GmAuth } from '../services/gm';
import { playerFromDevice } from '../services/players';
import { computeNightState, currentNight, getNight, nightMs, type NightState } from '../services/state';
import { priceHistoryPoints } from '../services/market';
import { gmView, playerView, publicView, tvView, type GmView, type PublicView } from '../services/views';

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
  // permessage-deflate: state JSON compresses ~5×; tiny frames (< 1 KB) are sent as-is.
  const io = new Server(server, { path: '/socket.io', serveClient: false, perMessageDeflate: { threshold: 1024 } });
  const views = new ViewCache(ctx);

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
    socket.emit('snapshot', views.snapshot(role));
  });

  // Coalesce refreshes: many writes → one broadcast, at most one per THROTTLE_MS (wall clock).
  const THROTTLE_MS = 250;
  const pending = new Set<number>();
  let scheduled = false;
  let lastFlush = 0;
  const flush = () => {
    scheduled = false;
    lastFlush = Date.now();
    for (const nightId of pending) views.broadcast(io, nightId);
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
      views.invalidate(nightId);
      pending.add(nightId);
      if (scheduled) return;
      scheduled = true;
      const wait = lastFlush + THROTTLE_MS - Date.now();
      if (wait > 0) setTimeout(flush, wait);
      else setImmediate(flush);
    },
  };
  return { io, bus };
}

type Json = Record<string, unknown>;

/**
 * Builds each audience's view once per broadcast and reuses it:
 *  - snapshots on (re)connect reuse the last broadcast's views while nothing has changed (reconnect storms are cheap);
 *  - updates carry only the top-level parts that changed since the last update to that room (clients merge shallowly);
 *  - price histories go out as short tails the client appends, instead of 60 points per stock every time.
 * A socket that joins mid-stream gets a full snapshot first; a freshly computed snapshot resets the deltas so
 * every room's next update is complete.
 */
class ViewCache {
  private cache = new Map<number, { st: NightState; pub: PublicView; gm: GmView; tv: Json; at: number; clean: boolean }>();
  private lastSent = new Map<string, Map<string, string>>();
  constructor(private ctx: Ctx) {}

  invalidate(nightId: number) {
    const c = this.cache.get(nightId);
    if (c) c.clean = false;
  }

  private compute(nightId: number) {
    const st = computeNightState(this.ctx, nightId);
    if (!st) return null;
    const pub = publicView(this.ctx, st);
    const entry = { st, pub, gm: gmView(this.ctx, st, pub), tv: tvView(this.ctx, st) as Json, at: Date.now(), clean: true };
    this.cache.set(nightId, entry);
    return entry;
  }

  /** Cached views if nothing changed since they were built (max 5 s); otherwise fresh ones (and full next updates). */
  private current(nightId: number) {
    const c = this.cache.get(nightId);
    if (c && c.clean && Date.now() - c.at < 5000) return c;
    const fresh = this.compute(nightId);
    for (const k of [...this.lastSent.keys()]) if (k.startsWith(`${nightId}:`)) this.lastSent.delete(k);
    return fresh;
  }

  /** The clock fields must be current even when the rest is cached. */
  private withClock<T extends { night: PublicView['night'] }>(v: T): T {
    const n = getNight(this.ctx, v.night.id);
    if (!n) return v;
    return { ...v, night: { ...v.night, serverTime: this.ctx.now(), nightMs: nightMs(this.ctx, n), pauseUntil: n.status === 'paused' ? n.pause_until : null } };
  }

  snapshot(role: Role) {
    const n = currentNight(this.ctx);
    const base = { role: role.kind, ...(role.kind === 'gm' ? { whoami: { name: role.auth.name, role: role.auth.role, deviceType: role.auth.deviceType, paused: role.auth.paused } } : {}) };
    if (!n) return { ...base, night: null };
    const c = this.current(n.id);
    if (!c) return { ...base, night: null };
    if (role.kind === 'gm') return { ...base, ...this.withClock(role.auth.paused ? c.pub : c.gm) };
    if (role.kind === 'player') return { ...base, ...this.withClock(playerView(this.ctx, c.st, role.playerId, c.pub) ?? c.pub) };
    return { ...base, ...this.withClock(c.pub), tv: c.tv };
  }

  /** Top-level keys whose JSON changed since the last update to this room. `always` keys are sent regardless. */
  private delta(room: string, obj: Json, always: string[] = []): Json {
    const prev = this.lastSent.get(room);
    const next = new Map<string, string>();
    const out: Json = {};
    for (const [k, v] of Object.entries(obj)) {
      const js = JSON.stringify(v ?? null);
      next.set(k, js);
      if (!prev || always.includes(k) || prev.get(k) !== js) out[k] = v;
    }
    this.lastSent.set(room, next);
    return out;
  }

  /** Market for updates: no full history; each stock carries its last few [tick, price] points instead. */
  private compactMarket(nightId: number, market: PublicView['market']) {
    const pts = priceHistoryPoints(this.ctx, nightId);
    return market.map(({ history: _h, ...m }) => {
      const p = pts.get(m.id);
      const tail = p ? p.ticks.slice(-3).map((t, i) => [t, p.prices.slice(-3)[i]!]) : [];
      return { ...m, tail };
    });
  }

  broadcast(io: Server, nightId: number) {
    const c = this.compute(nightId);
    if (!c) return;
    const { st, pub, gm, tv } = c;
    const pubOut: Json = { ...pub, market: this.compactMarket(nightId, pub.market) };
    io.to('public').emit('state:update', this.delta(`${nightId}:public`, pubOut, ['night', 'marketTick']));
    io.to('tv').emit('state:update', { tv });
    const { gm: extras, ...gmPublic } = gm;
    const gmOut = this.delta(`${nightId}:gm`, { ...gmPublic, market: pubOut.market }, ['night', 'marketTick']);
    gmOut.gm = this.delta(`${nightId}:gm-extras`, extras as unknown as Json);
    io.to('gm').emit('state:update', gmOut);
    for (const p of st.players) {
      const room = io.sockets.adapter.rooms.get(`player:${p.id}`);
      if (room && room.size) io.to(`player:${p.id}`).emit('player:update', playerView(this.ctx, st, p.id, pub)!.me);
    }
  }
}
