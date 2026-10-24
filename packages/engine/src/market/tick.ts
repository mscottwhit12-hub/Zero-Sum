import type { GoldH } from '../money';
import type { Rng } from '../rng';
import { bandAt, type Settings } from '../settings';
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
}

export interface TickResult {
  securities: SecurityState[];
  records: PriceRecord[];
}

/** One market tick for every security. Pure apart from the passed RNG. */
export function tickMarket(securities: SecurityState[], ctx: TickContext, settings: Settings, rng: Rng): TickResult {
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
    out.set(
      sec.id,
      tickPlayer(
        sec,
        {
          fair: fair.get(pid),
          drift: sec.left ? 0 : ctx.drift.get(pid) ?? 0,
          mood: sec.left ? 0 : ctx.mood.get(pid) ?? 0,
          impulses: imp(sec.id),
        },
        settings,
      ),
    );
  }
  const playerPrices = [...out.values()].map((r) => r.sec.price);
  for (const sec of securities) {
    if (sec.kind === 'index') out.set(sec.id, tickIndex(sec, playerPrices, settings));
    else if (sec.kind === 'crypto') out.set(sec.id, tickCrypto(sec, imp(sec.id), settings, rng));
    else if (sec.kind === 'event') out.set(sec.id, tickEvent(sec, imp(sec.id), settings));
    else if (sec.kind === 'dead') out.set(sec.id, tickDead(sec, imp(sec.id), settings));
  }
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
