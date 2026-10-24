/**
 * Population study: every player type at every skill tier, in random mixed groups.
 * Each player is compared with "Never trades" players of the same skill tier and party size,
 * so the edge isolates the strategy, not the skill.
 *
 * Usage: tsx src/study.ts [--nights 3000] [--set recommended] [--write]
 */
import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng, type Settings } from '@gn/engine';
import { aggregate } from './metrics';
import { PARAM_SETS, SIM_OPTIONS } from './paramSets';
import { runNight, type NightMetrics, type PlayerRow } from './runner';
import { AGENT_KINDS, AGENT_LABEL, type AgentKind, type SkillTier } from './world';

export const TIERS: SkillTier[] = ['low', 'mid', 'high'];
const TIER_CENTER: Record<SkillTier, number> = { low: -1, mid: 0, high: 1 };
const CREWS: AgentKind[] = ['coalition', 'kingmaker'];
export const SOLO: AgentKind[] = AGENT_KINDS.filter((k) => !CREWS.includes(k));

/** Random mixed group. Crews (3 each) appear in about half the nights; everyone else is a uniform draw. */
export function buildRoster(rng: Rng, n: number) {
  const agents: AgentKind[] = [];
  if (rng.next() < 0.5) agents.push('coalition', 'coalition', 'coalition');
  if (rng.next() < 0.5) agents.push('kingmaker', 'kingmaker', 'kingmaker');
  while (agents.length < n) agents.push(rng.pick(SOLO));
  return agents.map((agent) => {
    const tier = rng.pick(TIERS);
    return { agent, tier, skill: TIER_CENTER[tier] + rng.normal() * 0.3 };
  });
}

export function runStudyNight(seed: number, players: number, settings: Settings): NightMetrics {
  const roster = buildRoster(createRng(seed ^ 0x5eed), players);
  return runNight(
    { ...SIM_OPTIONS, lateJoinChance: 0, leaverChance: 0, seed, players, roster, coalitionTarget: seed % 2 ? 'crypto' : 'dead' },
    settings,
  );
}

// ---------------------------------------------------------------- analysis

interface Cell {
  n: number;
  gold: number;
  edge: number;
  edgeSe: number;
  edgePct: number;
  win: number;
  top3: number;
  trade: number;
  games: number;
  played: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const variance = (xs: number[]) => {
  const m = mean(xs);
  return xs.length > 1 ? xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) : 0;
};

export function analyse(nights: NightMetrics[]) {
  const rows: (PlayerRow & { size: number })[] = nights.flatMap((m) => m.playerRows.map((r) => ({ ...r, size: m.players })));
  // Control: never-trades by (size, tier)
  const ctrl = new Map<string, number[]>();
  for (const r of rows) if (r.agent === 'inactive') (ctrl.get(`${r.size}|${r.tier}`) ?? ctrl.set(`${r.size}|${r.tier}`, []).get(`${r.size}|${r.tier}`)!).push(r.goldH / 100);
  const ctrlMean = new Map([...ctrl].map(([k, v]) => [k, mean(v)]));
  const ctrlSe2 = mean([...ctrl.values()].map((v) => variance(v) / v.length));
  const cells = new Map<string, Cell>();
  for (const agent of AGENT_KINDS) {
    for (const tier of TIERS) {
      const rs = rows.filter((r) => r.agent === agent && r.tier === tier);
      const gold = rs.map((r) => r.goldH / 100);
      const edges = rs.map((r) => r.goldH / 100 - ctrlMean.get(`${r.size}|${r.tier}`)!);
      const base = mean(rs.map((r) => ctrlMean.get(`${r.size}|${r.tier}`)!));
      cells.set(`${agent}|${tier}`, {
        n: rs.length,
        gold: mean(gold),
        edge: mean(edges),
        edgeSe: Math.sqrt(variance(edges) / Math.max(1, rs.length) + (agent === 'inactive' ? 0 : ctrlSe2)),
        edgePct: base ? mean(edges) / base : 0,
        win: mean(rs.map((r) => (r.won ? 1 : 0))),
        top3: mean(rs.map((r) => (r.top3 ? 1 : 0))),
        trade: mean(rs.map((r) => r.tradeH / 100)),
        games: mean(rs.map((r) => r.gamesH / 100)),
        played: mean(rs.map((r) => r.gamesPlayed)),
      });
    }
  }
  return { cells, ctrlMean, rows };
}

const sig = (c: Cell) => Math.abs(c.edge) > 2 * c.edgeSe;
const f1 = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const L = (k: AgentKind) => AGENT_LABEL[k];

/** Plain-language findings, generated from the numbers. Only statistically clear effects are stated as findings. */
export function insights(cells: Map<string, Cell>): string[] {
  const get = (a: AgentKind, t: SkillTier) => cells.get(`${a}|${t}`)!;
  const traders = AGENT_KINDS.filter((a) => a !== 'inactive');
  const out: string[] = [];

  for (const t of TIERS) {
    const ranked = traders.map((a) => ({ a, c: get(a, t) })).sort((x, y) => y.c.edge - x.c.edge);
    const best = ranked.filter((x) => sig(x.c) && x.c.edge > 0).slice(0, 3);
    const worst = ranked.filter((x) => sig(x.c) && x.c.edge < 0).slice(-3).reverse();
    out.push(
      `**${t[0]!.toUpperCase() + t.slice(1)}-skill players:** ` +
        (best.length ? `best strategies are ${best.map((x) => `${L(x.a)} (${f1(x.c.edge)} gold)`).join(', ')}` : 'no strategy reliably beats never trading') +
        '; ' +
        (worst.length ? `worst are ${worst.map((x) => `${L(x.a)} (${f1(x.c.edge)})`).join(', ')}.` : 'none is reliably worse than never trading.'),
    );
  }

  // Skill-dependent flips: clearly positive at one end, clearly negative at the other.
  for (const a of traders) {
    const lo = get(a, 'low');
    const hi = get(a, 'high');
    if (sig(lo) && sig(hi) && Math.sign(lo.edge) !== Math.sign(hi.edge)) {
      out.push(`**${L(a)} flips with skill:** ${f1(lo.edge)} gold for low-skill players, ${f1(hi.edge)} for high-skill players.`);
    }
  }

  // Bigger/smaller effect by skill (same sign, large gap).
  for (const a of traders) {
    const lo = get(a, 'low');
    const hi = get(a, 'high');
    if (sig(lo) && sig(hi) && Math.sign(lo.edge) === Math.sign(hi.edge) && Math.abs(lo.edge - hi.edge) > 2 * Math.hypot(lo.edgeSe, hi.edgeSe) && Math.abs(lo.edge - hi.edge) >= 2) {
      const who = Math.abs(lo.edge) > Math.abs(hi.edge) ? 'low' : 'high';
      out.push(`**${L(a)}** matters more for ${who}-skill players (${f1(lo.edge)} low vs ${f1(hi.edge)} high).`);
    }
  }

  // Exploit flags: > +15% over never-trades at any tier.
  for (const a of traders) {
    for (const t of TIERS) {
      const c = get(a, t);
      if (sig(c) && c.edgePct > 0.15) out.push(`⚠️ **Possible exploit:** ${L(a)} at ${t} skill ends ${pct(c.edgePct)} ahead of never-trades (${f1(c.edge)} gold).`);
    }
  }

  // Can a low-skill player buy a podium?
  const loTop = traders.map((a) => ({ a, c: get(a, 'low') })).sort((x, y) => y.c.top3 - x.c.top3);
  const ctrlLo = get('inactive', 'low');
  out.push(
    `**Low-skill shot at the podium:** never-trades reaches top 3 in ${pct(ctrlLo.top3)} of nights; the best strategies are ${loTop
      .slice(0, 3)
      .map((x) => `${L(x.a)} ${pct(x.c.top3)}`)
      .join(', ')}.`,
  );
  // Skill dominance
  const hiWin = get('inactive', 'high').win;
  const loWin = ctrlLo.win;
  out.push(`**Skill vs strategy:** a high-skill never-trader wins ${pct(hiWin)} of nights, a low-skill never-trader ${pct(loWin)}. The best low-skill strategy wins ${pct(Math.max(...traders.map((a) => get(a, 'low').win)))}.`);

  // Table time: grinder / butterfly
  const gr = get('grinder', 'mid');
  const bf = get('butterfly', 'mid');
  const ct = get('inactive', 'mid');
  out.push(
    `**Games vs phone time (mid skill):** Game grinder plays ${gr.played.toFixed(1)} games (${f1(gr.edge)} gold vs never-trades); Social butterfly plays ${bf.played.toFixed(1)} (${f1(bf.edge)}, trading ${f1(bf.trade)}); never-trades plays ${ct.played.toFixed(1)}.`,
  );
  return out;
}

export function studyReport(nights: NightMetrics[], setName: string): string {
  const { cells } = analyse(nights);
  const get = (a: AgentKind, t: SkillTier) => cells.get(`${a}|${t}`)!;
  const out: string[] = [];
  const by = (n: number) => nights.filter((m) => m.players === n).length;
  out.push('# Player-type study', '');
  out.push(
    `Settings \`${setName}\`. ${nights.length} simulated nights (${by(12)} at 12 players, ${by(20)} at 20). Each night is a random mix of the ${AGENT_KINDS.length} player types; each player is randomly low, mid or high skill. A pump crew and a kingmaker crew (3 players each) each appear in about half of nights.`,
    '',
    '**Edge** = average final gold minus the average of *Never trades* players with the same skill in the same party size. ★ = clear effect (more than 2 standard errors from zero); no star means it could be noise.',
    '',
  );
  out.push('## Findings', '', ...insights(cells).map((x) => `- ${x}`), '');
  out.push('## Edge by type and skill', '', '| Type | Low skill | Mid skill | High skill | Avg |', '|---|---:|---:|---:|---:|');
  const order = [...AGENT_KINDS].sort((a, b) => mean(TIERS.map((t) => get(b, t).edge)) - mean(TIERS.map((t) => get(a, t).edge)));
  for (const a of order) {
    const cellTxt = (t: SkillTier) => {
      const c = get(a, t);
      return a === 'inactive' ? `${c.gold.toFixed(1)} gold` : `${f1(c.edge)}${sig(c) ? '★' : ''}`;
    };
    out.push(`| ${L(a)} | ${cellTxt('low')} | ${cellTxt('mid')} | ${cellTxt('high')} | ${a === 'inactive' ? '(baseline)' : f1(mean(TIERS.map((t) => get(a, t).edge)))} |`);
  }
  out.push('', '## Win and podium rate', '', '| Type | Win % low / mid / high | Top-3 % low / mid / high |', '|---|---|---|');
  for (const a of order) {
    out.push(`| ${L(a)} | ${TIERS.map((t) => pct(get(a, t).win)).join(' / ')} | ${TIERS.map((t) => pct(get(a, t).top3)).join(' / ')} |`);
  }
  out.push('', '## Where the gold comes from (all skills)', '', '| Type | Games played | Game gold | Trading P&L | Samples |', '|---|---:|---:|---:|---:|');
  for (const a of order) {
    const cs = TIERS.map((t) => get(a, t));
    const n = cs.reduce((x, c) => x + c.n, 0);
    const w = (f: (c: Cell) => number) => cs.reduce((x, c) => x + f(c) * c.n, 0) / Math.max(1, n);
    out.push(`| ${L(a)} | ${w((c) => c.played).toFixed(1)} | ${w((c) => c.games).toFixed(1)} | ${f1(w((c) => c.trade))} | ${n} |`);
  }
  for (const n of [12, 20]) {
    const ms = nights.filter((m) => m.players === n);
    if (!ms.length) continue;
    const agg = aggregate(ms);
    out.push('', `## Spec targets with mixed groups — ${n} players`, '', '| | Target | Result | Goal |', '|---|---|---|---|');
    for (const t of agg.targets) out.push(`| ${t.pass ? '✅' : '❌'} | ${t.label} | ${t.value} | ${t.target} |`);
  }
  out.push('', '## Player types', '', ...AGENT_KINDS.map((a) => `- **${L(a)}**`));
  return out.join('\n');
}

// ---------------------------------------------------------------- CLI

function arg(name: string, def: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
}

async function main() {
  const nights = Number(arg('nights', '3000'));
  const setName = arg('set', 'recommended');
  const set = PARAM_SETS.find((s) => s.name === setName);
  if (!set) throw new Error(`unknown set ${setName}`);
  const workerPath = fileURLToPath(new URL('./worker.ts', import.meta.url));
  const k = Math.max(1, Math.min(cpus().length, 8));
  const t0 = Date.now();
  const all: NightMetrics[] = [];
  for (const players of [12, 20]) {
    const seeds = Array.from({ length: nights }, (_, i) => 7_000_000 + players * 100_000 + i);
    const chunks: number[][] = Array.from({ length: k }, () => []);
    seeds.forEach((s, i) => chunks[i % k]!.push(s));
    const parts = await Promise.all(
      chunks.map(
        (chunk) =>
          new Promise<NightMetrics[]>((resolve, reject) => {
            const child = fork(workerPath, [], { execArgv: ['--import', 'tsx'] });
            child.once('message', (m) => resolve(m as NightMetrics[]));
            child.once('exit', (code) => reject(new Error(`worker exited (${code}) without a result`)));
            child.send({ kind: 'study', settings: set.settings, players, seeds: chunk });
          }),
      ),
    );
    all.push(...parts.flat());
  }
  const md = studyReport(all, setName);
  console.log(md);
  console.error(`\n${all.length} nights in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (process.argv.includes('--write')) {
    const dir = fileURLToPath(new URL('../reports/', import.meta.url));
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/STUDY.md`, md);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

