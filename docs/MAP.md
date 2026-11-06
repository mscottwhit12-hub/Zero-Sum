# Where things are

One page to find the file for a change. Paths are under `packages/` unless they start with `e2e/`, `docs/` or `copy/`.
Rules (pure, no I/O) live in **engine**, shared by the server and the client. The **server** stores and serves them;
the **client** has three apps: `play/` (phones), `gm/` (GM console), `tv/` (display).

## Check that everything still works
| What | Command |
|---|---|
| Types, unit tests, build (short summary; full log `e2e/.out/check.log`) | `npm run check` |
| + quick browser set (tables, seating, seats, features, swipe, bets) | `npm run check -- --e2e` |
| + named / all browser harnesses | `npm run check -- --e2e tables,risk` · `--e2e all` |
| A ready-made test night for a new browser check | `e2e/lib/night.mjs` (`testNight`) |
| "Nothing crosses or is cut off" audit for floor plans / TV | `e2e/lib/audit.mjs` (`layoutProblems`) |

## By feature
| Feature | Rules (engine) | Server | Client |
|---|---|---|---|
| Every setting, default, validation | `engine/src/settings.ts` | `services/state.ts` (night settings) | GM `gm/screens/Settings.svelte`; simple dials `gm/screens/tuning.ts` + `Tuning.svelte` |
| Market tick (all stocks, noise layer) | `engine/src/market/tick.ts` | `services/market.ts` (runs each tick), `tickLoop.ts` | — |
| Player / index / crypto / event / dead stock models | `market/player.ts`, `indexFund.ts`, `crypto.ts`, `event.ts`, `dead.ts`, `fair.ts`, `clamp.ts` | `services/indexTerms.ts` | phone `play/apps/Market.svelte`; GM `gm/screens/Market.svelte` |
| Trading, fees, caps | `market/trade.ts` | `services/trading.ts` | phone `play/apps/Market.svelte`, `Wallet.svelte` |
| Mood (GM reported mood → jitter, reported mood → push) | `engine/src/mood.ts` | `services/field.ts` (records, GM view) | GM `gm/screens/Mood.svelte` |
| Game scoring, payouts, standings | `scoring.ts`, `standings.ts`, `money.ts` | `services/games.ts`, `boardGold.ts` | GM `ScoreEntry.svelte`, `ResultWizard.svelte`, `Games.svelte` |
| Game boards (Catan, Risk, poker, …) | — | `services/boards.ts` | GM `gm/boards/<game>/` (+ `contract.ts`, `index.ts`); phone `play/apps/CatanApp.svelte`, `RiskApp.svelte` |
| Seating, tables, colours, props | `engine/src/props.ts` (prop kinds, fit, colours) | `services/seating.ts` | drawing `shared/FloorPlan.svelte`, prop art `shared/propArt.ts` + `PropSprite.svelte`, seat maths `shared/seating.ts`; GM `gm/screens/Seating.svelte`; TV close-up `tv/TableView.svelte` |
| Votes / incoming call, kingfall | `votes.ts`, `clock.ts`, `kingfall.ts` | `services/votes.ts` | phone `play/apps/Vote.svelte` |
| Achievements, hints, handicaps | `achievements.ts`, `hints.ts`, `handicap.ts` | `services/achievements.ts`, `hints.ts`, `handicap.ts` | GM `Handicaps.svelte` |
| Minter (idle mini-game) | `minter.ts` | `services/minter.ts` | phone `play/fun/minter/` |
| Bets | `betting.ts` | `services/betting.ts` | phone `play/apps/Bets.svelte`; GM `gm/screens/Bets.svelte`; text `shared/betText.ts` |
| Espionage memos | — | `services/espionage.ts` | GM `Espionage.svelte`; phone `play/apps/Messages*.svelte` |
| Chat, wiretap, feed | — | `services/chat.ts`, `feed.ts` | phone `play/apps/Chat.svelte`, `Feed.svelte`; GM `Chats.svelte`; text `shared/feedText.ts` |
| Join, rejoin, late join, devices | `lateJoin.ts` | `services/join.ts`, `players.ts`, `auth/` | phone `play/Join.svelte`; GM `Players.svelte`, `Devices.svelte`, `JoinQr.svelte` |
| Night lifecycle, pause, end, finale | `endNight.ts` | `services/night.ts`, `finaleControl.ts`, `recap.ts`, `nightReport.ts` | GM `Dashboard.svelte`, `NightTimeline.svelte`; TV `tv/Finale.svelte` |
| Statements, exports, archive | — | `services/exports.ts`, `pdf.ts`, `zip.ts` | phone `play/Statement.svelte`; GM `Archive.svelte` |
| Sounds, music | — | `services/sounds.ts`, `soundPack.ts`, `music.ts` | GM `Sounds.svelte`; TV `tv/music.ts`, `tones.ts` |
| Game library, packs | — | `services/library.ts` (+ `test-data/packs/`) | GM `Library.svelte` |
| Phone home screen, leaderboard swipe | — | — | `play/App.svelte`, `play/Leaderboard.svelte`, `play/phone.css` |
| TV display | — | `services/views.ts` (`tvView`) | `tv/App.svelte`, `tv/tv.css` |
| GM console shell, nav, theme | — | `services/gm.ts` (GM auth), `auth/attempts.ts` (login brake) | `gm/App.svelte`, `gm/gm.css`, `gm/lib.ts` |

## Plumbing
| What | Where |
|---|---|
| What each screen receives (GM / phone / TV views) | `server/src/services/views.ts` |
| REST routes | `server/src/routes/index.ts` (+ `guard.ts`) |
| Live updates (sockets) | `server/src/sockets/index.ts`; client `shared/socket.ts` |
| Database tables + upgrade steps | `server/src/db/migrations.ts` (append only) |
| Security headers, CSP, app setup | `server/src/app.ts` |
| Client API calls, toasts, formatting | `shared/api.ts`, `shared/ui.ts`, `shared/format.ts` |
| Shared client types | `shared/types.ts` |
| All player-facing words | `copy/en.json` (via `shared/copy.ts`) |
| Simulation (balance targets) | `sim/src/` (`npm run sim -w @gn/sim`) |
| Browser harnesses | `e2e/` (see `e2e/README.md`) |
| Engineering handoff (how it works now) | `docs/HANDOFF.md`; build history `docs/HISTORY.md` |
