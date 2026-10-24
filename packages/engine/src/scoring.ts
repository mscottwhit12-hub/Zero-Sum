import { type GoldH } from './money';
import type { Settings } from './settings';

export type GameMode = 'competitive' | 'team' | 'coop';

export interface Participant {
  playerId: string;
  /** Competitive: player's place (ties = equal numbers). Team: the team's place. Coop: ignored. */
  placement?: number | null;
  dnf?: boolean;
  team?: string | null;
}

export interface GameResult {
  id: string;
  mode: GameMode;
  /** Actual hours played, pause excluded. Entered by the GM. */
  actualHours: number;
  participants: Participant[];
  /** Coop only. */
  coopWon?: boolean | null;
}

export interface ScoredParticipant {
  playerId: string;
  mult: number;
  goldH: GoldH;
}

export interface ScoredGame {
  gameId: string;
  playersInGame: number;
  hours: number;
  rows: ScoredParticipant[];
}

export class ScoringError extends Error {}

/** Multiplier for a single (untied) place, 1-based. */
export function placeMult(place: number, s: Settings['scoring']): number {
  const list = s.placementMults;
  if (place < 1) throw new ScoringError(`bad place ${place}`);
  if (place <= list.length) return list[place - 1]!;
  return list[list.length - 1]! * Math.pow(s.tailFactor, place - list.length);
}

/** Multiplier for a tie group occupying places [from, from+count-1]. */
export function tieMult(from: number, count: number, s: Settings['scoring']): number {
  const ms: number[] = [];
  for (let p = from; p < from + count; p++) ms.push(placeMult(p, s));
  if (s.tieRule === 'best') return Math.max(...ms);
  if (s.tieRule === 'worst') return Math.min(...ms);
  return ms.reduce((a, b) => a + b, 0) / ms.length;
}

/**
 * Turns placement numbers (ties allowed, dense or competition style) into a mult per unit.
 * Units are sorted by placement; equal placements form a tie group spanning consecutive places.
 */
export function multsForPlacements<K>(units: { key: K; placement: number }[], s: Settings['scoring']): Map<K, number> {
  const sorted = [...units].sort((a, b) => a.placement - b.placement);
  const out = new Map<K, number>();
  let pos = 1;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j]!.placement === sorted[i]!.placement) j++;
    const m = tieMult(pos, j - i, s);
    for (let k = i; k < j; k++) out.set(sorted[k]!.key, m);
    pos += j - i;
    i = j;
  }
  return out;
}

export function validateResult(r: GameResult): string[] {
  const errs: string[] = [];
  if (!(r.actualHours > 0)) errs.push('actual hours must be > 0');
  if (r.participants.length === 0) errs.push('no participants');
  const ids = new Set<string>();
  for (const p of r.participants) {
    if (ids.has(p.playerId)) errs.push(`duplicate participant ${p.playerId}`);
    ids.add(p.playerId);
  }
  if (r.mode === 'coop') {
    if (r.coopWon == null) errs.push('coop needs win/loss');
  } else {
    for (const p of r.participants) {
      if (p.dnf) continue;
      if (p.placement == null || !Number.isInteger(p.placement) || p.placement < 1)
        errs.push(`missing placement for ${p.playerId}`);
    }
  }
  if (r.mode === 'team') {
    const teamPlace = new Map<string, number>();
    for (const p of r.participants) {
      if (!p.team) {
        errs.push(`missing team for ${p.playerId}`);
        continue;
      }
      if (p.dnf || p.placement == null) continue;
      const prev = teamPlace.get(p.team);
      if (prev !== undefined && prev !== p.placement) errs.push(`team ${p.team} has mixed placements`);
      teamPlace.set(p.team, p.placement);
    }
  }
  return errs;
}

/** gold = actual_hours × players_in_game × placement_mult × goldScale, rounded once to hundredths. */
export function scoreGame(r: GameResult, settings: Settings): ScoredGame {
  const errs = validateResult(r);
  if (errs.length) throw new ScoringError(errs.join('; '));
  const s = settings.scoring;
  const n = r.participants.length; // DNF counts toward players_in_game; team = total people
  const mults = new Map<string, number>();

  if (r.mode === 'coop') {
    const m = r.coopWon ? placeMult(1, s) : s.coopLossMult;
    for (const p of r.participants) mults.set(p.playerId, p.dnf ? s.dnfMult : m);
  } else if (r.mode === 'team') {
    const teamPlace = new Map<string, number>();
    for (const p of r.participants) if (!p.dnf && p.placement != null) teamPlace.set(p.team!, p.placement);
    // A team where every member DNF'd has no place; it doesn't occupy a slot.
    const teamMult = multsForPlacements([...teamPlace].map(([key, placement]) => ({ key, placement })), s);
    for (const p of r.participants) mults.set(p.playerId, p.dnf ? s.dnfMult : teamMult.get(p.team!) ?? s.dnfMult);
  } else {
    const placed = r.participants.filter((p) => !p.dnf).map((p) => ({ key: p.playerId, placement: p.placement! }));
    const pm = multsForPlacements(placed, s);
    for (const p of r.participants) mults.set(p.playerId, p.dnf ? s.dnfMult : pm.get(p.playerId)!);
  }

  const rows = r.participants.map((p) => {
    const mult = mults.get(p.playerId)!;
    return { playerId: p.playerId, mult, goldH: Math.round(r.actualHours * n * mult * s.goldScale * 100) };
  });
  return { gameId: r.id, playersInGame: n, hours: r.actualHours, rows };
}

/** Hours played per player (tracked for the GM, never enforced). */
export function hoursPlayed(results: GameResult[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of results) for (const p of r.participants) out.set(p.playerId, (out.get(p.playerId) ?? 0) + r.actualHours);
  return out;
}
