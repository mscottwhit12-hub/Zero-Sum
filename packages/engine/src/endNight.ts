import type { GoldH } from './money';
import { liquidateAll, type Lot, type TradeRecord } from './market/trade';
import type { SecurityState } from './market/types';
import type { Settings } from './settings';
import { computeStandings, deriveLedger, rankBy, type LedgerInput, type LedgerRow } from './standings';
import { resolveQuarter, type Ballot, type QuarterResolution } from './votes';

export interface EndNightInput {
  ledger: LedgerInput;
  lots: Lot[];
  securities: SecurityState[];
  /** Active (non-left) player ids: eligible for the open quarter's bounty. */
  activePlayerIds: string[];
  /** The open quarter, if any. Force-resolved before auto-sell (locked #3). */
  openQuarter: { ballots: Ballot[] } | null;
}

export interface PodiumRow {
  playerId: string;
  goldH: GoldH;
  rank: number;
}

export interface EndNightResult {
  quarter: QuarterResolution | null;
  liquidations: TradeRecord[];
  ledger: Map<string, LedgerRow>;
  /** Final ranking by gold (everything is cash after auto-sell). */
  podium: PodiumRow[];
}

/**
 * End sequence:
 *  1. Force-resolve the open quarter on net worth (holdings still open) and pay its bounty.
 *  2. Auto-sell every holding at the pre-crash price (no lockout); fee on profits only.
 *  3. Re-derive the ledger; podium by gold.
 */
export function endNight(input: EndNightInput, settings: Settings): EndNightResult {
  const prices = new Map(input.securities.map((s) => [s.id, s.price]));
  const holdings = input.lots.map((l) => ({ playerId: l.playerId, securityId: l.securityId, sharesH: l.sharesH }));

  let quarter: QuarterResolution | null = null;
  let ledgerInput = input.ledger;
  if (input.openQuarter) {
    const ledger = deriveLedger(ledgerInput, settings);
    const active = new Set(input.activePlayerIds);
    const standings = computeStandings(ledger, holdings, prices, settings).filter((r) => active.has(r.playerId));
    quarter = resolveQuarter(input.openQuarter.ballots, rankBy(standings, (r) => r.netWorthH), settings);
    ledgerInput = { ...ledgerInput, bounties: [...ledgerInput.bounties, ...quarter.payouts] };
  }

  const liquidations = liquidateAll(input.lots, prices, settings.market.endSellProfitFeeFrac);
  ledgerInput = {
    ...ledgerInput,
    tradeFlows: [...ledgerInput.tradeFlows, ...liquidations.map((t) => ({ playerId: t.playerId, cashH: t.cashH }))],
  };
  const ledger = deriveLedger(ledgerInput, settings);
  const podium = rankBy(
    [...ledger.values()].map((l) => ({ playerId: l.playerId, goldH: l.cashH, rank: 0 })),
    (r) => r.goldH,
  );
  return { quarter, liquidations, ledger, podium };
}
