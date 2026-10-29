import { describe, expect, it } from 'vitest';
import type { BoardContext, BoardPlayer } from '../contract';
import {
  GROUPS,
  NOTE_MAX,
  PROPS,
  SETTINGS,
  addNote,
  assetsOf,
  assign,
  assignBlock,
  buildBlock,
  buildStep,
  declareBankrupt,
  def,
  describeEntry,
  hotelLevel,
  init,
  levelLabel,
  money,
  ordinal,
  placements,
  pl,
  po,
  priceOf,
  propByKey,
  recap,
  recapText,
  recordReroll,
  restore,
  score,
  setCash,
  setsOwned,
  startCash,
  status,
  supply,
  type MonoState,
} from './def';

const player = (id: number, seat: number | null = id): BoardPlayer => ({ id, name: `P${id}`, color: null, avatarPath: null, seat });
const defaults = () => Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));
const mk = (n: number, settings: Record<string, number> = {}): BoardContext => ({
  players: Array.from({ length: n }, (_, i) => player(i + 1)),
  table: { name: 'T1', seats: 8, w: 0.3, h: 0.15 },
  rerollsAllowed: true,
  rerollsLeft: {},
  useReroll: async () => undefined,
  settings: { ...defaults(), ...settings },
});
const give = (s: MonoState, ctx: BoardContext, pid: number, keys: string[], now = 0) => keys.reduce((a, k) => assign(a, ctx, k, pid, now), s);
const BROWN = ['mediterranean', 'baltic'];
const DARK = ['parkPlace', 'boardwalk'];
const LIGHT = ['oriental', 'vermont', 'connecticut'];

describe('data and settings', () => {
  it('has the 28 properties with the right group sizes', () => {
    expect(PROPS).toHaveLength(28);
    expect(new Set(PROPS.map((p) => p.key)).size).toBe(28);
    const count = (g: string) => PROPS.filter((p) => p.group === g).length;
    expect(Object.fromEntries(GROUPS.map((g) => [g.key, count(g.key)]))).toEqual({
      brown: 2, lightBlue: 3, pink: 3, orange: 3, red: 3, yellow: 3, green: 3, darkBlue: 2, railroad: 4, utility: 2,
    });
  });
  it('has the official prices and house costs as defaults', () => {
    const c = mk(2);
    expect(priceOf(propByKey('boardwalk')!, c.settings)).toBe(400);
    expect(priceOf(propByKey('mediterranean')!, c.settings)).toBe(60);
    expect(priceOf(propByKey('reading')!, c.settings)).toBe(200);
    expect(priceOf(propByKey('water')!, c.settings)).toBe(150);
    expect(SETTINGS.houseBrown!.default).toBe(50);
    expect(SETTINGS.houseGreen!.default).toBe(200);
    expect(SETTINGS.housesSupply!.default).toBe(32);
    expect(SETTINGS.hotelsSupply!.default).toBe(12);
    expect(hotelLevel(c.settings)).toBe(5);
    expect(SETTINGS.startCash!.default).toBe(1500);
  });
  it('total price of the whole board is the official sum', () => {
    const c = mk(2);
    expect(PROPS.reduce((n, p) => n + priceOf(p, c.settings), 0)).toBe(
      60 * 2 + 100 * 2 + 120 + 140 * 2 + 160 + 180 * 2 + 200 + 220 * 2 + 240 + 260 * 2 + 280 + 300 * 2 + 320 + 350 + 400 + 200 * 4 + 150 * 2,
    );
  });
  it('every setting has a sane range', () => {
    for (const s of Object.values(SETTINGS)) {
      expect(s.min).toBeLessThanOrEqual(s.default);
      expect(s.default).toBeLessThanOrEqual(s.max);
    }
  });
  it('matches the key and label the pack points at', () => {
    expect(def.key).toBe('monopoly');
    expect(def.label).toBe('Monopoly');
  });
  it('formats money and levels', () => {
    expect(money(0)).toBe('$0');
    expect(money(1500)).toBe('$1,500');
    expect(money(1234567)).toBe('$1,234,567');
    expect(levelLabel(0, 5)).toBe('No houses');
    expect(levelLabel(1, 5)).toBe('1 house');
    expect(levelLabel(3, 5)).toBe('3 houses');
    expect(levelLabel(5, 5)).toBe('Hotel');
  });
});

describe('init', () => {
  it('starts with nothing owned, no cash tracked, plain JSON', () => {
    const ctx = mk(4);
    const s = init(ctx);
    expect(Object.keys(s.props)).toHaveLength(28);
    expect(Object.values(s.props).every((p) => p.owner === null && p.level === 0)).toBe(true);
    expect(Object.values(s.players).every((p) => p.cash === null && !p.bankrupt)).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  it('handles an empty game', () => {
    expect(init(mk(0)).players).toEqual({});
  });
});

describe('assets and score', () => {
  it('adds property prices and building costs, ignores cash', () => {
    const ctx = mk(3);
    let s = give(init(ctx), ctx, 1, ['boardwalk', 'reading']);
    expect(assetsOf(s, 1, ctx.settings)).toBe(600);
    s = setCash(s, ctx, 1, 5000, 0);
    expect(score(s, ctx)[1]).toBe(600);
  });
  it('counts buildings at their cost (a hotel is the house cost times the hotel level)', () => {
    const ctx = mk(2);
    let s = give(init(ctx), ctx, 1, DARK);
    s = buildStep(s, ctx, 'parkPlace', 1, 0);
    s = buildStep(s, ctx, 'boardwalk', 1, 0);
    expect(assetsOf(s, 1, ctx.settings)).toBe(350 + 400 + 2 * 200);
  });
  it('reads every number from settings', () => {
    const ctx = mk(2, { price_boardwalk: 500, houseDarkBlue: 100, priceRailroad: 250 });
    let s = give(init(ctx), ctx, 1, ['boardwalk', 'reading', 'parkPlace']);
    s = buildStep(s, ctx, 'parkPlace', 1, 0);
    expect(assetsOf(s, 1, ctx.settings)).toBe(500 + 250 + 350 + 100);
  });
  it('gives every player a score, 0 for the bankrupt and for owners of nothing', () => {
    const ctx = mk(3);
    let s = give(init(ctx), ctx, 2, ['boardwalk']);
    s = declareBankrupt(s, ctx, 2, 1);
    const sc = score(s, ctx);
    expect(Object.keys(sc)).toHaveLength(3);
    expect(sc).toEqual({ 1: 0, 2: 0, 3: 0 });
  });
  it('a bankrupt player\u2019s leftover properties are not counted', () => {
    const ctx = mk(3);
    let s = give(init(ctx), ctx, 1, ['boardwalk']);
    s = declareBankrupt(s, ctx, 1, 1);
    expect(po(s, 'boardwalk').owner).toBe(1);
    expect(assetsOf(s, 1, ctx.settings)).toBe(0);
  });
});

describe('assigning properties', () => {
  const ctx = mk(3);
  it('gives, moves, and returns properties; logs each', () => {
    let s = assign(init(ctx), ctx, 'boardwalk', 1, 100);
    expect(po(s, 'boardwalk').owner).toBe(1);
    s = assign(s, ctx, 'boardwalk', 2, 200);
    expect(po(s, 'boardwalk').owner).toBe(2);
    s = assign(s, ctx, 'boardwalk', null, 300);
    expect(po(s, 'boardwalk').owner).toBeNull();
    expect(s.log.map((e) => [e.playerId, e.fromOwner])).toEqual([[1, null], [2, 1], [null, 2]]);
  });
  it('is idempotent', () => {
    const once = assign(init(ctx), ctx, 'boardwalk', 1, 100);
    expect(assign(once, ctx, 'boardwalk', 1, 100)).toBe(once);
    const bank = init(ctx);
    expect(assign(bank, ctx, 'boardwalk', null, 100)).toBe(bank);
  });
  it('ignores unknown properties and unknown or bankrupt players', () => {
    const s = init(ctx);
    expect(assign(s, ctx, 'nope', 1, 0)).toBe(s);
    expect(assign(s, ctx, 'boardwalk', 99, 0)).toBe(s);
    const b = declareBankrupt(s, ctx, 2, 1);
    expect(assign(b, ctx, 'boardwalk', 2, 2)).toBe(b);
    expect(assignBlock(b, ctx, 'boardwalk', 2)).toBe('That player is bankrupt.');
  });
  it('keeps the auction price (optional) in the history only', () => {
    let s = assign(init(ctx), ctx, 'boardwalk', 1, 0, 450);
    expect(s.log[0]).toMatchObject({ kind: 'property', price: 450 });
    expect(assetsOf(s, 1, ctx.settings)).toBe(400); // printed price, not the auction price
    expect(pl(s, 1).cash).toBeNull(); // cash untouched
    s = assign(s, ctx, 'reading', 1, 1);
    expect(s.log[1]).not.toHaveProperty('price');
    s = assign(s, ctx, 'water', 1, 2, -5);
    s = assign(s, ctx, 'electric', 1, 3, NaN);
    expect(s.log[2]).not.toHaveProperty('price');
    expect(s.log[3]).not.toHaveProperty('price');
  });
  it('does not change cash even when cash is tracked', () => {
    let s = setCash(init(ctx), ctx, 1, 1500, 0);
    s = assign(s, ctx, 'boardwalk', 1, 1, 400);
    expect(pl(s, 1).cash).toBe(1500);
  });
  it('blocks a transfer while the colour set has buildings, with a reason', () => {
    let s = give(init(ctx), ctx, 1, BROWN);
    s = buildStep(s, ctx, 'mediterranean', 1, 0);
    expect(assignBlock(s, ctx, 'baltic', 2)).toMatch(/Sell all the buildings on the brown set/);
    expect(assign(s, ctx, 'baltic', 2, 1)).toBe(s);
    s = buildStep(s, ctx, 'mediterranean', -1, 2);
    expect(assign(s, ctx, 'baltic', 2, 3)).not.toBe(s);
  });
  it('railroads and utilities can always move', () => {
    const s = give(init(ctx), ctx, 1, ['reading', 'water']);
    expect(assign(s, ctx, 'reading', 2, 1)).not.toBe(s);
  });
});

describe('building rules', () => {
  const ctx = mk(3);
  it('needs the whole colour set, and says so', () => {
    const s = give(init(ctx), ctx, 1, ['mediterranean']);
    expect(buildBlock(s, ctx, 'mediterranean', 1)).toBe('P1 needs the whole brown set before building.');
    expect(buildStep(s, ctx, 'mediterranean', 1, 0)).toBe(s);
    const split = assign(give(init(ctx), ctx, 1, BROWN), ctx, 'baltic', 2, 1);
    expect(buildBlock(split, ctx, 'mediterranean', 1)).toMatch(/needs the whole brown set/);
  });
  it('refuses unowned properties, railroads, utilities', () => {
    const s = init(ctx);
    expect(buildBlock(s, ctx, 'boardwalk', 1)).toBe('Nobody owns Boardwalk.');
    expect(buildBlock(give(s, ctx, 1, ['reading']), ctx, 'reading', 1)).toBe('Only streets can have houses.');
  });
  it('builds evenly up and down', () => {
    let s = give(init(ctx), ctx, 1, LIGHT);
    s = buildStep(s, ctx, 'oriental', 1, 0);
    expect(buildBlock(s, ctx, 'oriental', 1)).toMatch(/Build evenly/);
    s = buildStep(s, ctx, 'vermont', 1, 0);
    s = buildStep(s, ctx, 'connecticut', 1, 0);
    s = buildStep(s, ctx, 'oriental', 1, 0);
    expect(po(s, 'oriental').level).toBe(2);
    expect(buildBlock(s, ctx, 'vermont', -1)).toMatch(/Sell evenly/);
    expect(buildBlock(s, ctx, 'oriental', -1)).toBeNull();
  });
  it('goes houses 1..4, then a hotel, then stops', () => {
    let s = give(init(ctx), ctx, 1, BROWN);
    for (let i = 0; i < 5; i++) {
      s = buildStep(s, ctx, 'mediterranean', 1, i * 10000);
      s = buildStep(s, ctx, 'baltic', 1, i * 10000 + 1);
    }
    expect(po(s, 'mediterranean').level).toBe(5);
    expect(buildBlock(s, ctx, 'mediterranean', 1)).toBe('Mediterranean Avenue already has a hotel.');
    expect(buildBlock(s, ctx, 'baltic', -1)).toBeNull();
  });
  it('can\u2019t sell what isn\u2019t there', () => {
    const s = give(init(ctx), ctx, 1, BROWN);
    expect(buildBlock(s, ctx, 'baltic', -1)).toBe('Baltic Avenue has no buildings to sell.');
  });
  it('is bounded by the bank\u2019s houses and hotels (settings)', () => {
    const c = mk(3, { housesSupply: 2, hotelsSupply: 1 });
    let s = give(init(c), c, 1, BROWN);
    s = buildStep(s, c, 'mediterranean', 1, 0);
    s = buildStep(s, c, 'baltic', 1, 0);
    expect(supply(s, c.settings)).toMatchObject({ housesUsed: 2, housesLeft: 0 });
    expect(buildBlock(s, c, 'mediterranean', 1)).toBe('No houses left in the bank.');
    s = give(s, c, 2, ['oriental']); // someone else's property doesn't matter
    const s2 = give(init(c), c, 1, BROWN);
    expect(buildBlock(s2, c, 'baltic', 1)).toBeNull();
  });
  it('a hotel takes a hotel from the bank and gives the four houses back', () => {
    const c = mk(3, { hotelsSupply: 1, housesSupply: 8 });
    let s = give(init(c), c, 1, BROWN);
    for (let i = 0; i < 4; i++) {
      s = buildStep(s, c, 'mediterranean', 1, i * 10000);
      s = buildStep(s, c, 'baltic', 1, i * 10000 + 1);
    }
    expect(supply(s, c.settings).housesLeft).toBe(0);
    s = buildStep(s, c, 'mediterranean', 1, 90000); // 4 -> hotel
    expect(supply(s, c.settings)).toMatchObject({ hotelsUsed: 1, hotelsLeft: 0, housesUsed: 4, housesLeft: 4 });
    expect(buildBlock(s, c, 'baltic', 1)).toBe('No hotels left in the bank.');
  });
  it('selling a hotel needs enough houses in the bank to replace it', () => {
    const c = mk(3, { housesSupply: 4 });
    const s = give(init(c), c, 1, BROWN);
    // a hotel on Baltic while Mediterranean's four houses use up the whole supply of 4
    const forced = { ...s, props: { ...s.props, baltic: { owner: 1, level: 5 }, mediterranean: { owner: 1, level: 4 } } };
    expect(supply(forced, c.settings)).toMatchObject({ housesUsed: 4, housesLeft: 0, hotelsUsed: 1 });
    expect(buildBlock(forced, c, 'baltic', -1)).toBe('The bank doesn\u2019t have enough houses to replace this hotel.');
    expect(buildStep(forced, c, 'baltic', -1, 0)).toBe(forced);
    // with enough houses back in the bank it is allowed
    const roomy = mk(3, { housesSupply: 8 });
    expect(buildBlock(forced, roomy, 'baltic', -1)).toBeNull();
  });
  it('is idempotent and never mutates its input', () => {
    const s = give(init(ctx), ctx, 1, BROWN);
    const copy = JSON.stringify(s);
    const once = buildStep(s, ctx, 'mediterranean', 1, 0);
    expect(JSON.stringify(s)).toBe(copy);
    // the same (now illegal) step again is refused: evenness
    expect(buildStep(once, ctx, 'mediterranean', 1, 0)).toBe(once);
  });
  it('a moved property starts with no buildings', () => {
    let s = give(init(ctx), ctx, 1, ['reading']);
    s = assign(s, ctx, 'reading', 2, 1);
    expect(po(s, 'reading').level).toBe(0);
  });
  it('treats an out-of-range stored level as the hotel', () => {
    const s = give(init(ctx), ctx, 1, BROWN);
    const odd = { ...s, props: { ...s.props, baltic: { owner: 1, level: 99 } } };
    expect(assetsOf(odd, 1, ctx.settings)).toBe(60 + 60 + 5 * 50);
  });
});

describe('cash (optional)', () => {
  const ctx = mk(3);
  it('is not tracked until the GM starts it, at the starting-cash setting', () => {
    let s = init(ctx);
    expect(pl(s, 1).cash).toBeNull();
    s = startCash(s, ctx, 1, 0);
    expect(pl(s, 1).cash).toBe(1500);
    expect(startCash(s, ctx, 1, 1)).toBe(s);
    const c2 = mk(3, { startCash: 2000 });
    expect(pl(startCash(init(c2), c2, 1, 0), 1).cash).toBe(2000);
  });
  it('edits, clamps, stops tracking, and ignores junk', () => {
    let s = startCash(init(ctx), ctx, 1, 0);
    s = setCash(s, ctx, 1, 1380, 1);
    expect(pl(s, 1).cash).toBe(1380);
    expect(pl(setCash(s, ctx, 1, -50, 2), 1).cash).toBe(0);
    expect(pl(setCash(s, ctx, 1, 10_000_000, 2), 1).cash).toBe(99999);
    expect(setCash(s, ctx, 1, NaN, 2)).toBe(s);
    expect(setCash(s, ctx, 1, 1380, 2)).toBe(s);
    expect(pl(setCash(s, ctx, 1, null, 2), 1).cash).toBeNull();
    expect(setCash(s, ctx, 99, 5, 2)).toBe(s);
  });
  it('merges quick taps into one history line', () => {
    let s = startCash(init(ctx), ctx, 1, 0);
    s = setCash(s, ctx, 1, 1510, 1000);
    s = setCash(s, ctx, 1, 1520, 2000);
    s = setCash(s, ctx, 1, 1620, 3000);
    expect(s.log).toHaveLength(2); // start + one merged change
    expect(s.log[1]).toMatchObject({ from: 1500, to: 1620 });
  });
  it('is blocked for bankrupt players', () => {
    let s = declareBankrupt(init(ctx), ctx, 2, 0);
    expect(setCash(s, ctx, 2, 50, 1)).toBe(s);
  });
});

describe('bankruptcy', () => {
  const ctx = mk(4);
  it('marks the player, keeps their properties for the GM to move, and clears their buildings', () => {
    let s = give(init(ctx), ctx, 1, DARK);
    s = buildStep(s, ctx, 'parkPlace', 1, 0);
    s = buildStep(s, ctx, 'boardwalk', 1, 0);
    const before = supply(s, ctx.settings).housesUsed;
    expect(before).toBe(2);
    s = declareBankrupt(s, ctx, 1, 5000);
    expect(pl(s, 1)).toMatchObject({ bankrupt: true, bankruptAt: 5000, order: 1 });
    expect(po(s, 'parkPlace')).toEqual({ owner: 1, level: 0 });
    expect(po(s, 'boardwalk')).toEqual({ owner: 1, level: 0 });
    expect(supply(s, ctx.settings).housesUsed).toBe(0);
    expect(s.log.at(-1)).toMatchObject({ kind: 'bankrupt', playerId: 1 });
  });
  it('lets the GM hand the leftover properties on', () => {
    let s = give(init(ctx), ctx, 1, DARK);
    s = declareBankrupt(s, ctx, 1, 1);
    s = assign(s, ctx, 'parkPlace', 2, 2);
    s = assign(s, ctx, 'boardwalk', null, 3);
    expect(assetsOf(s, 2, ctx.settings)).toBe(350);
    expect(po(s, 'boardwalk').owner).toBeNull();
  });
  it('is idempotent', () => {
    const once = declareBankrupt(init(ctx), ctx, 2, 5);
    expect(declareBankrupt(once, ctx, 2, 6)).toBe(once);
  });
  it('can be undone, restoring buildings that still fit; twice is harmless', () => {
    let s = give(init(ctx), ctx, 1, BROWN);
    s = buildStep(s, ctx, 'mediterranean', 1, 0);
    s = buildStep(s, ctx, 'baltic', 1, 0);
    s = declareBankrupt(s, ctx, 1, 100);
    const back = restore(s, ctx, 1, 200);
    expect(pl(back, 1)).toMatchObject({ bankrupt: false, order: null, backup: null });
    expect(po(back, 'mediterranean').level).toBe(1);
    expect(po(back, 'baltic').level).toBe(1);
    expect(back.log.at(-1)).toMatchObject({ kind: 'restore', moved: 2 });
    expect(restore(back, ctx, 1, 300)).toBe(back);
  });
  it('does not restore buildings on a property that was moved on', () => {
    let s = give(init(ctx), ctx, 1, BROWN);
    s = buildStep(s, ctx, 'mediterranean', 1, 0);
    s = buildStep(s, ctx, 'baltic', 1, 0);
    s = declareBankrupt(s, ctx, 1, 100);
    s = assign(s, ctx, 'baltic', 2, 150);
    const back = restore(s, ctx, 1, 200);
    expect(po(back, 'mediterranean').level).toBe(1);
    expect(po(back, 'baltic')).toEqual({ owner: 2, level: 0 });
  });
  it('restore respects the bank\u2019s supply', () => {
    const c = mk(4, { housesSupply: 2 });
    let s = give(init(c), c, 1, BROWN);
    s = buildStep(s, c, 'mediterranean', 1, 0);
    s = buildStep(s, c, 'baltic', 1, 0);
    s = declareBankrupt(s, c, 1, 1);
    s = give(s, c, 2, LIGHT);
    s = buildStep(s, c, 'oriental', 1, 2);
    s = buildStep(s, c, 'vermont', 1, 2);
    const back = restore(s, c, 1, 3);
    expect(supply(back, c.settings).housesUsed).toBeLessThanOrEqual(2);
    expect(po(back, 'mediterranean').level).toBe(0);
  });
  it('keeps the order unique after an undo', () => {
    let s = init(ctx);
    s = declareBankrupt(s, ctx, 2, 1);
    s = declareBankrupt(s, ctx, 3, 2);
    s = restore(s, ctx, 2, 3);
    s = declareBankrupt(s, ctx, 2, 4);
    expect(pl(s, 3).order).toBe(2);
    expect(pl(s, 2).order).toBe(3);
  });
  it('will not bankrupt the last player standing', () => {
    let s = init(ctx);
    s = declareBankrupt(s, ctx, 2, 1);
    s = declareBankrupt(s, ctx, 3, 2);
    s = declareBankrupt(s, ctx, 4, 3);
    expect(status(s, ctx)).toEqual({ alive: [1], winnerId: 1, over: true });
    expect(declareBankrupt(s, ctx, 1, 4)).toBe(s);
  });
  it('blocks building and the owner of nothing can\u2019t build', () => {
    let s = give(init(ctx), ctx, 1, BROWN);
    s = declareBankrupt(s, ctx, 1, 1);
    expect(buildBlock(s, ctx, 'mediterranean', 1)).toBe('P1 is bankrupt.');
  });
});

describe('status', () => {
  it('has no winner while two or more are in, nor in a one-player game', () => {
    expect(status(init(mk(4)), mk(4))).toMatchObject({ winnerId: null, over: false });
    expect(status(init(mk(1)), mk(1)).over).toBe(false);
  });
});

describe('placements', () => {
  it('ranks survivors by assets, then cash, then shares a place', () => {
    const ctx = mk(5);
    let s = init(ctx);
    s = give(s, ctx, 1, ['boardwalk']); // 400
    s = give(s, ctx, 2, ['parkPlace']); // 350
    s = give(s, ctx, 3, ['reading', 'electric']); // 350 as well
    s = give(s, ctx, 4, ['reading'.replace('reading', 'pennsylvaniaRR')]); // 200
    s = setCash(s, ctx, 2, 100, 0);
    s = setCash(s, ctx, 3, 900, 0);
    expect(placements(s, ctx)).toEqual([[1], [3], [2], [4], [5]]);
  });
  it('untracked cash counts as nothing for the tie-break, so equal assets with no cash share a place', () => {
    const ctx = mk(3);
    let s = give(init(ctx), ctx, 1, ['reading']);
    s = give(s, ctx, 2, ['pennsylvaniaRR']);
    expect(placements(s, ctx)).toEqual([[1, 2], [3]]);
  });
  it('puts the bankrupt behind the survivors, latest bankrupt first', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = declareBankrupt(s, ctx, 3, 1);
    s = declareBankrupt(s, ctx, 2, 2);
    s = give(s, ctx, 1, ['boardwalk']);
    expect(placements(s, ctx)).toEqual([[1], [4], [2], [3]]);
  });
  it('a finished game: last player standing is first', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = declareBankrupt(s, ctx, 4, 1);
    s = declareBankrupt(s, ctx, 1, 2);
    s = declareBankrupt(s, ctx, 3, 3);
    expect(placements(s, ctx)).toEqual([[2], [3], [1], [4]]);
  });
  it('includes every player exactly once', () => {
    const ctx = mk(6);
    let s = declareBankrupt(init(ctx), ctx, 5, 1);
    expect(placements(s, ctx).flat().sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('works with players the state has not seen', () => {
    const ctx = mk(3);
    expect(placements({ v: 1, players: {}, props: {}, log: [], seq: 0, bankruptCount: 0 }, ctx)).toEqual([[1, 2, 3]]);
  });
});

describe('sets', () => {
  it('lists the sets a player owns in full', () => {
    const ctx = mk(2);
    const s = give(init(ctx), ctx, 1, [...BROWN, 'water', 'electric']);
    expect(setsOwned(s, 1).map((g) => g.key)).toEqual(['brown', 'utility']);
  });
});

describe('history', () => {
  const ctx = mk(4);
  const name = (id: number) => `P${id}`;
  it('merges quick building taps on the same property only', () => {
    let s = give(init(ctx), ctx, 1, BROWN);
    s = buildStep(s, ctx, 'mediterranean', 1, 1000);
    s = buildStep(s, ctx, 'baltic', 1, 1500);
    s = buildStep(s, ctx, 'mediterranean', 1, 2000);
    expect(s.log.filter((e) => e.kind === 'build')).toHaveLength(3);
  });
  it('drops a build entry that nets to nothing', () => {
    let s = give(init(ctx), ctx, 1, BROWN);
    const n = s.log.length;
    s = buildStep(s, ctx, 'mediterranean', 1, 1000);
    s = buildStep(s, ctx, 'mediterranean', -1, 1500);
    expect(s.log).toHaveLength(n);
  });
  it('keeps ids unique and trims to logMax', () => {
    const c = mk(2, { logMax: 50, mergeSeconds: 0 });
    let s = init(c);
    for (let i = 0; i < 70; i++) s = addNote(s, c, `n${i}`, null, i);
    expect(s.log).toHaveLength(50);
    expect(s.log[0]!.text).toBe('n20');
    expect(new Set(s.log.map((e) => e.id)).size).toBe(50);
  });
  it('records trimmed, length-limited notes, about a player or the whole game', () => {
    let s = init(ctx);
    s = addNote(s, ctx, '  free parking jackpot  ', 1, 5);
    s = addNote(s, ctx, 'x'.repeat(NOTE_MAX + 40), null, 6);
    expect(s.log[0]).toMatchObject({ text: 'free parking jackpot', playerId: 1 });
    expect(s.log[1]!.text).toHaveLength(NOTE_MAX);
    expect(addNote(s, ctx, '  ', null, 7)).toBe(s);
    expect(addNote(s, ctx, 'hi', 99, 8).log.at(-1)!.playerId).toBeNull();
  });
  it('describes entries in words', () => {
    let s = init(ctx);
    s = assign(s, ctx, 'boardwalk', 1, 1, 450);
    s = assign(s, ctx, 'parkPlace', 1, 2);
    s = assign(s, ctx, 'reading', 2, 3);
    s = assign(s, ctx, 'reading', 3, 4, 120);
    s = assign(s, ctx, 'reading', null, 5);
    s = buildStep(s, ctx, 'parkPlace', 1, 100000);
    s = startCash(s, ctx, 1, 200000);
    s = setCash(s, ctx, 1, null, 300000);
    s = declareBankrupt(s, ctx, 2, 400000);
    s = restore(s, ctx, 2, 500000);
    s = recordReroll(s, ctx, 4, 600000);
    s = addNote(s, ctx, 'peace', 1, 700000);
    expect(s.log.map((e) => describeEntry(e, name, 5))).toEqual([
      'P1 won Boardwalk at auction for $450',
      'P1 got Park Place from the bank',
      'P2 got Reading Railroad from the bank',
      'P3 took Reading Railroad from P2 for $120',
      'P3 returned Reading Railroad to the bank',
      'P1: Park Place, no houses \u2192 1 house',
      'P1: cash not tracked \u2192 $1,500',
      'P1: cash $1,500 \u2192 not tracked',
      'P2 went bankrupt',
      'P2 is back in (bankruptcy undone)',
      'P4 used a re-roll',
      'P1: peace',
    ]);
  });
});

describe('re-rolls', () => {
  it('counts a re-roll that was spent', () => {
    const ctx = mk(4);
    const s = recordReroll(init(ctx), ctx, 3, 9);
    expect(pl(s, 3).rerollsUsed).toBe(1);
    expect(recordReroll(s, ctx, 99, 9)).toBe(s);
  });
});

describe('recap', () => {
  const ctx = mk(4);
  const build = (): MonoState => {
    let s = init(ctx);
    s = assign(s, ctx, 'boardwalk', 1, 1, 450);
    s = assign(s, ctx, 'parkPlace', 1, 2, 380);
    s = assign(s, ctx, 'reading', 1, 3);
    s = buildStep(s, ctx, 'parkPlace', 1, 100000);
    s = startCash(s, ctx, 1, 200000);
    s = setCash(s, ctx, 1, 700, 300000);
    s = recordReroll(s, ctx, 1, 400000);
    s = assign(s, ctx, 'water', 2, 5);
    s = declareBankrupt(s, ctx, 3, 6);
    s = declareBankrupt(s, ctx, 4, 7);
    return s;
  };
  it('lists every player, best first', () => {
    expect(recap(build(), ctx).map((r) => [r.playerId, r.place])).toEqual([[1, 1], [2, 2], [4, 3], [3, 4]]);
  });
  it('fills in the stats', () => {
    const [w, p2, , out] = recap(build(), ctx);
    expect(w).toMatchObject({
      name: 'P1', assets: 400 + 350 + 200 + 200, cash: 700, sets: ['Dark blue'], houses: 1, hotels: 0, auctionsWon: 2, auctionSpent: 830, rerollsUsed: 1, bankrupt: false,
    });
    expect(w!.properties).toEqual(['Reading Railroad', 'Park Place', 'Boardwalk']);
    expect(p2).toMatchObject({ assets: 150, cash: null, sets: [] });
    expect(out).toMatchObject({ bankrupt: true, assets: 0 });
  });
  it('shared places skip ahead', () => {
    const c = mk(4);
    let s = give(init(c), c, 1, ['reading']);
    s = give(s, c, 2, ['pennsylvaniaRR']);
    expect(recap(s, c).map((r) => r.place)).toEqual([1, 1, 3, 3]);
  });
  it('writes a private phone message per player through the contract hook', () => {
    const msgs = def.recap!(build(), ctx);
    expect(msgs.map((m) => m.playerId)).toEqual([1, 2, 4, 3]);
    expect(msgs[0]!.text).toContain('Monopoly recap for P1: 1st place.');
    expect(msgs[0]!.text).toContain('Assets at the end: $1,150, plus $700 cash.');
    expect(msgs[0]!.text).toContain('Complete sets: Dark blue.');
    expect(msgs[0]!.text).toContain('Buildings: 1 house.');
    expect(msgs[0]!.text).toContain('Won 2 auctions, spending $830.');
    expect(msgs[3]!.text).toContain('Went bankrupt.');
    expect(msgs[3]!.text).not.toContain('Assets at the end');
  });
  it('skips lines with nothing to say', () => {
    const rows = recap(init(mk(2)), mk(2));
    const t = recapText(rows[0]!);
    expect(t).toContain('Assets at the end: $0.');
    expect(t).not.toContain('Properties');
    expect(t).not.toContain('Buildings');
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
  });
});

describe('state is plain JSON throughout', () => {
  it('survives a save and load after a whole game', () => {
    const ctx = mk(4);
    let s = init(ctx);
    s = assign(s, ctx, 'mediterranean', 1, 1, 70);
    s = assign(s, ctx, 'baltic', 1, 2);
    s = buildStep(s, ctx, 'mediterranean', 1, 3);
    s = startCash(s, ctx, 1, 4);
    s = declareBankrupt(s, ctx, 2, 5);
    s = addNote(s, ctx, 'deal', 1, 6);
    const loaded = JSON.parse(JSON.stringify(s)) as MonoState;
    expect(loaded).toEqual(s);
    expect(placements(loaded, ctx)).toEqual(placements(s, ctx));
    expect(score(loaded, ctx)).toEqual(score(s, ctx));
    expect(def.recap!(loaded, ctx)).toEqual(def.recap!(s, ctx));
  });
});
