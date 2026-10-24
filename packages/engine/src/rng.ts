/** Seedable RNG so ticks and sims are reproducible. Pure: state is the closure. */
export interface Rng {
  next(): number; // [0,1)
  normal(): number; // N(0,1)
  int(minIncl: number, maxIncl: number): number;
  pick<T>(xs: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const normal = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return {
    next,
    normal,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (xs) => {
      if (xs.length === 0) throw new Error('pick from empty');
      return xs[Math.floor(next() * xs.length)]!;
    },
  };
}
