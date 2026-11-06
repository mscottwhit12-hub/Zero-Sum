# Zero-Sum — Build history

Every build so far, oldest first (moved out of `docs/HANDOFF.md` §4 on Nov 6 so the handoff stays short). New builds get a subsection at the end.

### History

| Phase / build | Content | Commit |
|---|---|---|
| 0 | Concerns review (decisions 1–7) | — |
| 1 | Engine + tests | `27335f7`, `c896ab5` (auto-sell fee) |
| 2 | Simulation, tuning, ×3 game gold, 27 player types + skill study | `5fa66f7` … `c5e3fc1` |
| 3 | Server core: schema, setup, GM auth/remote lock, state machine, tick loop, sockets, audit | `14825f9` |
| 4 | GM field flow + basic TV, library packs | `91e5b2d`, `a0a322f` |
| 5 | Phone shell, join/rejoin/late join, trading, messages | `582ddba`, `491ecdf` |
| 6 | Votes/incoming call, mood, kingfall, espionage, re-rolls, achievements, notifications | `c4c9393` |
| 7 | Placeholder TV broadcast, sound, seating, rulebook, Minter, broadcast throttle | `c4c9393` |
| — | Docker install + README | `81b5363` |
| 8 | Prompts, collapse/podium/recap, statements + PDF, exports, archive, join QR | `ffeafeb` |
| Oct 26 | Install confirmed on the user's server | — |
| Oct 27a | Score entry, payout curve, index growth, crypto trend, hint rewards, handicaps; test-only time scale + Catan/Risk test pack | `2d663c4` |
| Oct 27b | Fixes from 10 bug-hunt rounds; Fastify 5.12.7 | `00c462c` |
| Oct 27c | Performance fixes 1–6 (price-history cache, lean broadcasts, cached snapshots, compression) | `5d5a40f` |
| Oct 27d | This handoff + browser harnesses committed under `e2e/` | `1c9d0de` |
| Oct 28 | Feedback round: gold to 0.01, auto-rejoin on the home phone, night length edit + running-over offer, time guards, schedule timeline, player chat + wiretap, Minter idle rework, wide GM layout | see §4b |
| Oct 27e | Seating rework (resize, drag-to-seat + swap, 2–8 seats, TV floor/table rotation); sim models index growth; per-game GM boards + Risk board; classics pack | see §4a |

### 4a. Oct 27e update (seating, sim, game boards)
- **Seating:** tables are resizable rectangles (right edge = length, bottom = width, corner = both; sizes are fractions of the plan width on a fixed 3:2 plan). Players are dragged onto seat icons (dropdowns kept as fallback); a seated player dropped on an occupied seat swaps. **2–8 seats per table**; a table's minimum size grows with its seats. Shared `shared/FloorPlan.svelte` draws GM + TV.
- **TV rotation:** up next → market → full floor (seats filled/empty only) → one close-up per seated table (`tv/TableView.svelte`, names readable at 1080p) → minters.
- **Sim:** `runner.ts` passes index growth (`indexExtra`) like the server. Index now ~+7–8%/night in the sim: **accepted as an intended nerf**.
- **Game boards** (decision: GM gets a per-game tab while a game runs):
  - Contract `packages/client/src/gm/boards/contract.ts` (v1.1). Boards live in `gm/boards/<key>/` (`def.ts` pure logic + `Board.svelte` + tests) and are registered in `gm/boards/index.ts`.
  - Library/pack field `board` (key). `assets/classics.json` is seeded once on boot (`meta.classics_seeded`), so existing installs get Risk; trademarked names in the default install are now allowed (user decision).
  - Server `services/boards.ts`: versioned `game_board` state (stale writes → 409 `board_stale`, client reloads), board settings (Master only, `board_setting`, shown on GM Settings), recap sent once as private phone messages when the result is submitted. `POST /api/rerolls` takes a `requestId` (no double spend).
  - Client `gm/screens/BoardHost.svelte`: builds the context, saves (debounced), posts the board score to the crown, pre-fills the result screen from `placements()`.
  - **Risk board:** crown = reinforcements per turn; finish = territories, armies, then elimination order; an eliminated player's territories go to the eliminator (undo reverses it); 4–6 players.
- Migrations: **9** `game_table.map_w/map_h`; **10** `library_game.board`, `game_board`, `board_setting`, `reroll_use.request_id`.
- Tests: client 51 (Risk), engine 112, server 81, sim 4. Browser harnesses `e2e/seating` (21 checks) and `e2e/boards` (12 checks).

### 4b. Oct 28 update (feedback round)
- **Gold** shows to 0.01 everywhere (`format.gold`); the TV keeps 0.1 (`goldTv`, `feedText(..., { tv: true })`). Storage was already hundredths.
- **Rejoin on the home phone is auto-approved.** Phones keep a permanent `gn_phone` id (survives sign-out); `player.home_phone_hash` (migration 11) is set at join / late-join approval; `POST /api/join/rejoin {playerId, phoneId}` returns `{approved}`. Audit `device.auto_approve`. Any other phone still needs a GM.
- **Account switching on one browser:** the phone returns to home on any identity change, other tabs reload when `gn_device` changes (identity is per browser by design; per-tab identity was rejected), and the Minter only syncs as the account it opened with. Harness `e2e/rounds/r11-account-switch.mjs`.
- **Night length** is editable live (Dashboard → Edit length, Master). Never below time played; started quarters keep their times and later ones re-spread (`respreadQuarters`, stored in `night.quarter_plan`, migration 12).
- **Running over** (`prompts.overrunDivisor`, default 8): when the night's end arrives with games running, a Master banner on every GM screen offers +planned length ÷ divisor, biggest first; "no" moves to the next game; "yes" extends and the cycle repeats. `POST /api/night/overrun {gameId, accept}`.
- **Time guards:** confirm before starting out of order / with a player already playing / at a busy table; double-booking warning when scheduling; a game scheduled in the past (live night) just starts. Tags: **Filibuster** (running past planned length), **Tardy** (scheduled, past its start). One clock style (`shared/gameTime.ts`) on game cards, Games list, board header, Seating plan and TV tables. Dashboard **night timeline**.
- **Schedule timeline** (Games screen, `ScheduleTimeline.svelte`): blocks sized by time; rows = tables (drag between rows to change table) or players; drag to move (5-min steps, never into the past), drag the right edge to resize, drag unscheduled games in. Overlaps stack in lanes; clashes (player or table double-booked) show red.
- **Player chat** (`services/chat.ts`, migration 13): one-to-one (reused) and group threads; every message kept with its time; members get `chat:message`; phone **Chat** app with unread badge; GM **Player chats** screen; included in the night export. **Wiretap** memo reward (`mode: any | pair`): one random message from a chat the holder isn't in (any chat, or between two chosen players); victims are never told; audit `wiretap.use`.
- **NFT Minter** (Adventure Capitalist style; still fun only): credits are the big number, NFTs minted secondary; leaderboard = lifetime NFTs minted. Milestones (×2 at 10/25/50/100/200 owned), upgrades (Overclock ×3 per generator, mouse/keyboard tap multipliers), managers (unmanaged generators only mint while the app is open), Rebrand for investors (+5% each). State extras in `minter_state.extra` (migration 14). Numbers are placeholders in `engine/src/minter.ts`.
- **Wide GM layout:** content fills a centred 4:3 area (min 1100px). Risk board on wide screens: table/standings/history left, every player's panel in a scrolling right column.
- **Sound upload** shows a progress bar.
- Tests: client 51, engine 116, server 90, sim 4. Browser: `e2e/features/run.mjs` (21 checks), `r11` (5).

### 4d. Phone theme (Server, Oct 29)
- Dark "burner phone" theme on the player phone only (`play/phone.css`, vars on `.phone`; GM untouched). Dock: Chat, Market, Messages, Feed. Fonts in `assets/fonts/` with licences (GFS Baskerville, Carlito, Latin Modern Mono). App open/close zoom (`play/zoom.ts`, reduced-motion respected).
- Screen scripts unchanged; only markup/CSS. Browser tests now select by the new class names: `button.app`, `.nb`, `button.r`/`span.t`, `button.pick`, `button.tipc`/`.rd`.
- Open (Server's next drop): serif digits/apostrophes, Minter button size, toasts over dock, stamp overflow. Claude: move the new hardcoded English to copy. TV theme is phase 2.

### 4e. iPhone home-screen app (Oct 29)
- `/play` is installable on iPhone (Share → Add to Home Screen): opens full screen, dark status bar, Zero-Sum icon. Files: `packages/client/public/` (manifest, icons), tags in `play.html`. GM/TV not installable.
- iPhone Safari shows a dismissible hint on the join screen to add to the home screen **before** joining: the home-screen app has its own storage, so a player who joined in Safari would need a GM-approved rejoin there.
- No service worker / offline (the app needs the server; avoids stale builds). Android: over plain http it's only a shortcut; a real Android app is a later idea (Tate).

### 4c. Ticket to Ride boards (No, Oct 28)
- Two boards: `ticket-to-ride` (USA) and `ticket-to-ride-europe` (stations). Final-score boards: trains left (final-round warning), last turn done, the final score the players count, tickets (tie-break), optional points breakdown and a copyable stats report. No live leader: the crown sees scores only once every player has one; a tie at the top keeps no crown (locked rule).
- Classic games now seed **per game by name** (`seedClassics`, meta `classic:<name>`), so new classics reach existing installs; deleted ones stay deleted.
- Bug log: `docs/boards/ttr-bug-log.xlsx`. Browser test `e2e/boards/ttr.mjs` (8 checks). Client tests now 198 (Risk + both TTR).

### 4f. Oct 29 real-hardware feedback round (Claude built; local commits on `feedback-oct29`)
- **Vote call** hangs up after voting (Vote app closes to home ~0.7 s after a saved pick).
- **Schedule drag** bug: `PATCH /api/games/:id` didn't broadcast, so the timeline kept the old start and the next drag measured from it. Now emits `game:update` + refresh. Harness `e2e/features/sched.mjs`.
- **Audio upload**: cap 30 MB (`SOUND_MAX_MB`, route body limit 42 MB for base64), FLAC accepted (`fLaC` signature), client checks type/size first and always shows an error (FileReader failures included); MIME is set from the file extension.
- **Early vote**: `POST /api/night/vote-early` (any GM; Dashboard "Open next vote now"). Opens the next unvoted quarter now with its own window (`vote_round.window_end_nms`, migration 15); the quarter's times don't move; drift applies from its start; bounty at its end. `voteStep` now handles several unresolved rounds; End voids an early round whose quarter never came.
- **Past-night-end warning** when scheduling, moving or resizing a game (`pastNightEnd` in `gm/lib.ts`).
- **Risk over-map warning**: totals above `territoryTotal` are allowed but warned (header + player panel).
- **Live standings → stocks** (hidden): `liveLevels` (engine) per scored game, stored in `game.live_levels` (migration 16), summed into each player's target as `live` (band units). Top 50% up tapering, bottom 25% down, zero-sum; updated on every score entry, kept after the game (stacks with the result: accepted). Manual-crown games excluded. Setting `market.player.liveMax` 0.05.
- **Shorting = inverse share**: `openShort` / `coverShort` (engine), short lots carry `entry` (migration 17: `lot.short`, `lot.entry`, `trade.short`); value = shares × max(0, 2·entry − price). Not your own stock; sale-sized impact; shared invest cap, same fee and lockout; auto-closed at End with the 10% profit fee. Trades: open = side `sell` + short, cover = side `buy` + short. Phone Market: Short / Close short; Wallet lists shorts.
- **Risk battles**: def `battle()` (territories defender → attacker, optional casualties and rounds; one history line). GM Battle panel. Players: phone **Risk** app (only for players in a running Risk game) with live standings and an optional battle log → `board_claim` (migration 18), GM approves/rejects on the board (first decision wins; pending entries void at result/cancel). **Board contract v1.3**: `ctx.claims`, `ctx.decideClaim`.
- **End-of-night package** (`services/nightReport.ts`): statement gains `stats` (net worth line, games + gold, trades/fees, best short win, own stock line high/low/close, biggest backer, bounties, re-rolls, Minter rank, play vs idle, chat count, fun title). PDF adds these + charts. 3 SVG cards `GET /api/me/cards/:n.svg` (phone saves/shares as PNG). GM `GET /api/export/package.zip` (Master): every player's PDF + cards, `night-summary.pdf`, JSON + CSVs (own zip writer, `services/zip.ts`). Styling is functional; Server styles later.
- Replay animations / drop "Best investment": **Server, later**.
- Harness `e2e/features/oct29.mjs`.

### 4g. Oct 29–31 QoL rounds (Rocket League; QoL-1…9)
- **Risk board import fix** (`library.importPack` no longer nulls `board`; `seedClassics` repairs null boards). **Tick countdown** on GM Market, phone Market and the TV header (`lastTickAt`, `secondsToNextTick`).
- **Audit log in plain language** (`gm/auditText.ts`, "Computer speak" toggle shows the raw JSON) and **filters** (`gm/auditFilter.ts`: hide / only a game, player, GM, kind of event or text). Board edits are audited (`board.edit`).
- **Draggable empty seats** (`game_table.seat_pos`, migration 19; GM Seating + TV; "Even out seats" resets). Per-game boards still draw seats evenly.
- **Phone**: waiting/denied text clears the iPhone notch (`.pad.edge`); the background bar lines are one fixed layer (`.bars`) so app zooms never scale or cut them; **swipe right on home → full-screen Leaderboard** (page dots; dock hides there); the Standings app is gone.
- **Rejoin trust** (`player_phone`, migration 20): a phone a GM approves is remembered (several per player). **GM sign-in is name + password only**: no device chooser or check (layout is detected; Devices screen can still switch it); the `gn_gm` cookie is a **session cookie** (signs in again after the browser closes).
- **Bets** (migration 21: `bet` table, `adjustment.kind = 'bet'`; `engine/betting.ts`, `services/betting.ts`, phone Bets app, GM Bets screen). Player-to-player only: win ("X wins") and place ("X in the top 2–5") bets on a scheduled/running game, odds "a to b" (1–10 each), open to all or one named player. The offerer risks the stake and wins stake×a÷b; the taker risks that amount. The most either side can lose is `betting.maxStake` (5 gold); a **High Roller ticket** (new challenge reward `high_roller`) lifts it to `betting.ticketMaxStake` (10) for one bet. Stakes are held through the gold ledger when a bet is taken (they leave cash but still count toward net worth) and paid when the result is recorded. Tie, cancelled game, night end, GM void, or a player who wasn't in the game: stakes go back. Open offers lapse when the game ends. Only people in the game's player list can be bet on; a top-N that can't lose is refused. Settings: `betting.enabled / maxStake / ticketMaxStake / maxOpenOffers`. A correction after payout does not re-pay.
- Harnesses: `e2e/seating/seats.mjs`, `e2e/swipe/pages.mjs`, `e2e/bets/bets.mjs`.

### 4h. TV theme (Server, v7; Nov 1)
- TV restyled (`tv/tv.css`, new; imported by `tv/App.svelte`) with Server's markup in `App`, `Finale`, `TableView`; scripts unchanged except the CSS import and the seat-relax import. Crawl is ~2× (`--crawl-fs`/`--crawl-h` on `.tvroot`); the header keeps the tick countdown; close-ups use dragged seats (`relaxSeats`). A banner reserves its own row above the crawl (`.tvroot:has(.banner) .tv`), so it never covers panels.
- Phone fixes 1–4 (`play/phone.css`: Carlito digits, `.wd`/`.big` overflow, 44px Minter buttons, toasts over the dock) and `Rules.svelte`. "Best investment" finale slide dropped (`services/recap.ts`, `phase8.test.ts`).
- Known: on a floor with tables placed side by side near the plan edge, a seat dot can sit behind the neighbouring table (shared `FloorPlan`, placement data, not theme).

### 4i. Uno, Parcheesi, Sorry!, Yahtzee boards (No, Nov 1)
- Four boards in `gm/boards/{uno,parcheesi,sorry,yahtzee}`, registered in `boards/index.ts`, classics entries in `assets/classics.json` (all `leadMode: "high"`). Client tests 641 (+203). Browser test `e2e/boards/no2.mjs` (17 checks).
- **Tate reviewed no rule on Uno, Parcheesi or Sorry!** ("default rules for all of the rest"); their rules are No's/Claude's picks (see each pack's NOTES). Uno: rounds to 500 (setting), live crown. Parcheesi / Sorry!: pawn counts per zone, live crown by pawns home then Home path / Safety. No slides, blockades or board positions.
- Yahtzee (Tate decided): 13-box sheet, optional live tracking, smart entry, upper bonus 35 at 63, Yahtzee bonus 100, no crown until the game ends, 2–8 players. **Open:** player phone app where players fill their own boxes and the GM approves needs a new claim kind in contract v1.3 plus server support; not built.

### 4j. Stock halt (QoL, Nov 1)
- Any GM can **Halt** a stock from GM Market (any kind, incl. index/crypto/event). One transaction (`field.ts` `haltSecurity`): every open position (long and short) is closed at the current price with no fee, no impact, no lockout (forced trades, `liquidateAll` with fee 0); the price freezes (`SecurityState.halted`; `tickMarket` keeps it still); nobody can trade it (engine error `halted`, HTTP 409). Holders get a private Compliance message; feed item `feed.stock_halted` becomes a BREAKING banner on the TV and appears on phones (copy in `copy/en.json`). **Relist** (`/api/securities/:id/relist`) resumes it; closed positions stay closed. Both are in the audit log (`market.halt`, `market.relist`).
- Phone Market shows "· HALTED" and a notice and disables Buy/Short/Sell. Harness `e2e/features/halt.mjs`.

### 4k. Kingfall grace period (QoL, Nov 1)
- A Kingfall (hidden crypto spike + GM-only feed item) now waits `market.crypto.kingfallGraceSeconds` (15 s) with the king still out of 1st, so a GM input mistake fixed in time costs the king nothing. Engine: `CrownState.pending`, `tapLeader` (no more `kingfall` flag), `dueKingfall`, `clearPending`. If the king retakes 1st inside the window the Kingfall is cancelled and their reign (`since`) is restored.
- Server: `crownReplay` / `settleKingfall` / `kingfallStep` (tick loop, 1 s) in `games.ts`; `leader_tap.kingfall_fired` (migration 22, all existing taps marked fired). A tap after the window settles first; submitting the game's result fires a waiting Kingfall immediately. The public "dethroned" item is still immediate.

### 4l. GM console restyle (Server, Nov 1) and Soundboard 1 (Ollama, Nov 2)
- GM console: `gm/gm.css` (GM page only; `shared/base.css` untouched) redefines tokens: light = ledger paper, dark = forest night; radius 8 px controls / 12 px panels; 44 px controls + 16 px text on phones/touch or GM phone layout. Scripts unchanged. Claude's fix: "Up next" rows stack below 560 px; inputs/selects `min-width: 0; max-width: 100%`. Every GM screen and board fits 360 px.
- Soundboard 1: tag-driven TV music. Server `services/music.ts` (Auto rules: night state → tag, a running game's library sound theme wins; manual override; Master-only), `services/soundPack.ts` (zip + `manifest.json`, 200 MB cap, lazy zip reader), migration 23 (sound tags/credit/source_url/license), `/api/music`, `/api/audio/settings`, `/api/sounds/pack`, PATCH sound; `/media/sounds` serves FLAC and HTTP Range (Safari). TV `tv/music.ts` (shuffle without repeats, lone track loops, crossfade, ducking under cues; silent until "Enable audio"; reports `music:now`). GM Sounds screen rebuilt (Music, Play by tag, Credits). Audio files are never in the repo: Tate's two LonePeakMusic tracks are an importable pack (licence: use with credit; redistribution unclear).

### 4n. Three QoL fixes (Nov 3)
- **Rename sounds:** the Master's Soundboard > Library list has an editable name for every sound (soundboard buttons, cues, music). Uses the existing `PATCH /api/sounds/:id`; the board button follows.
- **Big music files:** music (kind `ambient`) can be up to 1 GB (`AMBIENT_MAX_MB`); cues and soundboard buttons stay at 30 MB. The Soundboard upload form now sends the raw file to `POST /api/sounds/file?name=&kind=&tags=...` (content-type audio/*, Master only), streamed to disk (temp file, bytes checked, renamed on success; refused uploads leave nothing behind). The old base64 `POST /api/sounds` still exists (30 MB). Sound **packs** are still capped at 200 MB in total (buffered in memory). A reverse proxy in front of the server must allow big bodies (nginx `client_max_body_size`).
- **Mood:** `mood.moodMax` 0.06 → 0.10 (mood bias up to ±10%).

### 4m. Texas Hold'em board (Jim) + poker for gold (Nov 3)
- Board `gm/boards/poker/` (key `poker`, classics: 2–10 players, 3 h, re-rolls off, crown = chips). Tournament or cash game; chip calculator (`chips.ts`: up to 8 colours, values from real ladders, bank share 10–100% to players, default 1/3); buy-ins marked in (cash/Venmo or gold) before the first hand (`requirePayment`); everyone cashes out at chip value; one-tap bust moves chips to the winner.
- **Board contract v1.4:** optional `BoardDef.gold(state, ctx)` → `{ held, payouts }` in gold, sent by `BoardHost` with every save (undefined = board never touches gold; null = nothing held).
- Server `services/boardGold.ts`, migration 24 (adjustment kind `game_stake`, `board_gold`, `game_board.gold`): holds reconciled on each save (cash down, net worth unchanged, like bet stakes); at the result the pot is paid in proportion to the latest payouts, scaled to the pot (zero-sum, largest remainder); cancel / End night refund. Holds aren't capped by cash (cash can go negative while held).

### 4n. Phone Catan app + no negative gold holds (Nov 5)
- Contract v1.4 also adds `BoardClaim` kind `build` (`{ playerId, action: settlement | city | longestRoad | largestArmy }`); boards narrow on `kind` (Risk uses `BattleClaim`, Catan `BuildClaim`). Server `createClaim` accepts Catan actions (own only); `playerBoardGames` returns Risk and Catan games (Catan points from board settings, defaults mirrored in `CATAN_DEFAULTS`). Phone `play/apps/CatanApp.svelte` (⬡, only while in a running Catan game); Catan board "From players" panel (`applyBuild`, `buildProblem`). Harness `e2e/boards/catan.mjs` covers the phone flow.
- `checkBoardGold`: a save that would hold more gold than a player's cash is refused (`not_enough_gold`); BoardHost reloads like a stale save.

### 4o. Security, camera roll, Minter polish (Nov 5)
- `services/zip.ts` `zipIndex`: declared-size inflate cap (mismatch → `zip_corrupt`), `maxTotalBytes`, `maxRatio` (big entries > 100:1 → `zip_bomb`), checked before any decompression.
- `auth/attempts.ts`: brute-force brake on `/api/gm/login` (per name+IP and per IP) and `/api/gm/unlock` (per GM): 5 free wrong tries, then 30 s doubling to 15 min (`429 too_many_attempts`). In memory.
- `app.ts` onSend: nosniff, `X-Frame-Options: DENY`, no-referrer, COOP; strict CSP on HTML (`script-src 'self'`; styles allow inline for Svelte; img/media allow data:/blob:; ws). Any inline `<script>` in the built pages would break: there are none.
- Statement cards render the PNGs (press-and-hold → Save to Photos); only the button opens the share sheet.
- Minter client counts whole cycles like `advanceMinter` (no drop at sync), time from the request, monotonic display, rAF ~30 fps; cycles < 0.25 s show a full bar. Rebrand themes `play/fun/minter/themes.svelte.ts` (5, rotate by `rebrands % 5`; `minterBrand` drives the phone header/home label).

### 4p. Swipe back, stock detail (Nov 5)
- Phone home pager: touch handled by `swipeTouch` (touch events; `preventDefault` once a swipe is sideways so the scrolling leaderboard can't take it), pointer events only for mouse/pen; flicks (>25 px, <300 ms) count. `.pager .board` has `touch-action: pan-y; overscroll-behavior: contain`.
- Phone stock page shows `TickCountdown` under the range chips. GM Market: ticker buttons open a stock detail (chart from `GET /api/gm/market/:id/history`, ranges, countdown, mood/offset).

### 4q. QoL small + medium batches (Nov 5)
- Phone top bar = market countdown (`secondsToNextTick`); TV finale avatars (`av` snippet, photo or initials); Risk app `battles` from the board log; GM nav main/minor tabs; `Sparkline` `scrub` (+ `from`/`to` for times); table `rotation` (migration 25, 15° steps; FloorPlan rotates table + seats, counter-rotates avatars, resize/seat-drag/drop in the table frame; TV close-ups unrotated).
- BoardHost shows the game's table (FloorPlan, view only, zoomed). Seating mismatch warning + optional fix. `play/CropPhoto.svelte` at join (`encodeAvatar`). TV vote call → "Answer your phones." 1 min (`callUntil`).
- Finale control: `services/finaleControl.ts` (in-memory clock per night: `start`, `pausedEl`; `finaleSegments`; recap_until follows; `POST /api/night/finale/control` next|prev|pause|play); night info carries `finaleCtl`, `finaleSegments`; TV `finale:ctl` event.
- Settings: `gm/screens/tuning.ts` + `Tuning.svelte` (dials = multipliers on `DEFAULT_SETTINGS`, ×0–×3; games/cap ≥ ×0.25); all settings under Advanced. Server test `tuningLimits` keeps dial paths valid.
- Dead-stock pump (sim): accepted as an intended mechanic (Tate, Nov 5).

### 4r. Table props (Nov 5)
`6218e9c`. QoL 17. Original SVG sprites (`client/src/shared/propArt.ts`, 23 kinds in `engine/src/props.ts`: 11 game boards, poker pieces, drinks, smokes). Migration 26 `table_prop` (per night, table frame fractions x/y/w + rotation). GM Seating: palette, drag, corner resize, turn, remove (`POST /api/tables/:id/props`, `PATCH|DELETE /api/props/:id`, master). A game starting at a table places its board (`placeGameBoard`); result/cancel/end night clears it. Table w/h locked while it has props (`table_has_props`). Drawn on GM floor plan, TV floor and close-up. Awaiting Tate's device check.

### 4s. Table colour, upright labels, visual audit (Nov 5)
`7284ebe` + `59d74ba`. Migration 27 `game_table.color` ('#rrggbb'/null; drops bottle props). Bottle prop removed. Table text always upright (counter-rotated) and sized to fit inside the turned table (`stripRoom`/`fitLabel` in FloorPlan: shrink → 2-line wrap → …). Prop pill drops the game name before cutting. Seat names have a backing. TV close-up refits props to its own shape; close-up seat names shrink to fit. Known: 40-char names on tiny tables still end in …; only a table's centre is clamped to the plan, so edge tables can push seats off it. Awaiting Tate's device check.

### 4t. Drag-to-turn, mood rework (Nov 5–6)
`2c0ee0b`: selected table/prop gets a ⟳ knob (top-left); drag round the centre, 15° steps. `023d6a6` + curve commit: QoL mood rework. Background noise on every stock (`market.noise`: ±0.30 gold ≈ 2 SD, half OU wander / half per-tick jiggle; laid over the model price in `tickMarket`, state `nz`/`nzDrift`, causes `noise`/`noiseSize`). GM reported mood → jitter (`mood.jitterMax` 3 gold at mood 1, `jitterCurve` 2.15: 3 → ±0.91, 4 → ±0.44, 5 → background), fades like the push. Reported mood (self-assessment) alone → push (±`moodMax` band). GM Mood screen labels "GM reported mood" / "Reported mood"; tuning dials for jitter and background noise. Sim 200×12p default 9/9. Awaiting Tate's device check.
