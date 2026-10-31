/**
 * NFT Minter server side (spec §15.4). Fun only: never touches gold, market or scoring.
 * Server-authoritative state per player per night; phones sync taps + purchases every few seconds.
 * Playable on the pause lock screen with the intermission bonus (locked decision #5).
 */
import {
  advanceMinter,
  applyMinterSync,
  boostMinter,
  claimableInvestors,
  cyclePayout,
  cycleTime,
  emptyMinter,
  investorMult,
  managerCost,
  MINTER_RULES,
  MINTER_TIERS,
  MINTER_UPGRADES,
  minterRate,
  nextMilestone,
  tierCost,
  type MinterState,
} from '@gn/engine';
import { hintsForMinter } from './hints';
import { j } from '../db';
import { conflict, type Ctx } from '../context';
import { currentNight, nightMs, nightSettings, type NightRow, type PlayerRow } from './state';

interface Row {
  player_id: number;
  minted: number;
  currency: number;
  tiers: string;
  taps: number;
  extra: string;
}
type Extra = Pick<MinterState, 'upgrades' | 'managers' | 'investors' | 'rebrands' | 'prog' | 'boost'> & { clock?: number };

/** Runs on the night clock: live only (paused and ended freeze it). */
const running = (n: NightRow) => n.status === 'live';
const VISIBLE: NightRow['status'][] = ['joins_open', 'live', 'paused'];

function fromRow(r: Row | undefined): { s: MinterState; clock: number | null } {
  if (!r) return { s: emptyMinter(), clock: null };
  const x = j.parse<Extra>(r.extra, {});
  const { clock, ...extra } = x;
  return { s: { ...emptyMinter(), ...extra, minted: r.minted, credits: r.currency, tiers: j.parse(r.tiers, {}), taps: r.taps }, clock: clock ?? null };
}

function load(ctx: Ctx, playerId: number, nightId: number) {
  return fromRow(ctx.db.prepare('SELECT player_id, minted, currency, tiers, taps, extra FROM minter_state WHERE player_id = ? AND night_id = ?').get(playerId, nightId) as Row | undefined);
}

function save(ctx: Ctx, playerId: number, nightId: number, s: MinterState, clock: number) {
  ctx.db
    .prepare(
      `INSERT INTO minter_state (player_id, night_id, minted, currency, tiers, taps, extra, updated_at) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (player_id, night_id) DO UPDATE SET minted = excluded.minted, currency = excluded.currency, tiers = excluded.tiers, taps = excluded.taps, extra = excluded.extra, updated_at = excluded.updated_at`,
    )
    .run(
      playerId,
      nightId,
      s.minted,
      s.credits,
      j.str(s.tiers),
      s.taps,
      j.str({ upgrades: s.upgrades ?? [], managers: s.managers ?? [], investors: s.investors ?? 0, rebrands: s.rebrands ?? 0, prog: s.prog ?? {}, boost: s.boost ?? 0, clock }),
      ctx.now(),
    );
}

/** Seconds of night clock since this state was last brought up to date. */
const since = (clock: number | null, now: number) => (clock == null ? 0 : Math.max(0, (now - clock) / 1000));

function view(n: NightRow, s: MinterState) {
  const owned = (id: string) => s.tiers[id] ?? 0;
  // Owned businesses, plus the next one to unlock.
  const firstLocked = MINTER_TIERS.findIndex((t) => !owned(t.id));
  return {
    minted: Math.floor(s.minted),
    credits: Math.floor(s.credits),
    ratePerSec: minterRate(s),
    boostLeft: Math.ceil(s.boost ?? 0),
    boostMult: MINTER_RULES.boostMult,
    paused: n.status === 'paused',
    active: running(n),
    shop: MINTER_TIERS.filter((t, i) => owned(t.id) > 0 || i === firstLocked).map((t) => {
      const o = owned(t.id);
      const time = cycleTime(t, o || 1);
      return {
        id: t.id,
        name: t.name,
        owned: o,
        cost: tierCost(t, o),
        time,
        payout: o ? cyclePayout(s, t) : t.payout * investorMult(s),
        progress: s.prog?.[t.id] != null ? Math.min(1, s.prog[t.id]! / time) : null,
        nextMilestone: nextMilestone(o),
        managed: (s.managers ?? []).includes(t.id),
        managerCost: managerCost(t),
      };
    }),
    upgrades: MINTER_UPGRADES.map((u) => ({
      id: u.id,
      name: u.name,
      cost: u.cost,
      target: u.target,
      mult: u.mult,
      bought: (s.upgrades ?? []).includes(u.id),
      available: owned(u.target) > 0,
    })),
    investors: { have: s.investors ?? 0, claimable: claimableInvestors(s), bonusPct: Math.round((investorMult(s) - 1) * 100), perInvestorPct: Math.round(MINTER_RULES.investorBonus * 100) },
    rebrands: s.rebrands ?? 0,
    visible: VISIBLE.includes(n.status),
  };
}
export type MinterView = ReturnType<typeof view>;

export function minterGet(ctx: Ctx, player: PlayerRow): MinterView {
  const n = currentNight(ctx);
  if (!n || n.id !== player.night_id) throw conflict('no_night');
  const { s, clock } = load(ctx, player.id, n.id);
  return view(n, running(n) ? advanceMinter(s, since(clock, nightMs(ctx, n))) : s);
}

export function minterSync(ctx: Ctx, player: PlayerRow, input: { buys?: unknown }): MinterView & { rejected: string[] } {
  const n = currentNight(ctx);
  if (!n || n.id !== player.night_id) throw conflict('no_night');
  const { s, clock } = load(ctx, player.id, n.id);
  const now = nightMs(ctx, n);
  const buys = Array.isArray(input.buys) ? input.buys.filter((x): x is string => typeof x === 'string') : [];
  const r = applyMinterSync(s, { buys }, since(clock, now), { active: running(n) });
  save(ctx, player.id, n.id, r.state, now);
  scheduleLeaderboard(ctx, n.id);
  const firsts = Object.keys(r.state.tiers).filter((t) => ((r.state.tiers as Record<string, number>)[t] ?? 0) > 0 && !(((s.tiers as Record<string, number>)[t] ?? 0) > 0));
  if (firsts.length) hintsForMinter(ctx, n, player.id, firsts);
  return { ...view(n, r.state), rejected: r.rejected };
}

/** Memo reward: ×10 Minter for 5 minutes of night clock. */
export function minterBoost(ctx: Ctx, n: NightRow, playerId: number): void {
  const { s, clock } = load(ctx, playerId, n.id);
  const now = nightMs(ctx, n);
  const cur = running(n) ? advanceMinter(s, since(clock, now)) : s;
  save(ctx, playerId, n.id, boostMinter(cur), now);
}

/** Keeps every Minter running with the app closed (leaderboard + TV stay current). Every ~10 s while live. */
const lastAdvance = new Map<number, number>();
export function minterAdvanceStep(ctx: Ctx, n: NightRow): void {
  if (!running(n)) return;
  const wall = ctx.now();
  if (wall - (lastAdvance.get(n.id) ?? 0) < 10_000) return;
  lastAdvance.set(n.id, wall);
  const now = nightMs(ctx, n);
  const rows = ctx.db.prepare('SELECT player_id, minted, currency, tiers, taps, extra FROM minter_state WHERE night_id = ?').all(n.id) as Row[];
  if (!rows.length) return;
  ctx.db.transaction(() => {
    for (const r of rows) {
      const { s, clock } = fromRow(r);
      save(ctx, r.player_id, n.id, advanceMinter(s, since(clock, now)), now);
    }
  })();
  scheduleLeaderboard(ctx, n.id);
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
