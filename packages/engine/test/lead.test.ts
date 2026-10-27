import { describe, expect, it } from 'vitest';
import { leaderFromScores } from '../src';

const m = (o: Record<string, number>) => new Map(Object.entries(o));

describe('leaderFromScores', () => {
  it('higher wins', () => expect(leaderFromScores(m({ a: 3, b: 7, c: 5 }), 'high', null)).toBe('b'));
  it('lower wins', () => expect(leaderFromScores(m({ a: 3, b: 7, c: 5 }), 'low', null)).toBe('a'));
  it('no scores keeps current', () => expect(leaderFromScores(m({}), 'high', 'a')).toBe('a'));
  it('tie at top keeps holder in the tie', () => expect(leaderFromScores(m({ a: 7, b: 7 }), 'high', 'b')).toBe('b'));
  it('tie at top without holder keeps current', () => expect(leaderFromScores(m({ a: 7, b: 7, c: 2 }), 'high', 'c')).toBe('c'));
  it('tie with no holder gives no crown', () => expect(leaderFromScores(m({ a: 7, b: 7 }), 'high', null)).toBeNull());
  it('ignores non-finite', () => expect(leaderFromScores(m({ a: NaN, b: 1 }), 'high', null)).toBe('b'));
});
