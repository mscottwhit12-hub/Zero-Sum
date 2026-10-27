import { describe, expect, it } from 'vitest';
import { hoursPlayed, placeMult, resolveSettings, scoreGame, ScoringError, type GameResult } from '../src';
import { spec } from './fixtures';

// Worked examples use the original spec values (game gold ×1).
const x1 = spec;

const S = x1();
const gold = (r: GameResult, s = S) => Object.fromEntries(scoreGame(r, s).rows.map((x) => [x.playerId, x.goldH]));

describe('placement multipliers', () => {
  it('1.0 / 0.5 / 0.25 then keeps halving', () => {
    expect([1, 2, 3, 4, 5].map((p) => placeMult(p, S.scoring))).toEqual([1, 0.5, 0.25, 0.125, 0.0625]);
  });
});

describe('competitive', () => {
  it('2h, 4 players: 8.0 / 4.0 / 2.0 / 1.0', () => {
    const r: GameResult = {
      id: 'g',
      mode: 'competitive',
      actualHours: 2,
      participants: [
        { playerId: 'a', placement: 1 },
        { playerId: 'b', placement: 2 },
        { playerId: 'c', placement: 3 },
        { playerId: 'd', placement: 4 },
      ],
    };
    expect(gold(r)).toEqual({ a: 800, b: 400, c: 200, d: 100 });
  });

  it('tie for 2nd (1,2,2,4) averages places 2–3: 2h×4×0.375 = 3.0 each', () => {
    const r: GameResult = {
      id: 'g',
      mode: 'competitive',
      actualHours: 2,
      participants: [
        { playerId: 'a', placement: 1 },
        { playerId: 'b', placement: 2 },
        { playerId: 'c', placement: 2 },
        { playerId: 'd', placement: 4 },
      ],
    };
    expect(gold(r)).toEqual({ a: 800, b: 300, c: 300, d: 100 });
  });

  it('dense tie notation (1,2,2,3) gives the same result', () => {
    const r: GameResult = {
      id: 'g',
      mode: 'competitive',
      actualHours: 2,
      participants: [
        { playerId: 'a', placement: 1 },
        { playerId: 'b', placement: 2 },
        { playerId: 'c', placement: 2 },
        { playerId: 'd', placement: 3 },
      ],
    };
    expect(gold(r)).toEqual({ a: 800, b: 300, c: 300, d: 100 });
  });

  it('tie rule best / worst', () => {
    const r: GameResult = {
      id: 'g',
      mode: 'competitive',
      actualHours: 1,
      participants: [
        { playerId: 'a', placement: 1 },
        { playerId: 'b', placement: 1 },
      ],
    };
    expect(gold(r, x1({ scoring: { tieRule: 'best' } }))).toEqual({ a: 200, b: 200 });
    expect(gold(r, x1({ scoring: { tieRule: 'worst' } }))).toEqual({ a: 100, b: 100 });
    expect(gold(r)).toEqual({ a: 150, b: 150 });
  });

  it('DNF counts toward players_in_game and scores 0', () => {
    const r: GameResult = {
      id: 'g',
      mode: 'competitive',
      actualHours: 1.5,
      participants: [
        { playerId: 'a', placement: 1 },
        { playerId: 'b', placement: 2 },
        { playerId: 'c', placement: 3 },
        { playerId: 'd', dnf: true },
      ],
    };
    // n = 4: 1.5 × 4 × 1 = 6.0
    expect(gold(r)).toEqual({ a: 600, b: 300, c: 150, d: 0 });
  });

  it('rounds once to hundredths', () => {
    const r: GameResult = {
      id: 'g',
      mode: 'competitive',
      actualHours: 1.333,
      participants: [
        { playerId: 'a', placement: 1 },
        { playerId: 'b', placement: 2 },
        { playerId: 'c', placement: 3 },
      ],
    };
    // 1.333×3×0.25 = 0.99975 → 1.00
    expect(gold(r).c).toBe(100);
    expect(gold(r).a).toBe(400); // 3.999 → 4.00
  });

  it('settings change re-scores', () => {
    const r: GameResult = {
      id: 'g',
      mode: 'competitive',
      actualHours: 1,
      participants: [
        { playerId: 'a', placement: 1 },
        { playerId: 'b', placement: 2 },
      ],
    };
    expect(gold(r, x1({ scoring: { placementMults: [1, 0.8] } }))).toEqual({ a: 200, b: 160 });
  });

  it('goldScale multiplies game gold only (2h × 4 × 1.0 × 2.5 = 20.0)', () => {
    const r: GameResult = {
      id: 'g',
      mode: 'competitive',
      actualHours: 2,
      participants: [
        { playerId: 'a', placement: 1 },
        { playerId: 'b', placement: 2 },
        { playerId: 'c', placement: 3 },
        { playerId: 'd', placement: 4 },
      ],
    };
    expect(gold(r, x1({ scoring: { goldScale: 2.5 } }))).toEqual({ a: 2000, b: 1000, c: 500, d: 250 });
  });

  it('rejects missing placement / bad hours / duplicates', () => {
    expect(() =>
      scoreGame({ id: 'g', mode: 'competitive', actualHours: 1, participants: [{ playerId: 'a' }] }, S),
    ).toThrow(ScoringError);
    expect(() =>
      scoreGame({ id: 'g', mode: 'competitive', actualHours: 0, participants: [{ playerId: 'a', placement: 1 }] }, S),
    ).toThrow(/hours/);
    expect(() =>
      scoreGame(
        {
          id: 'g',
          mode: 'competitive',
          actualHours: 1,
          participants: [
            { playerId: 'a', placement: 1 },
            { playerId: 'a', placement: 2 },
          ],
        },
        S,
      ),
    ).toThrow(/duplicate/);
  });
});

describe('team', () => {
  it('players_in_game = total people; each member gets the team place gold', () => {
    const r: GameResult = {
      id: 'g',
      mode: 'team',
      actualHours: 1,
      participants: [
        { playerId: 'a', team: 'A', placement: 1 },
        { playerId: 'b', team: 'A', placement: 1 },
        { playerId: 'c', team: 'B', placement: 2 },
        { playerId: 'd', team: 'B', placement: 2 },
      ],
    };
    expect(gold(r)).toEqual({ a: 400, b: 400, c: 200, d: 200 });
  });

  it('tied teams average over team places; DNF member gets 0', () => {
    const r: GameResult = {
      id: 'g',
      mode: 'team',
      actualHours: 1,
      participants: [
        { playerId: 'a', team: 'A', placement: 1 },
        { playerId: 'b', team: 'B', placement: 1 },
        { playerId: 'c', team: 'C', placement: 3 },
        { playerId: 'd', team: 'C', dnf: true },
      ],
    };
    // n=4. A,B share places 1–2: 0.75 → 3.0. C is 3rd: 0.25 → 1.0
    expect(gold(r)).toEqual({ a: 300, b: 300, c: 100, d: 0 });
  });

  it('rejects mixed placements within a team', () => {
    expect(() =>
      scoreGame(
        {
          id: 'g',
          mode: 'team',
          actualHours: 1,
          participants: [
            { playerId: 'a', team: 'A', placement: 1 },
            { playerId: 'b', team: 'A', placement: 2 },
          ],
        },
        S,
      ),
    ).toThrow(/mixed/);
  });
});

describe('coop', () => {
  const base = {
    id: 'g',
    mode: 'coop' as const,
    actualHours: 2,
    participants: [{ playerId: 'a' }, { playerId: 'b' }, { playerId: 'c' }],
  };
  it('win: everyone gets the 1st mult (2×3×1 = 6.0)', () => {
    expect(gold({ ...base, coopWon: true })).toEqual({ a: 600, b: 600, c: 600 });
  });
  it('loss: consolation 0.25 (2×3×0.25 = 1.5)', () => {
    expect(gold({ ...base, coopWon: false })).toEqual({ a: 150, b: 150, c: 150 });
  });
  it('needs a win/loss', () => {
    expect(() => scoreGame(base, S)).toThrow(/win\/loss/);
  });
});

describe('hours played', () => {
  it('sums per player', () => {
    const h = hoursPlayed([
      { id: '1', mode: 'coop', actualHours: 1, coopWon: true, participants: [{ playerId: 'a' }, { playerId: 'b' }] },
      { id: '2', mode: 'coop', actualHours: 0.5, coopWon: true, participants: [{ playerId: 'a' }] },
    ]);
    expect(h.get('a')).toBe(1.5);
    expect(h.get('b')).toBe(1);
  });
});

describe('linear payout curve', () => {
  const L = resolveSettings({}).scoring;
  it('defaults to linear with a 10% floor', () => expect([L.curve, L.floorMult]).toEqual(['linear', 0.1]));
  it('6 players: 100/50/40/30/20/10', () => expect([1, 2, 3, 4, 5, 6].map((p) => placeMult(p, L, 6))).toEqual([1, 0.5, 0.4, 0.3, 0.2, 0.1]));
  it('4 players never below classic: 1/0.5/0.3/0.125', () => expect([1, 2, 3, 4].map((p) => +placeMult(p, L, 4).toFixed(4))).toEqual([1, 0.5, 0.3, 0.125]));
  it('3 players keeps classic 0.25 for 3rd', () => expect(placeMult(3, L, 3)).toBe(0.25));
  it('scoreGame uses the unit count', () => {
    const g = scoreGame({ id: 'g', mode: 'competitive', actualHours: 1, participants: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ playerId: id, placement: i + 1 })) }, resolveSettings({ scoring: { goldScale: 1 } }));
    expect(g.rows.map((r) => r.goldH)).toEqual([600, 300, 240, 180, 120, 60]);
  });
});
