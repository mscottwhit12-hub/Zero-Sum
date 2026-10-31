import { describe, expect, it } from 'vitest';
import { betKindAllowed, decideBet, maxLossH, oddsOk, winAmountH } from '../src/betting';
import type { GameResult } from '../src/scoring';

const ranked = (places: (number | 'dnf')[], mode: GameResult['mode'] = 'competitive'): GameResult => ({
  id: '1',
  mode,
  actualHours: 1,
  participants: places.map((p, i) => ({ playerId: String(i + 1), placement: p === 'dnf' ? null : p, dnf: p === 'dnf', team: null })),
});

describe('win bets', () => {
  it('yes for the winner, no for everyone else', () => {
    const r = ranked([1, 2, 3]);
    expect(decideBet(r, { kind: 'win', subjectId: '1' })).toBe('yes');
    expect(decideBet(r, { kind: 'win', subjectId: '2' })).toBe('no');
  });
  it('a tie for first refunds a bet on a tied player but loses for others', () => {
    const r = ranked([1, 1, 3]);
    expect(decideBet(r, { kind: 'win', subjectId: '1' })).toBe('tie');
    expect(decideBet(r, { kind: 'win', subjectId: '2' })).toBe('tie');
    expect(decideBet(r, { kind: 'win', subjectId: '3' })).toBe('no');
  });
  it('a DNF loses; a player who was not in the game voids the bet', () => {
    expect(decideBet(ranked([1, 'dnf']), { kind: 'win', subjectId: '2' })).toBe('no');
    expect(decideBet(ranked([1, 2]), { kind: 'win', subjectId: '9' })).toBe('void');
  });
});

describe('place bets', () => {
  const r = ranked([1, 2, 3, 4]);
  it('top N is yes inside, no outside', () => {
    expect(decideBet(r, { kind: 'place', subjectId: '3', topN: 3 })).toBe('yes');
    expect(decideBet(r, { kind: 'place', subjectId: '4', topN: 3 })).toBe('no');
  });
  it('a tie across the line refunds; a tie wholly inside or outside does not', () => {
    const t = ranked([1, 2, 2, 4]); // 2nd and 3rd share the second place → positions 2..3
    expect(decideBet(t, { kind: 'place', subjectId: '2', topN: 2 })).toBe('tie');
    expect(decideBet(t, { kind: 'place', subjectId: '2', topN: 3 })).toBe('yes');
    expect(decideBet(t, { kind: 'place', subjectId: '4', topN: 3 })).toBe('no');
  });
});

describe('team and co-op games', () => {
  it('a team counts once when sharing a place', () => {
    const r: GameResult = {
      id: '1',
      mode: 'team',
      actualHours: 1,
      participants: [
        { playerId: '1', placement: 1, dnf: false, team: 'A' },
        { playerId: '2', placement: 1, dnf: false, team: 'A' },
        { playerId: '3', placement: 2, dnf: false, team: 'B' },
      ],
    };
    expect(decideBet(r, { kind: 'win', subjectId: '2' })).toBe('yes');
    expect(decideBet(r, { kind: 'win', subjectId: '3' })).toBe('no');
  });
  it('co-op: the whole table wins or loses; place bets are not offered', () => {
    const r: GameResult = { id: '1', mode: 'coop', actualHours: 1, coopWon: true, participants: [{ playerId: '1', placement: null, dnf: false, team: null }] };
    expect(decideBet(r, { kind: 'win', subjectId: '1' })).toBe('yes');
    expect(decideBet({ ...r, coopWon: false }, { kind: 'win', subjectId: '1' })).toBe('no');
    expect(betKindAllowed('coop', 'place')).toBe(false);
    expect(betKindAllowed('competitive', 'place')).toBe(true);
  });
});

describe('odds and limits', () => {
  it('3 to 1: offerer risks 1 to win 3; the limit is the larger side', () => {
    expect(winAmountH(100, 3, 1)).toBe(300);
    expect(maxLossH(100, 3, 1)).toBe(300);
    expect(maxLossH(500, 1, 3)).toBe(500);
    expect(winAmountH(500, 1, 3)).toBe(167);
  });
  it('odds must be whole numbers 1–10', () => {
    expect(oddsOk(3, 1)).toBe(true);
    expect(oddsOk(0, 1)).toBe(false);
    expect(oddsOk(11, 1)).toBe(false);
    expect(oddsOk(1.5, 1)).toBe(false);
  });
});
