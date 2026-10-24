import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { aggregate, type Aggregate } from './metrics';
import { PARAM_SETS, SENSITIVITY, type ParamSet } from './paramSets';
import type { NightMetrics } from './runner';
import { writeReport } from './report';
import type { Job } from './worker';

const workerPath = fileURLToPath(new URL('./worker.ts', import.meta.url));

function runParallel(job: Omit<Job, 'seeds'>, seeds: number[]): Promise<NightMetrics[]> {
  const k = Math.max(1, Math.min(cpus().length, 8));
  const chunks: number[][] = Array.from({ length: k }, () => []);
  seeds.forEach((s, i) => chunks[i % k]!.push(s));
  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<NightMetrics[]>((resolve, reject) => {
          const child = fork(workerPath, [], { execArgv: ['--import', 'tsx'] });
          child.once('message', (m) => resolve(m as NightMetrics[]));
          child.once('error', reject);
          child.once('exit', (code) => reject(new Error(`worker exited (${code}) without a result`)));
          child.send({ ...job, seeds: chunk });
        }),
    ),
  ).then((r) => r.flat());
}

export async function runSet(set: ParamSet, runs: number, sizes: number[], options?: Job['options']): Promise<Aggregate[]> {
  const out: Aggregate[] = [];
  for (const players of sizes) {
    const seeds = Array.from({ length: runs }, (_, i) => players * 100_000 + i + 1);
    out.push(aggregate(await runParallel({ settings: set.settings, players, options }, seeds)));
  }
  return out;
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
}

async function main() {
  const runs = Number(arg('runs', '1000'));
  const sizes = arg('players', '12,20').split(',').map(Number);
  const names = arg('sets', PARAM_SETS.map((s) => s.name).join(',')).split(',');
  const recommended = arg('recommend', '');
  const write = process.argv.includes('--write');
  const results: { set: ParamSet; aggs: Aggregate[] }[] = [];
  const patch = arg('patch', '');
  if (patch) PARAM_SETS.push({ name: 'adhoc', note: 'ad hoc', settings: JSON.parse(patch) });
  const brief = process.argv.includes('--brief');
  for (const name of names) {
    const set = PARAM_SETS.find((s) => s.name === name);
    if (!set) throw new Error(`unknown set ${name}`);
    const t0 = Date.now();
    const aggs = await runSet(set, runs, sizes);
    results.push({ set, aggs });
    console.log(`\n== ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    for (const a of aggs) {
      console.log(`  ${a.players} players: ${a.targets.filter((t) => t.pass).length}/${a.targets.length} pass`);
      for (const t of a.targets) console.log(`    ${t.pass ? 'PASS' : 'fail'} ${t.id} ${brief ? '' : t.label + ': '}${t.value}${brief ? '' : ` [${t.target}]`}`);
      if (brief) continue;
      for (const [k, v] of Object.entries(a.extra)) console.log(`         ${k}: ${v}`);
      console.log(`         gold by agent: ${JSON.stringify(a.goldByAgent, (_, v) => (typeof v === 'number' ? +v.toFixed(1) : v))}`);
      console.log(`         market P&L by agent: ${JSON.stringify(a.marketPnlByAgent, (_, v) => (typeof v === 'number' ? +v.toFixed(1) : v))}`);
    }
  }
  const sensitivity: { name: string; aggs: Aggregate[] }[] = [];
  const rec = PARAM_SETS.find((x) => x.name === recommended);
  if (rec && process.argv.includes('--sensitivity')) {
    for (const sv of SENSITIVITY) {
      const aggs = await runSet(rec, Math.max(100, Math.round(runs / 2)), sizes, sv.options);
      sensitivity.push({ name: sv.name, aggs });
      console.log(`sensitivity: ${sv.name}: ${aggs.map((a) => a.targets.filter((t) => t.pass).length).join('+')}`);
    }
  }
  if (write) {
    const dir = fileURLToPath(new URL('../reports/', import.meta.url));
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2));
    writeFileSync(`${dir}/REPORT.md`, writeReport(results, runs, recommended, sensitivity));
    console.log(`\nwrote ${dir}REPORT.md`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
