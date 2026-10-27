import type { Rng } from '../rng';
import { placeMult } from '../scoring';
import type { Settings } from '../settings';
import { applyImpulsesAndClamp, round4 } from './clamp';
import type { PriceRecord, SecurityState } from './types';

/**
 * Index: equal-weighted average of player stock prices × scale (flat: player stocks are rank-based, so they cancel out),
 * plus hidden growth from games (`extra`, price units) and a gentle mean-reverting wobble. Smoothed (low volatility).
 * No trade impact and no GM offset (locked #6), so it can't be pumped directly.
 */
export function tickIndex(
  sec: SecurityState,
  playerPrices: number[],
  settings: Settings,
  extra = 0,
  rng?: Rng,
): { sec: SecurityState; record: PriceRecord } {
  const s = settings.market.index;
  const band = settings.market.bands.index;
  const base = playerPrices.length ? (playerPrices.reduce((a, b) => a + b, 0) / playerPrices.length) * s.scale : sec.price;
  const r = s.noiseReversion ?? 0.1;
  const sd = s.noiseFrac ?? 0;
  const noise = rng && sd > 0 ? round4((sec.noise ?? 0) * (1 - r) + sd * Math.sqrt(r * (2 - r)) * rng.normal()) : sec.noise ?? 0;
  const target = (base + extra) * (1 + noise);
  const model = sec.price + s.smoothing * (target - sec.price);
  const c = applyImpulsesAndClamp(sec.price, model, [], band, settings.market.maxChangeFrac);
  return {
    sec: { ...sec, price: c.price, noise },
    record: {
      securityId: sec.id,
      price: c.price,
      fair: null,
      target,
      causes: { prev: sec.price, model, impulses: [], clampedChange: c.clampedChange, clampedBand: c.clampedBand },
    },
  };
}

/** A game as the index sees it. Gold is in hundredths. */
export interface IndexGame {
  status: 'active' | 'final';
  /** People in the game. */
  players: number;
  /** Ranked units for the payout curve (players, or teams). Defaults to players. */
  units?: number;
  plannedHours: number;
  /** Active: pause-excluded hours so far. */
  elapsedHours: number;
  /** Final: gold actually paid by its result. */
  paidH?: number;
}

/** Expected total gold (hundredths) a game pays for `hours`: hours × players × goldScale × Σ placement mults. */
export function expectedGameGoldH(players: number, units: number, hours: number, settings: Settings): number {
  // Each person earns hours × players × mult(their unit's place) × goldScale; a unit holds players/units people.
  let sum = 0;
  for (let p = 1; p <= units; p++) sum += placeMult(p, settings.scoring, units);
  return Math.round(hours * players * settings.scoring.goldScale * (players / Math.max(1, units)) * sum * 100);
}

/**
 * Hidden index terms, price units. Growth: gold earned per night player (finals at the gold actually paid, active games
 * accrued by time played). Drop: each running game's expected gold per night player × startDropPerGold (returned at its end).
 */
export function indexExtra(games: IndexGame[], nightPlayers: number, settings: Settings): { growth: number; drop: number; extra: number } {
  const s = settings.market.index;
  const n = Math.max(1, nightPlayers);
  let earnedH = 0;
  let dropH = 0;
  for (const g of games) {
    const units = g.units ?? g.players;
    if (g.status === 'final') earnedH += g.paidH ?? 0;
    else {
      earnedH += expectedGameGoldH(g.players, units, g.elapsedHours, settings);
      dropH += expectedGameGoldH(g.players, units, g.plannedHours, settings);
    }
  }
  const growth = round4((s.growthPerGold * earnedH) / 100 / n);
  const drop = round4((s.startDropPerGold * dropH) / 100 / n);
  return { growth, drop, extra: round4(growth - drop) };
}
