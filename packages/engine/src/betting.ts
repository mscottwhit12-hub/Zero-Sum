/**
 * Player-to-player bets on a game's outcome. Pure rules: who wins a bet, and what each side risks.
 *
 * A bet is a statement about one player in one game ("Ann wins", "Ann finishes in the top 3") with odds "a to b":
 * the offerer risks `stake` and wins `stake × a / b` if the statement comes true; the taker risks that amount to win
 * the stake. Only these preset forms exist, so a result always settles them cleanly. A tie refunds both sides.
 */
import type { GameMode, GameResult } from './scoring';

export type BetKind = 'win' | 'place';
export interface BetTerms {
  kind: BetKind;
  subjectId: string;
  /** place bets: top N finishers (2–8). */
  topN?: number;
}
/** yes = the statement came true (offerer wins); no = it didn't (taker wins); tie = refund both; void = could not be decided, refund both. */
export type BetOutcome = 'yes' | 'no' | 'tie' | 'void';

export const MAX_ODDS_PART = 10;
export const PLACE_MIN = 2;
export const PLACE_MAX = 8;

/** Co-op games have no finishing order, so only win bets make sense there. */
export function betKindAllowed(mode: GameMode, kind: BetKind): boolean {
  return kind === 'win' || mode !== 'coop';
}

/** What the taker risks (and the offerer wins), in hundredths: stake × a ÷ b, rounded. */
export function winAmountH(stakeH: number, a: number, b: number): number {
  return Math.round((stakeH * a) / b);
}

/** The most either side can lose on the bet. The stake limit applies to this. */
export function maxLossH(stakeH: number, a: number, b: number): number {
  return Math.max(stakeH, winAmountH(stakeH, a, b));
}

export function oddsOk(a: unknown, b: unknown): boolean {
  const ok = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_ODDS_PART;
  return ok(a) && ok(b);
}

export function decideBet(r: GameResult, t: BetTerms): BetOutcome {
  const me = r.participants.find((p) => p.playerId === t.subjectId);
  if (!me) return 'void';
  if (r.mode === 'coop') {
    if (r.coopWon == null) return 'void';
    return r.coopWon && !me.dnf ? 'yes' : 'no';
  }
  if (me.dnf || me.placement == null) return 'no';
  // Teams share a place: count each team once.
  const unit = (p: GameResult['participants'][number]) => (r.mode === 'team' ? `team:${p.team}` : p.playerId);
  const sharing = new Set(r.participants.filter((p) => !p.dnf && p.placement === me.placement).map(unit)).size;
  const first = me.placement;
  const last = me.placement + sharing - 1;
  const limit = t.kind === 'win' ? 1 : t.topN ?? 1;
  if (last <= limit) return 'yes';
  if (first > limit) return 'no';
  return 'tie';
}
