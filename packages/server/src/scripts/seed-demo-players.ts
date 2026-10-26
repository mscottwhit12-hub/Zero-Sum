/**
 * DEV ONLY — not a product feature (players self-register from their phones in Phase 5).
 * Adds demo players to the current night while joins are open, so the GM console and TV
 * can be exercised before the phone app exists.
 *   DATA_DIR=./data tsx src/scripts/seed-demo-players.ts 8
 */
import { join } from 'node:path';
import { nullBus, type Ctx } from '../context';
import { openDb } from '../db';
import { createPlayer } from '../services/players';

const NAMES = ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley', 'Gray', 'Harper', 'Indy', 'Jules', 'Kai', 'Logan', 'Morgan', 'Noel', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sage', 'Tatum'];
const n = Math.min(NAMES.length, Number(process.argv[2] ?? 8));
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const db = openDb(join(dataDir, 'game-night.sqlite'));
const ctx: Ctx = { db, now: Date.now, bus: nullBus, config: { port: 0, host: '', dataDir, mediaDir: '', secureCookies: false } };
for (const name of NAMES.slice(0, n)) {
  const { player } = createPlayer(ctx, { displayName: name, ticker: name.slice(0, 4).toUpperCase() });
  console.log(`player ${player.id} ${player.display_name} (${player.ticker})`);
}
db.close();
