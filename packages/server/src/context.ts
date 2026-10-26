import type { DB } from './db';

/** Outbound broadcast channels. Sockets implement it; tests can use the recording bus. */
export interface Bus {
  /** Everyone (public data only). */
  all(event: string, data: unknown): void;
  /** Authenticated GM sockets. */
  gm(event: string, data: unknown): void;
  /** TV displays. */
  tv(event: string, data: unknown): void;
  /** Every device of one player. */
  player(playerId: number, event: string, data: unknown): void;
  /** One GM session (remote pause/resume). */
  gmSession(sessionId: number, event: string, data: unknown): void;
  /** Recompute derived state and push role-filtered updates to every socket. */
  refresh(nightId: number): void;
}

export const nullBus: Bus = { all() {}, gm() {}, tv() {}, player() {}, gmSession() {}, refresh() {} };

/** Records every emit; for tests. */
export function recordingBus() {
  const events: { channel: string; target?: number; event: string; data: unknown }[] = [];
  const bus: Bus = {
    all: (event, data) => events.push({ channel: 'all', event, data }),
    gm: (event, data) => events.push({ channel: 'gm', event, data }),
    tv: (event, data) => events.push({ channel: 'tv', event, data }),
    player: (target, event, data) => events.push({ channel: 'player', target, event, data }),
    gmSession: (target, event, data) => events.push({ channel: 'gmSession', target, event, data }),
    refresh: (target) => events.push({ channel: 'refresh', target, event: 'refresh', data: null }),
  };
  return { bus, events };
}

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  mediaDir: string;
  /** Mark session cookies Secure (only when served over HTTPS). */
  secureCookies: boolean;
}

export interface Ctx {
  db: DB;
  /** Wall clock (injectable for tests). */
  now(): number;
  bus: Bus;
  config: Config;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const bad = (code: string, message?: string) => new HttpError(400, code, message);
export const forbidden = (code = 'forbidden') => new HttpError(403, code);
export const notFound = (code = 'not_found') => new HttpError(404, code);
export const conflict = (code: string, message?: string) => new HttpError(409, code, message);
