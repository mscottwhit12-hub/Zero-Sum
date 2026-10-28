/**
 * Loads a night from the DB and derives everything (gold, standings, market) through the engine.
 * Nothing derived is stored: results + adjustments + payouts + trades are the source of truth.
 */
import {
  computeStandings,
  deriveLedger,
  nightClockMs,
  quarterSchedule,
  quartersFromPlan,
  resolveSettings,
  type QuarterSpan,
  type DeepPartial,
  type GameResult,
  type LedgerInput,
  type LedgerRow,
  type Lot,
  type PauseSpan,
  type SecurityState,
  type Settings,
  type StandingRow,
} from '@gn/engine';
import { j } from '../db';
import type { Ctx } from '../context';

export type NightStatus = 'setup' | 'joins_open' | 'live' | 'paused' | 'ended' | 'archived';

export interface NightRow {
  id: number;
  name: string;
  date: string;
  status: NightStatus;
  trading_closed: number;
  length_minutes: number;
  current_quarter: number | null;
  started_at: number | null;
  paused_at: number | null;
  pause_until: number | null;
  recap_until: number | null;
  recap_done: number;
  ended_at: number | null;
  tick_count: number;
  last_tick_at: number | null;
  settings: string;
  created_at: number;
  /** JSON QuarterSpan[] once the length changed mid-night; null = computed from the length. */
  quarter_plan: string | null;
}

/** The night's quarters: the stored plan (if any, and still the right count), else computed from the length. */
export function nightQuarters(night: NightRow, settings: Settings) {
  const plan = night.quarter_plan ? j.parse<QuarterSpan[]>(night.quarter_plan, []) : [];
  return plan.length === settings.votes.quarterCount ? quartersFromPlan(plan, settings.votes) : quarterSchedule(night.length_minutes, settings.votes);
}

export interface PlayerRow {
  id: number;
  night_id: number;
  display_name: string;
  avatar_path: string | null;
  color: string | null;
  ticker: string;
  reroll_tokens_left: number;
  got_stake: number;
  joined_at: number;
  left_at: number | null;
}

export const pid = (id: number) => String(id);
export const securityIdForPlayer = (playerId: number) => `p:${playerId}`;

/** The current night: the newest one that is not archived. */
export function currentNight(ctx: Ctx): NightRow | null {
  return (ctx.db.prepare("SELECT * FROM night WHERE status != 'archived' ORDER BY id DESC LIMIT 1").get() as NightRow | undefined) ?? null;
}

export function getNight(ctx: Ctx, nightId: number): NightRow | null {
  return (ctx.db.prepare('SELECT * FROM night WHERE id = ?').get(nightId) as NightRow | undefined) ?? null;
}

export function nightOverrides(n: NightRow): DeepPartial<Settings> {
  return j.parse<DeepPartial<Settings>>(n.settings, {});
}

export function nightSettings(n: NightRow): Settings {
  return resolveSettings(nightOverrides(n));
}

export function pauses(ctx: Ctx, nightId: number): PauseSpan[] {
  return (ctx.db.prepare('SELECT started_at, ended_at FROM night_pause WHERE night_id = ? ORDER BY id').all(nightId) as { started_at: number; ended_at: number | null }[]).map(
    (p) => ({ start: p.started_at, end: p.ended_at }),
  );
}

/** Night-clock ms (pause excluded). 0 before start; frozen at end. */
export function nightMs(ctx: Ctx, n: NightRow): number {
  if (!n.started_at) return 0;
  const now = n.ended_at ?? ctx.now();
  return nightClockMs(n.started_at, now, pauses(ctx, n.id));
}

export function players(ctx: Ctx, nightId: number): PlayerRow[] {
  return ctx.db.prepare('SELECT * FROM player WHERE night_id = ? ORDER BY id').all(nightId) as PlayerRow[];
}

export function loadResults(ctx: Ctx, nightId: number): GameResult[] {
  const games = ctx.db
    .prepare("SELECT id, mode, actual_duration_hours, coop_won FROM game WHERE night_id = ? AND status = 'final' ORDER BY ended_at, id")
    .all(nightId) as { id: number; mode: GameResult['mode']; actual_duration_hours: number; coop_won: number | null }[];
  const parts = ctx.db.prepare('SELECT player_id, team_label, placement, dnf FROM game_participant WHERE game_id = ?');
  return games.map((g) => ({
    id: String(g.id),
    mode: g.mode,
    actualHours: g.actual_duration_hours,
    coopWon: g.coop_won == null ? null : !!g.coop_won,
    participants: (parts.all(g.id) as { player_id: number; team_label: string | null; placement: number | null; dnf: number }[]).map((p) => ({
      playerId: pid(p.player_id),
      team: p.team_label,
      placement: p.placement,
      dnf: !!p.dnf,
    })),
  }));
}

export function loadLedgerInput(ctx: Ctx, nightId: number): LedgerInput {
  const q = <T>(sql: string) => ctx.db.prepare(sql).all(nightId) as T[];
  return {
    players: players(ctx, nightId).map((p) => ({ id: pid(p.id), gotStake: !!p.got_stake })),
    results: loadResults(ctx, nightId),
    adjustments: q<{ player_id: number; gold_h: number }>('SELECT player_id, gold_h FROM adjustment WHERE night_id = ?').map((r) => ({ playerId: pid(r.player_id), goldH: r.gold_h })),
    bounties: q<{ player_id: number; gold_h: number }>(
      'SELECT b.player_id, b.gold_h FROM bounty_payout b JOIN vote_round v ON v.id = b.vote_round_id WHERE v.night_id = ?',
    ).map((r) => ({ playerId: pid(r.player_id), goldH: r.gold_h })),
    achievements: q<{ player_id: number; gold_h: number }>('SELECT player_id, gold_h FROM achievement WHERE night_id = ?').map((r) => ({ playerId: pid(r.player_id), goldH: r.gold_h })),
    tradeFlows: [
      ...q<{ player_id: number; cash_h: number }>('SELECT player_id, cash_h FROM trade WHERE night_id = ?').map((r) => ({ playerId: pid(r.player_id), cashH: r.cash_h })),
      // Tip purchases leave cash like a trade (not earned gold, so they don't move the buyer's own stock).
      ...q<{ player_id: number; cost_h: number }>('SELECT player_id, cost_h FROM hint_grant WHERE night_id = ? AND cost_h > 0').map((r) => ({ playerId: pid(r.player_id), cashH: -r.cost_h })),
    ],
  };
}

interface SecurityDbRow {
  id: string;
  kind: SecurityState['kind'];
  player_id: number | null;
  ticker: string;
  price: number;
  gm_offset: number;
  state: string;
}

export function loadSecurities(ctx: Ctx, nightId: number): SecurityState[] {
  return (ctx.db.prepare('SELECT * FROM security WHERE night_id = ? ORDER BY rowid').all(nightId) as SecurityDbRow[]).map((r) => {
    const st = j.parse<Partial<SecurityState>>(r.state, {});
    return {
      id: r.id,
      kind: r.kind,
      ticker: r.ticker,
      playerId: r.player_id == null ? null : pid(r.player_id),
      price: r.price,
      gmOffset: r.gm_offset,
      driver: st.driver ?? null,
      baseline: st.baseline,
      noise: st.noise,
      lastFair: st.lastFair,
      left: st.left,
      leaverFair: st.leaverFair,
    };
  });
}

export function securityStateJson(s: SecurityState): string {
  return j.str({ driver: s.driver ?? null, baseline: s.baseline, noise: s.noise, lastFair: s.lastFair, left: s.left, leaverFair: s.leaverFair });
}

export function upsertSecurities(ctx: Ctx, nightId: number, secs: SecurityState[]): void {
  const up = ctx.db.prepare(
    `INSERT INTO security (id, night_id, kind, player_id, ticker, price, gm_offset, state) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (night_id, id) DO UPDATE SET price = excluded.price, state = excluded.state, ticker = excluded.ticker`,
  );
  for (const s of secs) up.run(s.id, nightId, s.kind, s.playerId == null ? null : Number(s.playerId), s.ticker, s.price, s.gmOffset, securityStateJson(s));
}

export function loadLots(ctx: Ctx, nightId: number): Lot[] {
  return (ctx.db.prepare('SELECT * FROM lot WHERE night_id = ? ORDER BY id').all(nightId) as {
    id: number;
    player_id: number;
    security_id: string;
    shares_h: number;
    cost_basis_h: number;
    created_nms: number;
    unlock_nms: number;
  }[]).map((l) => ({
    id: String(l.id),
    playerId: pid(l.player_id),
    securityId: l.security_id,
    sharesH: l.shares_h,
    costBasisH: l.cost_basis_h,
    createdAt: l.created_nms,
    unlockAt: l.unlock_nms,
  }));
}

export interface NightState {
  night: NightRow;
  settings: Settings;
  players: PlayerRow[];
  securities: SecurityState[];
  lots: Lot[];
  ledger: Map<string, LedgerRow>;
  standings: StandingRow[];
  nightMs: number;
  quarters: ReturnType<typeof quarterSchedule>;
}

/** Full derived state of a night. Cheap enough to recompute on every change for 10–20 players. */
export function computeNightState(ctx: Ctx, nightId: number): NightState | null {
  const night = getNight(ctx, nightId);
  if (!night) return null;
  const settings = nightSettings(night);
  const ps = players(ctx, nightId);
  const securities = loadSecurities(ctx, nightId);
  const lots = loadLots(ctx, nightId);
  const ledger = deriveLedger(loadLedgerInput(ctx, nightId), settings);
  const prices = new Map(securities.map((s) => [s.id, s.price]));
  const standings = securities.length
    ? computeStandings(ledger, lots.map((l) => ({ playerId: l.playerId, securityId: l.securityId, sharesH: l.sharesH })), prices, settings)
    : computeStandings(ledger, [], prices, settings);
  return {
    night,
    settings,
    players: ps,
    securities,
    lots,
    ledger,
    standings,
    nightMs: nightMs(ctx, night),
    quarters: nightQuarters(night, settings),
  };
}
