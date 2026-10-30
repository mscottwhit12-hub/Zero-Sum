/**
 * Seat geometry copied from the reference seating.ts (floor-plan / TV table drawing), trimmed to what the
 * Clue board needs. Seats are spaced evenly along the table edge, clockwise from the top-left, seat 1 first.
 */
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Seat centres relative to the table centre, in pixels. `icon` is the seat icon's diameter. */
export function seatPoints(seats: number, tw: number, th: number, icon: number, gap = 3): { seat: number; x: number; y: number }[] {
  const per = 2 * (tw + th);
  const out: { seat: number; x: number; y: number }[] = [];
  const off = icon / 2 + gap;
  for (let i = 0; i < seats; i++) {
    const d = ((i + 0.5) * per) / seats;
    let x: number, y: number;
    if (d < tw) {
      x = -tw / 2 + d;
      y = -th / 2 - off;
    } else if (d < tw + th) {
      x = tw / 2 + off;
      y = -th / 2 + (d - tw);
    } else if (d < 2 * tw + th) {
      x = tw / 2 - (d - tw - th);
      y = th / 2 + off;
    } else {
      x = -tw / 2 - off;
      y = th / 2 - (d - 2 * tw - th);
    }
    out.push({ seat: i + 1, x, y });
  }
  return out;
}
