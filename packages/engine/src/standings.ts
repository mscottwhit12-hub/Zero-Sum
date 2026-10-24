import { toH, valueH, type GoldH, type SharesH } from './money';
import { scoreGame, type GameResult } from './scoring';
import type { Settings } from './settings';

export interface LedgerPlayer {
  id: string;
  /** True if the player was in when the night went live (gets the starting stake). Late joiners get a frozen system adjustment instead. */
  gotStake: boolean;
}

export interface GoldEntry {
  playerId: string;
  goldH: GoldH;
}

export interface TradeFlow {
  playerId: string;
  /** Cash change: negative for buys (incl. fee), positive for sells (net of fee). */
  cashH: GoldH;
}

export interface LedgerInput {
  players: LedgerPlayer[];
  results: GameResult[];
  adjustments: GoldEntry[]; // manual + system (late-join stake)
  bounties: GoldEntry[];
  achievements: GoldEntry[];
  tradeFlows: TradeFlow[];
}

export interface LedgerRow {
  playerId: string;
  stakeH: GoldH;
  resultsH: GoldH;
  adjustmentsH: GoldH;
  bountiesH: GoldH;
  achievementsH: GoldH;
  /** Fair-price basis (locked #1): stake + results + adjustments + bounties + achievements. Trading P&L excluded. */
  earnedH: GoldH;
  tradeFlowH: GoldH;
  /** Gold on hand = earned + trade cash flows. This is "gold" for the podium. */
  cashH: GoldH;
}

/** Full re-derivation from raw inputs. Call on every change (results are the source of truth). */
export function deriveLedger(input: LedgerInput, settings: Settings): Map<string, LedgerRow> {
  const rows = new Map<string, LedgerRow>();
  const stakeH = toH(settings.stake.startingGold);
  for (const p of input.players) {
    rows.set(p.id, {
      playerId: p.id,
      stakeH: p.gotStake ? stakeH : 0,
      resultsH: 0,
      adjustmentsH: 0,
      bountiesH: 0,
      achievementsH: 0,
      earnedH: 0,
      tradeFlowH: 0,
      cashH: 0,
    });
  }
  const row = (id: string) => {
    const r = rows.get(id);
    if (!r) throw new Error(`unknown player ${id}`);
    return r;
  };
  for (const g of input.results) for (const s of scoreGame(g, settings).rows) row(s.playerId).resultsH += s.goldH;
  for (const a of input.adjustments) row(a.playerId).adjustmentsH += a.goldH;
  for (const b of input.bounties) row(b.playerId).bountiesH += b.goldH;
  for (const a of input.achievements) row(a.playerId).achievementsH += a.goldH;
  for (const t of input.tradeFlows) row(t.playerId).tradeFlowH += t.cashH;
  for (const r of rows.values()) {
    r.earnedH = r.stakeH + r.resultsH + r.adjustmentsH + r.bountiesH + r.achievementsH;
    r.cashH = r.earnedH + r.tradeFlowH;
  }
  return rows;
}

export interface Holding {
  playerId: string;
  securityId: string;
  sharesH: SharesH;
}

/** Sell value of a position at the current price, net of the trade fee. */
export function sellValueH(sharesH: SharesH, price: number, feeFrac: number): GoldH {
  const gross = valueH(sharesH, price);
  return gross - Math.round(gross * feeFrac);
}

export interface StandingRow {
  playerId: string;
  cashH: GoldH;
  holdingsH: GoldH;
  netWorthH: GoldH;
  /** Competition rank (1,1,3…) by net worth. */
  rank: number;
}

export function computeStandings(
  ledger: Map<string, LedgerRow>,
  holdings: Holding[],
  priceBySecurity: Map<string, number>,
  settings: Settings,
): StandingRow[] {
  const held = new Map<string, number>();
  for (const h of holdings) {
    const price = priceBySecurity.get(h.securityId);
    if (price === undefined) throw new Error(`no price for ${h.securityId}`);
    held.set(h.playerId, (held.get(h.playerId) ?? 0) + sellValueH(h.sharesH, price, settings.market.feeFrac));
  }
  const rows = [...ledger.values()].map((l) => {
    const holdingsH = held.get(l.playerId) ?? 0;
    return { playerId: l.playerId, cashH: l.cashH, holdingsH, netWorthH: l.cashH + holdingsH, rank: 0 };
  });
  return rankBy(rows, (r) => r.netWorthH);
}

/** Sorts descending by key and assigns competition ranks. Stable on ties (input order). */
export function rankBy<T extends { rank: number }>(rows: T[], key: (r: T) => number): T[] {
  const sorted = [...rows].sort((a, b) => key(b) - key(a));
  sorted.forEach((r, i) => {
    r.rank = i > 0 && key(sorted[i - 1]!) === key(r) ? sorted[i - 1]!.rank : i + 1;
  });
  return sorted;
}

/** Player ids at rank 1 by net worth (ties included). */
export function leaders(standings: StandingRow[]): string[] {
  return standings.filter((r) => r.rank === 1).map((r) => r.playerId);
}
