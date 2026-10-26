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
  socket.on('state:update', (u: Partial<T>) => state.update((cur) => (cur ? { ...cur, ...u } : (u as T))));
  for (const [ev, fn] of Object.entries(on)) socket.on(ev, fn);
  return { state, connected, socket, close: () => socket.close() };
}

/** Night clock that keeps running between server updates while the night is live. */
export function nightNow(night: { nightMs: number; serverTime: number; status: string } | null | undefined, now = Date.now()): number {
  if (!night) return 0;
  return night.status === 'live' ? night.nightMs + Math.max(0, now - night.serverTime) : night.nightMs;
}
