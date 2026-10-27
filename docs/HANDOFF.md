# Zero-Sum — Engineering Handoff

**As of:** Oct 27 2026 · **Repo:** `github.com/mscottwhit12-hub/Zero-Sum` (public, MIT) · **Branch:** `main`
**Status:** Build plan Phases 0–8 complete. First real Docker install on the user's server is in progress (see §13). No real-device test night yet.

This document is the complete context for the next lead engineer. Read §1–§5 before touching anything. The original spec ("Game Night Platform — Build Spec v1") and the "Decisions Log" live in the claude.ai Project **GAME_NIGHT**. Where this document and the spec disagree, **this document and the Decisions Log win** (they record later, user-approved decisions).

---

## 0. Reading order

1. §1 What it is · §2 How to work with this user (strict) · §3 Locked decisions
2. §4 Current state and what's next
3. §5–§9 Architecture reference (engine, server, client)
4. §10–§15 Hidden mechanics, sim, tests, deployment, known issues, backlog

---

## 1. What it is

A self-hosted LAN web app that wraps an in-person board/card game night.

- 10–20 players on their own phones (browser, no install, fake "burner phone" OS UI).
- One Master GM plus optional Sub GMs (GM console, laptop or phone layout).
- One TV at `/display` (fake financial news broadcast).
- Games earn **gold** (`hours × players × placement mult × goldScale`). Gold is the score, the trading money, and every reward. Never say "points".
- Every player is a **stock**; anyone can buy any stock (including their own) with gold. There are also an index, a crypto coin, two event stocks and a near-dead stock.
- Quarterly polls ("who leads at quarter end?") pay a small real bounty. Vote share **secretly** drifts stock prices.
- Mood rounds, kingfall, espionage memos, re-roll tokens, achievements, notifications, NFT Minter (fun only), seating, rulebook, sounds.
- The night ends in a **market collapse**: trading closes, all holdings auto-sell, the TV plays a finale (crash → podium → recap), and phones unlock into a **Final Account Statement** with a PDF.
- Theme: shady corporate / insider trading, played straight. Brand placeholder **"Bullion & Associates"**, TV **"BNN — Bullion News Network"**, GM = **"Compliance Office"**. All copy is in `copy/en.json`.
- Product/repo name: **Zero-Sum**. The in-app brand was deliberately left as Bullion & Associates; the user hasn't asked to rename it.

Open-source rules (spec §1.2): no hardcoded personal content (games, rules, sounds, photos are data); bundled assets must be redistributable; first run creates Master GM credentials (no default passwords); install = `docker compose up` + README.

---

## 2. How to work with this user (strict)

These are standing preferences. Violating them has caused friction before.

- **Style:** sharp, terse, about a third of normal length. No softening, praise or filler. No recaps of what they already know.
- **Questions:** one at a time, with lettered options (A/B/C, one line each), a **recommendation** with a 1–2 sentence reason, closing with **"Go with X?"**.
- **Short answers are decisions** ("b", "C", "yes A"). Lock them in, confirm in one line, move on. Additions mid-answer ("B, but also X") are locked too.
- **Decision rules while coding:**
  - Small implementation choices (lib versions, folder names, internal APIs): decide yourself.
  - Anything that changes gameplay, what players or the GM see, or a locked decision: **ask first**.
  - **Every gameplay number is a tunable GM setting** with a default. Never hardcode one.
- **Do not build features the user only asked about.** Verbatim: *"Do not code this new feature if it does not already exist I was just asking if it did."* (An unrequested trace feature was reverted.) Questions get answers, not code.
- **Don't invent data.** If the sim doesn't track something, say so.
- **Phase gates:** stop at the end of each phase with a ≤10-line report (what works, what's stubbed, deviations) and the next phase; continue only on "go".
- **Visuals:** keep them bland/placeholder. Claude may pick palette, names and copy within the theme. No detailed art/theme work until the user asks. Phase 7 TV look and Minter were explicitly "option A: basic placeholders".
- **Testing:** the user tests **only via installs from GitHub** (Docker on their Ubuntu server). Don't ask them to test from zips.
- **Infra:** the user owns Docker/Proxmox/LAN. Don't advise on infra beyond the README, unless asked (they did ask for Docker help, see §13).
- **Dependency policy:** pin exact versions; only use releases **≥ 2 weeks old**.
- Commits end with the attribution lines the session provides (Co-Authored-By / Claude-Session).
- User email (for attribution only): mscottwhit12@gmail.com. GitHub owner: `mscottwhit12-hub`. LICENSE copyright: "Tate".

---

## 3. Locked decisions (override the spec)

From the concerns review and later phases (mirrors the project's Decisions Log):

1. **Fair-price basis = earned gold only:** stake + results + adjustments + bounties + achievements. Trading P&L is ignored for fair price.
2. **Per-kind price bands**, each tunable: player 30–80, index 30–80, crypto 5–150, event 10–100, dead 1–40.
3. **Night clock excludes paused time**; quarters shift with pauses. **End force-resolves the open quarter and pays its bounty before auto-sell.**
4. **Late-joiner stake frozen at approval**, stored as a system adjustment (`kind = late_join`); never recomputed.
5. **NFT Minter is playable on the pause lock screen**, with intermission-only bonus (2× mint rate + one exclusive tier).
6. **GM price offset applies to player stocks only.**
7. **Quarter count is a GM setting (default 4).** 10% buffer at each end, middle 80% split evenly. The last quarter may resolve after trading closes (accepted).
8. **End-of-night auto-sell fee:** 10% of profit per position (player × security); losing positions pay nothing. Players are warned when trading closes.
9. **Game gold multiplier** `scoring.goldScale = 3`.
10. **Crown edge kept:** buying the crowned leader's stock before results is allowed ("reading the room").
11. **Market defaults (sim-tuned, approved Oct 24 2026, "subject to change"):** fee 3%, invest cap 25, player reversion 0.20, crypto σ 7% / reversion 0.05, kingfall +10%, dead impact 6% / reversion 0.02.
12. **Placeholder achievements keep paying real gold** until the user supplies the real list (First Mover 2, Hostile Takeover 5, Committed Associate 2, Market Oracle 1 hidden).
13. Espionage defaults: gold reward 3; TV reveals accept/reject after 15–45 s; dead-stock clue is fixed copy text.
14. Vote "decline" snoozes the incoming call **per device**; a two-device player gets the call on both (accepted as minor).
15. **Library is modular data** (JSON packs, import/export).
16. Phase 7 = **option A** (placeholder TV broadcast and Minter, no fancy graphics).
17. **License MIT**; repo `Zero-Sum`; testing starts only once it installs from GitHub.
18. **Score entry is the default crown** (Oct 26 2026). Each game has a lead mode: `high` (highest score leads), `low` (lowest leads) or `manual` (GM crown taps). The library game / pack sets it (`leadMode`, `leadLabel`); if unset, the GM picks when scheduling (default `high`). Locked once the game starts. A tie at the top keeps the current holder. Scores only move the crown (kingfall and dethroning unchanged); gold stays placement-based.
19. **Payout curve = linear** (Oct 27): 1st 1×, 2nd 0.5×, then even steps down to `scoring.floorMult` 0.10 at last place, never below the classic curve (`scoring.curve` 'linear' | 'classic'). 6 players: 100/50/40/30/20/10.
20. **Index growth (hidden from players, GM sees it):** base = average player stock (flat, zero-sum). Grows only while games run, by gold earned per night player (`market.index.growthPerGold` 0.23 ≈ +10–15% a night). A game's start dips the index by its expected gold per player × `startDropPerGold` 0.15; returned at its end; cancel removes its growth. Gentle mean-reverting wobble (`noiseFrac` 0.01). Derived from results every tick.
21. **Crypto downward trend:** `market.crypto.driftPerHour` −0.03; volatility unchanged; holding all night loses.
22. **Hint rewards ("anonymous tips"):** tiers common/rarer/rarest by how secret the mechanic is. Sources: game win + last place (≥15 min with 4+ players or ≥30 min with 2–3; >90 min rarer; >4 h rarest), two correct quarter picks in a row (rarer), first Server Rack/Data Center/Orbital Array (common/rarer/rarest), memo reward type `hint`, GM send (any GM), buy with gold (`hints.buy.enabled` off by default), trade one re-roll token for a common tip (once per 120 night-min). No repeats inside a tier; then next tier down; then repeats. Delivered in Messages as "Anonymous tip". Pool v1 (10 tips) in `engine/src/hints.ts` + `copy.hints`; more tips wanted (common tier especially).
23. **Handicaps (Master only, players never see them):** `handicap.autoEnabled` off by default. Hourly (night clock) auto level: top 50% = 1, bottom 50% = 2–5 by gap to the median on a composite (40% net-worth rank, 35% placements, 25% trajectory vs table); idle players −1 (min 2); running team games average their members. Effective = auto + Master's manual offset (−4..+4; the auto never removes it). Help per interval = gain(level) × projected night gold × interval/night length (gains 0/5/12/20/30%): 30% as an **anonymous gift** (adjustment kind `gift`, counts toward rank), 70% as hint credit spent on tips (value 2/4/8 gold). Help given stays. Corrections re-evaluate levels. GM Handicaps screen + log; GM export only.
24. **Poll window must fit inside a quarter** (server refuses otherwise).
25. **Games without a result at End are cancelled** (they paid nothing anyway); the End confirmation says how many.

### Rejected (spec §21, do not re-propose)
Fork an existing project · multiple apps · raw-score normalization · planned duration as a scoring input · ×100 display scaling · GM pre-creates players · per-second market · player-side seating · web push to locked phones · copying official rulebooks · ranking by gold only (net worth instead) · manual withdrawal before collapse · per-game/per-table stocks · event stocks for ties/dethrones/pauses/mood average (only re-roll + espionage) · **revealing hidden mechanics at the end** · auto-generated tickers · joining before the GM opens joins · rejoin by typing a username · public espionage success · gold-linear or blended fair price (rank-based chosen) · multiplicative drift/mood (additive, band units) · tab navigation on phones · notification banners (badges only) · auto-detecting GM device type · auto-lock on idle · auto night end or auto trading close · PNG statement (PDF) · rounding gold per payout (integer hundredths).

**Backlog, don't build unless asked:** shorts and calls, side bets, awards/superlatives screen, head-to-head records, trivia mini-game, printable night summary, local HTTPS for push, tradeable re-rolls.

---

## 4. Current state and what's next

### Phase history (all complete)
| Phase | Content | Commit |
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

### Immediately next
1. **Install confirmed** on the user's server (Oct 26; port mapping `6969:8080`).
2. Oct 27 build (see decisions 18–25): score entry, linear payout curve, index growth, crypto drift, hint rewards, handicaps. Verified by a 60× simulated night and 10 rounds of human-behaviour bug testing (scripts in the session scratchpad, not committed).
3. **First real test night** on physical phones and the TV is still the biggest unknown (vibration, iOS Safari, audio).
4. Open design items: more tips for the pool (especially common).
5. Waiting on the user: real achievement list, final brand/stock names, visual theme.

## 5. Architecture

### Stack (locked)
- **Single Docker container**, LAN only, plain HTTP/WS, **no internet at runtime**: every asset is bundled.
- Node.js 22 + TypeScript. Server: **Fastify 5 + Socket.IO**. DB: **SQLite (better-sqlite3)** in a volume. Client: **Svelte 5 (runes) + Vite 6**, built to static files served by the same server. PDF: **pdfkit** (built-in Helvetica).
- Server runs TypeScript directly via **tsx** (a runtime dependency); there is no server compile step.

### Exact pinned versions
fastify 5.12.7 · @fastify/static 10.1.4 · @fastify/cookie 11.1.2 · socket.io 4.8.1 · socket.io-client 4.8.1 · better-sqlite3 11.7.0 · pdfkit 0.20.2 (@types/pdfkit 0.17.6) · tsx 4.23.15 · typescript 5.6.3 · vitest 5.0.3 · svelte 5.57.1 · vite 6.4.4 · @sveltejs/vite-plugin-svelte 5.1.1 · svelte-check 4.1.4 · qrcode 1.5.4 (@types/qrcode 1.5.6) · @types/node 22.10.2 · @types/better-sqlite3 7.6.12.
`.npmrc` has `legacy-peer-deps=true`, a workaround for an npm arborist crash ("Cannot read properties of null (reading 'edgesOut')"). Keep it.

### Monorepo (npm workspaces)
```
copy/en.json            all user-facing text (cheap reskin)
assets/                 sample-library.json, house-rules.json, name-blocklist.txt
docker/entrypoint.sh    chown /data,/media then drop to user `node` (setpriv)
Dockerfile, docker-compose.yml, .dockerignore, README.md, LICENSE
packages/engine         pure TS rules, no I/O (@gn/engine; exports ./src/index.ts directly)
packages/sim            headless simulator + reports (@gn/sim)
packages/server         Fastify + Socket.IO + SQLite (@gn/server)
packages/client         Svelte, 4 entries: index (landing), play, gm, display (@gn/client)
docs/HANDOFF.md         this file
test-data/packs/        test-only library packs (catan-risk.json); not bundled or seeded
```
Root scripts: `npm run build` (client), `npm start` (server via tsx), `npm test` (all workspaces), `npm run typecheck`. Sim: `npm run sim -w @gn/sim`. Client dev: `npm run dev -w @gn/client` (Vite on :5173, proxies `/api` and `/socket.io` to :8080).

### Units and conventions
- **Gold is integer hundredths** everywhere in storage and engine (`goldH`, `_h`). 20 gold = 2000. Settings hold plain gold; the engine converts with `toH`.
- **Shares are hundredths** (`sharesH`). Fractional shares allowed.
- Prices are floats (rounded to 4 dp in the engine).
- **Night clock** (`nightMs`, `_nms`) excludes pauses; lot lockouts and quarters use it. Wall-clock is used for ticks, pause countdowns, espionage reveal delays, minter crawl and the finale.
- Player ids are integers in the DB; the engine uses string ids (`pid(id) = String(id)`).
- Security ids: `p:<playerId>` (player stocks), `index` (IDX), `crypto` (COIN), `event-reroll` (SCIC, Second Chance Insurance Co.), `event-espionage` (SHDW, Shadow Logistics), `dead` (DEAD). These tickers are reserved for players.
- Svelte components take the state prop as **`gs`** (not `state`, which collides with the `$state` rune).

---

## 6. Engine (`packages/engine`) — the rules

All functions are pure; the server and sim both call them. 87 tests (`test/fixtures.ts` `spec()` gives the original spec values, `goldScale` 1 etc., so the worked examples stay stable).

### Scoring (`scoring.ts`)
- `gold = actualHours × playersInGame × placementMult × goldScale`, rounded once to hundredths.
- Mults: `placementMults [1, 0.5, 0.25]`, then ×`tailFactor 0.5` each further place. Ties: `tieRule` average (default), best or worst over the spanned places.
- DNF counts toward playersInGame and scores `dnfMult` (0). Team: playersInGame = total people; each member gets the team's placement. Co-op: win = 1st-place mult, loss = `coopLossMult` 0.25.
- `hoursPlayed()` is tracked for the GM, never enforced. Planned duration is never a scoring input (actual hours are entered by the GM, prefilled pause-excluded).

### Ledger and standings (`standings.ts`)
- `deriveLedger`: stake + results + adjustments + bounties + achievements + trade flows → `cashH`. Nothing derived is stored: **results are the source of truth**, so changing settings re-scores everything live.
- **Net worth = gold + current sell value of holdings** (after fee). Rank by net worth; "leader" everywhere means the net-worth leader.

### Market (`market/*`)
- Tick every `tickSeconds` (20 s) while live with trading open. Impulses (trades, espionage, kingfall, re-rolls) queue and apply on the next tick. Every move is capped at `maxChangeFrac` 30% per tick and clamped to the band.
- **Player stock:** `fair` = rank-based on earned gold, spread across the inner 15–85% of the band (ties average; all tied = midpoint). `target = fair + (gmOffset + voteDrift + moodBias) × bandWidth`; `price += reversion × (target − price)`; then impulses. A leaver's fair decays toward band min (`leaverDecay`); their stock stays listed and is pumpable.
- **Index:** tracks the average player price × scale, smoothed (low volatility, no trade impact).
- **Crypto:** log random walk, `shock = σ·N(0,1) − σ²/2`, plus weak reversion to a slowly following baseline (`baselineAlpha` 0.002). This was made stationary in Phase 2 (the original model collapsed or drifted). Kingfall adds a hidden `+kingfallFrac` spike.
- **Event stocks:** baseline decays toward a floor; each driver event bumps it (`bump` 8%). SCIC is driven by re-roll spends; SHDW by espionage successes. Drivers are only hinted in copy.
- **Dead stock:** sits near band min (`baselineFrac` 5%); high trade impact (6%) and very weak reversion, so pumps persist and then bleed out. A "dead-stock clue" espionage reward hints at this.
- `slippage` (default 0) is an optional engine setting, not adopted.

### Trading (`market/trade.ts`)
- Buy with gold (`minTrade` 1); fee `feeFrac` 3%; per-buy **lot** locked for `lockoutMinutes` 5 (night clock); **invest cap** 25 gold of open cost basis; **one trade per stock per player per tick**; sells are FIFO over unlocked lots; you can't lose more than you invested.
- Frozen while paused or trading-closed. `liquidateAll(profitFeeFrac)` at End charges 10% on each profitable position.

### Votes (`votes.ts`, `clock.ts`)
- `quarterSchedule(length, votes)`: buffers, then Q1..Qn. A round opens at quarter start with a `windowMinutes` (5) window.
- Hidden drift: `driftMax × (voteShare − 1/N)` band units, applied for the rest of the quarter after the window closes.
- Bounty `bountyGold` (2) paid at quarter end to every voter who picked the actual net-worth leader (the top 2 both count when eligible players ≥ `topTwoMinPlayers` 16). Weighting `equal` (default) or `netWorth`. Self-votes are allowed and intended.

### Mood (`mood.ts`)
Two 1–5 ratings (mood, perceived self-assessment) → `centeredMood` → bias `moodMax × centered` (6% max) in band units, decaying `decayPerTick` 1% per tick.

### Kingfall (`kingfall.ts`)
`leaderFromScores(scores, 'high'|'low', current)` picks the leader from entered scores (ties keep the holder). `tapLeader`: a leader who held ≥ `kingfallHoldMinutes` 15 and gets displaced → crypto impulse. The dethroning is public; the kingfall/crypto link is hidden from players (the GM sees it).

### Late join (`lateJoin.ts`)
Stake = `goldFraction 0.75 × avg earned gold of active players − goldPenalty 2` (floored at 0). Start price = average player price − `stockPenalty 0.05` × band width.

### End (`endNight.ts`)
Force-resolve the open quarter (bounty), liquidate all lots (profit fee), derive the final ledger, produce the podium by gold.

### Achievements (`achievements.ts`)
A framework plus `DUMMY_ACHIEVEMENTS`:
- `first_blood` (First Mover): skill, gold 2.
- `hat_trick` (Hostile Takeover, 3 wins): skill, gold 5.
- `regular` (Committed Associate, 4 games played): skill, gold 2.
- `oracle` (Market Oracle, 2 correct quarter picks): vote-based, **hidden** gold 1.

Skill-based achievements openly pay gold; vote-based ones are presented as cosmetic but secretly pay a little (`gold_hidden`).

### Minter (`minter.ts`)
Fun only, **zero link to gold**. Tiers (placeholder numbers):

| Tier | Cost | Rate |
|---|---:|---:|
| Laptop | 15 | 0.2/s |
| Gaming Rig | 100 | 1/s |
| Server Rack | 600 | 5/s |
| Data Center | 4000 | 30/s |
| Orbital Array | 30000 | 200/s |
| Break-Room Farm (intermission-only) | 400 | 8/s |

- Costs grow ×1.15 per tier owned. Taps are clamped to 15/s and idle accrual to 600 s.
- While the night is paused, taps and passive minting are multiplied by `minter.pauseMultiplier` 2.
- The server is authoritative: `applyMinterSync(prev, {taps, buys}, elapsedSec, {paused, mult})`.

### All settings and defaults (`settings.ts`)
`resolveSettings(overrides)` deep-merges overrides; `validateSettings` returns issues.

- **scoring:** placementMults [1, 0.5, 0.25], tailFactor 0.5, tieRule average, dnfMult 0, coopLossMult 0.25, goldScale 3
- **stake:** startingGold 20
- **lateJoin:** goldFraction 0.75, goldPenalty 2, stockPenalty 0.05
- **market:**
  - general: tickSeconds 20, maxChangeFrac 0.3, feeFrac 0.03, endSellProfitFeeFrac 0.1, investCap 25, minTrade 1, lockoutMinutes 5, slippage 0
  - bands: player 30–80, index 30–80, crypto 5–150, event 10–100, dead 1–40
  - impact: player 0.02, index 0, crypto 0.06, event 0.02, dead 0.06
  - player: fairInnerLo 0.15, fairInnerHi 0.85, reversion 0.2, leaverDecay 0.02, espionageFrac 0.03
  - index: scale 1, smoothing 0.3
  - crypto: sigma 0.07, reversion 0.05, baselineAlpha 0.002, startFrac 0.25, kingfallFrac 0.1, kingfallHoldMinutes 15
  - event: startFrac 0.35, floorFrac 0.1, decay 0.005, bump 0.08, reversion 0.1
  - dead: baselineFrac 0.05, reversion 0.02
- **votes:** quarterCount 4, bufferFrac 0.1, windowMinutes 5, weighting equal, bountyGold 2, topTwoMinPlayers 16, driftMax 0.15
- **mood:** moodMax 0.06, decayPerTick 0.01
- **rerolls:** perPlayer 3
- **espionage:** goldReward 3, revealDelayMinSec 15, revealDelayMaxSec 45
- **achievements.gold:** first_blood 2, hat_trick 5, regular 2, oracle 1
- **prompts:** tradingCloseMinutesBefore 15
- **finale:** collapseSeconds 10, podiumStepSeconds 5, recapSlideSeconds 8
- **minter:** pauseMultiplier 2, tvCrawlMinutes 10

GM → Settings is **auto-generated** from this structure, so new settings appear in the UI automatically. Settings are stored per night as overrides (`night.settings` JSON); a null value resets a key to its default.

---

## 7. Server (`packages/server`)

### Runtime model
- One process owns all state. GM writes go through REST: **validate role → write DB → audit log → recompute → broadcast**.
- Clients get a role-filtered **snapshot on connect** and filtered `state:update` / `player:update` on every refresh.
- `bus.refresh(nightId)` is coalesced and **throttled to ≤1 broadcast per 250 ms** (wall clock).
- Each broadcast recomputes `computeNightState` once and builds the views per audience.
- **Tick loop** (`tickLoop.ts`, every 1 s), in order:
  1. Minter crawl (live or paused).
  2. Recap unlock (ended).
  3. Return early unless live.
  4. Sync `current_quarter`.
  5. `voteStep` (open/close/resolve rounds).
  6. `espionageStep` (delayed TV reveals).
  7. Market tick if due.

  Market randomness is deterministic per night and tick (restart-safe).
- `context.ts`: `Ctx {db, now, bus, config}`. `Bus {all, gm, tv, player, gmSession, refresh}`. HttpError helpers `bad`/`forbidden`/`notFound`/`conflict`. `recordingBus()` for tests.
- **Test-only** `ZS_TIME_SCALE` (default 1, range 1–1000): `src/timeScale.ts` scales `ctx.now()`, so the whole server runs N× real time, and the tick loop steps every max(50 ms, 1000/N). It isn't a GM setting, isn't shown in the app and isn't in the README. Never use it on a real night's DB: it stamps future times. Client countdowns and animations stay real-time. The socket throttle and minter leaderboard use the real clock.
- Env vars: `PORT` (8080), `HOST` (0.0.0.0), `DATA_DIR` (Docker: /data), `MEDIA_DIR` (/media), `CLIENT_DIR`, `SAMPLE_LIBRARY`, `HOUSE_RULES`, `NAME_BLOCKLIST`, `SECURE_COOKIES=1` (HTTPS only).
- Body limit 1 MB, except sound uploads at 12 MB.
- `main.ts` on boot: opens the DB (migrations run automatically), seeds the sample library once and the house rules once (meta flags), loads the name blocklist, and starts the tick loop.

### Auth
- **GM:** cookie `gn_gm` (stores the sha256 of the session token). Credentials and PIN are hashed (`auth/password.ts`). The device type (phone/laptop) is chosen at login.
- **Remote pause:** the GM's phone can "Pause device" on a laptop session. A paused session sees the public view and unlocks with the PIN or "Resume device". `requireGm(ctx, req, {master?, allowPaused?})`.
- **Roles:** Master = everything. Sub GM = **field actions only**: approvals, starting games, results, leader taps, mood, re-rolls, espionage, notifications, soundboard play, prompt dismiss. Setup/settings/library/rulebook/seating/sound uploads/offsets/night actions/exports are Master-only.
- **Players:** device token in header `x-device-token` or socket auth `deviceToken`. No passwords. A pending request's token becomes the device token on approval. Rejoin = pick your name, then GM approval. Multiple devices per player are allowed.

### Database (`db/migrations.ts`, SQLite, foreign keys on)
Migrations run in order:
1. Full schema: game_master, gm_session, night, night_pause, player, device, device_request, rule_entry, library_game, game_table, game, game_participant, leader_tap, adjustment(kind manual/late_join/espionage), reroll_use, security, price, impulse, trade, lot, vote_round, ballot, bounty_payout, mood_reading, challenge, achievement(gold_hidden), sound, notification, minter_state, audit_log, feed_event(gm_only), standings_snapshot.
2. `meta` table (one-time flags, prompt dismissals, `ambient_off:<night>`).
3. `night.pause_until`.
4. Challenge: `reveal_at`, `revealed`, `reassigned_from`, `peek_target`, `read_at`.
5. `seat_assignment` (night, table, seat, player; unique per player and per table seat), `minter_state.taps`, `sound.mime`, `sound.created_at`.
6. `night.recap_until`, `night.recap_done`.
7. `library_game.lead_mode/lead_label` (null = GM picks), `game.lead_mode` (existing rows `manual`) / `lead_label`, `game_score` (append-only history; latest per player counts).
8. `adjustment` rebuilt with kind `gift` + `read_at`; `hint_grant` (unique per player+source+ref, `cost_h` for purchases), `handicap_manual`, `handicap_eval` (levels, reasons, gifts, tips, credit), `player.hint_tradein_nms`.

Night states: `setup → joins_open → live ⇄ paused → ended → archived`. `trading_closed` is a flag; End force-closes trading. The current night = the newest non-archived night.

### Services (`src/services/`)
| File | Responsibility |
|---|---|
| `state.ts` | Load night/players/securities/lots/ledger; `computeNightState` (everything derived) |
| `night.ts` | Pure `transition()`, createNight, `applyNightAction` (pause countdown, End → finishNight + achievements + finale clock + cues), settings, adjustments, `skipFinale`/`replayFinale` |
| `gm.ts` | Setup, login, sessions, remote pause, PIN unlock, sub GMs, `masterOnly` |
| `library.ts` | Global library CRUD, JSON packs (`game-night-pack/1`), seeding; dangling rule links dropped |
| `games.ts` | Schedule/edit/cancel/start, suggested hours, result wizard + corrections, crowns/leader taps/kingfall, `tableId` validation, GameView |
| `players.ts` / `join.ts` | Name/ticker/color checks (blocklist, reserved tickers), avatars (≤200 KB, magic-byte check), join/late join/rejoin requests and approvals, leave, ticker override |
| `trading.ts` | Buy/sell via engine with gates; friendly errors |
| `market.ts` | Impulse queue, `runTick`, price history, mood terms |
| `votes.ts` | Round lifecycle, ballots, bounty, vote views (no tallies/drift) |
| `field.ts` | Mood readings, re-roll log, notifications, GM offsets |
| `espionage.ts` | Create/reassign/read/respond/resolve, delayed TV reveal, peek, rewards |
| `achievements.ts` | `awardAchievements` (after each result, quarter resolution and End) |
| `rules.ts` | Rulebook CRUD, house-rules seed |
| `seating.ts` | Tables, positions (0–1 fractions), seat assignment |
| `sounds.ts` | Uploads (MP3/OGG/WAV/M4A ≤ 8 MB, magic-byte check) to `MEDIA_DIR/sounds`, cues (final_round, intermission, achievement, night_end, collapse), ambient by library `sound_theme`, soundboard |
| `minter.ts` | Server-authoritative sync, leaderboard push (throttled 3 s), TV crawl |
| `prompts.ts` | Close-trading / end-night prompts with dismiss + re-prompt signatures |
| `recap.ts` | Finale (podium + recap slides), finale clock, recap unlock, statement data |
| `pdf.ts` | Statement PDF (pdfkit, Helvetica, plain) |
| `exports.ts` | Night JSON (`zero-sum-night/1`), CSV (standings/results/trades, formula-injection safe, BOM), archive list |
| `views.ts` | **Role-filtered views: the hidden-mechanics boundary** (§10) |
| `feed.ts` / `audit.ts` | Feed events (public or GM-only) / audit log |

Auto sound cues: pause → intermission; End → collapse; finale finished → night_end; achievement → achievement. Missing cue files fall back to synthesized tones on the TV.

### REST API (summary)
- **Public:** `GET /api/health`, `GET /api/setup/status`, `GET /api/night` (GM view if GM cookie), `GET /api/rules`, `GET/POST /api/join`, `POST /api/join/rejoin`, `GET /api/join/status`, `/uploads/avatars/:file`, `/media/sounds/:file`.
- **Setup/GM auth:** `POST /api/setup`, `POST /api/gm/login|logout|device-type|unlock`, `GET /api/gm/me`, sessions + pause/resume, sub-GM CRUD, `GET /api/gm/audit`.
- **Night (Master):** `POST /api/nights`, `PATCH /api/night`, `POST /api/night/:action` (open-joins, start, pause {minutes}, resume, close-trading, end, archive), `PATCH /api/night/settings`, `POST /api/night/adjustments`, `POST /api/night/finale/skip|replay`.
- **Any GM:** `POST /api/night/prompts/dismiss`, `GET /api/nights` (archive).
- **Library/games:** library CRUD + `export`/`import`; games CRUD, `start`, `prefill`, `result`, `correct`, `leader` (manual games only), `scores` (`{scores:[{playerId, score}]}`, any GM, scored games only).
- **Field (any GM):** `/api/requests/:id/approve|deny`, `POST /api/mood`, `/api/rerolls`, `/api/notifications`, `/api/challenges` (+ `/reassign`, `/resolve`), `POST /api/sounds/play`.
- **Master setup:** `/api/players/:id/leave`, `PATCH /api/players/:id` (ticker), `PATCH /api/securities/:id/offset`, rules CRUD, tables CRUD + `/seat`, `/api/seats/clear`, sound upload/delete, `GET /api/export/night.json?night=`, `GET /api/export/{standings|results|trades}.csv?night=`.
- **Tips/handicaps:** `POST /api/tips` {playerId, tier} (any GM), `PATCH /api/handicap/:playerId` {offset} (Master). Player: `POST /api/me/tips/:id/read`, `/api/me/gifts/:id/read`, `/api/me/tips/buy` {tier}, `/api/me/tips/trade-reroll`.
- **Player (device token):** `GET /api/me`, `POST /api/trade/buy|sell`, `POST /api/me/messages/:id/read`, `POST /api/vote`, `POST /api/me/challenges/:id/read|respond|peek`, `GET /api/minter`, `POST /api/minter/sync`, `GET /api/me/statement`, `GET /api/me/statement.pdf`.

### Sockets
- **Rooms:** `public` (TV + players), `tv`, `gm`, `player:<id>`, `gms:<sessionId>`. A paused GM device is moved to `public`.
- **State:** `snapshot` (on connect), `state:update` (public / GM; the TV room also gets `{tv:{seating, ambient}}`), `player:update` (private `me`).
- **Events:**
  - Night lifecycle: `night:update`, `night:paused`, `night:resumed`, `night:ended`.
  - Games and votes: `game:update`, `leader:update`, `vote:call`, `vote:update`.
  - Feed and achievements: `feed:new`, `achievement:new`.
  - Espionage: `espionage:notice` (TV), `espionage:update` (GM).
  - Sound: `sound:play` (TV).
  - Minter: `minter:leaderboard`, `tv:crawl` (TV).
  - Rules: `rules:update`.
  - Finale: `finale:replay` (TV), `recap:done`.
  - GM devices: `device:approval`, `gm:device_pause`.
  - Player-only: `vote:bounty`, `espionage:new`, `espionage:result`, `notify:player`.
- **Client store rule (important):** `shared/socket.ts` merges `player:update` (as `me`) and `minter:leaderboard` **into the store**. Before this, components set `s.me` locally and the next public `state:update` reverted it (a real bug found in the Phase 6 e2e).

---

## 8. Client (`packages/client`)

Entries: `index.html` (landing), `play.html`, `gm.html`, `display.html`. Aliases: `@shared`, `@copy`. Static, bundled, offline.

- **Shared:** `api.ts`, `socket.ts` (`connectLive`, `nightNow`), `copy.ts` (`t(key, vars)`), `format.ts` (`gold`, `signedGold`, `clock`…), `types.ts` (all view shapes), `ui.ts` (toast/run), `feedText.ts`, `markdown.ts` (safe subset; escapes first), `Avatar`, `Sparkline`, `Toasts`, `base.css` (bland, gold accent).
- **Phone (`play/`):** boot sequence, home grid with **red count badges only** (no banners), vibrate on new items, rotate prompt in landscape, centered phone frame on desktop.
  - Apps: Vote (icon only while a poll is open), Wallet, Market, Standings, Messages (GM notifications + encrypted espionage memos: decrypt, accept/reject, peek tool, dead clue), Feed, Rules (searchable), Profile, NFT Minter.
  - Full-screen **incoming call** when a poll opens (Answer opens Vote; Decline snoozes, keyed per night+quarter in localStorage; the badge stays).
  - Lock screens: pause (countdown + "Open NFT Minter") and ended (until the finale finishes).
  - `Statement.svelte`: Final Account Statement + PDF download (fetch with header → blob).
  - Fun apps registry: `play/fun/index.ts` (add more self-contained fun apps here).
  - Local storage: `gn_device`, `gn_pending`, `gn_feed_seen`, `gn_call_done`; session: `gn_booted`.
- **GM (`gm/`):** laptop sidebar or phone bottom bar (the first four field routes + More).
  - Screens: Dashboard (state, clock, quarter, poll status, pause with countdown, approvals, leader taps, **prompts**, after-collapse controls + exports), Games (schedule incl. table, result wizard, re-roll log), Mood, Espionage, Messages (notifications), Players, Market (offsets, mood terms, kingfall list), Seating (drag-drop), Soundboard, Rulebook, Join QR (printable; editable LAN URL), Archive & exports, Library, Settings (auto-generated), Devices & GMs, Audit log; plus Setup, Login and Locked.
- **TV (`tv/`):** terminal boot lines, headline bar, standings, now playing (crowns + progress), rotating panel every 15 s (up next / market board / seating / top minters), bottom ticker crawl, sequential lower-thirds (espionage, achievements, dethronings, poll opening, trading closed), "polls are open" strip, intermission overlay, ambient loop, synthesized cue tones (`tones.ts`).
  - `Finale.svelte`: SPECIAL REPORT → prices crash to zero → collapse line → podium 3rd→2nd→1st → recap slides → "statements on your phones". It's driven by the server's `recapUntil`, with clock skew corrected from `serverTime`.
  - "Enable audio" must be clicked once.

Known harmless warnings: `svelte-check` shows 3 warnings in `ResultWizard.svelte` ("captures the initial value of `game`"). That's intentional: one wizard instance per game.

---

## 9. Copy (`copy/en.json`)

Top-level keys: securities, achievements, brand, feed, status, modes, landing, phone (apps, call, vote, memo, rewards, statement, …), trade_errors, minter, tv (banners, recap, finale…), gm (prompts).

- The server reads the brand and achievement names for the PDF.
- Copy **never states hidden mechanics**; event-stock blurbs only hint.
- House rules (`assets/house-rules.json`) were written to reveal nothing hidden; a test checks for words like drift, hidden, kingfall, mood, secretly.

---

## 10. Hidden mechanics (must stay hidden)

| Hidden from | What |
|---|---|
| **Players and GM** | Vote-share drift · gold paid for "cosmetic" vote-based achievements · espionage stock nudges (±3% agent stock, SHDW bump) |
| **Players only** (GM console shows) | Mood-driven price impact per player · GM price offsets · kingfall → crypto spike |
| **Players only** (GM sees) | Index growth from games and start dips (`gm.indexTerms`) · crypto downward drift · handicaps (levels, gifts are "anonymous gifts", tips look like any tip) |
| **Hinted only** | What drives the event stocks (and anything a tip reveals to its recipient) |

- Never revealed at the end. Not in the recap, statements, PDF or exports.
- **Enforcement:** `services/views.ts` builds every view field by field; never spread DB rows into a view.
- Never sent to anyone: `drift`, price `causes`/`fair`/`target`, `impulses`, `lastFair`/`leaverFair`/`baseline`, credential/pin/token hashes, `gold_hidden` / hidden achievement gold. The GM ledger shows **visible** achievement gold only; hidden gold is folded into totals and never itemized.
- GM-only fields: `gmOffset`, `moodTerm`, `ledger`, `overrides`, `baseline`, GM-only feed (kingfall, corrections, espionage success, re-rolls).
- Seating is GM + TV only (sent to the `tv` room, never `public`).
- Statements show final gold and trading result but **no gold breakdown**, because a breakdown would let players subtract out the hidden gold.
- Tests assert these (`FORBIDDEN_KEYS`, `GM_ONLY_KEYS` in `test/helpers.ts`, plus structural checks in phase6–8 tests). Run them after any view change.

---

## 11. Simulation (`packages/sim`)

- Headless full nights using the real engine.
  - Agents: the original seven (holder, trader, self-pumper, coalition, crypto gambler, random, inactive) plus 20 more types (27 total: fee-aware minimalist, crown chaser, active trader, pump crew, kingmaker crew, game grinder, social butterfly, leader/underdog voter, momentum chaser, contrarian, panic seller, all-in YOLO, event speculator, dead-stock lone wolf, …), each with low/mid/high skill.
  - Runs use worker threads.
- `paramSets.ts`: `spec-original`/baseline, `old-x1-tuned`, `recommended` (= current defaults), `slippage-alt`.
- Reports: `packages/sim/reports/REPORT.md` (targets) and `STUDY.md` (population study); `results.json` is gitignored. Copies are in the Project ("Sim Report — Phase 2", "Player-Type Study").
- **Recommended set results:** 9/9 targets at 12 players, 8/9 at 20 players.
  - At 12 players: market share of the winner's gold 14%; solo pump unprofitable in 100% of runs; coalition ROI 5.7%.
  - The 20-player miss: bottom-quartile comeback 4.9% vs the 5–15% target.
- **Study findings** (edge vs never-trades of the same skill):
  - Best: fee-aware minimalist about +12, crown chaser about +9, active trader about +8.
  - Worst: self-pumper about −22, contrarian about −10, momentum chaser about −7.5.
  - These are flagged as "possible exploits" (>15% ahead); the user chose to keep the crown edge (decision 10).
- The sim tracks gold by source and has an example-night narrator, but **no per-trade trace** (the user asked; it doesn't exist, and they said not to build it).

---

## 12. Testing

- **Counts:** engine 112, server 72, sim 4 (188 total), all passing. `npm run typecheck` is clean (0 errors, the 3 known warnings).
- **Server test helpers:**
  - `makeApp()` builds an in-memory DB with a fake clock (`t.clock.advance(ms)`).
  - `liveNight(t, n)` returns the Master cookie plus device tokens.
  - `call()` sends requests; `tickOnce(ctx)` drives the loop; `recordingBus()` captures emits.
- **Browser e2e:** Playwright scripts were run ad hoc from the session scratch area (not committed; they had machine-specific paths). Every phase had a full run with no console errors and screenshots. Phase 8's run covered a full night: join → vote → mood → espionage → minter → trades → close-trading prompt → warnings → result → end prompt → finale (all 9 slides) → statement → PDF → exports → replay → archive → QR.
- **Not verified:**
  - Physical phones (vibration, call screen, iOS Safari).
  - Real TV audio output.
  - 20-player load.
  - A Docker build inside the dev sandbox (Docker Hub is blocked there). The Dockerfile steps were replayed natively on a fresh clone and run offline in a network namespace as the `node` user. The **user's own server then built the image successfully** (Oct 26).

---

## 13. Deployment

**Standard install** (README):
```sh
git clone https://github.com/mscottwhit12-hub/Zero-Sum.git zero-sum
cd zero-sum && docker compose up -d --build
```
- Image: `node:22-bookworm-slim`, multi-stage. The build stage has python3/make/g++ for better-sqlite3; it runs `npm ci`, builds the client, then `npm prune --omit=dev`.
- Runtime: `ENTRYPOINT docker/entrypoint.sh` (chowns /data and /media, then `setpriv` to user `node` uid 1000). CMD `node node_modules/tsx/dist/cli.mjs packages/server/src/main.ts`. Healthcheck `/api/health`.
- **The container listens on 8080.** Volumes: `/data` (sqlite, avatars) and `/media` (sounds). Compose uses `${ZS_PORT:-8080}:8080` and `TZ`.
- The first build needs internet; runtime needs none. Update: `git pull && docker compose up -d --build`. Migrations run automatically on start.

**The user's actual setup** (as of Oct 26):
- Ubuntu server `whitserv`, user `mscottwhit`, reached via Tailscale IP `100.125.8.126`.
- The repo is cloned at `~/jellyfin/zero-sum`, and a `zero-sum` service block was added to their large existing compose file at `/home/mscottwhit/jellyfin/docker-compose.yml`:
  - `build: ./zero-sum`
  - `image: zero-sum:latest`
  - volumes `./zero-sum/data:/data`, `./zero-sum/media:/media`
  - They first pasted a duplicate `services:` key (fixed).
- The build succeeded and the server logged healthy.
- **Open issue:** their port mapping was `6969:6969` (the container exposes 8080), so `http://100.125.8.126:6969` didn't load. They were told to use `"6969:8080"` and run `docker compose up -d zero-sum`; this is **unconfirmed**. ufw is inactive.
- After it works:
  - Open `/gm` → create the Master GM.
  - Players use `http://100.125.8.126:6969` (they must be on the tailnet), or the server's LAN IP for guests on the home Wi-Fi.
  - Note: party guests probably won't be on Tailscale, so for a real night the **LAN IP** is what goes on the join QR.
- Portainer note given: the Portainer web editor can't build from a local path. The options were to pre-build the image over SSH, or to publish an image to GHCR. **GHCR publishing doesn't exist yet**; offer it if they want `image:` pulls.

---

## 14. Known issues, risks and gotchas

- **Performance:** the full night state is recomputed per broadcast (throttled to 250 ms) and in `voteStep` every second. That's fine for 3–6 players; 20 players is unmeasured. If needed, cache `computeNightState` per tick or memoize the ledger.
- `recap.ts` "best trade" includes auto-sells (forced). "Trade of the night" can be tiny (e.g. +0.2) on short nights.
- The PDF uses Helvetica (WinAnsi), so avoid characters like `→` in PDF text (one was replaced with `->`). Times print in the server TZ (set `TZ`).
- The minter crawl and finale use wall clock; espionage reveals are wall-clock and don't fire while paused (they reveal on resume).
- The vote incoming call is per device (decision 14).
- `GET /api/night` returns the GM view if a GM cookie is present, otherwise the public view.
- **Dev gotchas:**
  - `pkill -f <pattern>` killed the agent's own shell; kill by pid from `ps` instead.
  - Playwright/Chromium is preinstalled in the sandbox; don't reinstall.
  - Docker Hub is blocked in the sandbox, so the Docker build can't be tested there.
  - `.npmrc legacy-peer-deps` is required.
  - Don't commit e2e scripts with absolute machine paths.
- **Dependency:** Fastify bumped to 5.12.7 on Oct 27 2026 (fixes the low header-schema advisory).

---

## 15. Placeholders and waiting on the user

| Item | Current placeholder |
|---|---|
| Achievement list | 4 dummies (above); the user will supply the real list |
| Brand / security names | Bullion & Associates, BNN, IDX / COIN / SCIC / SHDW / DEAD, PlaceholderCoin etc. in copy |
| Visual theme | Bland; TV "broadcast" and Minter are placeholders by request |
| Minter tiers | Made-up numbers |
| PDF layout | Plain |
| Tiebreaks | Average of spanned places (`tieRule`) |
| Espionage custom reward | Free text; the GM grants it by hand |
| Sounds | None bundled; cues use synthesized tones; the user uploads local files |
| Sub GM scope | All field actions; setup and settings are Master only |

**Possible next work (only on request):** GHCR image publishing, visual theme pass, real achievements, rank arrows on standings, a load test, physical-device fixes from the first real night, renaming the in-app brand to Zero-Sum.

---

## 16. Project knowledge (claude.ai Project "GAME_NIGHT")

- `Game Night Platform — Build Spec v1.md`: the authoritative original spec (Oct 24 2026).
- `Game Night Platform — Handoff.md`: the earlier, pre-spec handoff (superseded by the spec).
- `Decisions Log.md`: locked decisions (kept current).
- `Sim Report — Phase 2.md`, `Player-Type Study.md`: sim outputs.
- `Zero-Sum — Engineering Handoff.md`: this document (also in the repo at `docs/HANDOFF.md`).

When decisions change, update the Decisions Log and this file together.
