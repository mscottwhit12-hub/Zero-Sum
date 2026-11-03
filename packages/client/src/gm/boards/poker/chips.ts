/**
 * Chip plan: how many chips of each colour every player gets, from the chips the GM owns, the players, the buy-in
 * and the share of chips handed to players (the rest stays in the bank for rebuys). Pure maths, no Svelte.
 *
 * Units: a "point" is the smallest money unit the board counts in (default 100 points = $1 or 1 gold, so a $20 buy-in
 * is a 2,000-point stack). The stack always equals the buy-in when the chips allow it; every player gets exactly the same.
 *
 * Real-poker conventions used:
 *  - Chip values come from the standard 1-5-10-25-50-100-250-500-1000... ladder, picked by how many colours there are
 *    (2 colours use two widely spaced values, 4 colours use the 1/10/50/250 style spread, and so on), listed lowest first.
 *  - The smallest chip is about the first small blind (stack / 200), so every blind can be paid exactly.
 *  - Bigger chips carry more of the stack's value; the smallest chips are at least four small blinds so change is easy.
 *  - Counts are round where possible (5s and 10s once a colour has 10 or more chips).
 * The search is an exact optimisation (dynamic programming), so the same inputs always give the same answer.
 */

/** Most colours the plan handles (a layout limit, not a gameplay number). */
export const MAX_COLOURS = 8;
/** Colour names offered as suggestions when typing. */
export const COLOUR_NAMES = ['white', 'red', 'blue', 'green', 'black', 'purple', 'yellow', 'grey'];

export interface ChipColour {
  name: string;
  /** How many chips of this colour the GM owns. */
  count: number;
  /** Value of one chip in points; null = let the plan choose. */
  value: number | null;
}

export interface PlanInput {
  /** Listed lowest value first. */
  colours: ChipColour[];
  players: number;
  /** Buy-in per player, in dollars or gold. */
  buyIn: number;
  /** Points per dollar / per gold (100 = points are cents). */
  pointsPerUnit: number;
  /** Share of every colour handed to players, as a fraction (default 1/3; the rest stays in the bank). */
  shareNum: number;
  shareDen: number;
  /** Words for money in messages; default shows points. */
  fmt?: (points: number) => string;
}

export interface PlanRow {
  name: string;
  /** Points per chip. */
  value: number;
  /** True when the GM typed this value. */
  typed: boolean;
  /** Chips of this colour the GM owns. */
  count: number;
  /** Chips of this colour each player gets. */
  perPlayer: number;
  /** Chips left in the bank after the first handout. */
  bankLeft: number;
}

export type PlanStatus = 'exact' | 'adjusted' | 'impossible' | 'empty';

export interface ChipPlan {
  status: PlanStatus;
  /** Stack the buy-in calls for, in points. */
  target: number;
  /** Stack each player really gets, in points (equals target when status is exact). */
  stack: number;
  rows: PlanRow[];
  players: number;
  /** Share of chips handed to players actually used. */
  share: { num: number; den: number; percent: number };
  /** Value left in the bank after the first handout, in points. */
  bankValue: number;
  /** How many more full handouts (rebuys) the bank covers. */
  rebuys: number;
  /** First blinds worth suggesting for this stack, or null when there is no stack. */
  blinds: { sb: number; bb: number; bigBlinds: number } | null;
  /** What changed or what to know, in plain words. */
  notes: string[];
  /** Why no plan could be made, in plain words. */
  problems: string[];
}

// ------------------------------------------------------------------ nice numbers

const NICE_BASE = [1, 5, 10, 25, 50, 100];
/** The i-th "nice" chip value: 1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, ... */
export function niceAt(i: number): number {
  if (i < NICE_BASE.length) return NICE_BASE[Math.max(0, i)]!;
  const j = i - NICE_BASE.length;
  return [250, 500, 1000][j % 3]! * 10 ** Math.floor(j / 3);
}
/** Index of the largest nice value that is at most x (0 when x is below 1). */
export function niceIndexAtMost(x: number): number {
  let i = 0;
  while (niceAt(i + 1) <= x) i++;
  return i;
}

/** Steps along the nice list for each number of colours (lowest chip first). */
const OFFSETS: Record<number, number[]> = {
  1: [0],
  2: [0, 2],
  3: [0, 2, 4],
  4: [0, 2, 4, 6],
  5: [0, 2, 4, 6, 7],
  6: [0, 1, 3, 5, 7, 8],
  7: [0, 1, 2, 4, 6, 7, 8],
  8: [0, 1, 2, 3, 5, 6, 7, 8],
};

/**
 * Suggested chip values (points) for `k` colours, lowest first, for a stack of `stack` points: the smallest chip is
 * about the first small blind (stack / 200) and the biggest is at most half the stack.
 */
export function ladder(k: number, stack: number): number[] {
  const n = Math.min(MAX_COLOURS, Math.max(1, Math.round(k)));
  const off = OFFSETS[n]!;
  let i0 = niceIndexAtMost(Math.max(1, stack / 200));
  while (i0 > 0 && niceAt(i0 + off[n - 1]!) > stack / 2) i0--;
  return off.map((o) => niceAt(i0 + o));
}

/** First blinds for a stack: about 100 big blinds, and payable with the smallest chip. */
export function suggestBlinds(stack: number, smallestChip: number): { sb: number; bb: number; bigBlinds: number } | null {
  if (!(stack > 0)) return null;
  const chip = Math.max(1, smallestChip);
  let sb = niceAt(niceIndexAtMost(Math.max(1, stack / 200)));
  sb = Math.max(chip, Math.floor(sb / chip) * chip);
  return { sb, bb: sb * 2, bigBlinds: Math.floor(stack / (sb * 2)) };
}

/** Largest "round" number that divides `n` (1000, 500, ... 5, 1): used to pick the nicest of several stacks. */
function roundness(n: number): number {
  for (const d of [1000, 500, 250, 100, 50, 25, 10, 5]) if (n % d === 0) return d;
  return 1;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// ------------------------------------------------------------------ the search

/** Which sums (in units of g) can be made with at most avail[i] chips of value w[i]; exact bounded knapsack. */
function reachable(w: number[], avail: number[], M: number): Uint8Array {
  const r = new Uint8Array(M + 1);
  r[0] = 1;
  for (let i = 0; i < w.length; i++) {
    let left = Math.min(avail[i]!, Math.floor(M / w[i]!));
    for (let chunk = 1; left > 0; chunk *= 2) {
      const take = Math.min(chunk, left);
      left -= take;
      const step = take * w[i]!;
      for (let s = M; s >= step; s--) if (r[s - step]) r[s] = 1;
    }
  }
  return r;
}

/** Cost of giving a player `n` chips of colour i: how far the value is from its share, how round the count is. */
function chipCost(i: number, k: number, n: number, v: number, a: number, T: number, minSmall: number): number {
  const share = (i + 1) / ((k * (k + 1)) / 2);
  const dev = (n * v - share * T) / T;
  let c = dev * dev * 100;
  if (n === 0 && a > 0 && share * T >= v) c += 0.5;
  if (n >= 10) c += n % 10 === 0 ? 0 : n % 5 === 0 ? 0.01 : 0.05;
  c += 0.003 * n;
  if (i === 0 && n * v < minSmall) c += ((minSmall - n * v) / T) * 20;
  return c;
}

interface Found {
  counts: number[];
  /** Points of stack. */
  sum: number;
  exact: boolean;
}

/** Best exact stack of `T` points, or the nicest reachable stack just below it. null = nothing but zero is reachable. */
function search(values: number[], avail: number[], T: number): Found | null {
  const k = values.length;
  let g = values[0]!;
  for (const v of values) g = gcd(g, v);
  const M = Math.floor(T / g);
  const w = values.map((v) => v / g);
  const small = suggestBlinds(T, values[0]!);
  const minSmall = small ? small.sb * 4 : 0;
  let prev = new Float64Array(M + 1).fill(Infinity);
  prev[0] = 0;
  const choice: Int32Array[] = [];
  for (let i = 0; i < k; i++) {
    const cur = new Float64Array(M + 1).fill(Infinity);
    const pick = new Int32Array(M + 1);
    const nMax = Math.min(avail[i]!, Math.floor(M / w[i]!));
    const f = new Float64Array(nMax + 1);
    for (let n = 0; n <= nMax; n++) f[n] = chipCost(i, k, n, values[i]!, avail[i]!, T, minSmall);
    for (let s = 0; s <= M; s++) {
      const base = prev[s]!;
      if (base === Infinity) continue;
      const top = Math.min(nMax, Math.floor((M - s) / w[i]!));
      for (let n = 0; n <= top; n++) {
        const s2 = s + n * w[i]!;
        const c = base + f[n]!;
        if (c < cur[s2]!) {
          cur[s2] = c;
          pick[s2] = n;
        }
      }
    }
    choice.push(pick);
    prev = cur;
  }
  let best = -1;
  if (prev[M]! < Infinity && M * g === T) best = M;
  else {
    let bestScore = -1;
    for (let s = M; s >= Math.max(1, Math.ceil(M * 0.9)); s--) {
      if (prev[s]! === Infinity) continue;
      const r = roundness(s * g);
      if (r > bestScore) {
        bestScore = r;
        best = s;
      }
    }
    if (best < 0) for (let s = M; s >= 1; s--) if (prev[s]! < Infinity) {
      best = s;
      break;
    }
  }
  if (best < 1) return null;
  const counts = new Array<number>(k).fill(0);
  let s = best;
  for (let i = k - 1; i >= 0; i--) {
    const n = choice[i]![s]!;
    counts[i] = n;
    s -= n * w[i]!;
  }
  return { counts, sum: best * g, exact: best * g === T };
}

// ------------------------------------------------------------------ the plan

const clampShare = (num: number, den: number): { num: number; den: number } => {
  const d = Math.max(1, Math.round(den));
  const n = Math.max(0, Math.round(num));
  if (n / d < 0.1) return { num: 1, den: 10 };
  if (n / d > 1) return { num: 1, den: 1 };
  return { num: n, den: d };
};

const empty = (target: number, players: number, share: { num: number; den: number }, problems: string[]): ChipPlan => ({
  status: 'empty',
  target,
  stack: 0,
  rows: [],
  players,
  share: { ...share, percent: (share.num / share.den) * 100 },
  bankValue: 0,
  rebuys: 0,
  blinds: null,
  notes: [],
  problems,
});

export function planChips(input: PlanInput): ChipPlan {
  const fmt = input.fmt ?? ((p: number) => `${p} points`);
  const ppu = Math.max(1, input.pointsPerUnit);
  const players = Math.floor(input.players);
  const share = clampShare(input.shareNum, input.shareDen);
  const T = Math.round(input.buyIn * ppu);
  const problems: string[] = [];
  if (!(players >= 1)) problems.push('There has to be at least 1 player.');
  if (!(T >= 1)) problems.push('Enter a buy-in above 0.');
  const cols = input.colours.filter((c) => c.count > 0);
  if (!cols.length) problems.push('Add at least one colour of chips, with how many you have.');
  if (problems.length) return empty(Math.max(0, T), Math.max(0, players), share, problems);

  const k = Math.min(cols.length, MAX_COLOURS);
  const used = cols.slice(0, k);
  const suggested = ladder(k, T);
  const values = used.map((c, i) => (c.value !== null && c.value >= 1 ? Math.round(c.value) : suggested[i]!));
  for (let i = 1; i < k; i++) {
    if (values[i]! <= values[i - 1]!) {
      problems.push(`List the colours from the lowest value to the highest: ${used[i]!.name} (${fmt(values[i]!)}) is not worth more than ${used[i - 1]!.name} (${fmt(values[i - 1]!)}).`);
    }
  }
  const avail = used.map((c) => Math.floor((Math.floor(c.count) * share.num) / (share.den * players)));
  const rowsOf = (counts: number[]): PlanRow[] =>
    used.map((c, i) => ({
      name: c.name,
      value: values[i]!,
      typed: c.value !== null && c.value >= 1,
      count: Math.floor(c.count),
      perPlayer: counts[i]!,
      bankLeft: Math.floor(c.count) - counts[i]! * players,
    }));
  if (problems.length) return { ...empty(T, players, share, problems), status: 'impossible', rows: rowsOf(new Array(k).fill(0)) };
  if (T / Math.min(...values) > 400000) return { ...empty(T, players, share, ['These numbers are too large to plan; use a smaller buy-in or bigger chip values.']), status: 'impossible' };

  const found = search(values, avail, T);
  const notes: string[] = [];
  if (!found) {
    const maxStack = values.reduce((n, v, i) => n + avail[i]! * v, 0);
    const per = used.map((c) => Math.floor(c.count / players));
    const most = values.reduce((n, v, i) => n + per[i]! * v, 0);
    return {
      ...empty(T, players, share, [
        `Not enough chips: at ${Math.round((share.num / share.den) * 100)}% to players, each of ${players} players could get only ${fmt(maxStack)}${most > maxStack ? `, and at most ${fmt(most)} even if all the chips go out` : ''}.`,
      ]),
      status: 'impossible',
      rows: rowsOf(new Array(k).fill(0)),
    };
  }
  const rows = rowsOf(found.counts);
  const bankValue = rows.reduce((n, r) => n + r.bankLeft * r.value, 0);
  let rebuys = Infinity;
  for (const r of rows) if (r.perPlayer > 0) rebuys = Math.min(rebuys, Math.floor(r.bankLeft / r.perPlayer));
  if (rebuys === Infinity) rebuys = 0;
  let status: PlanStatus = 'exact';
  if (!found.exact) {
    status = found.sum >= T * 0.5 ? 'adjusted' : 'impossible';
    notes.push(`These chips can't make exactly ${fmt(T)} for every player. The nearest stack is ${fmt(found.sum)} (${fmt(T - found.sum)} less).`);
    // the smallest share (in whole percents) at which the exact stack would work
    const w0 = values.reduce(gcd, values[0]!);
    const M = Math.floor(T / w0);
    const wv = values.map((v) => v / w0);
    const works = (pct: number) => {
      const av = used.map((c) => Math.floor((Math.floor(c.count) * pct) / (100 * players)));
      return T % w0 === 0 && reachable(wv, av, M)[M] === 1;
    };
    const now = Math.floor((share.num / share.den) * 100) + 1;
    if (now <= 100 && works(100)) {
      let lo = now;
      let hi = 100;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (works(mid)) hi = mid;
        else lo = mid + 1;
      }
      notes.push(`Exactly ${fmt(T)} works if ${lo}% of the chips go to players (the bank keeps ${100 - lo}%).`);
    } else if (T % w0 !== 0) notes.push(`The chip values (${values.map(fmt).join(', ')}) can't add up to exactly ${fmt(T)}: change a value or the buy-in.`);
    else notes.push(`Even with every chip handed out, exactly ${fmt(T)} isn't possible: add chips or change a value.`);
    if (status === 'impossible') notes.push(`The nearest stack is under half the buy-in, so it isn't worth using. Add chips or change the share to players.`);
  }
  const smallest = rows.find((r) => r.perPlayer > 0)?.value ?? values[0]!;
  if (rows[0]!.perPlayer > 0 && rows[0]!.value < (suggestBlinds(found.sum, values[0]!)?.sb ?? 0) / 2) notes.push(`The smallest chip (${fmt(rows[0]!.value)}) is much smaller than the first small blind: fewer colours would be simpler.`);
  if (rebuys < 1) notes.push('The bank cannot cover even one rebuy at this share. Lower the share to players or add chips.');
  const first = suggestBlinds(found.sum, values[0]!);
  if (first) {
    const small = rows.reduce((n, r) => (r.value <= first.sb ? n + r.perPlayer * r.value : n), 0);
    if (small < first.bb * 2) notes.push(`Each player has under two big blinds (${fmt(first.bb * 2)}) in chips no bigger than the small blind (${fmt(first.sb)}), so paying blinds will often need change from the bank. More small chips would help.`);
  }
  return {
    status,
    target: T,
    stack: found.sum,
    rows,
    players,
    share: { ...share, percent: (share.num / share.den) * 100 },
    bankValue,
    rebuys,
    blinds: suggestBlinds(found.sum, smallest),
    notes,
    problems: [],
  };
}
