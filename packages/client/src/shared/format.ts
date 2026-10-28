/** Gold is integer hundredths; display to 1 decimal (spec §5.3). */
/** Gold (stored in hundredths) to 0.01 on phones and GM screens. */
export const gold = (h: number | null | undefined) => (h == null ? '—' : (h / 100).toFixed(2));
export const signedGold = (h: number) => `${h >= 0 ? '+' : '−'}${gold(Math.abs(h))}`;
/** The TV rounds gold to 0.1 (read from the couch). */
export const goldTv = (h: number | null | undefined) => (h == null ? '—' : (Math.round(h / 10) / 10).toFixed(1));
export const signedGoldTv = (h: number) => `${h >= 0 ? '+' : '−'}${goldTv(Math.abs(h))}`;

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const timeOfDay = (epoch: number | null | undefined) =>
  epoch == null ? '—' : new Date(epoch).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const hours = (h: number | null | undefined) => (h == null ? '—' : `${(Math.round(h * 100) / 100).toFixed(2)} h`);

export const price = (p: number) => p.toFixed(2);

/** 1 → 1st, 2 → 2nd … */
export const ordinal = (n: number) => {
  const v = n % 100;
  const s = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${n % 10 > 3 ? 'th' : s}`;
};
