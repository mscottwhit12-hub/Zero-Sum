import { copy } from '@shared/copy';
import type { PublicState, Security } from '@shared/types';

/** Display name for any security: player stocks show the player; others come from the copy file. */
export function securityName(s: PublicState | null, sec: Security): string {
  if (sec.kind === 'player') return s?.players.find((p) => p.id === sec.playerId)?.displayName ?? sec.ticker;
  const c = (copy as { securities: Record<string, { name: string }> }).securities[sec.id];
  return c?.name ?? sec.ticker;
}

export function securityBlurb(sec: Security): string | null {
  if (sec.kind === 'player') return null;
  const c = (copy as { securities: Record<string, { blurb?: string }> }).securities[sec.id];
  return c?.blurb ?? null;
}

export const pct = (a: number, b: number) => (b ? ((a / b - 1) * 100).toFixed(1) : '0.0');
