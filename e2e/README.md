# Browser test harnesses (not part of the install or `npm test`)

Scripts that drive real browsers against a real server. They need **Playwright with Chromium** available to Node
(the dev sandbox had it preinstalled globally, v1.63; elsewhere: `npm i -g playwright@1.63.0 && npx playwright install chromium`,
then run with `NODE_PATH=$(npm root -g)`). Output (server data, screenshots, JSON reports) goes to `e2e/.out/` (gitignored),
or to `$E2E_OUT`. Build the client first (`npm run build`): the servers serve `packages/client/dist`.

## Human-behaviour bug rounds (`rounds/`)
Each round starts its own fresh server (ports from 8200 up), plays out what real people do, and writes
`e2e/.out/out/<round>.json` (bugs, passed checks, console/page errors, server errors).

```sh
NODE_PATH=$(npm root -g) node e2e/rounds/r01-join.mjs
for r in e2e/rounds/r*.mjs; do NODE_PATH=$(npm root -g) node $r; done   # all ten, ~35 min
```

| Round | Covers |
|---|---|
| r01-join | double-tap Join, duplicate/reserved/junk names and tickers, refreshes, second tab, late join + double Approve, rejoin, join spam |
| r02-network | phones offline then back, server kill -9 + restart, two devices for one player, denied rejoin, refresh while pending, sign-out, offline across a pause |
| r03-trading | triple-tap Buy, odd amounts, lockout, Max/cap, trading while paused, stale tap after close |
| r04-votes (60×) | incoming call inside another app, landscape, answer/decline + refresh, change vote, double vote, ignored call, late vote |
| r05-gmgames | double Start, junk scores, wizard open/close/double submit, all tied, all DNF, cancel (index dip), start while paused, correction, library delete |
| r06-multigm | two GM devices at once (start, scores, same and different results), remote pause + PIN, Sub GM screens, stale settings forms, logout |
| r07-lifecycle (60×) | pause junk and spam, End with a game running, double End, refresh mid-finale, statements, archive + old phones/TV |
| r08-messages | trade-in and buy spam, tip taps, memo reject/reassign, peek twice, long/HTML messages, Minter mashing, tip to a leaver |
| r09-junk | RTL names, fake/huge photos, script/markdown injection everywhere, junk settings, broken pack file, 2 MB payload, nonsense API calls |
| r10-load (60×) | 14 phones + 2 GMs + TV, simultaneous buys, score storms, group refresh, Wi-Fi drops, crash under load, latency |
| seating (`e2e/seating/run.mjs`) | table resize handles and limits, moving tables, drag players onto seats, swap, unseat, dropdown fallback, TV floor dots + table close-up |
| r11-account-switch | sign out and in as someone else in one tab with a second tab open: lands on home, Minter counts for the right account, tabs never mix accounts |
| features (`e2e/features/run.mjs`) | Oct 28 round: gold 0.01/TV 0.1, Dashboard timeline + length edit, time guards, schedule drag + clashes, seating timing, chat + GM read, wiretap, Minter rework, upload progress |
| pwa (`e2e/features/pwa.mjs`) | iPhone home-screen app: manifest + icons served, iPhone tags on /play only, Add to Home Screen hint only in iPhone Safari, joining from the home-screen app |
| ttr (`e2e/boards/ttr.mjs`) | Ticket to Ride USA + Europe boards in the real app: library entries, render on laptop/phone, final scores saved, tie keeps no crown, recap on phones |
| boards (`e2e/boards/run.mjs`) | Risk board end to end: tab appears, edits save and move the crown, re-roll spends once, eliminator takes territories, second GM syncs, result pre-fill, recap on phones |

**Known false positives** (checked by hand; not app bugs): r03 "selling locked…" and "past the invest cap" (the app
correctly answers "one trade per tick" / "not enough gold"); r05 "Start disabled while paused" (timing; it is disabled);
r06 "paused laptop shows the PIN lock" (text check misses the PIN placeholder; it does lock); r09 `{"market":null}` → 200
(null resets a settings section by design); r10 "hourly handicap check" (a test server restarted at 60× resets its clock).

## Simulated game night at 60× (`night/`)
10 phones, 1 GM switching between laptop and phone, the TV; 2× 4-player Catan, then 6-player Risk alongside more Catan.
Catan uses real data (median 71 turns from 251 colonist.io games); Risk is modelled (`night/models.mjs`).

```sh
mkdir -p e2e/.out/night e2e/.out/night-data
ZS_TIME_SCALE=60 DATA_DIR=e2e/.out/night-data MEDIA_DIR=e2e/.out/night-media PORT=8097 npm start &   # test-only clock
NODE_PATH=$(npm root -g) node e2e/night/run.mjs e2e/.out/night test-data/packs/catan-risk.json   # ~10 min
```
Writes `result.json` (plan, results, issues, console errors, hidden-field leak scan of every frame, latency, final state,
the GM night export, statements), `events.log` and `shots/`. `SEED=` changes the night. Never point it at a real night's data.
