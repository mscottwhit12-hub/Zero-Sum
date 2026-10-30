import { io, type Socket } from 'socket.io-client';
import { writable, type Readable } from 'svelte/store';

export type Role = 'gm' | 'tv' | 'player';

export interface Live<T> {
  state: Readable<T | null>;
  connected: Readable<boolean>;
  socket: Socket;
  close(): void;
}

/**
 * Connects with a role; the server decides what this socket may see. A full snapshot arrives on
 * every (re)connect, then filtered `state:update`s. Extra events are passed to `on`.
 */
export function connectLive<T extends object>(role: Role, auth: Record<string, unknown> = {}, on: Record<string, (data: unknown) => void> = {}): Live<T> {
  const state = writable<T | null>(null);
  const connected = writable(false);
  const socket = io({ path: '/socket.io', auth: { role, ...auth }, transports: ['websocket', 'polling'] });
  socket.on('connect', () => connected.set(true));
  socket.on('disconnect', () => connected.set(false));
  socket.on('snapshot', (s: T) => state.set(s));
  socket.on('state:update', (u: Partial<T>) => state.update((cur) => (cur ? mergeUpdate(cur, u) : (u as T))));
  // Players: private `me` updates live in the same store so later public updates don't revert them.
  socket.on('player:update', (me: unknown) => state.update((cur) => (cur ? ({ ...cur, me } as T) : cur)));
  socket.on('minter:leaderboard', (d: { leaderboard: unknown }) => state.update((cur) => (cur ? ({ ...cur, minter: { leaderboard: d.leaderboard } } as T) : cur)));
  for (const [ev, fn] of Object.entries(on)) socket.on(ev, fn);
  return { state, connected, socket, close: () => socket.close() };
}

type MarketRow = { id: string; price: number; history?: number[]; tail?: [number, number][] } & Record<string, unknown>;
const HISTORY_POINTS = 60;

/**
 * Updates carry only the parts that changed. Top-level keys replace; the GM's `gm` block merges one level deeper;
 * market rows arrive without full history but with their last few [tick, price] points, appended here.
 */
export function mergeUpdate<T extends object>(cur: T, u: Partial<T>): T {
  const c = cur as Record<string, unknown>;
  const x = u as Record<string, unknown>;
  const out: Record<string, unknown> = { ...c, ...x };
  if (x.gm && c.gm) out.gm = { ...(c.gm as object), ...(x.gm as object) };
  if (Array.isArray(x.market)) {
    const prevTick = typeof c.marketTick === 'number' ? c.marketTick : -1;
    const prev = new Map(((c.market as MarketRow[] | undefined) ?? []).map((m) => [m.id, m]));
    out.market = (x.market as MarketRow[]).map((m) => {
      if (Array.isArray(m.history)) return m;
      const old = prev.get(m.id)?.history ?? [];
      const add = (m.tail ?? []).filter(([t]) => t > prevTick).map(([, p]) => p);
      const history = (old.length ? [...old, ...add] : (m.tail ?? []).map(([, p]) => p)).slice(-HISTORY_POINTS);
      const { tail: _t, ...rest } = m;
      return { ...rest, history: history.length ? history : [m.price] };
    });
  } else if (x.marketTick !== undefined && c.market) out.market = c.market;
  return out as T;
}

/** Night clock that keeps running between server updates while the night is live. */
export function nightNow(night: { nightMs: number; serverTime: number; status: string } | null | undefined, now = Date.now()): number {
  if (!night) return 0;
  return night.status === 'live' ? night.nightMs + Math.max(0, now - night.serverTime) : night.nightMs;
}

/**
 * Whole seconds until the next market tick, or null when ticks aren't running (night not live, trading closed,
 * or no tick time yet). `serverNow` is the server's clock (night.serverTime plus time since it arrived).
 */
export function secondsToNextTick(
  night: { status: string; tradingClosed: boolean; lastTickAt: number | null; tickSeconds: number } | null | undefined,
  serverNow: number,
): number | null {
  if (!night || night.status !== 'live' || night.tradingClosed || night.lastTickAt == null) return null;
  return Math.max(0, Math.ceil((night.lastTickAt + night.tickSeconds * 1000 - serverNow) / 1000));
}
