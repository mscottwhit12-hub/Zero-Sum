import { toH, type GoldH } from './money';
import type { Settings } from './settings';
import type { GoldEntry, StandingRow } from './standings';

export interface Ballot {
  voterId: string;
  targetId: string;
  weight: number;
}

/** Ballot weight at cast time. 'equal' = 1 player 1 vote; 'netWorth' = weight ∝ voter net worth (gold, floored at 0). */
export function ballotWeight(voterNetWorthH: GoldH, settings: Settings): number {
  return settings.votes.weighting === 'netWorth' ? Math.max(0, voterNetWorthH) / 100 : 1;
}

/** One ballot per voter; the last one wins. Self-votes are allowed. Ballots for non-eligible targets are ignored. */
export function dedupeBallots(ballots: Ballot[], eligible: Set<string>): Ballot[] {
  const byVoter = new Map<string, Ballot>();
  for (const b of ballots) if (eligible.has(b.targetId)) byVoter.set(b.voterId, b);
  return [...byVoter.values()];
}

export function voteShares(ballots: Ballot[], eligibleIds: string[]): Map<string, number> {
  const eligible = new Set(eligibleIds);
  const bs = dedupeBallots(ballots, eligible);
  const total = bs.reduce((a, b) => a + b.weight, 0);
  const out = new Map<string, number>(eligibleIds.map((id) => [id, 0]));
  if (total <= 0) return out;
  for (const b of bs) out.set(b.targetId, out.get(b.targetId)! + b.weight / total);
  return out;
}

/**
 * Hidden drift, fixed for the rest of the quarter once the window closes:
 * vote_drift = driftMax × (share − 1/N). No ballots → all 0.
 */
export function voteDrift(ballots: Ballot[], eligibleIds: string[], settings: Settings): Map<string, number> {
  const n = eligibleIds.length;
  const shares = voteShares(ballots, eligibleIds);
  const anyVotes = [...shares.values()].some((v) => v > 0);
  const out = new Map<string, number>();
  for (const id of eligibleIds) out.set(id, anyVotes && n > 0 ? settings.votes.driftMax * (shares.get(id)! - 1 / n) : 0);
  return out;
}

export interface QuarterResolution {
  /** Players who count as "leading" for the bounty (rank 1, or rank ≤ 2 at large party sizes). */
  winners: string[];
  payouts: GoldEntry[];
}

/**
 * Resolve at quarter end (or force-resolve at End, before auto-sell — locked #3).
 * Standings must be by net worth for eligible (active) players.
 */
export function resolveQuarter(ballots: Ballot[], standings: StandingRow[], settings: Settings): QuarterResolution {
  const eligibleIds = standings.map((s) => s.playerId);
  const topTwo = eligibleIds.length >= settings.votes.topTwoMinPlayers;
  const winners = standings.filter((s) => s.rank <= (topTwo ? 2 : 1)).map((s) => s.playerId);
  const win = new Set(winners);
  const bounty = toH(settings.votes.bountyGold);
  const payouts = dedupeBallots(ballots, new Set(eligibleIds))
    .filter((b) => win.has(b.targetId) && bounty > 0)
    .map((b) => ({ playerId: b.voterId, goldH: bounty }));
  return { winners, payouts };
}
