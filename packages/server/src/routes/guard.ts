import type { FastifyRequest } from 'fastify';
import { forbidden, HttpError, type Ctx } from '../context';
import { authFromToken, type GmAuth } from '../services/gm';
import { GM_COOKIE } from '../sockets';

export interface GuardOptions {
  /** Master GM only (setup and settings). */
  master?: boolean;
  /** Allowed on a remotely paused device (e.g. unlock, me). */
  allowPaused?: boolean;
}

/** Server-side permission check for GM routes. */
export function requireGm(ctx: Ctx, req: FastifyRequest, opts: GuardOptions = {}): GmAuth {
  const auth = authFromToken(ctx, req.cookies[GM_COOKIE]);
  if (!auth) throw new HttpError(401, 'unauthorized');
  if (auth.paused && !opts.allowPaused) throw new HttpError(423, 'device_paused');
  if (opts.master && auth.role !== 'master') throw forbidden('master_only');
  return auth;
}
