#!/usr/bin/env node
/**
 * One command for "is everything still fine?": type checks, unit tests, the client build and (optionally) the
 * browser harnesses. Prints a short summary; the full output of every step goes to e2e/.out/check.log.
 *
 *   npm run check                      # types, tests, build
 *   npm run check -- --e2e             # + the quick browser set (see QUICK)
 *   npm run check -- --e2e all         # + every harness except the long 60× night
 *   npm run check -- --e2e tables,bets # + just these (names from HARNESSES)
 *   npm run check -- --no-build        # skip the build (e2e needs a built client)
 *
 * Exit code 0 = all passed. Browser harnesses need Playwright + Chromium (see e2e/README.md); NODE_PATH is set to the
 * global npm root automatically.
 */
import { spawn, execSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(ROOT, 'e2e/.out/check.log');
mkdirSync(dirname(LOG), { recursive: true });
writeFileSync(LOG, `check ${new Date().toISOString()}\n`);

/** Browser harnesses by short name. */
const HARNESSES = {
  tables: 'e2e/tables/run.mjs',
  seating: 'e2e/seating/run.mjs',
  seats: 'e2e/seating/seats.mjs',
  features: 'e2e/features/run.mjs',
  swipe: 'e2e/swipe/pages.mjs',
  bets: 'e2e/bets/bets.mjs',
  pwa: 'e2e/features/pwa.mjs',
  sched: 'e2e/features/sched.mjs',
  oct29: 'e2e/features/oct29.mjs',
  halt: 'e2e/features/halt.mjs',
  sounds: 'e2e/features/sounds3.mjs',
  risk: 'e2e/boards/run.mjs',
  catan: 'e2e/boards/catan.mjs',
  clue: 'e2e/boards/clue.mjs',
  monopoly: 'e2e/boards/monopoly.mjs',
  no2: 'e2e/boards/no2.mjs',
  poker: 'e2e/boards/poker.mjs',
  scrabble: 'e2e/boards/scrabble.mjs',
  ttr: 'e2e/boards/ttr.mjs',
  r01: 'e2e/rounds/r01-join.mjs',
  r02: 'e2e/rounds/r02-network.mjs',
  r03: 'e2e/rounds/r03-trading.mjs',
  r04: 'e2e/rounds/r04-votes.mjs',
  r05: 'e2e/rounds/r05-gmgames.mjs',
  r06: 'e2e/rounds/r06-multigm.mjs',
  r07: 'e2e/rounds/r07-lifecycle.mjs',
  r08: 'e2e/rounds/r08-messages.mjs',
  r09: 'e2e/rounds/r09-junk.mjs',
  r10: 'e2e/rounds/r10-load.mjs',
  r11: 'e2e/rounds/r11-account-switch.mjs',
};
const QUICK = ['tables', 'seating', 'seats', 'features', 'swipe', 'bets'];
/**
 * Known false positives (checked by hand, not app bugs; see e2e/README.md): shown as "known", don't fail the check.
 * Each is [harness, text in the BUG line].
 */
const KNOWN = [
  ['r03', 'selling locked/too many shares explains why'], // the app answers "one trade per tick" / "you don't hold that many"
  ['r03', 'buying past the invest cap is refused with a clear reason'], // answers "not enough gold"
  ['r05', 'Start button disabled while paused'], // timing; it is disabled
  ['r06', 'paused laptop shows the PIN lock without refreshing'], // text check misses the PIN placeholder; it does lock
  ['r09', 'junk settings {"market":null} → 200'], // null resets a settings section by design
  ['r10', 'hourly handicap check ran under load'], // a test server restarted at 60× resets its clock
];

const argv = process.argv.slice(2);
const ei = argv.indexOf('--e2e');
let e2e = [];
if (ei >= 0) {
  const v = argv[ei + 1] && !argv[ei + 1].startsWith('--') ? argv[ei + 1] : 'quick';
  e2e = v === 'quick' ? QUICK : v === 'all' ? Object.keys(HARNESSES) : v.split(',');
  const bad = e2e.filter((n) => !HARNESSES[n]);
  if (bad.length) {
    console.log(`unknown harness: ${bad.join(', ')}. Known: ${Object.keys(HARNESSES).join(', ')}`);
    process.exit(2);
  }
}
const noBuild = argv.includes('--no-build');

/** Run a command; returns { code, out }. Everything is appended to the log. Kills the whole process group on timeout. */
function run(cmd, args, { cwd = ROOT, env = {}, timeoutMs = 15 * 60_000 } = {}) {
  return new Promise((res) => {
    appendFileSync(LOG, `\n$ ${cmd} ${args.join(' ')}  (in ${cwd})\n`);
    const p = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env }, detached: true });
    let out = '';
    const take = (d) => {
      d = String(d).replace(/\x1b\[[0-9;]*m/g, ''); // no colour codes
      out += d;
      appendFileSync(LOG, d);
    };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    const t = setTimeout(() => {
      out += '\n[check: timed out]\n';
      try {
        process.kill(-p.pid, 'SIGKILL');
      } catch {}
    }, timeoutMs);
    p.on('close', (code) => {
      clearTimeout(t);
      res({ code: code ?? 1, out });
    });
  });
}

const rows = [];
let failed = false;
const row = (name, ok, text, detail = []) => {
  rows.push({ name, ok, text, detail });
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(13)} ${text}`);
  for (const d of detail.slice(0, 15)) console.log(`       ${d}`);
};
const lines = (out, re) => out.split('\n').filter((l) => re.test(l)).map((l) => l.trim());

const t0 = Date.now();

// 1. Client: svelte-check (3 known warnings in ResultWizard).
{
  const r = await run('npx', ['svelte-check', '--tsconfig', './tsconfig.json'], { cwd: join(ROOT, 'packages/client') });
  const m = /svelte-check found (\d+) errors? and (\d+) warnings?/.exec(r.out);
  const errs = m ? +m[1] : -1;
  row('svelte-check', errs === 0, m ? `${m[1]} errors, ${m[2]} warnings` : 'no summary (see log)', errs ? lines(r.out, /Error/).slice(0, 15) : []);
}

// 2. Engine / server / sim type checks.
for (const w of ['engine', 'server', 'sim']) {
  const r = await run('npx', ['tsc', '--noEmit', '-p', '.'], { cwd: join(ROOT, 'packages', w) });
  row(`types ${w}`, r.code === 0, r.code === 0 ? 'clean' : 'errors', lines(r.out, /error TS/));
}

// 3. Unit tests, per workspace.
{
  const counts = [];
  const detail = [];
  let ok = true;
  for (const w of ['client', 'engine', 'server', 'sim']) {
    const r = await run('npx', ['vitest', 'run'], { cwd: join(ROOT, 'packages', w) });
    const m = /Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/.exec(r.out);
    const fails = m?.[1] ? +m[1] : r.code ? 1 : 0;
    counts.push(`${w} ${m ? m[2] : '?'}${fails ? ` (${fails} failed)` : ''}`);
    if (fails || r.code) {
      ok = false;
      detail.push(...lines(r.out, /FAIL|AssertionError|Error:/).slice(0, 8));
    }
  }
  row('tests', ok, counts.join(' · '), detail);
}

// 4. Client build.
if (!noBuild) {
  const r = await run('npm', ['run', 'build', '-w', 'packages/client']);
  row('build', r.code === 0, r.code === 0 ? 'ok' : 'failed', r.code ? lines(r.out, /error|Error/).slice(0, 10) : []);
}

// 5. Browser harnesses, one at a time.
if (e2e.length) {
  let nodePath = process.env.NODE_PATH ?? '';
  try {
    nodePath = execSync('npm root -g').toString().trim();
  } catch {}
  for (const n of e2e) {
    const r = await run('node', [HARNESSES[n]], { env: { NODE_PATH: nodePath } });
    const m = /ROUND \S+: (\d+) bugs, (\d+) checks passed, (\d+) console errors \((\d+) page errors\), (\d+) server errors/.exec(r.out);
    if (m) {
      const [, passed, , pageErr, serverErr] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
      const bugLines = lines(r.out, /^\s*BUG /);
      const isKnown = (l) => KNOWN.some(([h, t]) => h === n && l.includes(t));
      const real = bugLines.filter((l) => !isKnown(l));
      const known = bugLines.length - real.length;
      row(`e2e ${n}`, real.length === 0 && pageErr === 0 && serverErr === 0, `${passed} checks, ${real.length} bugs${known ? ` (+${known} known false positive${known > 1 ? 's' : ''})` : ''}, ${pageErr} page errors, ${serverErr} server errors`, real);
    } else {
      // Older harnesses without the shared reporter: pass = clean exit and no BAD/BUG lines.
      const bad = lines(r.out, /^\s*(BAD|BUG)\b|Error:|timed out/);
      row(`e2e ${n}`, r.code === 0 && bad.length === 0, r.code === 0 && !bad.length ? 'ok' : `exit ${r.code}`, bad);
    }
  }
}

console.log(`\ncheck: ${failed ? 'FAILED' : 'PASS'} in ${Math.round((Date.now() - t0) / 1000)}s · full log e2e/.out/check.log`);
process.exit(failed ? 1 : 0);
