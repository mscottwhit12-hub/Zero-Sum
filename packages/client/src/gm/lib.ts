import type { GameInfo, GmState, PlayerInfo } from '@shared/types';

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

/** Reasons to double-check before starting a game (time guards). Empty = just start. */
export function startWarnings(s: GmState | null, g: GameInfo): string[] {
  const games = s?.games ?? [];
  const out: string[] = [];
  const earlier = games.filter((x) => x.id !== g.id && x.status === 'scheduled' && x.plannedStart != null && (g.plannedStart == null || x.plannedStart < g.plannedStart));
  if (earlier.length) out.push(`${earlier.map((x) => x.name).join(', ')} ${earlier.length > 1 ? 'are' : 'is'} scheduled before ${g.name}.`);
  const running = games.filter((x) => x.id !== g.id && x.status === 'active');
  for (const p of g.participants) {
    const busy = running.find((x) => x.participants.some((q) => q.playerId === p.playerId));
    if (busy) out.push(`${playerName(s, p.playerId)} is in a running game (${busy.name}).`);
  }
  if (g.tableId != null) {
    const t = running.find((x) => x.tableId === g.tableId);
    if (t) out.push(`That table already has a running game (${t.name}).`);
  }
  return out;
}

/** Players booked into two games whose planned times overlap (for a game being scheduled). */
export function doubleBooked(s: GmState | null, start: number | null, hours: number | null, playerIds: number[], ignoreId?: number): string[] {
  if (start == null || !hours) return [];
  const end = start + hours * 3_600_000;
  const out: string[] = [];
  for (const g of s?.games ?? []) {
    if (g.id === ignoreId || (g.status !== 'scheduled' && g.status !== 'active')) continue;
    const gs0 = g.status === 'active' ? g.startedAt : g.plannedStart;
    if (gs0 == null || !g.plannedDurationHours) continue;
    const ge = gs0 + g.plannedDurationHours * 3_600_000;
    if (gs0 >= end || ge <= start) continue;
    const both = g.participants.filter((p) => playerIds.includes(p.playerId)).map((p) => playerName(s, p.playerId));
    if (both.length) out.push(`${both.join(', ')} ${both.length > 1 ? 'are' : 'is'} also in ${g.name} at that time.`);
  }
  return out;
}

/** Start a game, asking first if any time guard applies. */
export function confirmStart(s: GmState | null, g: GameInfo): boolean {
  const w = startWarnings(s, g);
  return !w.length || confirm(`${w.join('\n')}\n\nStart ${g.name} anyway?`);
}
