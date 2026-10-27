/**
 * Handicaps (GM/Master only; players never learn about them). Hourly on the night clock:
 *  - auto level (if handicap.autoEnabled) from net worth, placements and trajectory; top 50% = 1, bottom 50% = 2..5;
 *  - effective = auto + the Master GM's manual offset (the auto level never sees or removes the offset);
 *  - help for the interval: ~30% as an anonymous gold "gift", ~70% as hint credit spent on tips.
 * Help already given always stays. Result corrections re-evaluate levels (no extra help until the next interval).
 */
import { autoLevels, effectiveLevel, intervalHelpH, projectNightGoldH, spendHintCredit, toH, type HandicapPlayer } from '@gn/engine';
import { j } from '../db';
import { bad, conflict, forbidden, notFound, type Ctx } from '../context';
import { audit } from './audit';
import type { GmAuth } from './gm';
import { grantHint } from './hints';
import { computeNightState, loadResults, nightMs, nightSettings, type NightRow } from './state';

interface EvalRow {
  id: number;
  player_id: number;
  night_ms: number;
  auto_level: number;
  offset: number;
  effective: number;
  net_worth_h: number;
  reasons: string;
  trigger: 'interval' | 'correction' | 'manual';
  gift_h: number;
  hints: string;
  credit_h: number;
  created_at: number;
}

const offsets = (ctx: Ctx, nightId: number) =>
  new Map((ctx.db.prepare('SELECT player_id, offset FROM handicap_manual WHERE night_id = ?').all(nightId) as { player_id: number; offset: number }[]).map((r) => [r.player_id, r.offset]));

function lastEval(ctx: Ctx, nightId: number, playerId: number): EvalRow | undefined {
  return ctx.db.prepare('SELECT * FROM handicap_eval WHERE night_id = ? AND player_id = ? ORDER BY id DESC LIMIT 1').get(nightId, playerId) as EvalRow | undefined;
}
function lastIntervalNms(ctx: Ctx, nightId: number): number {
  return (ctx.db.prepare("SELECT MAX(night_ms) m FROM handicap_eval WHERE night_id = ? AND trigger = 'interval'").get(nightId) as { m: number | null }).m ?? 0;
}

/** Average normalised placement per player (1 = always first, 0 = always last; DNF = 0). Co-op games don't count. */
function placementScores(ctx: Ctx, nightId: number): Map<number, number> {
  const sums = new Map<number, { s: number; c: number }>();
  for (const r of loadResults(ctx, nightId)) {
    if (r.mode === 'coop') continue;
    const placed = r.participants.filter((p) => !p.dnf && p.placement != null).map((p) => p.placement!);
    const units = new Set(placed).size;
    const worst = Math.max(1, ...placed);
    for (const p of r.participants) {
      const v = p.dnf || p.placement == null ? 0 : units <= 1 ? 0.5 : 1 - (p.placement - 1) / Math.max(1, worst - 1);
      const x = sums.get(Number(p.playerId)) ?? { s: 0, c: 0 };
      x.s += v;
      x.c++;
      sums.set(Number(p.playerId), x);
    }
  }
  return new Map([...sums].map(([k, v]) => [k, v.s / v.c]));
}

function evaluate(ctx: Ctx, n: NightRow, trigger: EvalRow['trigger']): void {
  const settings = nightSettings(n);
  const st = computeNightState(ctx, n.id)!;
  const now = nightMs(ctx, n);
  const wallNow = ctx.now();
  const active = st.players.filter((p) => p.left_at == null);
  if (!active.length) return;
  const prevNms = lastIntervalNms(ctx, n.id);
  // Wall time of the previous interval evaluation (for "played in the interval").
  const prevWall =
    (ctx.db.prepare("SELECT MAX(created_at) t FROM handicap_eval WHERE night_id = ? AND trigger = 'interval'").get(n.id) as { t: number | null }).t ?? n.started_at ?? wallNow;
  const nw = new Map(st.standings.map((r) => [Number(r.playerId), r.netWorthH]));
  const ledger = new Map([...st.ledger.values()].map((l) => [Number(l.playerId), l]));
  const place = placementScores(ctx, n.id);
  const played = new Set(
    (ctx.db
      .prepare(
        "SELECT DISTINCT gp.player_id FROM game_participant gp JOIN game g ON g.id = gp.game_id WHERE g.night_id = ? AND g.status IN ('active','final') AND g.started_at IS NOT NULL AND g.started_at <= ? AND (g.ended_at IS NULL OR g.ended_at >= ?)",
      )
      .all(n.id, wallNow, prevWall) as { player_id: number }[]).map((r) => r.player_id),
  );
  const startH = toH(settings.stake.startingGold);
  const input: HandicapPlayer[] = active.map((p) => ({
    id: String(p.id),
    netWorthH: nw.get(p.id) ?? startH,
    prevNetWorthH: lastEval(ctx, n.id, p.id)?.net_worth_h ?? startH,
    placementScore: place.get(p.id) ?? null,
    playedInInterval: played.has(p.id),
  }));
  const auto = new Map<number, { level: number; reasons: Record<string, unknown> | null }>(
    settings.handicap.autoEnabled
      ? autoLevels(input, settings).map((l) => [Number(l.id), { level: l.level, reasons: { ...l.reasons, score: l.score } }])
      : input.map((p) => [Number(p.id), { level: 1, reasons: null }]),
  );
  // Team games: members of a running team game share the rounded average of their levels.
  const teamGames = ctx.db
    .prepare("SELECT g.id FROM game g WHERE g.night_id = ? AND g.status = 'active' AND g.mode = 'team'")
    .all(n.id) as { id: number }[];
  const teamAveraged = new Set<number>();
  for (const g of teamGames) {
    const members = (ctx.db.prepare('SELECT player_id FROM game_participant WHERE game_id = ?').all(g.id) as { player_id: number }[]).map((r) => r.player_id).filter((id) => auto.has(id));
    if (members.length < 2) continue;
    const avg = Math.round(members.reduce((a, id) => a + auto.get(id)!.level, 0) / members.length);
    for (const id of members) {
      auto.get(id)!.level = avg;
      teamAveraged.add(id);
    }
  }
  const off = offsets(ctx, n.id);
  const elapsedMin = now / 60000;
  const proj = new Map(active.map((p) => [p.id, projectNightGoldH(ledger.get(p.id)?.earnedH ?? startH, startH, elapsedMin, n.length_minutes)]));
  const tableAvg = [...proj.values()].reduce((a, b) => a + b, 0) / Math.max(1, proj.size);
  const ins = ctx.db.prepare(
    'INSERT INTO handicap_eval (night_id, player_id, night_ms, auto_level, offset, effective, net_worth_h, reasons, trigger, gift_h, hints, credit_h, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  ctx.db.transaction(() => {
    for (const p of active) {
      const a = auto.get(p.id)!;
      const o = off.get(p.id) ?? 0;
      const eff = effectiveLevel(a.level, o);
      const prevCredit = lastEval(ctx, n.id, p.id)?.credit_h ?? 0;
      let giftH = 0;
      let credit = prevCredit;
      const tips: string[] = [];
      // Help only on the hourly cadence; never for the very first moments of a late join (they start at 1).
      if (trigger === 'interval' && eff >= 2 && now - prevNms > 0) {
        const base = Math.max(proj.get(p.id) ?? startH, 0.5 * tableAvg);
        const help = intervalHelpH(eff, base, settings, n.length_minutes);
        giftH = help.giftH;
        credit += help.hintCreditH;
        if (giftH >= 1)
          ctx.db
            .prepare("INSERT INTO adjustment (night_id, player_id, gold_h, reason, kind, gm_id, created_at) VALUES (?,?,?, 'Anonymous gift', 'gift', NULL, ?)")
            .run(n.id, p.id, giftH, wallNow);
        if (settings.hints.enabled) {
          const spent = spendHintCredit(credit, settings);
          spent.tiers.forEach((t, k) => {
            if (grantHint(ctx, n, p.id, t, 'handicap', `h:${now}:${k}`) != null) tips.push(t);
          });
          credit = spent.leftH;
        }
      }
      ins.run(
        n.id,
        p.id,
        now,
        a.level,
        o,
        eff,
        nw.get(p.id) ?? startH,
        j.str({ ...(a.reasons ?? { auto: 'off' }), teamAveraged: teamAveraged.has(p.id) || undefined }),
        trigger,
        giftH,
        j.str(tips),
        credit,
        wallNow,
      );
      if (giftH >= 1) ctx.bus.player(p.id, 'gift:new', { goldH: giftH });
    }
  })();
  ctx.bus.gm('handicap:update', { trigger });
  ctx.bus.refresh(n.id);
}

/** Tick-loop step: hourly evaluation while live, when auto handicap is on or any manual level is set. */
export function handicapStep(ctx: Ctx, n: NightRow): void {
  if (n.status !== 'live') return;
  const s = nightSettings(n);
  const anyManual = !!ctx.db.prepare('SELECT 1 FROM handicap_manual WHERE night_id = ? AND offset != 0').get(n.id);
  if (!s.handicap.autoEnabled && !anyManual) return;
  const now = nightMs(ctx, n);
  if (now - lastIntervalNms(ctx, n.id) < s.handicap.intervalMinutes * 60_000) return;
  evaluate(ctx, n, 'interval');
}

/** After a result correction: recompute levels right away (help already given stays). */
export function handicapAfterCorrection(ctx: Ctx, n: NightRow): void {
  if (!nightSettings(n).handicap.autoEnabled) return;
  if (!ctx.db.prepare('SELECT 1 FROM handicap_eval WHERE night_id = ?').get(n.id)) return;
  evaluate(ctx, n, 'correction');
}

/** Master only: the GM's manual offset on top of the auto level (−4..+4). */
export function setHandicapOffset(ctx: Ctx, actor: GmAuth, playerId: number, input: { offset?: unknown }) {
  if (actor.role !== 'master') throw forbidden('master_only');
  const n = ctx.db.prepare("SELECT * FROM night WHERE status NOT IN ('archived') ORDER BY id DESC LIMIT 1").get() as NightRow | undefined;
  if (!n || ['setup', 'ended', 'archived'].includes(n.status)) throw conflict('bad_night_state', 'Handicaps can be set once players have joined.');
  if (!ctx.db.prepare('SELECT 1 FROM player WHERE id = ? AND night_id = ? AND left_at IS NULL').get(playerId, n.id)) throw notFound('player_not_found');
  const offset = Number(input.offset);
  if (!Number.isInteger(offset) || offset < -4 || offset > 4) throw bad('bad_offset', 'Offset must be a whole number from −4 to +4.');
  const before = offsets(ctx, n.id).get(playerId) ?? 0;
  ctx.db
    .prepare('INSERT INTO handicap_manual (night_id, player_id, offset, gm_id, updated_at) VALUES (?,?,?,?,?) ON CONFLICT (night_id, player_id) DO UPDATE SET offset = excluded.offset, gm_id = excluded.gm_id, updated_at = excluded.updated_at')
    .run(n.id, playerId, offset, actor.gmId, ctx.now());
  const last = lastEval(ctx, n.id, playerId);
  const auto = last?.auto_level ?? 1;
  ctx.db
    .prepare(
      "INSERT INTO handicap_eval (night_id, player_id, night_ms, auto_level, offset, effective, net_worth_h, reasons, trigger, gift_h, hints, credit_h, created_at) VALUES (?,?,?,?,?,?,?,?, 'manual', 0, '[]', ?, ?)",
    )
    .run(n.id, playerId, nightMs(ctx, n), auto, offset, effectiveLevel(auto, offset), last?.net_worth_h ?? toH(nightSettings(n).stake.startingGold), j.str({ by: actor.name, from: before }), last?.credit_h ?? 0, ctx.now());
  audit(ctx, { nightId: n.id, gmId: actor.gmId, action: 'handicap.offset', entity: 'player', entityId: playerId, before: { offset: before }, after: { offset } });
  ctx.bus.refresh(n.id);
  return { playerId, offset, effective: effectiveLevel(auto, offset) };
}

// ---------------------------------------------------------------- views (GM only)

export function handicapGmView(ctx: Ctx, n: NightRow, playerIds: number[]) {
  const s = nightSettings(n);
  const off = offsets(ctx, n.id);
  const players = playerIds.map((id) => {
    const e = lastEval(ctx, n.id, id);
    const auto = e?.auto_level ?? 1;
    const offset = off.get(id) ?? 0;
    return { playerId: id, auto, offset, effective: effectiveLevel(auto, offset), reasons: e ? j.parse<Record<string, unknown>>(e.reasons, {}) : null, lastNms: e?.night_ms ?? null };
  });
  const log = (ctx.db.prepare('SELECT * FROM handicap_eval WHERE night_id = ? ORDER BY id DESC LIMIT 150').all(n.id) as EvalRow[]).map((e) => ({
    id: e.id,
    playerId: e.player_id,
    nightMs: e.night_ms,
    auto: e.auto_level,
    offset: e.offset,
    effective: e.effective,
    trigger: e.trigger,
    reasons: j.parse<Record<string, unknown>>(e.reasons, {}),
    giftH: e.gift_h,
    tips: j.parse<string[]>(e.hints, []),
  }));
  const last = lastIntervalNms(ctx, n.id);
  return { autoEnabled: s.handicap.autoEnabled, intervalMinutes: s.handicap.intervalMinutes, nextEvalNms: last + s.handicap.intervalMinutes * 60_000, players, log };
}

/** Player-side: anonymous gifts (never says why). */
export function playerGifts(ctx: Ctx, nightId: number, playerId: number) {
  return (ctx.db.prepare("SELECT id, gold_h, created_at, read_at FROM adjustment WHERE night_id = ? AND player_id = ? AND kind = 'gift' ORDER BY id DESC").all(nightId, playerId) as {
    id: number;
    gold_h: number;
    created_at: number;
    read_at: number | null;
  }[]).map((g) => ({ id: g.id, goldH: g.gold_h, createdAt: g.created_at, read: g.read_at != null }));
}

export function readGift(ctx: Ctx, playerId: number, nightId: number, id: number): void {
  const r = ctx.db.prepare("UPDATE adjustment SET read_at = COALESCE(read_at, ?) WHERE id = ? AND player_id = ? AND kind = 'gift'").run(ctx.now(), id, playerId);
  if (!r.changes) throw notFound();
  ctx.bus.refresh(nightId);
}
