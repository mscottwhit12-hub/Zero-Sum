/**
 * NFT Minter server side (spec §15.4). Fun only: never touches gold, market or scoring.
 * Server-authoritative state per player per night; phones sync taps + purchases every few seconds.
 * Playable on the pause lock screen with the intermission bonus (locked decision #5).
 */
import { applyMinterSync, emptyMinter, MINTER_TIERS, minterRate, tierCost, type MinterState } from '@gn/engine';
import { hintsForMinter } from './hints';
import { j } from '../db';
import { conflict, type Ctx } from '../context';
import { currentNight, nightSettings, type NightRow, type PlayerRow } from './state';

interface Row {
  minted: number;
  currency: number;
  tiers: string;
  taps: number;
  updated_at: number;
}

const MINTING: NightRow['status'][] = ['joins_open', 'live', 'paused'];

function load(ctx: Ctx, playerId: number, nightId: number): { s: MinterState; updatedAt: number | null } {
  const r = ctx.db.prepare('SELECT minted, currency, tiers, taps, updated_at FROM minter_state WHERE player_id = ? AND night_id = ?').get(playerId, nightId) as Row | undefined;
  if (!r) return { s: emptyMinter(), updatedAt: null };
  return { s: { minted: r.minted, credits: r.currency, tiers: j.parse(r.tiers, {}), taps: r.taps }, updatedAt: r.updated_at };
}

function view(n: NightRow, s: MinterState) {
  const paused = n.status === 'paused';
  const mult = paused ? nightSettings(n).minter.pauseMultiplier : 1;
  return {
    minted: Math.floor(s.minted),
    credits: Math.floor(s.credits),
    tiers: s.tiers,
    ratePerSec: minterRate(s.tiers) * mult,
    mult,
    paused,
    active: MINTING.includes(n.status),
    shop: MINTER_TIERS.map((t) => ({ id: t.id, name: t.name, rate: t.rate, owned: s.tiers[t.id] ?? 0, cost: tierCost(t, s.tiers[t.id] ?? 0), intermissionOnly: !!t.intermissionOnly, available: !t.intermissionOnly || paused })),
  };
}
export type MinterView = ReturnType<typeof view>;

export function minterGet(ctx: Ctx, player: PlayerRow): MinterView {
  const n = currentNight(ctx);
  if (!n || n.id !== player.night_id) throw conflict('no_night');
  return view(n, load(ctx, player.id, n.id).s);
}

export function minterSync(ctx: Ctx, player: PlayerRow, input: { taps?: unknown; buys?: unknown }): MinterView & { rejected: string[] } {
  const n = currentNight(ctx);
  if (!n || n.id !== player.night_id) throw conflict('no_night');
  const { s, updatedAt } = load(ctx, player.id, n.id);
  if (!MINTING.includes(n.status)) return { ...view(n, s), rejected: [] };
  const now = ctx.now();
  const elapsed = updatedAt == null ? 0 : (now - updatedAt) / 1000;
  const buys = Array.isArray(input.buys) ? input.buys.filter((x): x is string => typeof x === 'string') : [];
  const r = applyMinterSync(s, { taps: Number(input.taps) || 0, buys }, elapsed, { paused: n.status === 'paused', mult: nightSettings(n).minter.pauseMultiplier });
  ctx.db
    .prepare(
      `INSERT INTO minter_state (player_id, night_id, minted, currency, tiers, taps, updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (player_id, night_id) DO UPDATE SET minted = excluded.minted, currency = excluded.currency, tiers = excluded.tiers, taps = excluded.taps, updated_at = excluded.updated_at`,
    )
    .run(player.id, n.id, r.state.minted, r.state.credits, j.str(r.state.tiers), r.state.taps, now);
  scheduleLeaderboard(ctx, n.id);
  const firsts = Object.keys(r.state.tiers).filter((t) => ((r.state.tiers as Record<string, number>)[t] ?? 0) > 0 && !(((s.tiers as Record<string, number>)[t] ?? 0) > 0));
  if (firsts.length) hintsForMinter(ctx, n, player.id, firsts);
  return { ...view(n, r.state), rejected: r.rejected };
}

export function minterLeaderboard(ctx: Ctx, nightId: number, limit = 10) {
  return (ctx.db.prepare('SELECT player_id, minted FROM minter_state WHERE night_id = ? AND minted >= 1 ORDER BY minted DESC LIMIT ?').all(nightId, limit) as { player_id: number; minted: number }[]).map((r) => ({
    playerId: r.player_id,
    minted: Math.floor(r.minted),
  }));
}

// Leaderboard pushes are throttled (phones sync every few seconds; no full-state refresh needed).
const lbTimers = new Map<number, ReturnType<typeof setTimeout>>();
function scheduleLeaderboard(ctx: Ctx, nightId: number) {
  if (lbTimers.has(nightId)) return;
  const t = setTimeout(() => {
    lbTimers.delete(nightId);
    try {
      ctx.bus.all('minter:leaderboard', { nightId, leaderboard: minterLeaderboard(ctx, nightId) });
    } catch {
      /* db closed (tests/shutdown) */
    }
  }, 3000);
  t.unref?.();
  lbTimers.set(nightId, t);
}

// TV crawl: "ACME mints 40,000 NFTs", about every `minter.tvCrawlMinutes` (wall clock).
const lastCrawl = new Map<number, number>();
export function minterCrawlStep(ctx: Ctx, n: NightRow): void {
  const every = nightSettings(n).minter.tvCrawlMinutes * 60_000;
  const last = lastCrawl.get(n.id);
  if (last == null) {
    lastCrawl.set(n.id, ctx.now());
    return;
  }
  if (ctx.now() - last < every) return;
  lastCrawl.set(n.id, ctx.now());
  const lb = minterLeaderboard(ctx, n.id, 5);
  if (!lb.length) return;
  const pick = lb[Math.floor(Math.random() * lb.length)]!;
  const ticker = (ctx.db.prepare('SELECT ticker FROM player WHERE id = ?').get(pick.playerId) as { ticker: string } | undefined)?.ticker ?? '???';
  ctx.bus.tv('tv:crawl', { kind: 'minter', ticker, minted: pick.minted });
}
