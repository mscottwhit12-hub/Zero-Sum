import type { SecurityKind } from '../settings';

export type EventDriver = 'reroll' | 'espionage';

export interface SecurityState {
  id: string;
  kind: SecurityKind;
  ticker: string;
  /** Player stocks only. */
  playerId?: string | null;
  /** Event stocks only: what moves this stock. */
  driver?: EventDriver | null;
  price: number;
  /** Crypto/event: internal baseline. Dead uses the settings baseline. */
  baseline?: number;
  /** Index: current wobble (fraction of price) around the trend. */
  noise?: number;
  /** Background noise now in the price (gold): price = model price + nz. */
  nz?: number;
  /** The wandering part of nz (gold); the rest is this tick's jiggle. */
  nzDrift?: number;
  /** GM offset in band units. Applies to player stocks only (locked #6). */
  gmOffset: number;
  /** Last computed fair (player stocks). */
  lastFair?: number;
  /** Player has left the night. Stock stays listed. */
  left?: boolean;
  /** GM halted trading in this stock (abuse): nobody can trade it, its price is frozen, positions were closed at full value. */
  halted?: boolean;
  /** Decaying fair for a leaver. */
  leaverFair?: number;
}

export type ImpulseCause =
  | 'trade_buy'
  | 'trade_sell'
  | 'espionage_success'
  | 'espionage_fail'
  | 'kingfall'
  | 'reroll_spend'
  | 'espionage_completion';

export interface Impulse {
  securityId: string;
  /** Fractional price move, e.g. +0.02. */
  frac: number;
  cause: ImpulseCause;
  /** Event stocks: driver events move the baseline as well as the price. */
  moveBaseline?: boolean;
}

export interface PriceCauses {
  prev: number;
  /** Price after the kind's model (reversion/walk/decay), before impulses and clamps. */
  model: number;
  impulses: { cause: ImpulseCause; frac: number }[];
  clampedChange: boolean;
  clampedBand: boolean;
  /** Player stocks: additive target terms in band units. */
  offset?: number;
  drift?: number;
  mood?: number;
  /** Crypto: the random shock (log return). */
  shock?: number;
  baseline?: number;
  /** Background noise in the price this tick (gold), and the ± size it was drawn at. */
  noise?: number;
  noiseSize?: number;
}

export interface PriceRecord {
  securityId: string;
  price: number;
  fair: number | null;
  target: number | null;
  causes: PriceCauses;
}
