import { gold } from './format';
import type { BetInfo, GameInfo, PlayerInfo } from './types';

/** "Alice wins" / "Alice finishes top 3" */
export function betClaim(b: BetInfo, players: PlayerInfo[]): string {
  const who = players.find((p) => p.id === b.subjectId)?.displayName ?? '?';
  return b.kind === 'win' ? `${who} wins` : `${who} finishes top ${b.topN}`;
}

export const betOdds = (b: Pick<BetInfo, 'oddsA' | 'oddsB'>) => `${b.oddsA} to ${b.oddsB}`;

export function betGame(b: BetInfo, games: GameInfo[]): string {
  return games.find((g) => g.id === b.gameId)?.name ?? 'a game';
}

/** One plain sentence for a finished bet. */
export function betOutcome(b: BetInfo, players: PlayerInfo[]): string {
  const name = (id: number | null) => players.find((p) => p.id === id)?.displayName ?? '?';
  if (b.status === 'settled') return `${name(b.winnerId)} won ${gold(b.winnerId === b.offererId ? b.winH : b.stakeH)}`;
  if (b.status === 'tie') return 'Tied: stakes returned';
  if (b.status === 'void') return b.note ?? 'Called off: stakes returned';
  if (b.status === 'expired') return 'Lapsed: nobody took it';
  if (b.status === 'cancelled') return 'Withdrawn';
  return '';
}
