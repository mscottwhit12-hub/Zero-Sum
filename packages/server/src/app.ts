import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { HttpError, nullBus, type Bus, type Config, type Ctx } from './context';
import type { DB } from './db';
import { registerGameRoutes, registerRoutes } from './routes';
import { attachSockets } from './sockets';
import type { Server } from 'socket.io';

export interface BuildOptions {
  db: DB;
  config: Config;
  now?: () => number;
  /** Built client (packages/client/dist). Pages are served from here when it exists. */
  clientDir?: string;
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

  app.setErrorHandler((error, _req, reply) => {
    const err = error as Error & { validation?: unknown; statusCode?: number };
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err.validation) return reply.code(400).send({ error: 'bad_request', message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'bad_request', message: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'server_error' });
  });

  registerRoutes(app, ctx);
  registerGameRoutes(app, ctx);

  if (opts.clientDir && existsSync(opts.clientDir)) {
    await app.register(fastifyStatic, { root: opts.clientDir, index: false, wildcard: false });
    // Hashed bundles never change; pages always revalidate.
    app.get('/assets/*', (req, reply) => {
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      return reply.sendFile(`assets/${(req.params as { '*': string })['*']}`);
    });
    const page = (file: string) => (_req: unknown, reply: { header: (k: string, v: string) => unknown; sendFile: (f: string) => unknown }) => {
      reply.header('cache-control', 'no-cache');
      return reply.sendFile(file);
    };
    app.get('/', page('index.html'));
    app.get('/gm', page('gm.html'));
    app.get('/display', page('display.html'));
    app.get('/play', page('play.html'));
  }

  let io: Server | null = null;
  if (opts.sockets !== false) {
    const s = attachSockets(ctx, app.server);
    io = s.io;
    ctx.bus = s.bus;
  }
  return { app, ctx, io };
}
