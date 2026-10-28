/** Floor-plan geometry shared by the GM seating screen and the TV. Sizes are fractions of the plan WIDTH. */
export const TABLE_W = { min: 0.1, max: 0.6 };
export const TABLE_H = { min: 0.07, max: 0.6 };
export const MIN_SEATS = 2;
export const MAX_SEATS = 8;
/** Edge length (fraction of plan width) each seat icon needs so icons never overlap. Mirrors server services/seating.ts. */
const SEAT_EDGE = 0.07;
/** Smallest table that fits `seats` icons around its edge (keeps the base min proportions). */
export function minSize(seats: number) {
  const k = Math.max(1, (seats * SEAT_EDGE) / (2 * (TABLE_W.min + TABLE_H.min)));
  return { w: Math.min(TABLE_W.max, TABLE_W.min * k), h: Math.min(TABLE_H.max, TABLE_H.min * k) };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Seat centres relative to the table centre, in pixels. Seats are spaced evenly along the table's edge
 * (clockwise from the top-left, seat 1 first) and sit just outside it: `icon` is the seat icon's diameter.
 */
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
