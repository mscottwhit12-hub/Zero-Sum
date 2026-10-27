import type { Settings } from './settings';

/** Per active game. `since` is night-clock ms. */
export interface CrownState {
  leaderId: string | null;
  since: number;
}

export interface TapResult {
  state: CrownState;
  /** Public: "dethroned" feed event when the leader changes. */
  dethroned: { from: string; to: string } | null;
  /** Hidden: previous leader held ≥ hold time and was displaced → crypto spike. */
  kingfall: boolean;
}

export const EMPTY_CROWN: CrownState = { leaderId: null, since: 0 };

export function tapLeader(state: CrownState, playerId: string, now: number, settings: Settings): TapResult {
  if (state.leaderId === playerId) return { state, dethroned: null, kingfall: false };
  const next: CrownState = { leaderId: playerId, since: now };
  if (state.leaderId === null) return { state: next, dethroned: null, kingfall: false };
  const heldMs = now - state.since;
  return {
    state: next,
    dethroned: { from: state.leaderId, to: playerId },
    kingfall: heldMs >= settings.market.crypto.kingfallHoldMinutes * 60_000,
  };
}

/** How a game's crown is decided: by entered scores (higher or lower wins) or by manual GM taps. */
export type LeadMode = 'high' | 'low' | 'manual';
export const LEAD_MODES: readonly LeadMode[] = ['high', 'low', 'manual'];

/**
 * Leader from the latest entered scores. Players with no score are ignored.
 * A tie at the top keeps the current holder if they are in the tie; otherwise nobody new takes the crown (returns current).
 */
export function leaderFromScores(scores: ReadonlyMap<string, number>, mode: 'high' | 'low', current: string | null): string | null {
  let best: number | null = null;
  let top: string[] = [];
  for (const [id, s] of scores) {
    if (!Number.isFinite(s)) continue;
    if (best === null || (mode === 'high' ? s > best : s < best)) {
      best = s;
      top = [id];
    } else if (s === best) top.push(id);
  }
  if (!top.length) return current;
  if (top.length === 1) return top[0]!;
  return current;
}
