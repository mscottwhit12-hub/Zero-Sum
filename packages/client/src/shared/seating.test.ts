import { describe, expect, it } from 'vitest';
import { edgeDistance, relaxSeats, seatFractions, seatPoints, snapToFree } from './seating';

const TW = 200;
const TH = 100;
const PER = 2 * (TW + TH); // 600

describe('seat positions', () => {
  it('without positions seats are spaced evenly; with positions they sit where they were put', () => {
    const even = seatPoints(4, TW, TH, 30);
    const same = seatPoints(4, TW, TH, 30, 3, seatFractions(4, null));
    expect(same).toEqual(even);
    // seat 1 moved to the middle of the top edge (fraction 100/600) → x = 0, just above the table
    const moved = seatPoints(4, TW, TH, 30, 3, [100 / PER, 0.3, 0.6, 0.85]);
    expect(moved[0]!.x).toBeCloseTo(0, 5);
    expect(moved[0]!.y).toBeLessThan(-TH / 2);
    expect(moved[1]).toEqual(even[1] && seatPoints(4, TW, TH, 30, 3, [100 / PER, 0.3, 0.6, 0.85])[1]);
  });
  it('a pointer anywhere maps to the nearest point on the table edge', () => {
    expect(edgeDistance(0, -300, TW, TH)).toBeCloseTo(100); // above the middle → top edge, 100 along
    expect(edgeDistance(500, 0, TW, TH)).toBeCloseTo(TW + 50); // right of the middle → right edge, halfway down
    expect(edgeDistance(0, 400, TW, TH)).toBeCloseTo(TW + TH + 100); // below the middle → bottom edge
    expect(edgeDistance(-400, 0, TW, TH)).toBeCloseTo(2 * TW + TH + 50); // left of the middle
    expect(edgeDistance(20, -30, TW, TH)).toBeCloseTo(TW / 2 + 20); // inside, nearer the top than the right → top edge
    expect(edgeDistance(80, -10, TW, TH)).toBeCloseTo(TW + (-10 + TH / 2)); // inside, nearer the right edge → right edge
    expect(edgeDistance(-300, -300, TW, TH)).toBeCloseTo(0); // beyond the top-left corner → the corner
    expect(edgeDistance(300, -300, TW, TH)).toBeCloseTo(TW); // top-right corner
  });
  it('a seat snaps to the nearest free spot, never on top of another seat', () => {
    const gap = 40;
    expect(snapToFree(300, [100, 500], PER, gap)).toBeCloseTo(300); // free: stays
    expect(snapToFree(110, [100, 400], PER, gap)).toBeCloseTo(140); // too close to the seat at 100: pushed out to 140
    expect(snapToFree(90, [100, 400], PER, gap)).toBeCloseTo(60); // from the other side: 60
    expect(snapToFree(5, [590], PER, gap)).toBeCloseTo(30); // the edge is a loop: 590 is 15 away from 5
    expect(snapToFree(10, [0, 40, 80], PER, 40)).toBeCloseTo(560); // squeezed between seats: the nearest spot that fits, going round the loop
    expect(snapToFree(0, [0, 100, 200, 300, 400, 500], 600, 100.01)).toBeNull(); // no room anywhere
  });
  it('close-up: seats are nudged apart when bigger icons would touch', () => {
    const out = relaxSeats([0.1, 0.11, 0.5], 0.05);
    const gaps = [...out].sort((a, b) => a - b).flatMap((v, i, a) => (i ? [v - a[i - 1]!] : []));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.05 - 1e-6);
    relaxSeats([0.1, 0.4, 0.7], 0.05).forEach((v, i) => expect(v).toBeCloseTo([0.1, 0.4, 0.7][i]!, 9)); // already apart: untouched
    expect(relaxSeats([0.99, 0.01], 0.1).every((v) => v >= 0 && v < 1)).toBe(true); // wraps around the corner
  });
});
