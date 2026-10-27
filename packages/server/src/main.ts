import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildApp } from './app';
import type { Config } from './context';
import { openDb } from './db';
import { startTickLoop } from './tickLoop';
import { seedLibraryOnce } from './services/library';
import { loadBlocklist } from './services/players';
import { seedRulesOnce } from './services/rules';
import { loopIntervalMs, parseTimeScale, scaledClock } from './timeScale';

const config: Config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? join(process.cwd(), 'data'),
  mediaDir: process.env.MEDIA_DIR ?? join(process.cwd(), 'media'),
  secureCookies: process.env.SECURE_COOKIES === '1',
};

const db = openDb(join(config.dataDir, 'game-night.sqlite'));
const clientDir = process.env.CLIENT_DIR ?? fileURLToPath(new URL('../../client/dist', import.meta.url));
const timeScale = parseTimeScale(process.env.ZS_TIME_SCALE);
const { app, ctx } = await buildApp({ db, config, logger: true, clientDir, now: scaledClock(timeScale) });
if (timeScale !== 1) app.log.warn(`TEST MODE: ZS_TIME_SCALE=${timeScale}. The server clock runs ${timeScale}x real time. Do not use with a real night.`);
seedLibraryOnce(ctx, process.env.SAMPLE_LIBRARY ?? fileURLToPath(new URL('../../../assets/sample-library.json', import.meta.url)));
seedRulesOnce(ctx, process.env.HOUSE_RULES ?? fileURLToPath(new URL('../../../assets/house-rules.json', import.meta.url)));
loadBlocklist(process.env.NAME_BLOCKLIST ?? fileURLToPath(new URL('../../../assets/name-blocklist.txt', import.meta.url)));
const stop = startTickLoop(ctx, loopIntervalMs(timeScale));
await app.listen({ port: config.port, host: config.host });

const shutdown = async () => {
  stop();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
