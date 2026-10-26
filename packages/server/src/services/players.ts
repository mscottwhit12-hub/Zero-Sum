import { bad, conflict, notFound, type Ctx } from '../context';
import { newToken, tokenHash } from '../auth/password';
import { currentNight, getNight, type PlayerRow } from './state';
import { nightSettings } from './state';

/** Placeholder slur blocklist (swears are fine). Phase 5 moves this to a data file. */
const BLOCKLIST: RegExp[] = [];

export function checkName(name: unknown): string {
  if (typeof name !== 'string') throw bad('bad_name');
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length < 1 || n.length > 24) throw bad('bad_name', 'Name must be 1–24 characters.');
  if (BLOCKLIST.some((r) => r.test(n))) throw bad('name_blocked');
  return n;
}

export function checkTicker(ticker: unknown): string {
  if (typeof ticker !== 'string' || !/^[A-Za-z]{3,4}$/.test(ticker.trim())) throw bad('bad_ticker', 'Ticker must be 3–4 letters.');
  const t = ticker.trim().toUpperCase();
  if (BLOCKLIST.some((r) => r.test(t))) throw bad('ticker_blocked');
  if (['IDX', 'COIN', 'SCIC', 'SHDW', 'DEAD'].includes(t)) throw conflict('ticker_taken');
  return t;
}

/**
 * Creates a player and their first device. Joins are GM-gated: only while joins are open.
 * (Late join and rejoin go through GM approval — Phase 5.)
 */
export function createPlayer(ctx: Ctx, input: { displayName: unknown; ticker: unknown; avatarPath?: unknown; color?: unknown }): { player: PlayerRow; deviceToken: string } {
  const night = currentNight(ctx);
  if (!night) throw notFound('no_night');
  if (night.status !== 'joins_open') throw conflict('joins_closed');
  const name = checkName(input.displayName);
  const ticker = checkTicker(input.ticker);
  return ctx.db.transaction(() => {
    if (ctx.db.prepare('SELECT 1 FROM player WHERE night_id = ? AND display_name = ?').get(night.id, name)) throw conflict('name_taken');
    if (ctx.db.prepare('SELECT 1 FROM player WHERE night_id = ? AND ticker = ?').get(night.id, ticker)) throw conflict('ticker_taken');
    const settings = nightSettings(night);
    const r = ctx.db
      .prepare('INSERT INTO player (night_id, display_name, avatar_path, color, ticker, reroll_tokens_left, joined_at) VALUES (?,?,?,?,?,?,?)')
      .run(night.id, name, typeof input.avatarPath === 'string' ? input.avatarPath : null, typeof input.color === 'string' ? input.color : null, ticker, settings.rerolls.perPlayer, ctx.now());
    const playerId = Number(r.lastInsertRowid);
    const { token, hash } = newToken();
    ctx.db.prepare('INSERT INTO device (player_id, token_hash, created_at) VALUES (?,?,?)').run(playerId, hash, ctx.now());
    return { player: ctx.db.prepare('SELECT * FROM player WHERE id = ?').get(playerId) as PlayerRow, deviceToken: token };
  })();
}

/** Player id for a device token, if the device belongs to a player of a non-archived night. */
export function playerFromDevice(ctx: Ctx, token: string | undefined | null): PlayerRow | null {
  if (!token) return null;
  const row = ctx.db
    .prepare('SELECT p.* FROM device d JOIN player p ON p.id = d.player_id WHERE d.token_hash = ?')
    .get(tokenHash(token)) as PlayerRow | undefined;
  if (!row) return null;
  const n = getNight(ctx, row.night_id);
  return n && n.status !== 'archived' ? row : null;
}
