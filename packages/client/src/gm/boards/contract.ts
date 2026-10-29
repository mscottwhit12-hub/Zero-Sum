/**
 * GAME BOARD CONTRACT v1.1 — binding for every board engineer. Changes go through the manager.
 * v1.1 (additive): BoardDef.recap, BoardProps.onfinish.
 * Svelte note: don't keep the `state` prop under that name (it clashes with the $state rune); destructure it as
 * `let { ctx, state: game, onchange, onfinish }: BoardProps<S> = $props();`
 *
 * A board lives in packages/client/src/gm/boards/<key>/ with:
 *   def.ts       export const def: BoardDef<YourState>   (pure logic, no Svelte)
 *   Board.svelte props: BoardProps<YourState>             (Svelte 5 runes)
 *   def.test.ts  vitest tests for def
 * The host (plumbing) shows Board.svelte in a GM tab while the game runs, saves `state` on the server,
 * sends score() to the crown, uses placements() to pre-fill the result, and exposes `settings` as GM settings.
 */

export interface BoardPlayer {
  id: number;
  name: string;
  color: string | null; // '#rrggbb'
  avatarPath: string | null;
  /** Seat number at the game's table (1-based, clockwise from top-left), or null if unseated / no table. */
  seat: number | null;
}

/** The game's table, for drawing players around it. null = game has no table. Sizes: fractions of plan width. */
export type BoardTable = { name: string; seats: number; w: number; h: number } | null;

export interface BoardContext {
  players: BoardPlayer[]; // participants of this game
  table: BoardTable;
  rerollsAllowed: boolean; // from the library game
  rerollsLeft: Record<number, number>; // player id -> tokens left tonight
  /** Spends one re-roll token for a player (host calls the existing API). */
  useReroll: (playerId: number) => Promise<unknown>;
  /** Current values of this board's settings (defaults merged with GM edits). */
  settings: Record<string, number>;
  /** v1.2: when the game started (epoch ms), null before start. */
  startedAt?: number | null;
  /** v1.2: planned end = start + the library game's length (epoch ms); null without a length. */
  endsAt?: number | null;
}

export interface BoardSetting {
  label: string; // shown on the GM Settings screen
  default: number;
  min: number;
  max: number;
  step?: number;
}

export interface BoardDef<S> {
  key: string; // 'risk'; same as the pack's "board" value
  label: string; // 'Risk'
  /** Every gameplay number the board uses. Never hardcode one. */
  settings?: Record<string, BoardSetting>;
  /** Fresh state at game start. Plain JSON only (no Date, Map, class). */
  init(ctx: BoardContext): S;
  /** Number per player for the crown; the pack's leadMode decides whether high or low leads. */
  score(state: S, ctx: BoardContext): Record<number, number>;
  /** Finish order for the result screen: groups of player ids, best first; a group of 2+ is a tie. */
  placements?(state: S, ctx: BoardContext): number[][];
  /** End-of-game recap, one private phone message per player; sent once when the result is submitted. */
  recap?(state: S, ctx: BoardContext): { playerId: number; text: string }[];
}

export interface BoardProps<S> {
  ctx: BoardContext;
  state: S;
  /** Call with a NEW state object on every edit. Must be safe to call twice with the same state. */
  onchange: (state: S) => void;
  /** Opens the result screen, pre-filled from placements(). For a "game over" button. */
  onfinish?: () => void;
}
