import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildApp } from './app';
import type { Config } from './context';
import { openDb } from './db';
import { startTickLoop } from './tickLoop';
import { seedLibraryOnce } from './services/library';
import { loadBlocklist } from './services/players';

const config: Config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? join(process.cwd(), 'data'),
  mediaDir: process.env.MEDIA_DIR ?? join(process.cwd(), 'media'),
  secureCookies: process.env.SECURE_COOKIES === '1',
};

const db = openDb(join(config.dataDir, 'game-night.sqlite'));
const clientDir = process.env.CLIENT_DIR ?? fileURLToPath(new URL('../../client/dist', import.meta.url));
const { app, ctx } = await buildApp({ db, config, logger: true, clientDir });
seedLibraryOnce(ctx, process.env.SAMPLE_LIBRARY ?? fileURLToPath(new URL('../../../assets/sample-library.json', import.meta.url)));
loadBlocklist(process.env.NAME_BLOCKLIST ?? fileURLToPath(new URL('../../../assets/name-blocklist.txt', import.meta.url)));
const stop = startTickLoop(ctx);
await app.listen({ port: config.port, host: config.host });

const shutdown = async () => {
  stop();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
