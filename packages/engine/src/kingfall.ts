import type { Settings } from './settings';

/**
 * Per active game. `since` is night-clock ms.
 * `pending`: a king who held the crown long enough for a Kingfall was just displaced (`at`, night-clock ms). The Kingfall only
 * counts if they are still out of 1st after the grace period; if they get the crown back inside it, the take-over is treated as
 * an input mistake: no Kingfall, and their reign carries on from `since` as if nothing happened.
 */
export interface CrownState {
  leaderId: string | null;
  since: number;
  pending?: { from: string; since: number; at: number };
}

export interface TapResult {
  state: CrownState;
  /** Public: "dethroned" feed event when the leader changes. */
  dethroned: { from: string; to: string } | null;
}

export const EMPTY_CROWN: CrownState = { leaderId: null, since: 0 };

const graceMs = (settings: Settings) => settings.market.crypto.kingfallGraceSeconds * 1000;

export function tapLeader(state: CrownState, playerId: string, now: number, settings: Settings): TapResult {
  if (state.leaderId === playerId) return { state, dethroned: null };
  if (state.leaderId === null) return { state: { leaderId: playerId, since: now }, dethroned: null };
  const dethroned = { from: state.leaderId, to: playerId };
  const p = state.pending;
  // The displaced king is back inside the grace period: undo the Kingfall and give them their reign back.
  if (p && p.from === playerId && now - p.at < graceMs(settings)) return { state: { leaderId: playerId, since: p.since }, dethroned };
  const held = now - state.since >= settings.market.crypto.kingfallHoldMinutes * 60_000;
  const pending = p ?? (held ? { from: state.leaderId, since: state.since, at: now } : undefined);
  return { state: { leaderId: playerId, since: now, ...(pending ? { pending } : {}) }, dethroned };
}

/** The pending Kingfall once the grace period is over (null while it can still be cancelled, or when there is none). */
export function dueKingfall(state: CrownState, now: number, settings: Settings): { from: string; at: number } | null {
  const p = state.pending;
  return p && now - p.at >= graceMs(settings) ? { from: p.from, at: p.at } : null;
}

/** The crown with its pending Kingfall dropped (it fired, or was handled). */
export function clearPending(state: CrownState): CrownState {
  if (!state.pending) return state;
  const { pending: _p, ...rest } = state;
  return rest;
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
