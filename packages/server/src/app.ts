import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { HttpError, nullBus, type Bus, type Config, type Ctx } from './context';
import type { DB } from './db';
import { registerRoutes } from './routes';
import { attachSockets } from './sockets';
import type { Server } from 'socket.io';

export interface BuildOptions {
  db: DB;
  config: Config;
  now?: () => number;
  /** Attach Socket.IO (default true). Tests of pure HTTP can skip it. */
  sockets?: boolean;
  logger?: boolean;
}

export interface App {
  app: FastifyInstance;
  ctx: Ctx;
  io: Server | null;
}

export async function buildApp(opts: BuildOptions): Promise<App> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  const ctx: Ctx = { db: opts.db, now: opts.now ?? Date.now, bus: nullBus as Bus, config: opts.config };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if ((err as { validation?: unknown }).validation) return reply.code(400).send({ error: 'bad_request', message: err.message });
    if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500)
      return reply.code((err as { statusCode: number }).statusCode).send({ error: 'bad_request', message: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'server_error' });
  });

  registerRoutes(app, ctx);

  let io: Server | null = null;
  if (opts.sockets !== false) {
    const s = attachSockets(ctx, app.server);
    io = s.io;
    ctx.bus = s.bus;
  }
  return { app, ctx, io };
}
