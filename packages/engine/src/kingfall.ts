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
