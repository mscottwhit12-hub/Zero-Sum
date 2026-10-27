/**
 * Night exports (JSON + CSV) and the archive list. Exports go to the Master GM, but hidden
 * mechanics stay hidden here too: no vote drift, no price causes/fair/target, no impulses,
 * no hidden achievement gold.
 */
import { scoreGame } from '@gn/engine';
import { j } from '../db';
import { notFound, type Ctx } from '../context';
import { masterOnly, type GmAuth } from './gm';
import { computeNightState, currentNight, getNight, loadResults, nightOverrides, nightSettings } from './state';

function nightOrCurrent(ctx: Ctx, nightId: unknown) {
  const n = nightId == null || nightId === '' ? currentNight(ctx) : getNight(ctx, Number(nightId));
  if (!n) throw notFound('no_night');
  return n;
}

export function exportNightJson(ctx: Ctx, actor: GmAuth, nightId?: unknown) {
  masterOnly(actor);
  const n = nightOrCurrent(ctx, nightId);
  const q = <T>(sql: string, ...args: unknown[]) => ctx.db.prepare(sql).all(n.id, ...args) as T[];
  const st = computeNightState(ctx, n.id)!;
  return {
    format: 'zero-sum-night/1',
    exportedAt: new Date(ctx.now()).toISOString(),
    night: {
      id: n.id,
      name: n.name,
      date: n.date,
      status: n.status,
      lengthMinutes: n.length_minutes,
      startedAt: n.started_at,
      endedAt: n.ended_at,
      settingsOverrides: nightOverrides(n),
    },
    players: q('SELECT id, display_name AS displayName, ticker, color, joined_at AS joinedAt, left_at AS leftAt FROM player WHERE night_id = ? ORDER BY id'),
    standings: st.standings.map((r) => ({ playerId: Number(r.playerId), netWorthH: r.netWorthH, rank: r.rank })),
    games: q<Record<string, unknown> & { id: number }>(
      `SELECT id, name, mode, status, planned_start AS plannedStart, planned_duration_hours AS plannedHours, started_at AS startedAt,
              ended_at AS endedAt, actual_duration_hours AS hours, coop_won AS coopWon, rerolls_allowed AS rerollsAllowed, table_id AS tableId
       FROM game WHERE night_id = ? ORDER BY id`,
    ).map((g) => ({
      ...g,
      participants: ctx.db.prepare('SELECT player_id AS playerId, team_label AS team, placement, dnf, seat_number AS seat FROM game_participant WHERE game_id = ?').all(g.id),
    })),
    adjustments: q('SELECT player_id AS playerId, gold_h AS goldH, reason, kind, gm_id AS gmId, created_at AS createdAt FROM adjustment WHERE night_id = ? ORDER BY id'),
    trades: q(
      `SELECT player_id AS playerId, security_id AS securityId, side, shares_h AS sharesH, price, cash_h AS cashH, fee_h AS feeH,
              basis_h AS basisH, forced, created_at AS createdAt FROM trade WHERE night_id = ? ORDER BY id`,
    ),
    securities: q('SELECT id, kind, ticker, player_id AS playerId FROM security WHERE night_id = ?'),
    prices: q('SELECT security_id AS securityId, tick, price, created_at AS createdAt FROM price WHERE night_id = ? ORDER BY id'),
    votes: q<{ id: number; quarter: number; status: string }>('SELECT id, quarter, status, opened_at AS openedAt, closed_at AS closedAt FROM vote_round WHERE night_id = ? ORDER BY quarter').map((v) => ({
      ...v,
      ballots: ctx.db.prepare('SELECT player_id AS playerId, target_player_id AS targetId, created_at AS createdAt FROM ballot WHERE vote_round_id = ?').all(v.id),
      bounties: ctx.db.prepare('SELECT player_id AS playerId, gold_h AS goldH FROM bounty_payout WHERE vote_round_id = ?').all(v.id),
    })),
    achievements: q<{ playerId: number; type: string; goldH: number; hidden: number; createdAt: number }>(
      'SELECT player_id AS playerId, type, gold_h AS goldH, gold_hidden AS hidden, created_at AS createdAt FROM achievement WHERE night_id = ? ORDER BY id',
    ).map(({ hidden, goldH, ...a }) => ({ ...a, goldH: hidden ? null : goldH })),
    moodReadings: q('SELECT player_id AS playerId, mood, self_assessment AS selfAssessment, created_at AS createdAt FROM mood_reading WHERE night_id = ? ORDER BY id'),
    leaderTaps: q('SELECT t.game_id AS gameId, t.player_id AS playerId, t.created_at AS createdAt FROM leader_tap t JOIN game g ON g.id = t.game_id WHERE g.night_id = ? ORDER BY t.id'),
    rerolls: q('SELECT r.player_id AS playerId, r.game_id AS gameId, r.created_at AS createdAt FROM reroll_use r JOIN player p ON p.id = r.player_id WHERE p.night_id = ? ORDER BY r.id'),
    espionage: q<{ reward: string }>('SELECT player_id AS playerId, text, reward, status, created_at AS createdAt, resolved_at AS resolvedAt FROM challenge WHERE night_id = ? ORDER BY id').map((c) => ({
      ...c,
      reward: j.parse(c.reward, {}),
    })),
    notifications: q('SELECT target, message, created_at AS createdAt FROM notification WHERE night_id = ? ORDER BY id'),
    minter: q('SELECT player_id AS playerId, CAST(minted AS INTEGER) AS minted, tiers FROM minter_state WHERE night_id = ?'),
    standingsSnapshots: q<{ data: string; createdAt: number }>('SELECT data, created_at AS createdAt FROM standings_snapshot WHERE night_id = ? ORDER BY id').map((s) => ({ createdAt: s.createdAt, standings: JSON.parse(s.data) })),
    feed: q<{ data: string }>('SELECT type, message, data, gm_only AS gmOnly, created_at AS createdAt FROM feed_event WHERE night_id = ? ORDER BY id').map((f) => ({ ...f, data: j.parse(f.data, {}) })),
    // GM export only: tips granted (incl. why) and the handicap log. Never on statements/PDF.
    tips: q('SELECT player_id AS playerId, hint_id AS hintId, tier, source, cost_h AS costH, night_ms AS nightMs, created_at AS createdAt FROM hint_grant WHERE night_id = ? ORDER BY id'),
    handicaps: q<{ reasons: string; hints: string }>(
      'SELECT player_id AS playerId, night_ms AS nightMs, auto_level AS auto, offset, effective, trigger, reasons, gift_h AS giftH, hints, created_at AS createdAt FROM handicap_eval WHERE night_id = ? ORDER BY id',
    ).map((h) => ({ ...h, reasons: j.parse(h.reasons, {}), hints: j.parse(h.hints, []) })),
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  // Quote when needed; neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const toCsv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const gold = (h: number | null | undefined) => (h == null ? '' : (h / 100).toFixed(2));
const iso = (ms: number | null | undefined) => (ms == null ? '' : new Date(ms).toISOString());

export const CSV_KINDS = ['standings', 'results', 'trades'] as const;

export function exportNightCsv(ctx: Ctx, actor: GmAuth, kind: string, nightId?: unknown): { name: string; csv: string } {
  masterOnly(actor);
  const n = nightOrCurrent(ctx, nightId);
  const st = computeNightState(ctx, n.id)!;
  const name = (id: number | string) => st.players.find((p) => p.id === Number(id))?.display_name ?? `#${id}`;
  const ticker = (id: number | string) => st.players.find((p) => p.id === Number(id))?.ticker ?? '';
  const base = `${n.date}-${n.name.replace(/[^\w-]+/g, '_')}`;
  if (kind === 'standings') {
    return {
      name: `${base}-standings.csv`,
      csv: toCsv(['rank', 'player', 'ticker', 'net_worth_gold', 'gold'], st.standings.map((r) => [r.rank, name(r.playerId), ticker(r.playerId), gold(r.netWorthH), gold(st.ledger.get(r.playerId)?.cashH)])),
    };
  }
  if (kind === 'results') {
    const settings = nightSettings(n);
    const games = new Map((ctx.db.prepare('SELECT id, name FROM game WHERE night_id = ?').all(n.id) as { id: number; name: string }[]).map((g) => [String(g.id), g.name]));
    const rows: unknown[][] = [];
    for (const r of loadResults(ctx, n.id)) {
      const scored = new Map(scoreGame(r, settings).rows.map((x) => [x.playerId, x]));
      for (const p of r.participants)
        rows.push([games.get(r.id), r.mode, r.actualHours, name(p.playerId), p.team ?? '', p.dnf ? 'DNF' : (p.placement ?? (r.coopWon == null ? '' : r.coopWon ? 'win' : 'loss')), scored.get(p.playerId)?.mult ?? '', gold(scored.get(p.playerId)?.goldH)]);
    }
    return { name: `${base}-results.csv`, csv: toCsv(['game', 'mode', 'hours', 'player', 'team', 'placement', 'multiplier', 'gold'], rows) };
  }
  if (kind === 'trades') {
    const tick = new Map(st.securities.map((s) => [s.id, s.ticker]));
    const rows = (ctx.db.prepare('SELECT * FROM trade WHERE night_id = ? ORDER BY id').all(n.id) as {
      player_id: number;
      security_id: string;
      side: string;
      shares_h: number;
      price: number;
      cash_h: number;
      fee_h: number;
      basis_h: number | null;
      forced: number;
      created_at: number;
    }[]).map((t) => [iso(t.created_at), name(t.player_id), t.forced ? 'auto-sell' : t.side, tick.get(t.security_id) ?? t.security_id, (t.shares_h / 100).toFixed(2), t.price.toFixed(2), gold(t.cash_h), gold(t.fee_h), t.side === 'sell' && t.basis_h != null ? gold(t.cash_h - t.basis_h) : '']);
    return { name: `${base}-trades.csv`, csv: toCsv(['time', 'player', 'side', 'stock', 'shares', 'price', 'gold', 'fee', 'profit'], rows) };
  }
  throw notFound('bad_export');
}

/** Archive: every night, newest first, with its winner. */
export function listNights(ctx: Ctx, actor: GmAuth) {
  void actor;
  return (ctx.db.prepare('SELECT id, name, date, status FROM night ORDER BY id DESC').all() as { id: number; name: string; date: string; status: string }[]).map((n) => {
    const snap = ctx.db.prepare('SELECT data FROM standings_snapshot WHERE night_id = ? ORDER BY id DESC LIMIT 1').get(n.id) as { data: string } | undefined;
    const top = snap ? (JSON.parse(snap.data) as { playerId: number; rank: number; goldH?: number; netWorthH?: number }[]).filter((r) => r.rank === 1) : [];
    const players = (ctx.db.prepare('SELECT COUNT(*) c FROM player WHERE night_id = ?').get(n.id) as { c: number }).c;
    const names = top.map((r) => (ctx.db.prepare('SELECT display_name FROM player WHERE id = ?').get(r.playerId) as { display_name: string } | undefined)?.display_name ?? '?');
    return { ...n, players, winners: n.status === 'ended' || n.status === 'archived' ? names : [], winnerGoldH: top[0] ? (top[0].goldH ?? top[0].netWorthH ?? null) : null };
  });
}
