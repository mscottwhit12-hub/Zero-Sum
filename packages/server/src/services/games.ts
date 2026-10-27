/**
 * Night schedule, game lifecycle, the result wizard backend, corrections, and leader taps (crowns).
 * Results are the source of truth: gold is always re-derived from them.
 */
import { awardAchievements } from './achievements';
import {
  EMPTY_CROWN,
  kingfallImpulse,
  leaderFromScores,
  type LeadMode,
  scoreGame,
  tapLeader,
  validateResult,
  type CrownState,
  type GameResult,
} from '@gn/engine';
import { j } from '../db';
import { bad, conflict, forbidden, notFound, type Ctx } from '../context';
import { audit } from './audit';
import { pushFeed } from './feed';
import type { GmAuth } from './gm';
import { getLibraryGame, leadLabelOf, leadModeOf, type GameMode } from './library';
import { hintsForResult } from './hints';
import { handicapAfterCorrection } from './handicap';
import { queueImpulse } from './market';
import { computeNightState, currentNight, loadResults, loadSecurities, nightMs, nightSettings, pauses, pid, type NightRow } from './state';

export type GameStatus = 'scheduled' | 'active' | 'final' | 'cancelled';

export interface GameRow {
  id: number;
  night_id: number;
  library_game_id: number | null;
  name: string;
  table_id: number | null;
  mode: GameMode;
  planned_start: number | null;
  planned_duration_hours: number | null;
  assigned_gm_id: number | null;
  status: GameStatus;
  started_at: number | null;
  ended_at: number | null;
  paused_seconds: number;
  actual_duration_hours: number | null;
  rerolls_allowed: number;
  coop_won: number | null;
  lead_mode: LeadMode;
  lead_label: string | null;
}

export interface ParticipantInput {
  playerId: unknown;
  placement?: unknown;
  dnf?: unknown;
  team?: unknown;
}

const masterOnly = (a: GmAuth) => {
  if (a.role !== 'master') throw forbidden('master_only');
};

function requireNight(ctx: Ctx, statuses: NightRow['status'][]): NightRow {
  const n = currentNight(ctx);
  if (!n) throw notFound('no_night');
  if (!statuses.includes(n.status)) throw conflict('bad_night_state', `Not allowed while the night is ${n.status}.`);
  return n;
}

export function getGame(ctx: Ctx, id: number): GameRow {
  const g = ctx.db.prepare('SELECT * FROM game WHERE id = ?').get(id) as GameRow | undefined;
  if (!g) throw notFound('game_not_found');
  return g;
}

function participantIds(ctx: Ctx, gameId: number): number[] {
  return (ctx.db.prepare('SELECT player_id FROM game_participant WHERE game_id = ? ORDER BY rowid').all(gameId) as { player_id: number }[]).map((r) => r.player_id);
}

function checkPlayers(ctx: Ctx, nightId: number, ids: unknown): number[] {
  if (ids === undefined) return [];
  if (!Array.isArray(ids)) throw bad('bad_participants');
  const out = [...new Set(ids.map(Number))];
  for (const id of out) {
    if (!ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ?').get(id, nightId)) throw bad('unknown_player', `Player ${id} is not in this night.`);
  }
  return out;
}

function setParticipants(ctx: Ctx, gameId: number, ids: number[]) {
  ctx.db.prepare('DELETE FROM game_participant WHERE game_id = ?').run(gameId);
  const ins = ctx.db.prepare('INSERT INTO game_participant (game_id, player_id) VALUES (?, ?)');
  for (const id of ids) ins.run(gameId, id);
}

// ---------------------------------------------------------------- schedule (Master)

export interface ScheduleInput {
  libraryGameId?: unknown;
  name?: unknown;
  mode?: unknown;
  plannedStart?: unknown;
  plannedDurationHours?: unknown;
  tableId?: unknown;
  rerollsAllowed?: unknown;
  participants?: unknown;
  /** Only used when the library game doesn't set one. */
  leadMode?: unknown;
  leadLabel?: unknown;
}

/** Optional table (seating plan) for a game; must belong to this night. */
function tableOf(ctx: Ctx, nightId: number, v: unknown): number | null {
  if (v == null || v === '') return null;
  const id = Number(v);
  if (!ctx.db.prepare('SELECT 1 FROM game_table WHERE id = ? AND night_id = ?').get(id, nightId)) throw bad('bad_table');
  return id;
}

export function scheduleGame(ctx: Ctx, actor: GmAuth, input: ScheduleInput): GameRow {
  masterOnly(actor);
  const n = requireNight(ctx, ['setup', 'joins_open', 'live', 'paused']);
  const lib = input.libraryGameId != null && input.libraryGameId !== '' ? getLibraryGame(ctx, Number(input.libraryGameId)) : null;
  if (input.libraryGameId != null && input.libraryGameId !== '' && !lib) throw notFound('library_game_not_found');
  const name = (typeof input.name === 'string' && input.name.trim() ? input.name.trim() : lib?.name ?? '').slice(0, 60);
  if (!name) throw bad('bad_name', 'Pick a library game or enter a name.');
  const mode = (input.mode ?? lib?.mode ?? 'competitive') as GameMode;
  if (!['competitive', 'team', 'coop'].includes(mode)) throw bad('bad_mode');
  const duration = Number(input.plannedDurationHours ?? lib?.defaultDuration ?? 1);
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 8) throw bad('bad_duration');
  const plannedStart = input.plannedStart == null || input.plannedStart === '' ? null : Number(input.plannedStart);
  if (plannedStart != null && !Number.isFinite(plannedStart)) throw bad('bad_start');
  const rerolls = input.rerollsAllowed === undefined ? !!lib?.rerollsAllowed : !!input.rerollsAllowed;
  const parts = checkPlayers(ctx, n.id, input.participants);
  // The library (pack) decides how the crown works; if it doesn't say, the GM picks (default: score, higher wins).
  const leadMode: LeadMode = lib?.leadMode ?? leadModeOf(input.leadMode) ?? 'high';
  const leadLabel = lib?.leadMode ? lib.leadLabel : (leadLabelOf(input.leadLabel) ?? lib?.leadLabel ?? null);
  return ctx.db.transaction(() => {
    const r = ctx.db
      .prepare(
        "INSERT INTO game (night_id, library_game_id, name, table_id, mode, planned_start, planned_duration_hours, status, rerolls_allowed, lead_mode, lead_label) VALUES (?,?,?,?,?,?,?, 'scheduled', ?,?,?)",
      )
      .run(n.id, lib?.id ?? null, name, tableOf(ctx, n.id, input.tableId), mode, plannedStart, duration, rerolls ? 1 : 0, leadMode, leadLabel);
    const id = Number(r.lastInsertRowid);
    setParticipants(ctx, id, parts);
    const g = getGame(ctx, id);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'game.schedule', entity: 'game', entityId: id, after: { ...g, participants: parts } });
    return g;
  })();
}

export function updateScheduledGame(ctx: Ctx, actor: GmAuth, id: number, input: ScheduleInput): GameRow {
  masterOnly(actor);
  const before = getGame(ctx, id);
  if (before.status !== 'scheduled' && before.status !== 'active') throw conflict('game_not_editable');
  const n = currentNight(ctx)!;
  const name = input.name === undefined ? before.name : String(input.name).trim().slice(0, 60);
  if (!name) throw bad('bad_name');
  const mode = (input.mode ?? before.mode) as GameMode;
  if (!['competitive', 'team', 'coop'].includes(mode)) throw bad('bad_mode');
  const duration = input.plannedDurationHours === undefined ? before.planned_duration_hours : Number(input.plannedDurationHours);
  if (duration != null && (!Number.isFinite(duration) || duration < 0.1 || duration > 8)) throw bad('bad_duration');
  const plannedStart = input.plannedStart === undefined ? before.planned_start : input.plannedStart == null || input.plannedStart === '' ? null : Number(input.plannedStart);
  const rerolls = input.rerollsAllowed === undefined ? before.rerolls_allowed : input.rerollsAllowed ? 1 : 0;
  const tableId = input.tableId === undefined ? before.table_id : tableOf(ctx, n.id, input.tableId);
  // Lead mode: fixed by the library game if it sets one; otherwise editable until the game starts.
  const lib = before.library_game_id != null ? getLibraryGame(ctx, before.library_game_id) : null;
  let leadMode = before.lead_mode;
  let leadLabel = before.lead_label;
  if (!lib?.leadMode && (input.leadMode !== undefined || input.leadLabel !== undefined)) {
    if (before.status !== 'scheduled') throw conflict('lead_mode_locked', 'The crown mode can only change before the game starts.');
    if (input.leadMode !== undefined) leadMode = leadModeOf(input.leadMode) ?? 'high';
    if (input.leadLabel !== undefined) leadLabel = leadLabelOf(input.leadLabel);
  }
  return ctx.db.transaction(() => {
    ctx.db
      .prepare('UPDATE game SET name=?, mode=?, planned_duration_hours=?, planned_start=?, rerolls_allowed=?, table_id=?, lead_mode=?, lead_label=? WHERE id=?')
      .run(name, mode, duration, plannedStart, rerolls, tableId, leadMode, leadLabel, id);
    if (input.participants !== undefined) setParticipants(ctx, id, checkPlayers(ctx, n.id, input.participants));
    const after = getGame(ctx, id);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'game.update', entity: 'game', entityId: id, before, after });
    return after;
  })();
}

export function cancelGame(ctx: Ctx, actor: GmAuth, id: number): void {
  masterOnly(actor);
  const g = getGame(ctx, id);
  if (g.status === 'final' || g.status === 'cancelled') throw conflict('game_not_cancellable');
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE game SET status = 'cancelled' WHERE id = ?").run(id);
    audit(ctx, { nightId: g.night_id, gmId: actor.gmId, action: 'game.cancel', entity: 'game', entityId: id, before: { status: g.status } });
  })();
  ctx.bus.all('game:update', { id, status: 'cancelled' });
  ctx.bus.refresh(g.night_id);
}

// ---------------------------------------------------------------- field actions (Master or Sub)

export function startGame(ctx: Ctx, actor: GmAuth, id: number, input: { participants?: unknown } = {}): GameRow {
  const n = requireNight(ctx, ['live']);
  const g = getGame(ctx, id);
  if (g.night_id !== n.id) throw notFound('game_not_found');
  // Idempotent: a second tap (or a second GM device) on an already-running game is a no-op, not an error.
  if (g.status === 'active') return g;
  if (g.status !== 'scheduled') throw conflict('game_not_scheduled');
  const parts = input.participants === undefined ? null : checkPlayers(ctx, n.id, input.participants);
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE game SET status = 'active', started_at = ?, assigned_gm_id = COALESCE(assigned_gm_id, ?) WHERE id = ?").run(ctx.now(), actor.gmId, id);
    if (parts) setParticipants(ctx, id, parts);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'game.start', entity: 'game', entityId: id, after: { participants: parts ?? participantIds(ctx, id) } });
  })();
  pushFeed(ctx, n.id, 'game', 'feed.game_started', { gameId: id, name: g.name });
  ctx.bus.all('game:update', { id, status: 'active' });
  ctx.bus.refresh(n.id);
  return getGame(ctx, id);
}

/** Wall ms between a and b with night pauses removed. */
function pauseOverlapMs(ctx: Ctx, nightId: number, a: number, b: number): number {
  let total = 0;
  for (const p of pauses(ctx, nightId)) {
    const s = Math.max(a, p.start);
    const e = Math.min(b, p.end ?? b);
    if (e > s) total += e - s;
  }
  return total;
}

/** Prefill for the wizard: elapsed hours since start, pause excluded, rounded to 0.05 h. The schedule is never a scoring input. */
export function suggestedHours(ctx: Ctx, g: GameRow): number | null {
  if (!g.started_at) return null;
  const end = g.ended_at ?? ctx.now();
  const ms = end - g.started_at - pauseOverlapMs(ctx, g.night_id, g.started_at, end);
  return Math.max(0.05, Math.round((ms / 3_600_000) * 20) / 20);
}

export interface ResultInput {
  participants: unknown;
  actualHours: unknown;
  coopWon?: unknown;
}

function parseResult(ctx: Ctx, g: GameRow, input: ResultInput): GameResult {
  if (!Array.isArray(input.participants) || input.participants.length === 0) throw bad('bad_participants', 'Add at least one participant.');
  const parts = (input.participants as ParticipantInput[]).map((p) => {
    const playerId = Number(p.playerId);
    if (!ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ?').get(playerId, g.night_id)) throw bad('unknown_player');
    const placement = p.placement == null || p.placement === '' ? null : Number(p.placement);
    return {
      playerId: pid(playerId),
      placement,
      dnf: !!p.dnf,
      team: typeof p.team === 'string' && p.team.trim() ? p.team.trim().slice(0, 20) : null,
    };
  });
  const result: GameResult = {
    id: String(g.id),
    mode: g.mode,
    actualHours: Number(input.actualHours),
    participants: parts,
    coopWon: g.mode === 'coop' ? (input.coopWon == null ? null : !!input.coopWon) : null,
  };
  const errs = validateResult(result);
  if (errs.length) throw bad('bad_result', errs.join('; '));
  if (result.actualHours > 12) throw bad('bad_result', 'actual hours must be ≤ 12');
  return result;
}

function writeResult(ctx: Ctx, g: GameRow, r: GameResult) {
  ctx.db.prepare('DELETE FROM game_participant WHERE game_id = ?').run(g.id);
  const ins = ctx.db.prepare('INSERT INTO game_participant (game_id, player_id, team_label, placement, dnf) VALUES (?,?,?,?,?)');
  for (const p of r.participants) ins.run(g.id, Number(p.playerId), p.team ?? null, p.dnf ? null : p.placement ?? null, p.dnf ? 1 : 0);
}

/** Result wizard submit: participants → placements/DNF/teams or win/loss → confirmed duration. */
export function submitResult(ctx: Ctx, actor: GmAuth, id: number, input: ResultInput) {
  const n = requireNight(ctx, ['live', 'paused']);
  const g = getGame(ctx, id);
  if (g.night_id !== n.id) throw notFound('game_not_found');
  if (g.status === 'final') {
    // Idempotent: the same result submitted twice (double tap, two GM devices) is a no-op success.
    const again = parseResult(ctx, g, input);
    const stored = loadResults(ctx, n.id).find((r) => r.id === String(id));
    const key = (r: GameResult) =>
      JSON.stringify([r.actualHours, r.coopWon ?? null, [...r.participants].map((p) => [String(p.playerId), p.dnf ? null : p.placement ?? null, !!p.dnf, p.team ?? null]).sort()]);
    if (stored && key(stored) === key({ ...again, id: String(id) })) {
      const sc = scoreGame(stored, nightSettings(n));
      return { gameId: id, gold: sc.rows.map((r) => ({ playerId: Number(r.playerId), goldH: r.goldH, mult: r.mult })) };
    }
  }
  if (g.status !== 'active' && g.status !== 'scheduled') throw conflict('game_not_open', 'Use “correct result” for finished games.');
  const result = parseResult(ctx, g, input);
  const settings = nightSettings(n);
  const scored = scoreGame(result, settings);
  const now = ctx.now();
  const pausedMs = g.started_at ? pauseOverlapMs(ctx, n.id, g.started_at, now) : 0;
  ctx.db.transaction(() => {
    writeResult(ctx, g, result);
    ctx.db
      .prepare("UPDATE game SET status = 'final', started_at = COALESCE(started_at, ?), ended_at = ?, actual_duration_hours = ?, coop_won = ?, paused_seconds = ? WHERE id = ?")
      .run(now, now, result.actualHours, result.coopWon == null ? null : result.coopWon ? 1 : 0, Math.round(pausedMs / 1000), id);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'game.result', entity: 'game', entityId: id, after: result });
  })();
  snapshotStandings(ctx, n.id);
  awardAchievements(ctx, n.id);
  hintsForResult(ctx, n, { ...result, id: String(id) });
  const winners = scored.rows.filter((r) => r.mult === Math.max(...scored.rows.map((x) => x.mult)) && r.goldH > 0).map((r) => Number(r.playerId));
  pushFeed(ctx, n.id, 'result', 'feed.game_result', { gameId: id, name: g.name, winners, gold: scored.rows.map((r) => ({ playerId: Number(r.playerId), goldH: r.goldH })) });
  ctx.bus.all('game:update', { id, status: 'final' });
  ctx.bus.refresh(n.id);
  return { gameId: id, gold: scored.rows.map((r) => ({ playerId: Number(r.playerId), goldH: r.goldH, mult: r.mult })) };
}

/**
 * Correction after the market has reacted (spec §7.4): gold re-derives; price history stays; trades and
 * paid bounties stand. Audit-logged and announced in the GM-only feed.
 */
export function correctResult(ctx: Ctx, actor: GmAuth, id: number, input: ResultInput) {
  const n = requireNight(ctx, ['live', 'paused']);
  const g = getGame(ctx, id);
  if (g.night_id !== n.id) throw notFound('game_not_found');
  if (g.status !== 'final') throw conflict('game_not_final');
  const before = {
    actualHours: g.actual_duration_hours,
    coopWon: g.coop_won,
    participants: ctx.db.prepare('SELECT player_id, team_label, placement, dnf FROM game_participant WHERE game_id = ?').all(id),
  };
  const result = parseResult(ctx, g, input);
  const scored = scoreGame(result, nightSettings(n));
  ctx.db.transaction(() => {
    writeResult(ctx, g, result);
    ctx.db.prepare('UPDATE game SET actual_duration_hours = ?, coop_won = ? WHERE id = ?').run(result.actualHours, result.coopWon == null ? null : result.coopWon ? 1 : 0, id);
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'game.correct', entity: 'game', entityId: id, before, after: result });
  })();
  snapshotStandings(ctx, n.id);
  awardAchievements(ctx, n.id);
  hintsForResult(ctx, n, { ...result, id: String(id) });
  handicapAfterCorrection(ctx, n);
  pushFeed(ctx, n.id, 'correction', 'feed.correction', { gameId: id, name: g.name, by: actor.name }, true);
  ctx.bus.all('game:update', { id, status: 'final' });
  ctx.bus.refresh(n.id);
  return { gameId: id, gold: scored.rows.map((r) => ({ playerId: Number(r.playerId), goldH: r.goldH, mult: r.mult })) };
}

/** Archive: a standings snapshot after every result. */
function snapshotStandings(ctx: Ctx, nightId: number) {
  const st = computeNightState(ctx, nightId)!;
  ctx.db
    .prepare('INSERT INTO standings_snapshot (night_id, data, created_at) VALUES (?,?,?)')
    .run(nightId, j.str(st.standings.map((r) => ({ playerId: Number(r.playerId), netWorthH: r.netWorthH, rank: r.rank }))), ctx.now());
}

// ---------------------------------------------------------------- crowns

/** Replays a game's leader taps through the engine to get the current crown. */
export function crownOf(ctx: Ctx, gameId: number): CrownState {
  const settings = nightSettings(currentNight(ctx) ?? (ctx.db.prepare('SELECT n.* FROM night n JOIN game g ON g.night_id = n.id WHERE g.id = ?').get(gameId) as NightRow));
  let crown = EMPTY_CROWN;
  for (const t of ctx.db.prepare('SELECT player_id, night_ms FROM leader_tap WHERE game_id = ? ORDER BY id').all(gameId) as { player_id: number; night_ms: number }[]) {
    crown = tapLeader(crown, pid(t.player_id), t.night_ms, settings).state;
  }
  return crown;
}

function activeGameFor(ctx: Ctx, gameId: number) {
  const n = requireNight(ctx, ['live', 'paused']);
  const g = getGame(ctx, gameId);
  if (g.night_id !== n.id) throw notFound('game_not_found');
  if (g.status !== 'active') throw conflict('game_not_active');
  const parts = participantIds(ctx, gameId);
  const eligible = (p: number) => (parts.length ? parts.includes(p) : !!ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ?').get(p, n.id));
  return { n, g, eligible };
}

/** Moves the crown (manual tap or score-derived). Dethroning is public; kingfall (a long reign ending) is hidden. */
function setCrown(ctx: Ctx, actor: GmAuth, n: NightRow, g: GameRow, p: number) {
  const before = crownOf(ctx, g.id);
  const at = nightMs(ctx, n);
  const t = tapLeader(before, pid(p), at, nightSettings(n));
  if (!t.dethroned && before.leaderId === pid(p)) return { leaderId: p, changed: false, dethroned: false };
  ctx.db.transaction(() => {
    ctx.db.prepare('INSERT INTO leader_tap (game_id, player_id, gm_id, night_ms, created_at) VALUES (?,?,?,?,?)').run(g.id, p, actor.gmId, at, ctx.now());
    audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'game.leader', entity: 'game', entityId: g.id, before: { leaderId: before.leaderId }, after: { leaderId: p } });
    if (t.kingfall) {
      const imp = kingfallImpulse(loadSecurities(ctx, n.id), nightSettings(n));
      if (imp) queueImpulse(ctx, n.id, imp);
    }
  })();
  if (t.dethroned) pushFeed(ctx, n.id, 'dethroned', 'feed.dethroned', { gameId: g.id, name: g.name, from: Number(t.dethroned.from), to: p });
  if (t.kingfall) pushFeed(ctx, n.id, 'kingfall', 'feed.kingfall', { gameId: g.id, name: g.name, from: Number(t.dethroned!.from) }, true);
  ctx.bus.all('leader:update', { gameId: g.id, leaderId: p });
  return { leaderId: p, changed: true, dethroned: !!t.dethroned };
}

/** Manual crown: ≤2 taps on the GM phone (pick game, tap leader). Only for games in manual lead mode. */
export function leaderTap(ctx: Ctx, actor: GmAuth, gameId: number, playerId: unknown) {
  const { n, g, eligible } = activeGameFor(ctx, gameId);
  if (g.lead_mode !== 'manual') throw conflict('crown_is_scored', 'This game decides the leader from scores. Enter scores instead.');
  const p = Number(playerId);
  if (!eligible(p)) throw bad('not_a_participant');
  const r = setCrown(ctx, actor, n, g, p);
  if (r.changed) ctx.bus.refresh(n.id);
  return r;
}

/** Latest entered score per player for a game. */
export function latestScores(ctx: Ctx, gameId: number): Map<number, number> {
  const rows = ctx.db
    .prepare('SELECT player_id, score FROM game_score WHERE id IN (SELECT MAX(id) FROM game_score WHERE game_id = ? GROUP BY player_id)')
    .all(gameId) as { player_id: number; score: number }[];
  return new Map(rows.map((r) => [r.player_id, r.score]));
}

/** Score entry (any GM): update some or all players' current scores; the crown follows automatically. */
export function enterScores(ctx: Ctx, actor: GmAuth, gameId: number, input: { scores?: unknown }) {
  const { n, g, eligible } = activeGameFor(ctx, gameId);
  if (g.lead_mode === 'manual') throw conflict('crown_is_manual', 'This game uses manual crown taps.');
  if (!Array.isArray(input.scores) || !input.scores.length) throw bad('bad_scores');
  if (input.scores.length > 40) throw bad('bad_scores');
  const entries = (input.scores as { playerId?: unknown; score?: unknown }[]).map((e) => {
    const p = Number(e?.playerId);
    const v = Number(e?.score);
    if (!eligible(p)) throw bad('not_a_participant');
    if (e?.score === '' || e?.score == null || !Number.isFinite(v)) throw bad('bad_score', 'Scores must be numbers.');
    if (Math.abs(v) > 1e6) throw bad('bad_score', 'Scores must be between −1,000,000 and 1,000,000.');
    return { p, v };
  });
  const at = nightMs(ctx, n);
  const prev = latestScores(ctx, gameId);
  const changed = entries.filter((e) => prev.get(e.p) !== e.v);
  if (changed.length) {
    ctx.db.transaction(() => {
      const ins = ctx.db.prepare('INSERT INTO game_score (game_id, player_id, score, gm_id, night_ms, created_at) VALUES (?,?,?,?,?,?)');
      for (const e of changed) ins.run(gameId, e.p, e.v, actor.gmId, at, ctx.now());
      audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'game.scores', entity: 'game', entityId: gameId, before: Object.fromEntries(changed.map((e) => [e.p, prev.get(e.p) ?? null])), after: Object.fromEntries(changed.map((e) => [e.p, e.v])) });
    })();
  }
  const scores = latestScores(ctx, gameId);
  const current = crownOf(ctx, gameId).leaderId;
  const next = leaderFromScores(new Map([...scores].map(([k, v]) => [pid(k), v])), g.lead_mode, current);
  const crown = next && next !== current ? setCrown(ctx, actor, n, g, Number(next)) : null;
  if (changed.length) ctx.bus.all('game:update', { id: gameId, status: g.status });
  if (changed.length || crown) ctx.bus.refresh(n.id);
  return { leaderId: next ? Number(next) : null, changed: !!crown?.changed, dethroned: !!crown?.dethroned, scores: Object.fromEntries(scores) };
}

// ---------------------------------------------------------------- views

export interface GameView {
  id: number;
  name: string;
  mode: GameMode;
  status: GameStatus;
  color: string | null;
  plannedStart: number | null;
  plannedDurationHours: number | null;
  startedAt: number | null;
  endedAt: number | null;
  /** Pause-excluded hours played so far (active) or the confirmed duration (final). */
  hours: number | null;
  rerollsAllowed: boolean;
  participants: { playerId: number; placement: number | null; dnf: boolean; team: string | null }[];
  leaderId: number | null;
  tableId: number | null;
  /** How the crown is decided: 'high'/'low' from entered scores, or 'manual' taps. */
  leadMode: LeadMode;
  leadLabel: string | null;
  /** Latest entered score per player (scored games only). Public: it's what the table already sees. */
  scores: Record<number, number>;
  /** The library game sets the lead mode (the schedule form can't change it). */
  leadFixed: boolean;
}

export function gameViews(ctx: Ctx, nightId: number): GameView[] {
  const rows = ctx.db
    .prepare(
      `SELECT g.*, l.color, l.lead_mode AS lib_lead_mode FROM game g LEFT JOIN library_game l ON l.id = g.library_game_id
       WHERE g.night_id = ? AND g.status != 'cancelled'
       ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, COALESCE(g.planned_start, g.started_at, g.id), g.id`,
    )
    .all(nightId) as (GameRow & { color: string | null; lib_lead_mode: string | null })[];
  const parts = ctx.db.prepare('SELECT player_id, placement, dnf, team_label FROM game_participant WHERE game_id = ? ORDER BY COALESCE(placement, 99), rowid');
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    mode: g.mode,
    status: g.status,
    color: g.color,
    plannedStart: g.planned_start,
    plannedDurationHours: g.planned_duration_hours,
    startedAt: g.started_at,
    endedAt: g.ended_at,
    hours: g.status === 'final' ? g.actual_duration_hours : g.status === 'active' ? suggestedHours(ctx, g) : null,
    rerollsAllowed: !!g.rerolls_allowed,
    participants: (parts.all(g.id) as { player_id: number; placement: number | null; dnf: number; team_label: string | null }[]).map((p) => ({
      playerId: p.player_id,
      placement: p.placement,
      dnf: !!p.dnf,
      team: p.team_label,
    })),
    leaderId: g.status === 'active' ? ((v) => (v ? Number(v) : null))(crownOf(ctx, g.id).leaderId) : null,
    tableId: g.table_id,
    leadMode: g.lead_mode,
    leadLabel: g.lead_label,
    scores: g.lead_mode === 'manual' ? {} : Object.fromEntries(latestScores(ctx, g.id)),
    leadFixed: g.lib_lead_mode != null,
  }));
}
