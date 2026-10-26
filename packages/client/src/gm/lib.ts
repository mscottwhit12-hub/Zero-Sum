import type { GmState, PlayerInfo } from '@shared/types';

export const playerName = (s: GmState | null, id: number | null | undefined) =>
  id == null ? '—' : (s?.players.find((p) => p.id === id)?.displayName ?? `#${id}`);

export const activePlayers = (s: GmState | null): PlayerInfo[] => (s?.players ?? []).filter((p) => !p.left);

/** "HH:MM" today (local) → epoch ms. */
export function timeToEpoch(hhmm: string): number | null {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function epochToTime(ms: number | null): string {
  if (ms == null) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
