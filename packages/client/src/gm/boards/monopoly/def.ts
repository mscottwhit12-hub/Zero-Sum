/**
 * Monopoly board: pure logic (no Svelte, no clock, no storage). Written to board-contract.ts v1.1.
 *
 * What it tracks: which of the 28 properties each player owns, houses and hotels on the streets, an OPTIONAL cash
 * number per player (null = not tracked), bankrupt or not, re-rolls used, and one game history of every change and
 * typed note (auction prices are an optional detail on the history line).
 *
 * Crown (score):       assets = price of every owned property + cost of every house/hotel on them. Cash is ignored.
 *                      Bankrupt players score 0 (properties they still hold are not counted until the GM moves them).
 * Result (placements): survivors by assets, then cash (if the GM entered it), still tied = shared place; then the
 *                      bankrupt, most recently bankrupt first. Last player standing is 1st. If the GM calls time,
 *                      the same order applies.
 * Building rules (full): the whole colour set is needed, houses go up and come down evenly, and the bank has a
 *                      limited supply of houses and hotels (a setting). A property can't change hands while its
 *                      colour set has buildings. Mortgages are not tracked.
 *
 * Every operation takes the time as an argument and returns a NEW state; if nothing would change (or the move isn't
 * allowed) it returns the SAME object, so repeating an operation is harmless. `buildBlock` / `assignBlock` give the
 * reason in words when a move isn't allowed.
 */
import type { BoardContext, BoardDef, BoardSetting } from '../contract';

/** Typed notes are cut to this many characters (a text-box limit, not a gameplay number). */
export const NOTE_MAX = 280;

export type GroupKey = 'brown' | 'lightBlue' | 'pink' | 'orange' | 'red' | 'yellow' | 'green' | 'darkBlue' | 'railroad' | 'utility';

export interface GroupDef {
  key: GroupKey;
  label: string;
  /** Streets can have houses; railroads and utilities can't. */
  street: boolean;
  /** Setting holding the cost of one house (and of the hotel step) for this colour set. */
  houseSetting?: string;
  /** Official default house cost, used only to build the settings below. */
  defaultHouse?: number;
}

export const GROUPS: GroupDef[] = [
  { key: 'brown', label: 'Brown', street: true, houseSetting: 'houseBrown', defaultHouse: 50 },
  { key: 'lightBlue', label: 'Light blue', street: true, houseSetting: 'houseLightBlue', defaultHouse: 50 },
  { key: 'pink', label: 'Pink', street: true, houseSetting: 'housePink', defaultHouse: 100 },
  { key: 'orange', label: 'Orange', street: true, houseSetting: 'houseOrange', defaultHouse: 100 },
  { key: 'red', label: 'Red', street: true, houseSetting: 'houseRed', defaultHouse: 150 },
  { key: 'yellow', label: 'Yellow', street: true, houseSetting: 'houseYellow', defaultHouse: 150 },
  { key: 'green', label: 'Green', street: true, houseSetting: 'houseGreen', defaultHouse: 200 },
  { key: 'darkBlue', label: 'Dark blue', street: true, houseSetting: 'houseDarkBlue', defaultHouse: 200 },
  { key: 'railroad', label: 'Railroads', street: false },
  { key: 'utility', label: 'Utilities', street: false },
];

export interface PropDef {
  key: string;
  name: string;
  group: GroupKey;
}

/** [key, name, group, official default price] for the 28 properties, in board order. */
const PROP_DATA: [string, string, GroupKey, number][] = [
  ['mediterranean', 'Mediterranean Avenue', 'brown', 60],
  ['baltic', 'Baltic Avenue', 'brown', 60],
  ['reading', 'Reading Railroad', 'railroad', 200],
  ['oriental', 'Oriental Avenue', 'lightBlue', 100],
  ['vermont', 'Vermont Avenue', 'lightBlue', 100],
  ['connecticut', 'Connecticut Avenue', 'lightBlue', 120],
  ['stCharles', 'St. Charles Place', 'pink', 140],
  ['electric', 'Electric Company', 'utility', 150],
  ['states', 'States Avenue', 'pink', 140],
  ['virginia', 'Virginia Avenue', 'pink', 160],
  ['pennsylvaniaRR', 'Pennsylvania Railroad', 'railroad', 200],
  ['stJames', 'St. James Place', 'orange', 180],
  ['tennessee', 'Tennessee Avenue', 'orange', 180],
  ['newYork', 'New York Avenue', 'orange', 200],
  ['kentucky', 'Kentucky Avenue', 'red', 220],
  ['indiana', 'Indiana Avenue', 'red', 220],
  ['illinois', 'Illinois Avenue', 'red', 240],
  ['bo', 'B&O Railroad', 'railroad', 200],
  ['atlantic', 'Atlantic Avenue', 'yellow', 260],
  ['ventnor', 'Ventnor Avenue', 'yellow', 260],
  ['water', 'Water Works', 'utility', 150],
  ['marvinGardens', 'Marvin Gardens', 'yellow', 280],
  ['pacific', 'Pacific Avenue', 'green', 300],
  ['northCarolina', 'North Carolina Avenue', 'green', 300],
  ['pennsylvaniaAve', 'Pennsylvania Avenue', 'green', 320],
  ['shortLine', 'Short Line', 'railroad', 200],
  ['parkPlace', 'Park Place', 'darkBlue', 350],
  ['boardwalk', 'Boardwalk', 'darkBlue', 400],
];

export const PROPS: PropDef[] = PROP_DATA.map(([key, name, group]) => ({ key, name, group }));
const BY_KEY: Record<string, PropDef> = Object.fromEntries(PROPS.map((p) => [p.key, p]));
export const propByKey = (key: string): PropDef | undefined => BY_KEY[key];
export const groupOf = (g: GroupKey): GroupDef => GROUPS.find((x) => x.key === g)!;
export const propsInGroup = (g: GroupKey): PropDef[] => PROPS.filter((p) => p.group === g);

/** Setting that holds a property's price: one per street; one shared by the railroads; one by the utilities. */
export function priceSetting(p: PropDef): string {
  if (p.group === 'railroad') return 'priceRailroad';
  if (p.group === 'utility') return 'priceUtility';
  return `price_${p.key}`;
}

/** Every gameplay number. Defaults are the official Monopoly values. */
export const SETTINGS: Record<string, BoardSetting> = (() => {
  const s: Record<string, BoardSetting> = {};
  for (const [key, name, group, price] of PROP_DATA) {
    if (group !== 'railroad' && group !== 'utility') s[`price_${key}`] = { label: `Price: ${name}`, default: price, min: 0, max: 1000, step: 10 };
  }
  s.priceRailroad = { label: 'Price: each railroad', default: 200, min: 0, max: 1000, step: 10 };
  s.priceUtility = { label: 'Price: each utility', default: 150, min: 0, max: 1000, step: 10 };
  for (const g of GROUPS) {
    if (g.houseSetting) s[g.houseSetting] = { label: `House cost: ${g.label}`, default: g.defaultHouse ?? 0, min: 0, max: 1000, step: 10 };
  }
  s.housesBeforeHotel = { label: 'Houses on a street before it becomes a hotel', default: 4, min: 1, max: 8 };
  s.housesSupply = { label: 'Houses in the bank', default: 32, min: 1, max: 200 };
  s.hotelsSupply = { label: 'Hotels in the bank', default: 12, min: 1, max: 100 };
  s.startCash = { label: 'Starting cash (when the GM starts tracking a player\u2019s cash)', default: 1500, min: 0, max: 100000, step: 100 };
  s.cashMax = { label: 'Most cash one player can have', default: 99999, min: 1000, max: 999999, step: 1000 };
  s.mergeSeconds = { label: 'History: merge quick taps within (seconds)', default: 5, min: 0, max: 60 };
  s.logMax = { label: 'History: most entries kept', default: 500, min: 50, max: 2000, step: 50 };
  return s;
})();

/** A setting's current value, falling back to its default. */
export function cfg(settings: Record<string, number> | undefined, key: string): number {
  const v = settings?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (SETTINGS[key]?.default ?? 0);
}

/** Building level that means "hotel" (houses before the hotel, plus one). */
export const hotelLevel = (settings: Record<string, number>): number => Math.max(1, Math.floor(cfg(settings, 'housesBeforeHotel'))) + 1;

export const priceOf = (p: PropDef, settings: Record<string, number>): number => cfg(settings, priceSetting(p));
export const houseCostOf = (g: GroupKey, settings: Record<string, number>): number => {
  const h = groupOf(g).houseSetting;
  return h ? cfg(settings, h) : 0;
};

/** "$1,400". */
export const money = (n: number): string => `${n < 0 ? '-' : ''}$${String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

/** "No houses", "2 houses", "Hotel". */
export function levelLabel(level: number, hotel: number): string {
  if (level >= hotel) return 'Hotel';
  if (level <= 0) return 'No houses';
  return level === 1 ? '1 house' : `${level} houses`;
}

// ------------------------------------------------------------------ state

export interface MonoPlayer {
  /** null = the GM isn't tracking this player's cash. */
  cash: number | null;
  bankrupt: boolean;
  bankruptAt: number | null;
  /** 1 for the first player out, 2 for the next, … Later = placed higher. */
  order: number | null;
  rerollsUsed: number;
  /** Building levels at the moment of bankruptcy (buildings are sold back to the bank), so a mis-tap can be undone. */
  backup: { levels: Record<string, number> } | null;
}

export interface PropState {
  /** Player id, or null = the bank. */
  owner: number | null;
  /** 0 = none, 1..housesBeforeHotel = houses, housesBeforeHotel+1 = hotel. Streets only. */
  level: number;
}

export type LogKind = 'note' | 'property' | 'build' | 'cash' | 'bankrupt' | 'restore' | 'reroll';

export interface LogEntry {
  id: number;
  /** Epoch ms. */
  t: number;
  kind: LogKind;
  /** The player it's about: for 'property' the NEW owner (null = back to the bank). */
  playerId: number | null;
  prop?: string;
  /** build: levels; cash: amounts (null = not tracked). */
  from?: number | null;
  to?: number | null;
  /** property: the previous owner (null = the bank). */
  fromOwner?: number | null;
  /** property: the price paid at auction, if the GM entered one. */
  price?: number;
  /** restore: how many buildings came back. */
  moved?: number;
  text?: string;
}

export interface MonoState {
  v: 1;
  players: Record<number, MonoPlayer>;
  props: Record<string, PropState>;
  log: LogEntry[];
  /** Last used log id. */
  seq: number;
  /** How many bankruptcies have happened (never goes down, so order stays unique). */
  bankruptCount: number;
}

const blank = (): MonoPlayer => ({ cash: null, bankrupt: false, bankruptAt: null, order: null, rerollsUsed: 0, backup: null });

/** A player's record; players the state doesn't know yet read as blank. */
export const pl = (s: MonoState, id: number): MonoPlayer => s.players[id] ?? blank();
/** A property's record; unknown reads as unowned. */
export const po = (s: MonoState, key: string): PropState => s.props[key] ?? { owner: null, level: 0 };
/** Building level of a property, never above the hotel level. */
export const lvl = (s: MonoState, key: string, settings: Record<string, number>): number => {
  const p = BY_KEY[key];
  if (!p || !groupOf(p.group).street) return 0;
  return Math.min(Math.max(0, Math.floor(po(s, key).level)), hotelLevel(settings));
};

export function init(ctx: BoardContext): MonoState {
  const players: Record<number, MonoPlayer> = {};
  for (const p of ctx.players) players[p.id] = blank();
  const props: Record<string, PropState> = {};
  for (const p of PROPS) props[p.key] = { owner: null, level: 0 };
  return { v: 1, players, props, log: [], seq: 0, bankruptCount: 0 };
}

export const ownedBy = (s: MonoState, pid: number): PropDef[] => PROPS.filter((p) => po(s, p.key).owner === pid);

/** Assets = property prices + building costs. Cash is ignored; bankrupt players have none. */
export function assetsOf(s: MonoState, pid: number, settings: Record<string, number>): number {
  if (pl(s, pid).bankrupt) return 0;
  let sum = 0;
  for (const p of ownedBy(s, pid)) sum += priceOf(p, settings) + lvl(s, p.key, settings) * houseCostOf(p.group, settings);
  return sum;
}

export function score(s: MonoState, ctx: BoardContext): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of ctx.players) out[p.id] = assetsOf(s, p.id, ctx.settings);
  return out;
}

/** Houses and hotels in play and left in the bank. */
export function supply(s: MonoState, settings: Record<string, number>): { housesUsed: number; hotelsUsed: number; housesLeft: number; hotelsLeft: number } {
  const hotel = hotelLevel(settings);
  let housesUsed = 0;
  let hotelsUsed = 0;
  for (const p of PROPS) {
    const l = lvl(s, p.key, settings);
    if (l >= hotel) hotelsUsed++;
    else housesUsed += l;
  }
  return {
    housesUsed,
    hotelsUsed,
    housesLeft: Math.max(0, Math.floor(cfg(settings, 'housesSupply')) - housesUsed),
    hotelsLeft: Math.max(0, Math.floor(cfg(settings, 'hotelsSupply')) - hotelsUsed),
  };
}

/** True when `pid` owns every property of the group. */
export const holdsSet = (s: MonoState, g: GroupKey, pid: number): boolean => propsInGroup(g).every((p) => po(s, p.key).owner === pid);

/** Colour sets (or railroads / utilities) the player owns in full. */
export const setsOwned = (s: MonoState, pid: number): GroupDef[] => GROUPS.filter((g) => holdsSet(s, g.key, pid));

// ------------------------------------------------------------------ placements

function group(ids: number[], same: (a: number, b: number) => boolean): number[][] {
  const out: number[][] = [];
  for (const id of ids) {
    const last = out[out.length - 1];
    if (last && same(last[0]!, id)) last.push(id);
    else out.push([id]);
  }
  return out;
}

export function placements(s: MonoState, ctx: BoardContext): number[][] {
  const ids = [...ctx.players.map((p) => p.id)].sort((a, b) => a - b);
  const a = (id: number) => assetsOf(s, id, ctx.settings);
  const c = (id: number) => pl(s, id).cash ?? 0;
  const alive = ids.filter((id) => !pl(s, id).bankrupt).sort((x, y) => a(y) - a(x) || c(y) - c(x));
  const out = group(alive, (x, y) => a(x) === a(y) && c(x) === c(y));
  const dead = ids.filter((id) => pl(s, id).bankrupt).sort((x, y) => (pl(s, y).order ?? 0) - (pl(s, x).order ?? 0));
  out.push(...group(dead, (x, y) => (pl(s, x).order ?? 0) === (pl(s, y).order ?? 0)));
  return out;
}

// ------------------------------------------------------------------ status

export interface GameStatus {
  alive: number[];
  /** Set when exactly one player is left standing. */
  winnerId: number | null;
  over: boolean;
}

export function status(s: MonoState, ctx: BoardContext): GameStatus {
  const alive = ctx.players.filter((p) => !pl(s, p.id).bankrupt).map((p) => p.id);
  const winnerId = ctx.players.length > 1 && alive.length === 1 ? alive[0]! : null;
  return { alive, winnerId, over: winnerId !== null };
}

// ------------------------------------------------------------------ operations

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** Adds any participants the state doesn't know yet (someone added after the game started). */
export function ensure(s: MonoState, ctx: BoardContext): MonoState {
  const missing = ctx.players.filter((p) => !s.players[p.id]);
  if (!missing.length) return s;
  const players = { ...s.players };
  for (const p of missing) players[p.id] = blank();
  return { ...s, players };
}

const MERGEABLE: LogKind[] = ['build', 'cash'];

/** Appends a log entry. A change to the same number by the same player/property within `mergeSeconds` of the last entry is folded into it. */
function addLog(s: MonoState, entry: Omit<LogEntry, 'id'>, ctx: BoardContext): MonoState {
  const mergeMs = cfg(ctx.settings, 'mergeSeconds') * 1000;
  const max = Math.max(1, Math.floor(cfg(ctx.settings, 'logMax')));
  const last = s.log[s.log.length - 1];
  // Starting or stopping cash tracking (a null amount) is always its own line, never folded into a neighbour.
  const numeric = (e: { from?: number | null; to?: number | null }) => e.from != null && e.to != null;
  if (
    last &&
    MERGEABLE.includes(entry.kind) &&
    last.kind === entry.kind &&
    last.playerId === entry.playerId &&
    last.prop === entry.prop &&
    numeric(last) &&
    numeric(entry) &&
    entry.t - last.t <= mergeMs
  ) {
    const merged: LogEntry = { ...last, to: entry.to, t: entry.t };
    const log = merged.to === merged.from ? s.log.slice(0, -1) : [...s.log.slice(0, -1), merged];
    return { ...s, log };
  }
  const id = s.seq + 1;
  const log = [...s.log, { ...entry, id }];
  return { ...s, seq: id, log: log.length > max ? log.slice(log.length - max) : log };
}

const putPlayer = (s: MonoState, pid: number, p: MonoPlayer): MonoState => ({ ...s, players: { ...s.players, [pid]: p } });
const putProp = (s: MonoState, key: string, p: PropState): MonoState => ({ ...s, props: { ...s.props, [key]: p } });
const nameIn = (ctx: BoardContext, id: number | null): string => (id === null ? 'the bank' : (ctx.players.find((p) => p.id === id)?.name ?? 'Another player'));

/** Looks up an editable (known, still in) player; null if the operation should do nothing. */
function editable(s: MonoState, ctx: BoardContext, pid: number): { s: MonoState; p: MonoPlayer } | null {
  if (!ctx.players.some((x) => x.id === pid)) return null;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  return p.bankrupt ? null : { s: s1, p };
}

/** Sets a player's cash; null stops tracking it. Clamped to 0..cashMax. */
export function setCash(s: MonoState, ctx: BoardContext, pid: number, value: number | null, now: number): MonoState {
  const e = editable(s, ctx, pid);
  if (!e) return s;
  let v: number | null;
  if (value === null) v = null;
  else if (!Number.isFinite(value)) return s;
  else v = clampInt(value, 0, cfg(ctx.settings, 'cashMax'));
  if (v === e.p.cash) return e.s;
  return addLog(putPlayer(e.s, pid, { ...e.p, cash: v }), { t: now, kind: 'cash', playerId: pid, from: e.p.cash, to: v }, ctx);
}

/** Starts tracking a player's cash at the starting-cash setting (does nothing if already tracked). */
export function startCash(s: MonoState, ctx: BoardContext, pid: number, now: number): MonoState {
  const e = editable(s, ctx, pid);
  if (!e || e.p.cash !== null) return s;
  return setCash(s, ctx, pid, cfg(ctx.settings, 'startCash'), now);
}

/** Why a property can't change hands, in words; null = it can. */
export function assignBlock(s: MonoState, ctx: BoardContext, key: string, to: number | null): string | null {
  const p = BY_KEY[key];
  if (!p) return 'Unknown property.';
  if (to !== null) {
    if (!ctx.players.some((x) => x.id === to)) return 'That player isn\u2019t in this game.';
    if (pl(s, to).bankrupt) return 'That player is bankrupt.';
  }
  if (po(s, key).owner === to) return null;
  if (groupOf(p.group).street && propsInGroup(p.group).some((x) => lvl(s, x.key, ctx.settings) > 0)) {
    return `Sell all the buildings on the ${groupOf(p.group).label.toLowerCase()} set before ${p.name} changes hands.`;
  }
  return null;
}

/**
 * Gives a property to a player (to = null returns it to the bank). `price` is an optional auction price that only
 * goes into the history. Not allowed while the colour set has buildings.
 */
export function assign(s: MonoState, ctx: BoardContext, key: string, to: number | null, now: number, price?: number | null): MonoState {
  if (!BY_KEY[key] || assignBlock(s, ctx, key, to) !== null) return s;
  const s1 = ensure(s, ctx);
  const cur = po(s1, key);
  if (cur.owner === to) return s1;
  const paid = typeof price === 'number' && Number.isFinite(price) && price >= 0 ? Math.round(price) : undefined;
  const next = putProp(s1, key, { owner: to, level: 0 });
  return addLog(next, { t: now, kind: 'property', playerId: to, prop: key, fromOwner: cur.owner, ...(paid !== undefined ? { price: paid } : {}) }, ctx);
}

/** Why a building can't be added (dir +1) or sold (dir -1), in words; null = it can. */
export function buildBlock(s: MonoState, ctx: BoardContext, key: string, dir: 1 | -1): string | null {
  const p = BY_KEY[key];
  if (!p) return 'Unknown property.';
  const g = groupOf(p.group);
  if (!g.street) return 'Only streets can have houses.';
  const st = po(s, key);
  if (st.owner === null) return `Nobody owns ${p.name}.`;
  const owner = nameIn(ctx, st.owner);
  if (pl(s, st.owner).bankrupt) return `${owner} is bankrupt.`;
  if (!holdsSet(s, p.group, st.owner)) return `${owner} needs the whole ${g.label.toLowerCase()} set before building.`;
  const hotel = hotelLevel(ctx.settings);
  const houses = Math.floor(cfg(ctx.settings, 'housesBeforeHotel'));
  const cur = lvl(s, key, ctx.settings);
  const now = cur + dir;
  if (dir === 1 && cur >= hotel) return `${p.name} already has a hotel.`;
  if (dir === -1 && cur <= 0) return `${p.name} has no buildings to sell.`;
  const levels = propsInGroup(p.group).map((x) => (x.key === key ? now : lvl(s, x.key, ctx.settings)));
  if (Math.max(...levels) - Math.min(...levels) > 1) {
    return dir === 1 ? `Build evenly: add to the other ${g.label.toLowerCase()} properties first.` : `Sell evenly: sell from the other ${g.label.toLowerCase()} properties first.`;
  }
  const sup = supply(s, ctx.settings);
  if (dir === 1) {
    if (now === hotel && sup.hotelsLeft < 1) return 'No hotels left in the bank.';
    if (now < hotel && sup.housesLeft < 1) return 'No houses left in the bank.';
  } else if (cur === hotel && sup.housesLeft < houses) {
    return 'The bank doesn\u2019t have enough houses to replace this hotel.';
  }
  return null;
}

/** Adds (dir 1) or sells (dir -1) one building level on a street. Not allowed moves return the same state. */
export function buildStep(s: MonoState, ctx: BoardContext, key: string, dir: 1 | -1, now: number): MonoState {
  if (buildBlock(s, ctx, key, dir) !== null) return s;
  const s1 = ensure(s, ctx);
  const cur = lvl(s1, key, ctx.settings);
  const owner = po(s1, key).owner;
  const next = putProp(s1, key, { owner, level: cur + dir });
  return addLog(next, { t: now, kind: 'build', playerId: owner, prop: key, from: cur, to: cur + dir }, ctx);
}

/**
 * Marks a player bankrupt. Their buildings go back to the bank (so the supply is right); their properties stay
 * with them for the GM to move by hand. The last player standing can't go bankrupt.
 */
export function declareBankrupt(s: MonoState, ctx: BoardContext, pid: number, now: number): MonoState {
  const e = editable(s, ctx, pid);
  if (!e) return s;
  const alive = ctx.players.filter((x) => !e.s.players[x.id]!.bankrupt);
  if (alive.length <= 1) return e.s;
  const levels: Record<string, number> = {};
  let props = e.s.props;
  for (const p of ownedBy(e.s, pid)) {
    const l = lvl(e.s, p.key, ctx.settings);
    if (l > 0) {
      levels[p.key] = l;
      props = { ...props, [p.key]: { owner: pid, level: 0 } };
    }
  }
  const order = e.s.bankruptCount + 1;
  const next = putPlayer({ ...e.s, props, bankruptCount: order }, pid, { ...e.p, bankrupt: true, bankruptAt: now, order, backup: { levels } });
  return addLog(next, { t: now, kind: 'bankrupt', playerId: pid }, ctx);
}

/** Undoes a bankruptcy, putting back the buildings that still fit (on properties they still own, within the bank's supply). */
export function restore(s: MonoState, ctx: BoardContext, pid: number, now: number): MonoState {
  if (!ctx.players.some((x) => x.id === pid)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  if (!p.bankrupt) return s1;
  const hotel = hotelLevel(ctx.settings);
  let cur = s1;
  let back = 0;
  for (const prop of PROPS) {
    const want = p.backup?.levels[prop.key] ?? 0;
    if (want <= 0 || po(cur, prop.key).owner !== pid) continue;
    for (let l = Math.min(want, hotel); l > 0; l--) {
      const sup = supply(putProp(cur, prop.key, { owner: pid, level: l }), ctx.settings);
      const hotels = sup.hotelsUsed <= Math.floor(cfg(ctx.settings, 'hotelsSupply'));
      const houses = sup.housesUsed <= Math.floor(cfg(ctx.settings, 'housesSupply'));
      if (hotels && houses) {
        cur = putProp(cur, prop.key, { owner: pid, level: l });
        back += l;
        break;
      }
    }
  }
  const next = putPlayer(cur, pid, { ...p, bankrupt: false, bankruptAt: null, order: null, backup: null });
  return addLog(next, { t: now, kind: 'restore', playerId: pid, ...(back > 0 ? { moved: back } : {}) }, ctx);
}

/** Records a re-roll the host has already spent (call only after `ctx.useReroll` succeeded). */
export function recordReroll(s: MonoState, ctx: BoardContext, pid: number, now: number): MonoState {
  if (!ctx.players.some((x) => x.id === pid)) return s;
  const s1 = ensure(s, ctx);
  const p = s1.players[pid]!;
  return addLog(putPlayer(s1, pid, { ...p, rerollsUsed: p.rerollsUsed + 1 }), { t: now, kind: 'reroll', playerId: pid }, ctx);
}

/** A typed note in the history, optionally about one player. Empty notes are ignored. */
export function addNote(s: MonoState, ctx: BoardContext, text: string, playerId: number | null, now: number): MonoState {
  const clean = text.trim().slice(0, NOTE_MAX);
  if (!clean) return s;
  const pid = playerId !== null && ctx.players.some((x) => x.id === playerId) ? playerId : null;
  return addLog(ensure(s, ctx), { t: now, kind: 'note', playerId: pid, text: clean }, ctx);
}

// ------------------------------------------------------------------ history text

export function describeEntry(e: LogEntry, nameOf: (id: number) => string, hotel = 5): string {
  const who = e.playerId === null ? '' : nameOf(e.playerId);
  const prop = e.prop ? (BY_KEY[e.prop]?.name ?? 'a property') : '';
  const amt = (v: number | null | undefined) => (v === null || v === undefined ? 'not tracked' : money(v));
  switch (e.kind) {
    case 'note':
      return e.playerId === null ? (e.text ?? '') : `${who}: ${e.text ?? ''}`;
    case 'property': {
      const from = e.fromOwner == null ? null : nameOf(e.fromOwner);
      if (e.playerId === null) return from ? `${from} returned ${prop} to the bank` : `${prop} returned to the bank`;
      if (from === null) return e.price !== undefined ? `${who} won ${prop} at auction for ${money(e.price)}` : `${who} got ${prop} from the bank`;
      return `${who} took ${prop} from ${from}${e.price !== undefined ? ` for ${money(e.price)}` : ''}`;
    }
    case 'build':
      return `${who}: ${prop}, ${levelLabel(e.from ?? 0, hotel).toLowerCase()} \u2192 ${levelLabel(e.to ?? 0, hotel).toLowerCase()}`;
    case 'cash':
      return `${who}: cash ${amt(e.from)} \u2192 ${amt(e.to)}`;
    case 'bankrupt':
      return `${who} went bankrupt`;
    case 'restore':
      return `${who} is back in (bankruptcy undone${e.moved ? `, ${e.moved} building${e.moved === 1 ? '' : 's'} put back` : ''})`;
    case 'reroll':
      return `${who} used a re-roll`;
  }
}

// ------------------------------------------------------------------ recap

export interface RecapRow {
  playerId: number;
  name: string;
  /** 1-based; tied players share a place. */
  place: number;
  tied: boolean;
  assets: number;
  /** null = never tracked. */
  cash: number | null;
  properties: string[];
  /** Colour sets, railroads or utilities owned in full. */
  sets: string[];
  houses: number;
  hotels: number;
  bankrupt: boolean;
  auctionsWon: number;
  auctionSpent: number;
  rerollsUsed: number;
}

export const ordinal = (n: number): string => {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** One row per player, best first: the end-of-game stats recap. */
export function recap(s: MonoState, ctx: BoardContext): RecapRow[] {
  const name = (id: number) => ctx.players.find((p) => p.id === id)?.name ?? 'Another player';
  const hotel = hotelLevel(ctx.settings);
  const rows: RecapRow[] = [];
  let place = 1;
  for (const g of placements(s, ctx)) {
    for (const id of g) {
      const p = pl(s, id);
      const owned = ownedBy(s, id);
      const wins = s.log.filter((e) => e.kind === 'property' && e.playerId === id && e.price !== undefined);
      rows.push({
        playerId: id,
        name: name(id),
        place,
        tied: g.length > 1,
        assets: assetsOf(s, id, ctx.settings),
        cash: p.cash,
        properties: owned.map((x) => x.name),
        sets: p.bankrupt ? [] : setsOwned(s, id).map((x) => x.label),
        houses: owned.reduce((n, x) => (lvl(s, x.key, ctx.settings) < hotel ? n + lvl(s, x.key, ctx.settings) : n), 0),
        hotels: owned.filter((x) => lvl(s, x.key, ctx.settings) >= hotel).length,
        bankrupt: p.bankrupt,
        auctionsWon: wins.length,
        auctionSpent: wins.reduce((n, e) => n + (e.price ?? 0), 0),
        rerollsUsed: p.rerollsUsed,
      });
    }
    place += g.length;
  }
  return rows;
}

/** The recap as plain text for one player (a private phone message). */
export function recapText(r: RecapRow): string {
  const lines = [`Monopoly recap for ${r.name}: ${ordinal(r.place)} place${r.tied ? ' (tied)' : ''}.`];
  if (r.bankrupt) lines.push('Went bankrupt.');
  else lines.push(`Assets at the end: ${money(r.assets)}${r.cash !== null ? `, plus ${money(r.cash)} cash` : ''}.`);
  if (r.properties.length) lines.push(`Properties (${r.properties.length}): ${r.properties.join(', ')}.`);
  if (r.sets.length) lines.push(`Complete sets: ${r.sets.join(', ')}.`);
  if (r.houses || r.hotels) lines.push(`Buildings: ${[r.houses ? `${r.houses} house${r.houses === 1 ? '' : 's'}` : '', r.hotels ? `${r.hotels} hotel${r.hotels === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')}.`);
  if (r.auctionsWon) lines.push(`Won ${r.auctionsWon} auction${r.auctionsWon === 1 ? '' : 's'}, spending ${money(r.auctionSpent)}.`);
  if (r.rerollsUsed) lines.push(`Re-rolls used: ${r.rerollsUsed}.`);
  return lines.join('\n');
}

export const def: BoardDef<MonoState> = {
  key: 'monopoly',
  label: 'Monopoly',
  settings: SETTINGS,
  init,
  score,
  placements,
  recap: (s, ctx) => recap(s, ctx).map((r) => ({ playerId: r.playerId, text: recapText(r) })),
};
