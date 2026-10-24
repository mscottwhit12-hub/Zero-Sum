/** Gold is stored as integer hundredths. Shares are stored as integer hundredths of a share. */
export type GoldH = number;
export type SharesH = number;

export function toH(gold: number): GoldH {
  return Math.round(gold * 100);
}

export function fromH(h: GoldH): number {
  return h / 100;
}

/** Display to 1 decimal. */
export function formatGold(h: GoldH): string {
  return (Math.round(h / 10) / 10).toFixed(1);
}

/** Value in hundredths of `sharesH` shares at `price` gold/share. */
export function valueH(sharesH: SharesH, price: number): GoldH {
  // (sharesH/100 shares) × price gold × 100 = sharesH × price hundredths
  return Math.round(sharesH * price);
}

export function sum(xs: Iterable<number>): number {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}
