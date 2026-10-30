/** Floor-plan geometry shared by the GM seating screen and the TV. Sizes are fractions of the plan WIDTH. */
export const TABLE_W = { min: 0.1, max: 0.6 };
export const TABLE_H = { min: 0.07, max: 0.6 };
export const MIN_SEATS = 2;
export const MAX_SEATS = 8;
/** Edge length (fraction of plan width) each seat icon needs so icons never overlap. Mirrors server services/seating.ts. */
export const SEAT_EDGE = 0.07;
/** Smallest table that fits `seats` icons around its edge (keeps the base min proportions). */
export function minSize(seats: number) {
  const k = Math.max(1, (seats * SEAT_EDGE) / (2 * (TABLE_W.min + TABLE_H.min)));
  return { w: Math.min(TABLE_W.max, TABLE_W.min * k), h: Math.min(TABLE_H.max, TABLE_H.min * k) };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Seat centres relative to the table centre, in pixels. Seats are spaced evenly along the table's edge
 * (clockwise from the top-left, seat 1 first) and sit just outside it: `icon` is the seat icon's diameter.
 * `pos` (one 0–1 fraction of the edge per seat) overrides the even spacing: that is where the GM dragged each seat.
 */
export function seatPoints(seats: number, tw: number, th: number, icon: number, gap = 3, pos?: number[] | null): { seat: number; x: number; y: number }[] {
  const per = 2 * (tw + th);
  const out: { seat: number; x: number; y: number }[] = [];
  const off = icon / 2 + gap;
  for (let i = 0; i < seats; i++) {
    const d = pos && pos.length === seats ? pos[i]! * per : ((i + 0.5) * per) / seats;
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

/** Seat positions as 0–1 fractions of the edge: the dragged ones if set, else evenly spaced. */
export const seatFractions = (seats: number, pos?: number[] | null): number[] => (pos && pos.length === seats ? pos : Array.from({ length: seats }, (_, i) => (i + 0.5) / seats));

/**
 * Distance along a table's edge (clockwise from the top-left corner) of the edge point nearest to (px, py),
 * where (px, py) is relative to the table's centre. A point inside the table goes to its nearest edge.
 */
export function edgeDistance(px: number, py: number, tw: number, th: number): number {
  const hx = tw / 2;
  const hy = th / 2;
  let x = clamp(px, -hx, hx);
  let y = clamp(py, -hy, hy);
  if (Math.abs(px) < hx && Math.abs(py) < hy) {
    const m = Math.min(px + hx, hx - px, py + hy, hy - py);
    if (m === py + hy) y = -hy;
    else if (m === hy - py) y = hy;
    else if (m === px + hx) x = -hx;
    else x = hx;
  }
  if (y <= -hy + 1e-9) return x + hx; // top edge
  if (x >= hx - 1e-9) return tw + (y + hy); // right edge
  if (y >= hy - 1e-9) return tw + th + (hx - x); // bottom edge
  return 2 * tw + th + (hy - y); // left edge
}

/**
 * The spot nearest to `d` (a distance along the edge, which is a loop of length `per`) that is at least `gap`
 * from every other seat in `others`. null if there is no room at all.
 */
export function snapToFree(d: number, others: number[], per: number, gap: number): number | null {
  const mod = (v: number) => ((v % per) + per) % per;
  const dist = (a: number, b: number) => {
    const x = Math.abs(mod(a) - mod(b));
    return Math.min(x, per - x);
  };
  const ok = (c: number) => others.every((o) => dist(c, o) >= gap - 1e-6);
  if (ok(d)) return mod(d);
  const cands = others.flatMap((o) => [mod(o + gap), mod(o - gap)]).filter(ok);
  if (!cands.length) return null;
  return cands.reduce((best, c) => (dist(c, d) < dist(best, d) ? c : best));
}

/** Nudge seat fractions apart until each pair is at least `gap` (a fraction of the edge) apart (display only: a bigger icon on a close-up). */
export function relaxSeats(pos: number[], gap: number): number[] {
  const n = pos.length;
  if (n < 2 || gap * n >= 1) return pos;
  const out = pos.map((v) => ((v % 1) + 1) % 1);
  const order = () => out.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  for (let pass = 0; pass < 60; pass++) {
    const o = order();
    let moved = false;
    for (let k = 0; k < n; k++) {
      const i = o[k]!;
      const j = o[(k + 1) % n]!;
      const d = ((out[j]! - out[i]!) % 1 + 1) % 1;
      const gapNow = k === n - 1 ? (out[j]! + 1 - out[i]!) % 1 || 1 : d;
      if (gapNow < gap - 1e-9) {
        const push = (gap - gapNow) / 2;
        out[i] = ((out[i]! - push) % 1 + 1) % 1;
        out[j] = (out[j]! + push) % 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}
