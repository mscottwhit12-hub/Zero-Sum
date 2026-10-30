/**
 * Clue board (classic rules, US edition): pure logic (no Svelte, no clock, no storage). Written to board-contract.ts v1.1.
 *
 * What it tracks: which suspect token each player has (optional), how many wrong accusations each player has made,
 * who is out, who solved it, who wears the crown (set by hand), re-rolls used, and one game history of accusations
 * and typed notes.
 *
 * THE SOLUTION ENVELOPE IS NEVER ENTERED OR STORED HERE. The GM judges an accusation at the real table and only taps
 * "wrong" or "correct". The optional suspect / weapon / room on an accusation is what the PLAYER said out loud.
 *
 * Crown (score):       manual. The GM crowns whoever looks closest to solving it (score 1; everyone else 0). Whoever has
 *                      solved the case scores 2, so the crown follows a correct accusation. Players who are out score 0.
 * Out:                 after `wrongLimit` wrong accusations (default 1, the classic rule) a player is out of the turn
 *                      order but still shows cards to others (the board just marks them "out").
 * Result (placements): the solver is 1st. Then everyone still in when the game ends, tied. Then the players who are
 *                      out, the one who went out LAST highest. If everyone accused wrong, nobody wins and the last
 *                      player out is 1st. Calling time with nobody solved: everyone still in ties for 1st.
 * First player:        Miss Scarlett's player (classic). If nobody has her, the earliest token in the classic order
 *                      (Scarlett, Mustard, White, Green, Peacock, Plum) that someone holds; with no tokens, lowest seat.
 *
 * Every operation takes the time as an argument and returns a NEW state; if nothing would change (or the move isn't
 * allowed) it returns the SAME object, so repeating an operation is harmless.
 */
import type { BoardContext, BoardDef, BoardSetting } from '../contract';

/** Typed notes are cut to this many characters (a text-box limit, not a gameplay number). */
export const NOTE_MAX = 280;

export interface CardDef {
  key: string;
  name: string;
}

/** US edition, in the classic order of play (Miss Scarlett first). */
export const SUSPECTS: CardDef[] = [
  { key: 'scarlett', name: 'Miss Scarlett' },
  { key: 'mustard', name: 'Colonel Mustard' },
  { key: 'white', name: 'Mrs. White' },
  { key: 'green', name: 'Mr. Green' },
  { key: 'peacock', name: 'Mrs. Peacock' },
  { key: 'plum', name: 'Professor Plum' },
];
export const WEAPONS: CardDef[] = [
  { key: 'candlestick', name: 'Candlestick' },
  { key: 'dagger', name: 'Dagger' },
  { key: 'leadPipe', name: 'Lead Pipe' },
  { key: 'revolver', name: 'Revolver' },
  { key: 'rope', name: 'Rope' },
  { key: 'wrench', name: 'Wrench' },
];
export const ROOMS: CardDef[] = [
  { key: 'kitchen', name: 'Kitchen' },
  { key: 'ballroom', name: 'Ballroom' },
  { key: 'conservatory', name: 'Conservatory' },
  { key: 'diningRoom', name: 'Dining Room' },
  { key: 'billiardRoom', name: 'Billiard Room' },
  { key: 'library', name: 'Library' },
  { key: 'lounge', name: 'Lounge' },
  { key: 'hall', name: 'Hall' },
  { key: 'study', name: 'Study' },
];

const nameFrom = (list: CardDef[], key: string | null | undefined, fallback: string): string => (key ? (list.find((c) => c.key === key)?.name ?? fallback) : fallback);
export const suspectName = (key: string | null | undefined): string => nameFrom(SUSPECTS, key, 'No suspect');
/** "Scarlett", "Mustard", … (last word of the suspect's name). */
export const suspectShort = (key: string | null | undefined): string => (key ? (suspectName(key).split(' ').pop() ?? '') : '');

/** Every gameplay number. Defaults are the classic rules. */
export const SETTINGS: Record<string, BoardSetting> = {
  wrongLimit: { label: 'Wrong accusations before a player is out', default: 1, min: 1, max: 5 },
  logMax: { label: 'History: most entries kept', default: 500, min: 50, max: 2000, step: 50 },
};

/** A setting's current value, falling back to its default. */
export function cfg(settings: Record<string, number> | undefined, key: string): number {
  const v = settings?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (SETTINGS[key]?.default ?? 0);
}

export const wrongLimit = (settings: Record<string, number> | undefined): number => Math.max(1, Math.floor(cfg(settings, 'wrongLimit')));

// ------------------------------------------------------------------ state

export interface CluePlayer {
  /** Suspect key (see SUSPECTS), or null = not recorded. */
  suspect: string | null;
  /** Wrong accusations made. */
  wrong: number;
  /** Out of the game (still shows cards at the real table). */
  out: boolean;
  outAt: number | null;
  /** 1 for the first player out, 2 for the next, … Later = placed higher. */
  order: number | null;
  rerollsUsed: number;
}

/** What the player SAID in an accusation. Never the solution. */
export interface Accusation {
  suspect?: string;
  weapon?: string;
  room?: string;
}

export type LogKind = 'note' | 'suspect' | 'wrong' | 'correct' | 'undo' | 'reroll' | 'crown';

export interface LogEntry {
  id: number;
  /** Epoch ms. */
  t: number;
  kind: LogKind;
  playerId: number | null;
  /** suspect: the suspect key now held (null = cleared). */
  token?: string | null;
  /** wrong / correct: what was said, if the GM entered it. */
  acc?: Accusation;
  /** wrong: this accusation put the player out. */
  out?: boolean;
  /** undo: which kind of entry was undone. */
  undone?: 'wrong' | 'correct';
  text?: string;
}

export interface ClueState {
  v: 1;
  players: Record<number, CluePlayer>;
  /** The player who made the correct accusation, or null. */
  winnerId: number | null;
  /** Who wears the crown by hand, or null. */
  leader: number | null;
  log: LogEntry[];
  /** Last used log id. */
  seq: number;
  /** How many players have gone out (never goes down, so order stays unique). */
  outCount: number;
}

const blank = (): CluePlayer => ({ suspect: null, wrong: 0, out: false, outAt: null, order: null, rerollsUsed: 0 });

/** A player's record; players the state doesn't know yet read as blank. */
export const pl = (s: ClueState, id: number): CluePlayer => s.players[id] ?? blank();

export function init(ctx: BoardContext): ClueState {
  const players: Record<number, CluePlayer> = {};
  for (const p of ctx.players) players[p.id] = blank();
  return { v: 1, players, winnerId: null, leader: null, log: [], seq: 0, outCount: 0 };
}

// ------------------------------------------------------------------ crown, placements, status

export function score(s: ClueState, ctx: BoardContext): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of ctx.players) {
    if (pl(s, p.id).out) out[p.id] = 0;
    else if (s.winnerId === p.id) out[p.id] = 2;
    else out[p.id] = s.leader === p.id ? 1 : 0;
  }
  return out;
}

function group(ids: number[], same: (a: number, b: number) => boolean): number[][] {
  const out: number[][] = [];
  for (const id of ids) {
    const last = out[out.length - 1];
    if (last && same(last[0]!, id)) last.push(id);
    else out.push([id]);
  }
  return out;
}

export function placements(s: ClueState, ctx: BoardContext): number[][] {
  const ids = [...ctx.players.map((p) => p.id)].sort((a, b) => a - b);
  const win = s.winnerId !== null && ids.includes(s.winnerId) ? s.winnerId : null;
  const out: number[][] = [];
  if (win !== null) out.push([win]);
  const still = ids.filter((id) => id !== win && !pl(s, id).out);
  if (still.length) out.push(still);
  const gone = ids.filter((id) => id !== win && pl(s, id).out).sort((x, y) => (pl(s, y).order ?? 0) - (pl(s, x).order ?? 0));
  out.push(...group(gone, (x, y) => (pl(s, x).order ?? 0) === (pl(s, y).order ?? 0)));
  return out;
}

export interface GameStatus {
  /** Players still in (not out). */
  alive: number[];
  /** The player who solved it, or null. */
  winnerId: number | null;
  /** Everyone is out and nobody solved it. */
  nobodyWins: boolean;
  over: boolean;
}

export function status(s: ClueState, ctx: BoardContext): GameStatus {
  const alive = ctx.players.filter((p) => !pl(s, p.id).out).map((p) => p.id);
  const winnerId = s.winnerId !== null && ctx.players.some((p) => p.id === s.winnerId) ? s.winnerId : null;
  const nobodyWins = winnerId === null && ctx.players.length > 0 && alive.length === 0;
  return { alive, winnerId, nobodyWins, over: winnerId !== null || nobodyWins };
}

/** Who moves first: the holder of the earliest suspect in the classic order; with no tokens, the lowest seat. */
export function firstPlayer(s: ClueState, ctx: BoardContext): { id: number; suspect: string | null } | null {
  if (!ctx.players.length) return null;
  for (const c of SUSPECTS) {
    const holder = ctx.players.find((p) => pl(s, p.id).suspect === c.key);
    if (holder) return { id: holder.id, suspect: c.key };
  }
  const bySeat = [...ctx.players].sort((a, b) => (a.seat ?? Number.MAX_SAFE_INTEGER) - (b.seat ?? Number.MAX_SAFE_INTEGER) || a.id - b.id);
  return { id: bySeat[0]!.id, suspect: null };
}

/** The player holding a suspect token, if any. */
export const suspectHolder = (s: ClueState, ctx: BoardContext, key: string): number | null => ctx.players.find((p) => pl(s, p.id).suspect === key)?.id ?? null;

// ------------------------------------------------------------------ operations

/** Adds any participants the state doesn't know yet (someone added after the game started). */
export function ensure(s: ClueState, ctx: BoardContext): ClueState {
  const missing = ctx.players.filter((p) => !s.players[p.id]);
  if (!missing.length) return s;
  const players = { ...s.players };
  for (const p of missing) players[p.id] = blank();
  return { ...s, players };
}

function addLog(s: ClueState, entry: Omit<LogEntry, 'id'>, ctx: BoardContext): ClueState {
  const max = Math.max(1, Math.floor(cfg(ctx.settings, 'logMax')));
  const id = s.seq + 1;
  const log = [...s.log, { ...entry, id }];
  return { ...s, seq: id, log: log.length > max ? log.slice(log.length - max) : log };
}

const putPlayer = (s: ClueState, pid: number, p: CluePlayer): ClueState => ({ ...s, players: { ...s.players, [pid]: p } });
const nameIn = (ctx: BoardContext, id: number | null): string => (id === null ? 'Nobody' : (ctx.players.find((p) => p.id === id)?.name ?? 'Another player'));
const known = (ctx: BoardContext, pid: number) => ctx.players.some((x) => x.id === pid);

/** Keeps only valid card keys; undefined when nothing was said. */
export function cleanAcc(acc: Accusation | undefined | null): Accusation | undefined {
  if (!acc) return undefined;
  const out: Accusation = {};
  if (acc.suspect && SUSPECTS.some((c) => c.key === acc.suspect)) out.suspect = acc.suspect;
  if (acc.weapon && WEAPONS.some((c) => c.key === acc.weapon)) out.weapon = acc.weapon;
  if (acc.room && ROOMS.some((c) => c.key === acc.room)) out.room = acc.room;
  return out.suspect || out.weapon || out.room ? out : undefined;
}

/** "Colonel Mustard, Rope, Library" (only the parts that were entered). */
export function accText(acc: Accusation | undefined): string {
  if (!acc) return '';
  return [acc.suspect ? nameFrom(SUSPECTS, acc.suspect, '') : '', acc.weapon ? nameFrom(WEAPONS, acc.weapon, '') : '', acc.room ? nameFrom(ROOMS, acc.room, '') : ''].filter(Boolean).join(', ');
}

/** Why a suspect can't be given to a player, in words; null = it can. */
export function suspectBlock(s: ClueState, ctx: BoardContext, pid: number, key: string | null): string | null {
  if (!known(ctx, pid)) return 'That player isn\u2019t in this game.';
  if (key === null) return null;
  if (!SUSPECTS.some((c) => c.key === key)) return 'Unknown suspect.';
  const holder = suspectHolder(s, ctx, key);
  if (holder !== null && holder !== pid) return `${suspectName(key)} is already ${nameIn(ctx, holder)}.`;
  return null;
}

/** Gives a player a suspect token (null clears it). */
export function assignSuspect(s: ClueState, ctx: BoardContext, pid: number, key: string | null, now: number): ClueState {
  if (suspectBlock(s, ctx, pid, key) !== null) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  if (p.suspect === key) return s1;
  return addLog(putPlayer(s1, pid, { ...p, suspect: key }), { t: now, kind: 'suspect', playerId: pid, token: key }, ctx);
}

/** Why a player can't make an accusation, in words; null = they can. */
export function accuseBlock(s: ClueState, ctx: BoardContext, pid: number): string | null {
  if (!known(ctx, pid)) return 'That player isn\u2019t in this game.';
  if (s.winnerId !== null && known(ctx, s.winnerId)) return 'The case is already solved.';
  if (pl(s, pid).out) return `${nameIn(ctx, pid)} is already out.`;
  return null;
}

/** A wrong accusation. At `wrongLimit` wrong accusations the player is out (but still shows cards). */
export function wrongAccusation(s: ClueState, ctx: BoardContext, pid: number, acc: Accusation | undefined, now: number): ClueState {
  if (accuseBlock(s, ctx, pid) !== null) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  const wrong = p.wrong + 1;
  const goesOut = wrong >= wrongLimit(ctx.settings);
  const a = cleanAcc(acc);
  let next: ClueState;
  if (goesOut) {
    const order = s1.outCount + 1;
    next = putPlayer({ ...s1, outCount: order, leader: s1.leader === pid ? null : s1.leader }, pid, { ...p, wrong, out: true, outAt: now, order });
  } else {
    next = putPlayer(s1, pid, { ...p, wrong });
  }
  return addLog(next, { t: now, kind: 'wrong', playerId: pid, out: goesOut, ...(a ? { acc: a } : {}) }, ctx);
}

/** A correct accusation: the player solved the case and the game is over. */
export function correctAccusation(s: ClueState, ctx: BoardContext, pid: number, acc: Accusation | undefined, now: number): ClueState {
  if (accuseBlock(s, ctx, pid) !== null) return s;
  const s1 = ensure(s, ctx);
  const a = cleanAcc(acc);
  return addLog({ ...s1, winnerId: pid }, { t: now, kind: 'correct', playerId: pid, ...(a ? { acc: a } : {}) }, ctx);
}

/** Why there is nothing to undo for a player, in words; null = something can be undone. */
export function undoBlock(s: ClueState, ctx: BoardContext, pid: number): string | null {
  if (!known(ctx, pid)) return 'That player isn\u2019t in this game.';
  if (s.winnerId === pid) return null;
  return pl(s, pid).wrong > 0 ? null : 'Nothing to undo.';
}

/**
 * Undoes a player's latest accusation: the solved case if they solved it, otherwise their last wrong accusation
 * (back in the game if that was what put them out).
 */
export function undoLast(s: ClueState, ctx: BoardContext, pid: number, now: number): ClueState {
  if (undoBlock(s, ctx, pid) !== null) return s;
  const s1 = ensure(s, ctx);
  if (s1.winnerId === pid) {
    // The undone 'correct' entry loses what was said, so a mis-tap can't leave a (possibly true) solution in the history.
    let at = -1;
    for (let i = s1.log.length - 1; i >= 0; i--) {
      const e = s1.log[i]!;
      if (e.kind === 'correct' && e.playerId === pid) {
        at = i;
        break;
      }
    }
    const log = at < 0 ? s1.log : s1.log.map((e, i) => (i === at ? { id: e.id, t: e.t, kind: e.kind, playerId: e.playerId } : e));
    return addLog({ ...s1, winnerId: null, log }, { t: now, kind: 'undo', playerId: pid, undone: 'correct' }, ctx);
  }
  const p = s1.players[pid]!;
  const wrong = p.wrong - 1;
  const back = p.out && wrong < wrongLimit(ctx.settings);
  const next = putPlayer(s1, pid, back ? { ...p, wrong, out: false, outAt: null, order: null } : { ...p, wrong });
  return addLog(next, { t: now, kind: 'undo', playerId: pid, undone: 'wrong' }, ctx);
}

/** Crowns a player by hand (crowning the current leader again, or null, clears the crown). Players who are out can't wear it. */
export function setLeader(s: ClueState, ctx: BoardContext, pid: number | null, now: number): ClueState {
  if (pid !== null && (!known(ctx, pid) || pl(s, pid).out)) return s;
  const target = pid === s.leader ? null : pid;
  if (target === s.leader) return s;
  return addLog(ensure({ ...s, leader: target }, ctx), { t: now, kind: 'crown', playerId: target }, ctx);
}

/** Records a re-roll the host has already spent (call only after `ctx.useReroll` succeeded). */
export function recordReroll(s: ClueState, ctx: BoardContext, pid: number, now: number): ClueState {
  if (!known(ctx, pid)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  return addLog(putPlayer(s1, pid, { ...p, rerollsUsed: p.rerollsUsed + 1 }), { t: now, kind: 'reroll', playerId: pid }, ctx);
}

/** A typed note in the history, optionally about one player. Empty notes are ignored. */
export function addNote(s: ClueState, ctx: BoardContext, text: string, playerId: number | null, now: number): ClueState {
  const clean = text.trim().slice(0, NOTE_MAX);
  if (!clean) return s;
  const pid = playerId !== null && known(ctx, playerId) ? playerId : null;
  return addLog(ensure(s, ctx), { t: now, kind: 'note', playerId: pid, text: clean }, ctx);
}

// ------------------------------------------------------------------ history text

export function describeEntry(e: LogEntry, nameOf: (id: number) => string): string {
  const who = e.playerId === null ? '' : nameOf(e.playerId);
  const said = accText(e.acc);
  switch (e.kind) {
    case 'note':
      return e.playerId === null ? (e.text ?? '') : `${who}: ${e.text ?? ''}`;
    case 'suspect':
      return e.token ? `${who} is ${suspectName(e.token)}` : `${who} no longer has a suspect`;
    case 'wrong':
      return `${who} made a wrong accusation${said ? ` (${said})` : ''}${e.out ? ' and is out (still shows cards)' : ''}`;
    case 'correct':
      return `${who} solved the case${said ? `: ${said}` : ''}`;
    case 'undo':
      return e.undone === 'correct' ? `${who}: undid the solved case` : `${who}: last wrong accusation undone`;
    case 'reroll':
      return `${who} used a re-roll`;
    case 'crown':
      return e.playerId === null ? 'Crown cleared' : `${who} is closest to solving (crown)`;
  }
}

// ------------------------------------------------------------------ recap

export const ordinal = (n: number): string => {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

export interface RecapRow {
  playerId: number;
  name: string;
  /** 1-based; tied players share a place. */
  place: number;
  tied: boolean;
  suspect: string | null;
  wrong: number;
  out: boolean;
  solved: boolean;
  rerollsUsed: number;
}

/** One row per player, best first: the end-of-game stats recap. */
export function recap(s: ClueState, ctx: BoardContext): RecapRow[] {
  const rows: RecapRow[] = [];
  let place = 1;
  for (const g of placements(s, ctx)) {
    for (const id of g) {
      const p = pl(s, id);
      rows.push({
        playerId: id,
        name: nameIn(ctx, id),
        place,
        tied: g.length > 1,
        suspect: p.suspect,
        wrong: p.wrong,
        out: p.out,
        solved: s.winnerId === id,
        rerollsUsed: p.rerollsUsed,
      });
    }
    place += g.length;
  }
  return rows;
}

/** What the winner said when they solved it (the latest correct accusation in the history). */
function solvedText(s: ClueState): string {
  for (let i = s.log.length - 1; i >= 0; i--) {
    const e = s.log[i]!;
    if (e.kind === 'correct' && e.playerId === s.winnerId) return accText(e.acc);
  }
  return '';
}

/** The recap as plain text for one player (a private phone message). */
export function recapText(r: RecapRow, s: ClueState, ctx: BoardContext): string {
  const lines = [`Clue recap for ${r.name}: ${ordinal(r.place)} place${r.tied ? ' (tied)' : ''}.`];
  if (r.suspect) lines.push(`You were ${suspectName(r.suspect)}.`);
  const said = solvedText(s);
  if (r.solved) lines.push(`You solved the case${said ? `: ${said}` : ''}.`);
  else {
    if (s.winnerId !== null && known(ctx, s.winnerId)) lines.push(`${nameIn(ctx, s.winnerId)} solved the case${said ? `: ${said}` : ''}.`);
    else if (!ctx.players.every((p) => pl(s, p.id).out)) lines.push('Nobody solved the case.');
    else lines.push('Everyone accused wrong, so nobody solved the case.');
    if (r.out) lines.push(`You went out after ${r.wrong} wrong accusation${r.wrong === 1 ? '' : 's'}.`);
    else lines.push('You were still in when the game ended.');
  }
  if (r.rerollsUsed) lines.push(`Re-rolls used: ${r.rerollsUsed}.`);
  return lines.join('\n');
}

export const def: BoardDef<ClueState> = {
  key: 'clue',
  label: 'Clue',
  settings: SETTINGS,
  init,
  score,
  placements,
  recap: (s, ctx) => recap(s, ctx).map((r) => ({ playerId: r.playerId, text: recapText(r, s, ctx) })),
};
