import type { GoldH } from '../money';
import type { Rng } from '../rng';
import { bandAt, type Settings } from '../settings';
import { clampTo, round4 } from './clamp';
import { tickCrypto } from './crypto';
import { tickDead } from './dead';
import { tickEvent } from './event';
import { computeFair } from './fair';
import { tickIndex } from './indexFund';
import { tickPlayer } from './player';
import type { EventDriver, Impulse, PriceRecord, SecurityState } from './types';

export interface TickContext {
  /** Earned gold (fair basis) for ACTIVE players only. Leavers are excluded from ranking. */
  earned: { playerId: string; earnedH: GoldH }[];
  /** Hidden vote drift per player, band units (0 when no drift is active). */
  drift: Map<string, number>;
  /** Mood bias per player, band units. */
  mood: Map<string, number>;
  /** Impulses queued since the last tick (trades, espionage, kingfall, re-rolls). */
  impulses: Impulse[];
  /** Live-standings bias per player, band units (summed over the night's scored games). */
  live?: Map<string, number>;
  /** Hidden index growth minus running games' start drops, price units (see indexExtra). */
  indexExtra?: number;
  /** ± gold each player's stock jitters (GM reported mood); absent = the background noise. */
  jitter?: Map<string, number>;
}

export interface TickResult {
  securities: SecurityState[];
  records: PriceRecord[];
}

/** A halted stock stays where the GM halted it: no model, drift or impulse moves it any more. */
const frozen = (sec: SecurityState, r: { sec: SecurityState; record: PriceRecord }) => ({ sec: { ...sec }, record: { ...r.record, price: sec.price } });

/**
 * Background noise (QoL mood rework): every stock carries a noise offset `nz` (gold) on top of its model price.
 * Half of it (by variance, driftShare) wanders and eases back; the rest is a fresh jiggle each tick. `size` is
 * the ± gold the noise mostly stays within (2 standard deviations). Returns the new offset and its wandering part.
 */
export function drawNoise(prevDrift: number, size: number, settings: Settings, rng: Rng): { nz: number; drift: number } {
  const n = settings.market.noise;
  const sd = Math.max(0, size) / 2;
  const r = Math.min(1, Math.max(0.001, n.reversion));
  const share = Math.min(1, Math.max(0, n.driftShare));
  const drift = prevDrift * (1 - r) + sd * Math.sqrt(share) * Math.sqrt(r * (2 - r)) * rng.normal();
  return { nz: drift + sd * Math.sqrt(1 - share) * rng.normal(), drift };
}

/** One market tick for every security. Pure apart from the passed RNG. */
export function tickMarket(securities: SecurityState[], ctx: TickContext, settings: Settings, rng: Rng): TickResult {
  const raw = securities;
  // Models run on the noise-free price; noise is laid back on at the end.
  securities = raw.map((sec) => (sec.nz ? { ...sec, price: round4(sec.price - sec.nz) } : sec));
  const s = settings.market;
  const fair = computeFair(ctx.earned, s.bands.player, s.player.fairInnerLo, s.player.fairInnerHi);
  const bySec = new Map<string, Impulse[]>();
  for (const i of ctx.impulses) {
    const list = bySec.get(i.securityId) ?? [];
    list.push(i);
    bySec.set(i.securityId, list);
  }
  const imp = (id: string) => bySec.get(id) ?? [];
  const out = new Map<string, { sec: SecurityState; record: PriceRecord }>();

  // Player stocks first: the index depends on them.
  for (const sec of securities) {
    if (sec.kind !== 'player') continue;
    const pid = sec.playerId!;
    const r = tickPlayer(
      sec,
      {
        fair: fair.get(pid),
        drift: sec.left ? 0 : ctx.drift.get(pid) ?? 0,
        mood: sec.left ? 0 : ctx.mood.get(pid) ?? 0,
        live: sec.left ? 0 : ctx.live?.get(pid) ?? 0,
        impulses: imp(sec.id),
      },
      settings,
    );
    out.set(sec.id, sec.halted ? frozen(sec, r) : r);
  }
  const playerPrices = [...out.values()].map((r) => r.sec.price);
  for (const sec of securities) {
    if (sec.kind === 'index') out.set(sec.id, tickIndex(sec, playerPrices, settings, ctx.indexExtra ?? 0, rng));
    else if (sec.kind === 'crypto') out.set(sec.id, tickCrypto(sec, imp(sec.id), settings, rng));
    else if (sec.kind === 'event') out.set(sec.id, tickEvent(sec, imp(sec.id), settings));
    else if (sec.kind === 'dead') out.set(sec.id, tickDead(sec, imp(sec.id), settings));
  }
  // Background noise last (after every other draw, so the old randomness is unchanged).
  for (const sec of securities) {
    const r = out.get(sec.id)!;
    const size = sec.kind === 'player' && !sec.left ? ctx.jitter?.get(sec.playerId!) ?? s.noise.base : s.noise.base;
    const { nz, drift } = drawNoise(sec.nzDrift ?? 0, size, settings, rng);
    const price = clampTo(round4(r.sec.price + nz), s.bands[sec.kind]);
    const applied = round4(price - r.sec.price);
    out.set(sec.id, { sec: { ...r.sec, price, nz: applied, nzDrift: round4(drift) }, record: { ...r.record, price, causes: { ...r.record.causes, noise: applied, noiseSize: round4(size) } } });
  }
  // A halted stock keeps its exact price (noise included).
  raw.forEach((sec) => {
    if (sec.halted) out.set(sec.id, frozen(sec, out.get(sec.id)!));
  });
  // Preserve input order.
  const res = securities.map((sec) => out.get(sec.id)!);
  return { securities: res.map((r) => r.sec), records: res.map((r) => r.record) };
}

export interface CreateSecuritiesInput {
  players: { id: string; ticker: string }[];
}

/** Securities at night start. Player stocks start at fair = band midpoint (everyone tied). */
export function createSecurities(input: CreateSecuritiesInput, settings: Settings): SecurityState[] {
  const b = settings.market.bands;
  const m = settings.market;
  const mid = (b.player.min + b.player.max) / 2;
  const players: SecurityState[] = input.players.map((p) => playerSecurity(p.id, p.ticker, mid));
  const indexPrice = Math.min(b.index.max, Math.max(b.index.min, mid * m.index.scale));
  const cryptoStart = bandAt(b.crypto, m.crypto.startFrac);
  const eventStart = bandAt(b.event, m.event.startFrac);
  const ev = (id: string, ticker: string, driver: EventDriver): SecurityState => ({
    id,
    kind: 'event',
    ticker,
    driver,
    price: eventStart,
    baseline: eventStart,
    gmOffset: 0,
  });
  return [
    ...players,
    { id: 'index', kind: 'index', ticker: 'IDX', price: indexPrice, gmOffset: 0 },
    { id: 'crypto', kind: 'crypto', ticker: 'COIN', price: cryptoStart, baseline: cryptoStart, gmOffset: 0 },
    ev('event-reroll', 'SCIC', 'reroll'),
    ev('event-espionage', 'SHDW', 'espionage'),
    { id: 'dead', kind: 'dead', ticker: 'DEAD', price: bandAt(b.dead, m.dead.baselineFrac), gmOffset: 0 },
  ];
}

export function playerSecurityId(playerId: string): string {
  return `p:${playerId}`;
}

export function playerSecurity(playerId: string, ticker: string, price: number): SecurityState {
  return { id: playerSecurityId(playerId), kind: 'player', ticker, playerId, price, gmOffset: 0 };
}

export function findEventSecurity(securities: SecurityState[], driver: EventDriver): SecurityState | undefined {
  return securities.find((s) => s.kind === 'event' && s.driver === driver);
}

// ---------- impulse builders ----------

export function tradeImpulse(sec: SecurityState, side: 'buy' | 'sell', settings: Settings): Impulse | null {
  const f = settings.market.impact[sec.kind];
  if (sec.kind === 'index' || f === 0) return null;
  return { securityId: sec.id, frac: side === 'buy' ? f : -f, cause: side === 'buy' ? 'trade_buy' : 'trade_sell' };
}

/** Success: agent's stock +e (hidden), Shadow Logistics bumps. Fail: agent's stock −e (hidden). */
export function espionageImpulses(
  securities: SecurityState[],
  agentPlayerId: string,
  outcome: 'success' | 'fail',
  settings: Settings,
): Impulse[] {
  const e = settings.market.player.espionageFrac;
  const out: Impulse[] = [];
  const own = securities.find((s) => s.kind === 'player' && s.playerId === agentPlayerId);
  if (own) out.push({ securityId: own.id, frac: outcome === 'success' ? e : -e, cause: outcome === 'success' ? 'espionage_success' : 'espionage_fail' });
  if (outcome === 'success') {
    const ev = findEventSecurity(securities, 'espionage');
    if (ev) out.push({ securityId: ev.id, frac: settings.market.event.bump, cause: 'espionage_completion', moveBaseline: true });
  }
  return out;
}

export function rerollImpulse(securities: SecurityState[], settings: Settings): Impulse | null {
  const ev = findEventSecurity(securities, 'reroll');
  return ev ? { securityId: ev.id, frac: settings.market.event.bump, cause: 'reroll_spend', moveBaseline: true } : null;
}

export function kingfallImpulse(securities: SecurityState[], settings: Settings): Impulse | null {
  const c = securities.find((s) => s.kind === 'crypto');
  return c ? { securityId: c.id, frac: settings.market.crypto.kingfallFrac, cause: 'kingfall' } : null;
}
