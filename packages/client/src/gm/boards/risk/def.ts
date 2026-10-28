/**
 * Risk board: pure logic (no Svelte, no clock, no storage). Written to board-contract.ts v1.
 *
 * What it tracks, per player: territories, total armies, continents held (ticked: "held the whole continent
 * at the start of their turn"), eliminated or not (and by whom), re-rolls used. Plus one game history: every
 * change and every typed note, with a timestamp.
 *
 * Crown (score):      reinforcements per turn = max(min, floor(territories / divisor)) + continent bonuses.
 * Result (placements): survivors by territories, then total armies (still tied = shared place), then the
 *                      eliminated, most recently eliminated first. Last player standing is simply 1st.
 *
 * Every operation takes the time as an argument and returns a NEW state; if nothing would change it returns the
 * SAME object, so repeating an operation (double tap, onchange twice) is harmless.
 */
import type { BoardContext, BoardDef, BoardSetting } from '../contract';

/** Typed notes are cut to this many characters (a text-box limit, not a gameplay number). */
export const NOTE_MAX = 280;

export type ContinentKey = 'northAmerica' | 'southAmerica' | 'europe' | 'africa' | 'asia' | 'australia';

/** The six continents and the board setting that holds each one's bonus. */
export const CONTINENTS: { key: ContinentKey; label: string; setting: string }[] = [
  { key: 'northAmerica', label: 'North America', setting: 'bonusNorthAmerica' },
  { key: 'southAmerica', label: 'South America', setting: 'bonusSouthAmerica' },
  { key: 'europe', label: 'Europe', setting: 'bonusEurope' },
  { key: 'africa', label: 'Africa', setting: 'bonusAfrica' },
  { key: 'asia', label: 'Asia', setting: 'bonusAsia' },
  { key: 'australia', label: 'Australia', setting: 'bonusAustralia' },
];

/** Every gameplay number. Defaults are the official Risk values. */
export const SETTINGS: Record<string, BoardSetting> = {
  territoryTotal: { label: 'Territories on the map', default: 42, min: 10, max: 100 },
  reinforceDivisor: { label: 'Territories per reinforcement army', default: 3, min: 1, max: 10 },
  reinforceMin: { label: 'Minimum reinforcements per turn', default: 3, min: 0, max: 10 },
  bonusNorthAmerica: { label: 'Bonus: North America', default: 5, min: 0, max: 20 },
  bonusSouthAmerica: { label: 'Bonus: South America', default: 2, min: 0, max: 20 },
  bonusEurope: { label: 'Bonus: Europe', default: 5, min: 0, max: 20 },
  bonusAfrica: { label: 'Bonus: Africa', default: 3, min: 0, max: 20 },
  bonusAsia: { label: 'Bonus: Asia', default: 7, min: 0, max: 20 },
  bonusAustralia: { label: 'Bonus: Australia', default: 2, min: 0, max: 20 },
  startArmies4: { label: 'Starting armies each (4 or fewer players)', default: 30, min: 1, max: 100 },
  startArmies5: { label: 'Starting armies each (5 players)', default: 25, min: 1, max: 100 },
  startArmies6: { label: 'Starting armies each (6 or more players)', default: 20, min: 1, max: 100 },
  armiesMax: { label: 'Most armies one player can have', default: 999, min: 100, max: 9999, step: 100 },
  mergeSeconds: { label: 'History: merge quick taps within (seconds)', default: 5, min: 0, max: 60 },
  logMax: { label: 'History: most entries kept', default: 500, min: 50, max: 2000, step: 50 },
};

/** A setting's current value, falling back to its default. */
export function cfg(settings: Record<string, number> | undefined, key: string): number {
  const v = settings?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (SETTINGS[key]?.default ?? 0);
}

// ------------------------------------------------------------------ state

export interface RiskPlayer {
  territories: number;
  armies: number;
  continents: ContinentKey[];
  eliminated: boolean;
  /** Player id of whoever eliminated them; null = unknown. */
  eliminatedBy: number | null;
  /** When (epoch ms), for display. */
  eliminatedAt: number | null;
  /** 1 for the first player out, 2 for the next, … Later = placed higher. */
  order: number | null;
  rerollsUsed: number;
  /** Numbers from just before elimination, so a mis-tap can be undone. `gave` territories went to `gaveTo`. */
  backup: { territories: number; armies: number; continents: ContinentKey[]; gave?: number; gaveTo?: number | null } | null;
}

export type LogKind = 'note' | 'territories' | 'armies' | 'continent' | 'eliminate' | 'restore' | 'reroll';

export interface LogEntry {
  id: number;
  /** Epoch ms. */
  t: number;
  kind: LogKind;
  playerId: number | null;
  /** Number changes: value before and after (continent: 0 / 1). */
  from?: number;
  to?: number;
  continent?: ContinentKey;
  /** Eliminations: who did it (null = unknown). */
  by?: number | null;
  /** Notes. */
  text?: string;
  /** Eliminations: territories handed to the eliminator; restores: territories taken back. */
  moved?: number;
}

export interface RiskState {
  v: 1;
  players: Record<number, RiskPlayer>;
  log: LogEntry[];
  /** Last used log id. */
  seq: number;
  /** How many eliminations have happened (never goes down, so order stays unique). */
  elimCount: number;
}

const blank = (): RiskPlayer => ({
  territories: 0,
  armies: 0,
  continents: [],
  eliminated: false,
  eliminatedBy: null,
  eliminatedAt: null,
  order: null,
  rerollsUsed: 0,
  backup: null,
});

/** A player's numbers; players the state doesn't know yet read as blank. */
export const pl = (s: RiskState, id: number): RiskPlayer => s.players[id] ?? blank();

export function startArmies(players: number, settings: Record<string, number>): number {
  if (players >= 6) return cfg(settings, 'startArmies6');
  if (players === 5) return cfg(settings, 'startArmies5');
  return cfg(settings, 'startArmies4');
}

/** Reinforcement armies this player would get at the start of their turn. */
export function reinforcements(p: RiskPlayer, settings: Record<string, number>): number {
  if (p.eliminated) return 0;
  const base = Math.max(cfg(settings, 'reinforceMin'), Math.floor(p.territories / Math.max(1, cfg(settings, 'reinforceDivisor'))));
  const bonus = CONTINENTS.reduce((sum, c) => (p.continents.includes(c.key) ? sum + cfg(settings, c.setting) : sum), 0);
  return base + bonus;
}

/** Fresh state: the map's territories dealt evenly (extras to the first seats) and the starting armies. */
export function init(ctx: BoardContext): RiskState {
  const ordered = [...ctx.players].sort((a, b) => (a.seat ?? 1e9) - (b.seat ?? 1e9) || a.id - b.id);
  const n = ordered.length;
  const total = Math.floor(cfg(ctx.settings, 'territoryTotal'));
  const each = n ? Math.floor(total / n) : 0;
  const extra = n ? total % n : 0;
  const armies = startArmies(n, ctx.settings);
  const players: Record<number, RiskPlayer> = {};
  ordered.forEach((p, i) => {
    players[p.id] = { ...blank(), territories: each + (i < extra ? 1 : 0), armies };
  });
  return { v: 1, players, log: [], seq: 0, elimCount: 0 };
}

export function score(s: RiskState, ctx: BoardContext): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of ctx.players) out[p.id] = reinforcements(pl(s, p.id), ctx.settings);
  return out;
}

/** Groups equal neighbours of an already-sorted list. */
function group(ids: number[], same: (a: number, b: number) => boolean): number[][] {
  const out: number[][] = [];
  for (const id of ids) {
    const last = out[out.length - 1];
    if (last && same(last[0]!, id)) last.push(id);
    else out.push([id]);
  }
  return out;
}

export function placements(s: RiskState, ctx: BoardContext): number[][] {
  const ids = [...ctx.players.map((p) => p.id)].sort((a, b) => a - b);
  const alive = ids
    .filter((id) => !pl(s, id).eliminated)
    .sort((a, b) => pl(s, b).territories - pl(s, a).territories || pl(s, b).armies - pl(s, a).armies);
  const out = group(alive, (a, b) => pl(s, a).territories === pl(s, b).territories && pl(s, a).armies === pl(s, b).armies);
  const dead = ids.filter((id) => pl(s, id).eliminated).sort((a, b) => (pl(s, b).order ?? 0) - (pl(s, a).order ?? 0));
  out.push(...group(dead, (a, b) => (pl(s, a).order ?? 0) === (pl(s, b).order ?? 0)));
  return out;
}

export const def: BoardDef<RiskState> = {
  key: 'risk',
  label: 'Risk',
  settings: SETTINGS,
  init,
  score,
  placements,
  recap: (s, ctx) => recap(s, ctx).map((r) => ({ playerId: r.playerId, text: recapText(r) })),
};

// ------------------------------------------------------------------ status

export interface GameStatus {
  alive: number[];
  /** Set when exactly one player is left standing. */
  winnerId: number | null;
  over: boolean;
}

export function status(s: RiskState, ctx: BoardContext): GameStatus {
  const alive = ctx.players.filter((p) => !pl(s, p.id).eliminated).map((p) => p.id);
  const winnerId = ctx.players.length > 1 && alive.length === 1 ? alive[0]! : null;
  return { alive, winnerId, over: winnerId !== null };
}

// ------------------------------------------------------------------ operations

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** Adds any participants the state doesn't know yet (someone added after the game started). */
export function ensure(s: RiskState, ctx: BoardContext): RiskState {
  const missing = ctx.players.filter((p) => !s.players[p.id]);
  if (!missing.length) return s;
  const players = { ...s.players };
  for (const p of missing) players[p.id] = blank();
  return { ...s, players };
}

const MERGEABLE: LogKind[] = ['territories', 'armies', 'continent'];

/** Appends a log entry. A change to the same number by the same player within `mergeSeconds` of the last entry is folded into it. */
function addLog(s: RiskState, entry: Omit<LogEntry, 'id'>, ctx: BoardContext): RiskState {
  const mergeMs = cfg(ctx.settings, 'mergeSeconds') * 1000;
  const max = Math.max(1, Math.floor(cfg(ctx.settings, 'logMax')));
  const last = s.log[s.log.length - 1];
  if (
    last &&
    MERGEABLE.includes(entry.kind) &&
    last.kind === entry.kind &&
    last.playerId === entry.playerId &&
    last.continent === entry.continent &&
    entry.t - last.t <= mergeMs
  ) {
    const merged: LogEntry = { ...last, to: entry.to, t: entry.t };
    const log = merged.to === merged.from ? s.log.slice(0, -1) : [...s.log.slice(0, -1), merged];
    return { ...s, log };
  }
  const id = s.seq + 1;
  const log = [...s.log, { ...entry, id }];
  return { ...s, seq: id, log: log.length > max ? log.slice(log.length - max) : log };
}

/** Looks up an editable (known, still in) player; null if the operation should do nothing. */
function editable(s: RiskState, ctx: BoardContext, pid: number): { s: RiskState; p: RiskPlayer } | null {
  if (!ctx.players.some((x) => x.id === pid)) return null;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  return p.eliminated ? null : { s: s1, p };
}

const put = (s: RiskState, pid: number, p: RiskPlayer): RiskState => ({ ...s, players: { ...s.players, [pid]: p } });

export function setTerritories(s: RiskState, ctx: BoardContext, pid: number, value: number, now: number): RiskState {
  const e = editable(s, ctx, pid);
  if (!e || !Number.isFinite(value)) return s;
  const v = clampInt(value, 0, cfg(ctx.settings, 'territoryTotal'));
  if (v === e.p.territories) return e.s;
  return addLog(put(e.s, pid, { ...e.p, territories: v }), { t: now, kind: 'territories', playerId: pid, from: e.p.territories, to: v }, ctx);
}

export function setArmies(s: RiskState, ctx: BoardContext, pid: number, value: number, now: number): RiskState {
  const e = editable(s, ctx, pid);
  if (!e || !Number.isFinite(value)) return s;
  const v = clampInt(value, 0, cfg(ctx.settings, 'armiesMax'));
  if (v === e.p.armies) return e.s;
  return addLog(put(e.s, pid, { ...e.p, armies: v }), { t: now, kind: 'armies', playerId: pid, from: e.p.armies, to: v }, ctx);
}

/** Ticks or unticks a continent (an explicit value, not a flip, so a double tap can't undo itself). */
export function setContinent(s: RiskState, ctx: BoardContext, pid: number, key: ContinentKey, held: boolean, now: number): RiskState {
  const e = editable(s, ctx, pid);
  if (!e) return s;
  if (e.p.continents.includes(key) === held) return e.s;
  const continents = held ? CONTINENTS.map((c) => c.key).filter((k) => k === key || e.p.continents.includes(k)) : e.p.continents.filter((k) => k !== key);
  return addLog(put(e.s, pid, { ...e.p, continents }), { t: now, kind: 'continent', playerId: pid, continent: key, from: held ? 0 : 1, to: held ? 1 : 0 }, ctx);
}

/**
 * Eliminates a player: marks them out, records who did it (null = unknown) and zeroes their territories, armies
 * and continents (kept in `backup` for undo). A known eliminator who is still in takes over their territories
 * (armies are lost, as in Risk). The last player standing can't be eliminated.
 */
export function eliminate(s: RiskState, ctx: BoardContext, pid: number, byId: number | null, now: number): RiskState {
  const e = editable(s, ctx, pid);
  if (!e) return s;
  const alive = ctx.players.filter((x) => !e.s.players[x.id]!.eliminated);
  if (alive.length <= 1) return e.s;
  const by = byId !== null && byId !== pid && ctx.players.some((x) => x.id === byId) ? byId : null;
  const order = e.s.elimCount + 1;
  const taker = by !== null && !e.s.players[by]!.eliminated ? e.s.players[by]! : null;
  const total = cfg(ctx.settings, 'territoryTotal');
  const gave = taker ? Math.max(0, Math.min(e.p.territories, total - taker.territories)) : 0;
  let s1 = e.s;
  if (taker && by !== null && gave > 0) s1 = put(s1, by, { ...taker, territories: taker.territories + gave });
  const next = put(s1, pid, {
    ...e.p,
    territories: 0,
    armies: 0,
    continents: [],
    eliminated: true,
    eliminatedBy: by,
    eliminatedAt: now,
    order,
    backup: { territories: e.p.territories, armies: e.p.armies, continents: [...e.p.continents], gave, gaveTo: gave > 0 ? by : null },
  });
  return addLog({ ...next, elimCount: order }, { t: now, kind: 'eliminate', playerId: pid, by, ...(gave > 0 ? { moved: gave } : {}) }, ctx);
}

/** Undoes an elimination, putting their numbers back. */
export function restore(s: RiskState, ctx: BoardContext, pid: number, now: number): RiskState {
  if (!ctx.players.some((x) => x.id === pid)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  if (!p.eliminated) return s1;
  const b = p.backup ?? { territories: 0, armies: 0, continents: [] };
  // Take back the territories the eliminator received (never below 0 if they've changed since).
  let s2 = s1;
  let moved = 0;
  if (b.gave && b.gaveTo != null && s1.players[b.gaveTo]) {
    const t = s1.players[b.gaveTo]!;
    moved = Math.min(b.gave, t.territories);
    if (moved > 0) s2 = put(s1, b.gaveTo, { ...t, territories: t.territories - moved });
  }
  const next = put(s2, pid, {
    ...p,
    territories: b.territories,
    armies: b.armies,
    continents: [...b.continents],
    eliminated: false,
    eliminatedBy: null,
    eliminatedAt: null,
    order: null,
    backup: null,
  });
  return addLog(next, { t: now, kind: 'restore', playerId: pid, ...(moved > 0 ? { moved } : {}) }, ctx);
}

/** Records a re-roll the host has already spent (call only after `ctx.useReroll` succeeded). */
export function recordReroll(s: RiskState, ctx: BoardContext, pid: number, now: number): RiskState {
  if (!ctx.players.some((x) => x.id === pid)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  return addLog(put(s1, pid, { ...p, rerollsUsed: p.rerollsUsed + 1 }), { t: now, kind: 'reroll', playerId: pid }, ctx);
}

/** A typed note in the history, optionally about one player. Empty notes are ignored. */
export function addNote(s: RiskState, ctx: BoardContext, text: string, playerId: number | null, now: number): RiskState {
  const clean = text.trim().slice(0, NOTE_MAX);
  if (!clean) return s;
  const pid = playerId !== null && ctx.players.some((x) => x.id === playerId) ? playerId : null;
  return addLog(ensure(s, ctx), { t: now, kind: 'note', playerId: pid, text: clean }, ctx);
}

// ------------------------------------------------------------------ history text

export function describeEntry(e: LogEntry, nameOf: (id: number) => string): string {
  const who = e.playerId === null ? '' : nameOf(e.playerId);
  switch (e.kind) {
    case 'note':
      return e.playerId === null ? (e.text ?? '') : `${who}: ${e.text ?? ''}`;
    case 'territories':
      return `${who}: territories ${e.from} → ${e.to}`;
    case 'armies':
      return `${who}: armies ${e.from} → ${e.to}`;
    case 'continent': {
      const label = CONTINENTS.find((c) => c.key === e.continent)?.label ?? 'a continent';
      return e.to ? `${who} holds ${label}` : `${who} no longer holds ${label}`;
    }
    case 'eliminate':
      return e.by == null
        ? `${who} was eliminated`
        : `${who} was eliminated by ${nameOf(e.by)}${e.moved ? ` (${e.moved} territories to ${nameOf(e.by)})` : ''}`;
    case 'restore':
      return `${who} is back in (elimination undone${e.moved ? `, ${e.moved} territories returned` : ''})`;
    case 'reroll':
      return `${who} used a re-roll`;
  }
}

// ------------------------------------------------------------------ recap

export interface RecapRow {
  playerId: number;
  name: string;
  /** 1-based; tied players share a place. */
  place: number;
  tied: boolean;
  territories: number;
  armies: number;
  reinforcements: number;
  continents: string[];
  eliminated: boolean;
  eliminatedBy: string | null;
  /** Players this player eliminated. */
  knockouts: number;
  rerollsUsed: number;
  /** Most territories held at any point the history shows. */
  peakTerritories: number;
}

export const ordinal = (n: number): string => {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** One row per player, best first: the end-of-game stats recap. */
export function recap(s: RiskState, ctx: BoardContext): RecapRow[] {
  const name = (id: number) => ctx.players.find((p) => p.id === id)?.name ?? 'Another player';
  const rows: RecapRow[] = [];
  let place = 1;
  for (const g of placements(s, ctx)) {
    for (const id of g) {
      const p = pl(s, id);
      const seen = s.log.filter((e) => e.playerId === id && e.kind === 'territories').flatMap((e) => [e.from ?? 0, e.to ?? 0]);
      rows.push({
        playerId: id,
        name: name(id),
        place,
        tied: g.length > 1,
        territories: p.territories,
        armies: p.armies,
        reinforcements: reinforcements(p, ctx.settings),
        continents: CONTINENTS.filter((c) => p.continents.includes(c.key)).map((c) => c.label),
        eliminated: p.eliminated,
        eliminatedBy: p.eliminatedBy === null ? null : name(p.eliminatedBy),
        knockouts: ctx.players.filter((o) => pl(s, o.id).eliminated && pl(s, o.id).eliminatedBy === id).length,
        rerollsUsed: p.rerollsUsed,
        peakTerritories: Math.max(p.territories, p.backup?.territories ?? 0, ...seen),
      });
    }
    place += g.length;
  }
  return rows;
}

/** The recap as plain text for one player (for the host's messaging to use). */
export function recapText(r: RecapRow): string {
  const lines = [`Risk recap for ${r.name}: ${ordinal(r.place)} place${r.tied ? ' (tied)' : ''}.`];
  lines.push(r.eliminated ? (r.eliminatedBy ? `Eliminated by ${r.eliminatedBy}.` : 'Eliminated.') : `Finished with ${r.territories} territories and ${r.armies} armies.`);
  lines.push(`Most territories held: ${r.peakTerritories}.`);
  if (r.continents.length) lines.push(`Continents held at the end: ${r.continents.join(', ')}.`);
  if (r.knockouts) lines.push(`Players eliminated: ${r.knockouts}.`);
  if (r.rerollsUsed) lines.push(`Re-rolls used: ${r.rerollsUsed}.`);
  return lines.join('\n');
}
