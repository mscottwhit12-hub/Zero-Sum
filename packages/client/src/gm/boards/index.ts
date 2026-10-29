/** Installed GM boards, by pack "board" key. Add a board: import its def + Board.svelte and list it here. */
import type { Component } from 'svelte';
import type { BoardDef, BoardProps } from './contract';
import { def as riskDef } from './risk/def';
import RiskBoard from './risk/Board.svelte';
import { def as ttrDef } from './ticket-to-ride/def';
import TtrBoard from './ticket-to-ride/Board.svelte';
import { def as ttrEuDef } from './ticket-to-ride-europe/def';
import TtrEuBoard from './ticket-to-ride-europe/Board.svelte';

export interface BoardEntry {
  def: BoardDef<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  Board: Component<BoardProps<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const BOARDS: Record<string, BoardEntry> = {
  risk: { def: riskDef, Board: RiskBoard as unknown as BoardEntry['Board'] },
  'ticket-to-ride': { def: ttrDef, Board: TtrBoard as unknown as BoardEntry['Board'] },
  'ticket-to-ride-europe': { def: ttrEuDef, Board: TtrEuBoard as unknown as BoardEntry['Board'] },
};

/** Defaults from the board's def, overridden by the Master's saved values. */
export function boardSettingsFor(key: string, saved: Record<string, Record<string, number>> | undefined): Record<string, number> {
  const d = BOARDS[key]?.def.settings ?? {};
  const out: Record<string, number> = {};
  for (const [k, s] of Object.entries(d)) out[k] = s.default;
  return { ...out, ...(saved?.[key] ?? {}) };
}
