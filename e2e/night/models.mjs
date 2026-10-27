// Game-outcome models for the test night. Only what the app consumes: duration, score over time, placements.
// Catan: median 71 game turns, 4-player base game, 251 colonist.io games (alexcates.com). Winners build ~36% faster
//        than losers (settlement slope .045 vs .033 per game turn). Box time 60–120 min → minutes per turn = U(60,120)/71.
// Risk:  no timestamped 6-player logs found. Duration U(3.5, 5.5) h inside the published 1–8 h; eliminations and
//        territory curves are modelled (assumption, labelled in the report).

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const U = (r, a, b) => a + (b - a) * r();

/** One Catan game: per own turn, chance p_i of +1 VP (some hidden as dev-card VPs); first to 10 wins. */
function catanOnce(r, n, k) {
  const p = Array.from({ length: n }, () => U(r, 0.3, 0.46) * k);
  const vp = Array(n).fill(2);
  const hidden = Array(n).fill(0);
  const hist = [{ turn: 0, vp: [...vp], hidden: [...hidden] }];
  let turn = 0;
  while (turn < 400) {
    const i = turn % n;
    turn++;
    if (r() < p[i]) {
      vp[i]++;
      if (r() < 0.12) hidden[i]++;
    }
    hist.push({ turn, vp: [...vp], hidden: [...hidden] });
    if (vp[i] >= 10) return { turns: turn, winner: i, hist, vp };
  }
  return null;
}

/** Calibrates k so the median game length is ~71 turns. */
export function calibrateCatan(seed = 7) {
  let best = { k: 1, err: Infinity, median: 0 };
  for (let k = 0.6; k <= 1.6; k += 0.02) {
    const r = rng(seed);
    const t = [];
    for (let i = 0; i < 600; i++) t.push(catanOnce(r, 4, k).turns);
    t.sort((a, b) => a - b);
    const med = t[300];
    if (Math.abs(med - 71) < best.err) best = { k: Math.round(k * 100) / 100, err: Math.abs(med - 71), median: med, q1: t[150], q3: t[450] };
  }
  return best;
}

/** Catan timeline in game minutes: [{min, visible:[...]}] and final placements (ties share a place). */
export function catanGame(r, n, k) {
  const g = catanOnce(r, n, k);
  const minPerTurn = U(r, 60, 120) / 71;
  const durationMin = g.turns * minPerTurn;
  const points = g.hist.map((h) => ({ min: h.turn * minPerTurn, visible: h.vp.map((v, i) => v - h.hidden[i]), actual: h.vp }));
  const order = g.vp.map((v, i) => ({ i, v: i === g.winner ? 99 : v })).sort((a, b) => b.v - a.v);
  const place = Array(n);
  order.forEach((o, idx) => {
    place[o.i] = idx > 0 && order[idx - 1].v === o.v ? place[order[idx - 1].i] : idx + 1;
  });
  return { kind: 'catan', turns: g.turns, minPerTurn, durationMin, points, finalVp: g.vp, place, winner: g.winner };
}

/** Risk (6p) model: eliminations spread through the game, territories follow strength + noise. */
export function riskGame(r, n = 6) {
  const durationMin = U(r, 3.5, 5.5) * 60;
  // Strength order = final placement order. Index 0 = winner.
  const ranks = [...Array(n).keys()].sort(() => r() - 0.5); // ranks[j] = player index with placement j+1
  const elimFrac = Array.from({ length: n - 2 }, () => U(r, 0.3, 0.92)).sort((a, b) => a - b);
  const elimAt = Array(n).fill(Infinity);
  // last place eliminated first
  for (let j = 0; j < n - 2; j++) elimAt[ranks[n - 1 - j]] = elimFrac[j] * durationMin;
  elimAt[ranks[1]] = durationMin; // runner-up falls at the end
  const strength = Array(n);
  ranks.forEach((pi, j) => (strength[pi] = 1 - j * 0.12));
  const noise = Array(n).fill(0);
  const points = [];
  for (let m = 0; m <= durationMin + 0.01; m += 5) {
    const t = m / durationMin;
    for (let i = 0; i < n; i++) noise[i] += (r() - 0.5) * 0.5;
    const alive = [...Array(n).keys()].filter((i) => m < elimAt[i]);
    const w = Array(n).fill(0);
    for (const i of alive) w[i] = Math.exp(strength[i] * 3 * t + noise[i] * (1 - t * 0.6));
    const tot = w.reduce((a, b) => a + b, 0);
    let terr = w.map((x) => Math.floor((x / tot) * 42));
    let left = 42 - terr.reduce((a, b) => a + b, 0);
    const rem = w.map((x, i) => ({ i, f: (x / tot) * 42 - terr[i] })).filter((x) => alive.includes(x.i)).sort((a, b) => b.f - a.f);
    for (let q = 0; left > 0; q++, left--) terr[rem[q % rem.length].i]++;
    for (const i of alive) if (terr[i] === 0) terr[i] = 1; // alive means at least 1
    if (m >= durationMin) terr = terr.map((_, i) => (i === ranks[0] ? 42 : 0));
    points.push({ min: m, visible: terr });
  }
  const place = Array(n);
  ranks.forEach((pi, j) => (place[pi] = j + 1));
  return { kind: 'risk', durationMin, points, place, elimAt, winner: ranks[0] };
}

/** Score the GM would read off the table at game minute m. */
export function scoreAt(game, m) {
  let p = game.points[0];
  for (const x of game.points) if (x.min <= m) p = x;
  return p.visible;
}
