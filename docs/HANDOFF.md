# Zero-Sum — Engineering Handoff

**As of:** Oct 27 2026 · **Repo:** `github.com/mscottwhit12-hub/Zero-Sum` (public, MIT) · **Branch:** `main`

**Status:**
- Build plan Phases 0–8 are complete, plus three post-plan builds (Oct 26–27): score entry, a softer payout curve, index growth, crypto trend, hint rewards, handicaps, bug-hunt fixes and performance work.
- The install is confirmed on the user's server.
- Testing so far is simulated nights at 60× speed and 10 rounds of human-behaviour bug testing. **No real-device night yet.**

This document is the complete context for the next lead engineer. Read §1–§5 before touching anything.

The original spec ("Game Night Platform — Build Spec v1") and the **Decisions Log** live in the claude.ai Project **GAME_NIGHT**. Where this document and the spec disagree, **this document and the Decisions Log win**: they record later, user-approved decisions. The user calls the Decisions Log the **"master sheet"**. Keep it current as decisions are made, not afterwards.

---

## 0. Reading order

1. §1 What it is · §2 How to work with this user (strict) · §3 Locked decisions
2. §4 Current state and what's next · **§16 Discussed but not done** · **§14 Open problems**
3. §5–§9 Architecture reference (engine, server, client, copy)
4. §10–§13 Hidden mechanics, sim, testing, deployment · §15 Placeholders · §17 Project docs

---

## 1. What it is

A self-hosted LAN web app that wraps an in-person board/card game night.

**Who uses it**
- 10–20 players on their own phones (browser, no install, a fake "burner phone" OS UI).
- One Master GM plus optional Sub GMs (GM console, laptop or phone layout).
- One TV at `/display` (a fake financial news broadcast).

**How the night works**
- Games earn **gold**: `hours × players × placement mult × goldScale`. Gold is the score, the trading money and every reward. Never say "points".
- The GM enters **scores during a game** (victory points, territories). The crown (current leader) follows the scores automatically.
- Every player is a **stock**; anyone can buy any stock (including their own) with gold. There is also:
  - an index (flat, but it secretly grows while games run),
  - a crypto coin (volatile, secretly trending down),
  - two event stocks,
  - a near-dead stock.
- Quarterly polls ("who leads at quarter end?") arrive as an **incoming call**. They pay a small real bounty, and vote share **secretly** drifts stock prices.
- Also: mood rounds, kingfall, espionage memos, re-roll tokens, achievements, notifications, the NFT Minter (fun only), seating, rulebook and sounds.
- **Anonymous tips** (hint rewards) reveal hidden mechanics to players who earn them.
- **Handicaps** (Master only, off by default) quietly help struggling players with anonymous gold gifts and tips.
- The night ends in a **market collapse**: trading closes, all holdings auto-sell, the TV plays a finale (crash → podium → recap), and phones unlock into a **Final Account Statement** with a PDF.

**Theme and naming**
- Shady corporate / insider trading, played straight.
- Brand placeholder **"Bullion & Associates"**, TV **"BNN — Bullion News Network"**, GM = **"Compliance Office"**. All copy is in `copy/en.json`.
- Product/repo name: **Zero-Sum**. The in-app brand was deliberately left as Bullion & Associates; the user hasn't asked to rename it. The user likes that the index base stays flat because it "plays well with the name zero-sum".

**Open-source rules (spec §1.2)**
- No hardcoded personal content: games, rules, sounds and photos are data.
- Bundled assets must be redistributable.
- First run creates the Master GM credentials (no default passwords).
- Install = `docker compose up` + README.
- Trademarked game names (Catan, Risk) live only in `test-data/`, never in the bundled sample library.

---

## 2. How to work with this user (strict)

These are standing preferences. Violating them has caused friction before.

**Style**
- Sharp, terse, about a third of normal length. No softening, praise or filler. No recaps of what they already know.

**Questions**
- Default: one at a time, with lettered options (A/B/C, one line each), a **recommendation** with a 1–2 sentence reason, closing with **"Go with X?"**.
- When the user asks for **open-ended questions** ("ask one open question at a time", "list them open ended… don't lead the question or give suggestions"): ask plainly, with no options and no recommendation.
- When they ask for a **brainstorm or a list to approve** ("brainstorm 15 ideas", "30 options… labeled so I can go down saying yes or no"): give a numbered or labelled list with one line each. They answer item by item ("1) yes 2) no 5) yes if…"), and each answer is a decision. Log it in the Decisions Log.

**Decisions**
- **Short answers are decisions** ("b", "C", "yes A"). Lock them in, confirm in one line, move on. Additions mid-answer ("B, but also X") are locked too.
- "Talk only", "do not build yet", "do nothing yet", "make note" all mean **no code**. Discuss, log decisions, stop.

**Decision rules while coding**
- Small implementation choices (library versions, folder names, internal APIs): decide yourself.
- Anything that changes gameplay, what players or the GM see, or a locked decision: **ask first**.
- **Every gameplay number is a tunable GM setting** with a default. Never hardcode one.
- **Do not build features the user only asked about.** Verbatim: *"Do not code this new feature if it does not already exist I was just asking if it did."* (An unrequested trace feature was reverted.) Questions get answers, not code.
- **Don't invent data.** If the sim doesn't track something, say so. When real data isn't available (e.g. Risk game logs), say it's modelled.

**Long autonomous runs**
- The user may hand over a big multi-step job ("build all… then 10 rounds of bug testing… then push"). Ask **all** blocking questions and **all permissions** (GitHub push access, etc.) **up front**, in one batch, then run to the end.

**Phase gates**
- Stop at the end of each phase with a ≤10-line report (what works, what's stubbed, deviations) and the next step. Continue only on "go".

**Push only when told**
- "Fix 1–6, do not push" means commit locally at most.
- The session's stop hook nags about unpushed commits; the user's instruction wins.

**Visuals**
- Keep them bland/placeholder. Claude may pick palette, names and copy within the theme. No detailed art/theme work until the user asks.

**Testing**
- The user tests **only via installs from GitHub** (Docker on their Ubuntu server). Don't ask them to test from zips.
- They also like **simulated nights**: real browsers, a 60× clock, simulated player types, game timings from real logs where available (see §12).

**Infra and dependencies**
- The user owns Docker/Proxmox/LAN. Don't advise on infra beyond the README unless asked (they did ask for Docker help, see §13).
- Pin exact versions; only use releases **≥ 2 weeks old**.

**Attribution**
- Commits end with the attribution lines the session provides (Co-Authored-By / Claude-Session).
- User email (for attribution only): mscottwhit12@gmail.com. GitHub owner: `mscottwhit12-hub`. LICENSE copyright: "Tate". The user goes by Tate in tests (the Master GM name used throughout).

---

## 3. Locked decisions (override the spec)

Mirrors the project's Decisions Log. 1–17 come from Phases 0–8; 18–27 were added Oct 26–27.

1. **Fair-price basis = earned gold only:** stake + results + adjustments (including handicap gifts) + bounties + achievements. Trading P&L and tip purchases are ignored for fair price.
2. **Per-kind price bands**, each tunable: player 30–80, index 30–80, crypto 5–150, event 10–100, dead 1–40.
3. **Night clock excludes paused time**; quarters shift with pauses. **End force-resolves the open quarter and pays its bounty before auto-sell.**
4. **Late-joiner stake frozen at approval**, stored as a system adjustment (`kind = late_join`); never recomputed.
5. **NFT Minter is playable on the pause lock screen**, with an intermission-only bonus (2× mint rate + one exclusive tier).
6. **GM price offset applies to player stocks only.**
7. **Quarter count is a GM setting (default 4).** 10% buffer at each end, middle 80% split evenly. The last quarter may resolve after trading closes (accepted).
8. **End-of-night auto-sell fee:** 10% of profit per position (player × security); losing positions pay nothing. Players are warned when trading closes.
9. **Game gold multiplier** `scoring.goldScale = 3`.
10. **Crown edge kept:** buying the crowned leader's stock before results is allowed ("reading the room").
11. **Market defaults (sim-tuned, approved Oct 24 2026, "subject to change"):** fee 3%, invest cap 25, player reversion 0.20, crypto σ 7% / reversion 0.05, kingfall +10%, dead impact 6% / reversion 0.02.
12. **Placeholder achievements keep paying real gold** until the user supplies the real list (First Mover 2, Hostile Takeover 5, Committed Associate 2, Market Oracle 1 hidden).
13. **Espionage defaults:** gold reward 3; the TV reveals accept/reject after 15–45 s; the dead-stock clue is fixed copy text.
14. **Vote "decline" snoozes the incoming call per device**; a two-device player gets the call on both (accepted as minor).
15. **Library is modular data** (JSON packs `game-night-pack/1`, import/export).
16. **Phase 7 = option A** (placeholder TV broadcast and Minter, no fancy graphics).
17. **License MIT**; repo `Zero-Sum`; testing starts only once it installs from GitHub.
18. **Score entry is the default crown.**
    - Each game has a lead mode: `high` (highest score leads, default), `low`, or `manual` (GM crown taps).
    - The library game or pack sets it (`leadMode`, `leadLabel`, e.g. "Victory points"); if the pack doesn't, the GM picks when scheduling.
    - Locked once the game starts. A tie at the top keeps the current holder.
    - Scores only move the crown (kingfall and dethroning unchanged); gold stays placement-based.
19. **Payout curve = linear + floor.**
    - 1st 1×, 2nd 0.5×, then even steps down to `scoring.floorMult` 0.10 at last place, never below the classic curve. For example: 6 players 100/50/40/30/20/10; 4 players 1/0.5/0.3/0.125.
    - `scoring.curve: 'classic'` restores the old curve.
    - Handicaps must **not** influence the curve.
20. **Index growth** (hidden from players; the GM sees it on the Market screen).
    - Base = average player stock, so it stays flat (zero-sum).
    - Grows only while games run, by gold earned **per night player** (`market.index.growthPerGold` 0.23; target +10–15% a night).
    - A game's start dips the index by its expected gold per player × `startDropPerGold` 0.15; the dip comes back at its end. A cancelled game also loses the growth it accrued.
    - Gentle mean-reverting wobble (`noiseFrac` 0.01, `noiseReversion` 0.1).
    - Derived from results every tick, so corrections recompute it.
21. **Crypto downward trend** (hidden): `market.crypto.driftPerHour` −0.03, volatility unchanged, so holding all night loses. Swing trading should be the only way to win on it.
22. **Hint rewards ("anonymous tips").** Tier = how secret or valuable the mechanic is (common / rarer / rarest). Full details in §6.
    - **Sources:**
      - game win and last place (≥15 min with 4+ players, or ≥30 min with 2–3; over 90 min → rarer; over 4 h → rarest);
      - two correct quarter picks in a row (rarer);
      - first Server Rack / Data Center / Orbital Array (common / rarer / rarest);
      - memo reward type "Mechanic tip" (GM picks the tier);
      - GM sends a tip (any GM);
      - buy with gold (off by default);
      - trade one re-roll token for a common tip (max once per 2 night-hours).
    - **Draw:** no repeats inside a tier; then the next tier down; then repeats.
    - **Never hinted:** Market Oracle's hidden gold, and the GM price offset.
23. **Handicaps** (Master GM only; players never learn they exist; Smash-Bros-style). Details in §6.
    - Auto handicap is a setting, **off by default**, toggled by the Master only.
    - Hourly auto levels: top 50% = 1, bottom 50% = 2–5.
    - Plus the Master's manual offset; the auto never removes a level the GM set.
    - Help = about **30% as an anonymous gold "gift from another associate"** (counts toward rank) + 70% as tips. Gains at levels 2/3/4/5 ≈ 5/12/20/30% of a night's gold.
    - Help already given stays. Shown in GM exports only. Nothing carries between nights.
24. **The poll window must fit inside a quarter** (the server refuses otherwise).
25. **Games without a result at End are cancelled** (they paid nothing anyway). The End confirmation says how many.
26. **Errors are never shown as raw codes.** `copy.errors.<code>` + `errorText()` give every failure a sentence.
27. **Double taps are harmless:** game start, result submit (same result) and memo answers (same answer) are idempotent.

### Rejected (spec §21, do not re-propose)
- Fork an existing project · multiple apps · raw-score normalization · planned duration as a scoring input · ×100 display scaling · GM pre-creates players.
- Per-second market · player-side seating · web push to locked phones · copying official rulebooks · ranking by gold only (net worth instead) · manual withdrawal before collapse.
- Per-game/per-table stocks · event stocks for ties/dethrones/pauses/mood average (only re-roll + espionage) · **revealing hidden mechanics at the end** · auto-generated tickers.
- Joining before the GM opens joins · rejoin by typing a username · public espionage success.
- Gold-linear or blended fair price (rank-based chosen) · multiplicative drift/mood (additive, band units).
- Tab navigation on phones · notification banners (badges only) · auto-detecting GM device type · auto-lock on idle · auto night end or auto trading close.
- PNG statement (PDF instead) · rounding gold per payout (integer hundredths).

**Also rejected Oct 27:**
- **Index options:** pure steady climb, dividends, or trade-driven. Chosen: growth from games with dips at start.
- **Index visibility:** hinting it via the rulebook (players get nothing; only tips may reveal it).
- **Hint sources:** a single correct quarter pick, achievement unlocks, dethroning / being dethroned, comeback, intermission top minter, trade volume.
- **Hint pool entries:** H1–H9, H11, H14, H20, H23, H25–H28, H30 (list in the Decisions Log).

### Backlog (don't build unless asked)
- Shorts and calls · side bets · awards/superlatives screen · head-to-head records · trivia mini-game · printable night summary · local HTTPS for push · tradeable re-rolls.

---

## 4. Current state and what's next

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
| Oct 27d | This handoff + browser harnesses committed under `e2e/` | (this commit) |

### Immediately next
1. **The user pulls the Oct 27 builds** (`git pull && docker compose up -d --build zero-sum`, see §13) and runs a short night with auto handicap on. Migrations 7 and 8 run automatically.
2. **First real test night** on physical phones and the TV. This is still the biggest unknown: Android vibration, iOS Safari, the call screen, TV audio, real Wi-Fi.
3. **Re-run the headless sim** (`npm run sim -w @gn/sim`). The payout curve, index growth, crypto drift and handicaps all changed the economy after the sim tuning (§11). The §18 targets are **not re-verified**.
4. Work the open items in **§16** and **§14** as the user prioritises them. Don't start them unasked.
5. Waiting on the user: real achievement list, more tips (especially common), final brand/stock names, visual theme.

---

## 5. Architecture

### Stack (locked)
- **Single Docker container**, LAN only, plain HTTP/WS, **no internet at runtime**: every asset is bundled.
- Node.js 22 + TypeScript. Server: **Fastify 5 + Socket.IO**. DB: **SQLite (better-sqlite3, WAL)** in a volume. Client: **Svelte 5 (runes) + Vite 6**, built to static files served by the same server. PDF: **pdfkit** (built-in Helvetica).
- The server runs TypeScript directly via **tsx** (a runtime dependency); there is no server compile step.

### Exact pinned versions
- fastify 5.12.7 · @fastify/static 10.1.4 · @fastify/cookie 11.1.2
- socket.io 4.8.1 · socket.io-client 4.8.1
- better-sqlite3 11.7.0 · pdfkit 0.20.2 (@types/pdfkit 0.17.6)
- tsx 4.23.15 · typescript 5.6.3 · vitest 5.0.3
- svelte 5.57.1 · vite 6.4.4 · @sveltejs/vite-plugin-svelte 5.1.1 · svelte-check 4.1.4
- qrcode 1.5.4 (@types/qrcode 1.5.6) · @types/node 22.10.2 · @types/better-sqlite3 7.6.12

`.npmrc` has `legacy-peer-deps=true`, a workaround for an npm arborist crash ("Cannot read properties of null (reading 'edgesOut')"). Keep it. The e2e harnesses use **Playwright 1.63** (not a dependency; see `e2e/README.md`).

### Monorepo (npm workspaces)
```
copy/en.json            all user-facing text (cheap reskin), incl. hints.* and errors.*
assets/                 sample-library.json, house-rules.json, name-blocklist.txt
docker/entrypoint.sh    chown /data,/media then drop to user `node` (setpriv)
Dockerfile, docker-compose.yml, .dockerignore, README.md, LICENSE
packages/engine         pure TS rules, no I/O (@gn/engine; exports ./src/index.ts directly)
packages/sim            headless simulator + reports (@gn/sim)
packages/server         Fastify + Socket.IO + SQLite (@gn/server)
packages/client         Svelte, 4 entries: index (landing), play, gm, display (@gn/client)
docs/HANDOFF.md         this file
test-data/packs/        test-only library packs (catan-risk.json); not bundled or seeded
e2e/                    browser harnesses: 10 bug rounds + 60× night (README inside; not in npm test)
```

**Root scripts:**
- `npm run build` (client) · `npm start` (server via tsx) · `npm test` (all workspaces) · `npm run typecheck`
- Sim: `npm run sim -w @gn/sim`
- Client dev: `npm run dev -w @gn/client` (Vite on :5173, proxies `/api` and `/socket.io` to :8080)

### Units and conventions
- **Gold is integer hundredths** everywhere in storage and engine (`goldH`, `_h`). 20 gold = 2000. Settings hold plain gold; the engine converts with `toH`.
- **Shares are hundredths** (`sharesH`). Fractional shares allowed. Prices are floats (rounded to 4 dp in the engine).
- **Night clock** (`nightMs`, `_nms`) excludes pauses. Lot lockouts, quarters, handicap intervals and the re-roll trade-in cooldown use it.
- **Wall clock** is used for ticks, pause countdowns, espionage reveal delays, the minter crawl and the finale.
- Player ids are integers in the DB; the engine uses string ids (`pid(id) = String(id)`).
- Security ids: `p:<playerId>` (player stocks), `index` (IDX), `crypto` (COIN), `event-reroll` (SCIC, Second Chance Insurance Co.), `event-espionage` (SHDW, Shadow Logistics), `dead` (DEAD). These tickers are reserved for players.
- Svelte components take the state prop as **`gs`** (not `state`, which collides with the `$state` rune).

---

## 6. Engine (`packages/engine`) — the rules

All functions are pure; the server and sim both call them. 112 tests. `test/fixtures.ts` `spec()` gives the original spec values (goldScale 1, `curve: 'classic'`, crypto `driftPerHour: 0`) so the worked examples stay stable.

### Scoring (`scoring.ts`)
- `gold = actualHours × playersInGame × placementMult × goldScale`, rounded once to hundredths.
- `placeMult(place, s, units)`:
  - **Classic:** `placementMults [1, 0.5, 0.25]`, then ×`tailFactor 0.5` for each further place.
  - **Linear (default):** places 3..units step evenly from 2nd's mult to `floorMult` 0.10, never below classic. Rounded to 6 dp.
  - `units` = ranked players (or teams).
- **Ties:** `tieRule` average (default), best or worst over the spanned places.
- **DNF** counts toward playersInGame and scores `dnfMult` (0).
- **Team:** playersInGame = total people; each member gets the team's placement.
- **Co-op:** win = 1st-place mult, loss = `coopLossMult` 0.25.
- `hoursPlayed()` is tracked for the GM, never enforced. Planned duration is never a scoring input; actual hours are entered by the GM, prefilled pause-excluded.

### Ledger and standings (`standings.ts`)
- `deriveLedger`: stake + results + adjustments + bounties + achievements + trade flows → `cashH`.
- Nothing derived is stored: **results are the source of truth**, so changing settings re-scores everything live.
- Tip purchases go in as **trade flows** (cash only, not earned gold).
- **Net worth = gold + current sell value of holdings** (after fee). Rank by net worth; "leader" everywhere means the net-worth leader.

### Market (`market/*`)
- **Ticks:** every `tickSeconds` (20 s) while live with trading open.
- **Impulses** (trades, espionage, kingfall, re-rolls) queue and apply on the next tick.
- **Limits:** every move is capped at `maxChangeFrac` 30% per tick and clamped to the band.

**Player stock**
- `fair` is rank-based on earned gold, spread across the inner 15–85% of the band (ties average; all tied = midpoint).
- `target = fair + (gmOffset + voteDrift + moodBias) × bandWidth`; then `price += reversion × (target − price)`; then impulses.
- A leaver's fair decays toward band min (`leaverDecay`); their stock stays listed and is pumpable.

**Index (`indexFund.ts`)**
- Price = (average player price × scale + `extra`) × (1 + wobble), smoothed.
- `extra = indexExtra(games, nightPlayers)`:
  - growth = `growthPerGold` × (finals' gold paid + running games' accrued expected gold) / night players;
  - minus drop = `startDropPerGold` × running games' expected gold for their planned hours / night players.
- `expectedGameGoldH(players, units, hours)` uses the payout curve.
- The wobble is OU noise kept in security state `noise`.
- The index is flat by construction: rank-based player prices always average to the band midpoint, so the deep test night stayed at 54.7–55.2 before growth was added.

**Crypto**
- Log random walk: `shock = σ·N(0,1) − σ²/2`, plus weak reversion to a slowly following baseline (`baselineAlpha` 0.002).
- Downward trend: `drift = ln(1 + driftPerHour) × tickSeconds/3600`, applied to price and baseline.
- Kingfall adds a hidden `+kingfallFrac` spike.

**Event stocks**
- The baseline decays toward a floor; each driver event bumps it (`bump` 8%).
- SCIC is driven by re-roll **spends** (not re-roll trade-ins for tips); SHDW by espionage successes. Drivers are only hinted in copy.

**Dead stock**
- Sits near band min (`baselineFrac` 5%), with high trade impact (6%) and very weak reversion, so pumps persist and then bleed out.

`slippage` (default 0) is an optional engine setting, not adopted.

### Trading (`market/trade.ts`)
- Buy with gold (`minTrade` 1); fee `feeFrac` 3%.
- Each buy creates a **lot** locked for `lockoutMinutes` 5 (night clock).
- **Invest cap:** 25 gold of open cost basis.
- **One trade per stock per player per tick.**
- Sells are FIFO over unlocked lots; you can't lose more than you invested.
- Frozen while paused or trading-closed. `liquidateAll(profitFeeFrac)` at End charges 10% on each profitable position.

### Votes (`votes.ts`, `clock.ts`)
- `quarterSchedule(length, votes)`: buffers, then Q1..Qn. A round opens at quarter start with a `windowMinutes` (5) window. **The window must fit inside the quarter** (the server validates it against the night length).
- **Hidden drift:** `driftMax × (voteShare − 1/N)` band units, applied for the rest of the quarter after the window closes.
- **Bounty:** `bountyGold` (2), paid at quarter end to every voter who picked the actual net-worth leader. The top 2 both count when eligible players ≥ `topTwoMinPlayers` 16.
- Weighting `equal` (default) or `netWorth`. Self-votes are allowed and intended.

### Mood (`mood.ts`)
- Two 1–5 ratings (mood, perceived self-assessment), **entered by the GM** → `centeredMood` → bias `moodMax × centered` (6% max) in band units, decaying `decayPerTick` 1% per tick.

### Kingfall and crowns (`kingfall.ts`)
- `leaderFromScores(scores, 'high'|'low', current)` picks the leader from entered scores (ties keep the holder; with no holder in the tie, the crown stays where it is).
- `tapLeader`: a leader who held ≥ `kingfallHoldMinutes` 15 and gets displaced → crypto impulse.
- The dethroning is public; the kingfall/crypto link is hidden from players (the GM sees it).

### Late join (`lateJoin.ts`)
- Stake = `goldFraction 0.75 × avg earned gold of active players − goldPenalty 2` (floored at 0).
- Start price = average player price − `stockPenalty 0.05` × band width.

### End (`endNight.ts`)
- Force-resolve the open quarter (bounty), liquidate all lots (profit fee), derive the final ledger, produce the podium by gold.

### Achievements (`achievements.ts`)
A framework plus `DUMMY_ACHIEVEMENTS`:
- `first_blood` (First Mover): skill, gold 2.
- `hat_trick` (Hostile Takeover, 3 wins): skill, gold 5.
- `regular` (Committed Associate, 4 games played): skill, gold 2.
- `oracle` (Market Oracle, 2 correct quarter picks): vote-based, **hidden** gold 1. It's presented as cosmetic; its gold is folded into totals and never itemized.

### Hints (`hints.ts`)
**Pool v1** (`HINT_POOL`; text in `copy.hints.<id>`; numbers come from live settings via `hintVars`):

| Tier | Id | Hint |
|---|---|---|
| Common | `trade_impact` | Every buy pushes the price up a little; every sale pushes it down. |
| Rarer | `index_dip` | The index flinches when a game begins and gets it back when the game ends. |
| Rarer | `scic_driver` | Second Chance Insurance does well when people buy second chances. |
| Rarer | `shdw_driver` | Shadow Logistics profits when an operation succeeds. |
| Rarer | `event_decay` | Event stocks bleed slowly whenever nothing is happening. |
| Rarer | `dead_memory` | DEAD moves hard when bought, and it's slow to forget. |
| Rarer | `coin_leak` | COIN is chaos with a slow leak. Holding it for long rarely pays. |
| Rarer | `mood` | How you seem to be feeling shows up in your stock, and the effect fades with time. (It says "seem", not "say": the GM enters mood.) |
| Rarest | `kingfall` | If a game leader holds the crown for `{holdMinutes}` minutes and is then overthrown, COIN jumps on the next update. |
| Rarest | `index_scale` | Bigger games make the index grow faster, and make it flinch harder at the start. |

**Functions**
- `drawHint(tier, seen, pick)`: an unseen tip from the tier; else unseen from the next tier down; else a repeat.
- `gameHintTier(players, hours)`: see decision 22. Returns null if the game isn't eligible.
- `MINTER_HINT_TIERS`: `rack`→common, `datacenter`→rarer, `orbital`→rarest.

### Handicaps (`handicap.ts`)
- **`autoLevels(players)`:** a composite of 40% net-worth rank percentile, 35% average normalised placement, and 25% trajectory against the table's average growth since the last check.
  - The top `ceil(n/2)` get 1.
  - The others get `2 + round(3 × (median − score) / max(median − min, 0.15))`; a tight pack gets small levels.
  - Idle in the interval → −`idlePenaltyLevels` (min 2).
- **`effectiveLevel(auto, offset)`** clamps to 1–5.
- **`intervalHelpH(level, projectedH, nightMinutes)`** = gain × projection × interval / night length, split `goldShare` 0.3 gift / 0.7 hint credit.
- **`projectNightGoldH`** = stake + (earned − stake) × night / max(elapsed, 30 min).
- **`spendHintCredit`** buys the best affordable tier repeatedly (tip values 2/4/8 gold, `hints.value`; these values were assumed and the user agreed they can be).

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
- While paused, taps and passive minting ×`minter.pauseMultiplier` 2.
- The server is authoritative: `applyMinterSync(prev, {taps, buys}, elapsedSec, {paused, mult})`.
- The first rack / data center / orbital pays a tip.

### All settings and defaults (`settings.ts`)
`resolveSettings(overrides)` deep-merges overrides. `validateSettings` returns issues and never throws; the server also guards against malformed shapes.

**scoring**
- placementMults [1, 0.5, 0.25], tailFactor 0.5, tieRule average, dnfMult 0, coopLossMult 0.25, goldScale 3
- **curve linear, floorMult 0.1**

**stake, lateJoin**
- stake: startingGold 20
- lateJoin: goldFraction 0.75, goldPenalty 2, stockPenalty 0.05

**market**
- general: tickSeconds 20 (validated 15–30), maxChangeFrac 0.3, feeFrac 0.03, endSellProfitFeeFrac 0.1, investCap 25, minTrade 1, lockoutMinutes 5, slippage 0
- bands: player 30–80, index 30–80, crypto 5–150, event 10–100, dead 1–40
- impact: player 0.02, index 0, crypto 0.06, event 0.02, dead 0.06
- player: fairInnerLo 0.15, fairInnerHi 0.85, reversion 0.2, leaverDecay 0.02, espionageFrac 0.03
- index: scale 1, smoothing 0.3, **growthPerGold 0.23, startDropPerGold 0.15, noiseFrac 0.01, noiseReversion 0.1**
- crypto: sigma 0.07, reversion 0.05, baselineAlpha 0.002, **driftPerHour −0.03**, startFrac 0.25, kingfallFrac 0.1, kingfallHoldMinutes 15
- event: startFrac 0.35, floorFrac 0.1, decay 0.005, bump 0.08, reversion 0.1
- dead: baselineFrac 0.05, reversion 0.02

**votes, mood, rerolls, espionage, achievements, prompts, finale, minter**
- votes: quarterCount 4, bufferFrac 0.1, windowMinutes 5, weighting equal, bountyGold 2, topTwoMinPlayers 16, driftMax 0.15
- mood: moodMax 0.06, decayPerTick 0.01
- rerolls: perPlayer 3
- espionage: goldReward 3, revealDelayMinSec 15, revealDelayMaxSec 45
- achievements.gold: first_blood 2, hat_trick 5, regular 2, oracle 1
- prompts: tradingCloseMinutesBefore 15
- finale: collapseSeconds 10, podiumStepSeconds 5, recapSlideSeconds 8
- minter: pauseMultiplier 2, tvCrawlMinutes 10

**hints**
- enabled true
- games {win true, lastPlace true, minMinutesLarge 15, minMinutesSmall 30, rarerMinutes 90, rarestMinutes 240}
- streak true, minter true
- buy {enabled **false**, priceCommon 5, priceRarer 10, priceRarest 20}
- rerollTradeIn {enabled true, cooldownMinutes 120}
- value {common 2, rarer 4, rarest 8}

**handicap**
- autoEnabled **false**, intervalMinutes 60, gainByLevel [0, 0.05, 0.12, 0.2, 0.3], goldShare 0.3, idlePenaltyLevels 1

GM → Settings is **auto-generated** from this structure, so new settings appear in the UI automatically. Settings are stored per night as overrides (`night.settings` JSON); a `null` value resets a key (or a whole section) to its default.

---

## 7. Server (`packages/server`)

### Runtime model
- **One process owns all state.** GM writes go through REST: **validate role → write DB → audit log → refresh**.
- **`bus.refresh(nightId)`** marks the cached views stale and schedules a broadcast. Refreshes are coalesced and **throttled to ≤1 broadcast per 250 ms** (wall clock).

**Broadcasts (`sockets/index.ts`, `ViewCache`)**
- **One build per broadcast:** each broadcast computes `computeNightState` once, builds the public / GM / TV views once, and caches them.
- **Updates carry only the top-level parts that changed** since the last update to that room. The GM's `gm` block is diffed one level deeper. `night` and `marketTick` are always sent.
- **Market rows in updates have no `history`;** each carries `tail` = its last 3 `[tick, price]` points. Clients append points newer than their `marketTick` (`shared/socket.ts mergeUpdate`, 60-point cap).
- **Snapshots on (re)connect reuse the cached views** while nothing has changed (max 5 s). The clock fields (`serverTime`, `nightMs`, `pauseUntil`) are always refreshed.
- **A freshly computed snapshot resets the deltas,** so the next update to every room is complete. A socket that joins mid-stream always gets a full snapshot first. A remotely paused GM device reconnects for a fresh snapshot.
- **Compression:** WebSocket `permessage-deflate` (threshold 1 KB).

**Caches (`market.ts`)**
- **Price history** and **GM mood terms** are cached per database + night and rebuilt once per market tick with one indexed read per security.
- `priceHistoryPoints` returns ticks + prices. The old window query ranked every price row on every broadcast (35–47 ms).

**Tick loop (`tickLoop.ts`, every 1 s)**, in order:
1. Minter crawl (live or paused).
2. Recap unlock (ended).
3. Return early unless live.
4. Sync `current_quarter`.
5. `voteStep` (open/close/resolve rounds; resolution also checks poll streaks for tips).
6. `espionageStep` (delayed TV reveals).
7. `handicapStep` (hourly; runs if auto is on or any manual offset is set).
8. Market tick if due (index growth terms from `indexTerms.ts` are passed in).

Market randomness is deterministic per night and tick, so restarts are safe.

**Context, config and boot**
- `context.ts`: `Ctx {db, now, bus, config}`. `Bus {all, gm, tv, player, gmSession, refresh}`. HttpError helpers `bad`/`forbidden`/`notFound`/`conflict`. `recordingBus()` for tests.
- **Test-only `ZS_TIME_SCALE`** (default 1, range 1–1000): `src/timeScale.ts` scales `ctx.now()` so the whole server runs N× real time. The tick loop steps every max(50 ms, 1000/N).
  - It isn't a GM setting, isn't shown in the app and isn't in the README. **Never use it on a real night's DB:** it stamps future times.
  - **Restarting a test server resets the scaled clock**, so the night clock goes backwards.
  - Client countdowns and animations stay real-time. The socket throttle and minter leaderboard use the real clock.
- **Env vars:** `PORT` (8080), `HOST` (0.0.0.0), `DATA_DIR` (Docker: /data), `MEDIA_DIR` (/media), `CLIENT_DIR`, `SAMPLE_LIBRARY`, `HOUSE_RULES`, `NAME_BLOCKLIST`, `SECURE_COOKIES=1` (HTTPS only), `ZS_TIME_SCALE` (test only).
- **Body limit:** 1 MB, except sound uploads at 12 MB.
- **`main.ts` on boot:** opens the DB (migrations run automatically), seeds the sample library once and the house rules once (meta flags), loads the name blocklist, and starts the tick loop.

### Auth
- **GM:** cookie `gn_gm` (stores the sha256 of the session token). Credentials and PIN are hashed (`auth/password.ts`). The device type (phone/laptop) is chosen at login.
- **Remote pause:** the GM's phone can "Pause device" on a laptop session. A paused session sees the public view and unlocks with the PIN ("Wrong PIN." on failure; **no rate limit**) or "Resume device". `requireGm(ctx, req, {master?, allowPaused?})`.
- **Roles:**
  - Master = everything.
  - Sub GM = **field actions only**: approvals, starting games, results, scores, leader taps, mood, re-rolls, espionage, notifications, **sending tips**, soundboard play, prompt dismiss.
  - Master-only: setup, settings (including the auto-handicap toggle), library, rulebook, seating, sound uploads, offsets, **handicap levels**, night actions, exports.
- **Players:** device token in header `x-device-token` or socket auth `deviceToken`. No passwords.
  - A pending request's token becomes the device token on approval.
  - Rejoin = pick your name ("Return to my desk"), then GM approval. Multiple devices per player are allowed.
  - Device tokens of an archived night stop working; phones get `night:archived` and return to join.

### Database (`db/migrations.ts`, SQLite WAL, foreign keys on)
Migrations run in order:
1. **Full schema:** game_master, gm_session, night, night_pause, player, device, device_request, rule_entry, library_game, game_table, game, game_participant, leader_tap, adjustment, reroll_use, security (state JSON: driver/baseline/noise/lastFair/left/leaverFair), price (with a `causes` JSON debug note per row), impulse, trade, lot, vote_round, ballot, bounty_payout, mood_reading, challenge, achievement(gold_hidden), sound, notification, minter_state, audit_log, feed_event(gm_only), standings_snapshot.
2. `meta` table (one-time flags, prompt dismissals, `ambient_off:<night>`).
3. `night.pause_until`.
4. Challenge: `reveal_at`, `revealed`, `reassigned_from`, `peek_target`, `read_at`.
5. `seat_assignment` (night, table, seat, player; unique per player and per table seat), `minter_state.taps`, `sound.mime`, `sound.created_at`.
6. `night.recap_until`, `night.recap_done`.
7. `library_game.lead_mode/lead_label` (null = GM picks), `game.lead_mode` (existing rows `manual`) / `lead_label`, `game_score` (append-only history; latest per player counts; index on game, player, id).
8. **Hints, handicaps, gifts:**
   - `adjustment` rebuilt with kind `gift` + `read_at`.
   - `hint_grant` (unique per night+player+source+ref; `cost_h` for purchases).
   - `handicap_manual` (night, player, offset).
   - `handicap_eval` (levels, reasons JSON, trigger interval/correction/manual, gift_h, tips, credit_h).
   - `player.hint_tradein_nms`.

**Indexes:** only `price(night, security, tick)`, `impulse(night, consumed_tick)`, `game_score`, `handicap_eval` and the unique keys. Many per-night tables have no `night_id` index (§14).

**Night states:** `setup → joins_open → live ⇄ paused → ended → archived`.
- `trading_closed` is a flag; End force-closes trading.
- End also **cancels games without a result**.
- The current night = the newest non-archived night.

### Services (`src/services/`)
| File | Responsibility |
|---|---|
| `state.ts` | Load night/players/securities/lots/ledger (tip purchases as trade flows); `computeNightState` (everything derived) |
| `night.ts` | Pure `transition()`, createNight, `applyNightAction` (pause countdown; End → cancel open games, finishNight, achievements, finale clock, cues; archive → `night:archived`), settings (validated, incl. poll window ≤ quarter), adjustments, `skipFinale`/`replayFinale` |
| `gm.ts` | Setup, login, sessions, remote pause, PIN unlock, sub GMs, `masterOnly` |
| `library.ts` | Global library CRUD, JSON packs (`game-night-pack/1`, incl. leadMode/leadLabel), seeding; dangling rule links dropped |
| `games.ts` | Schedule/edit/cancel/start (idempotent), suggested hours, result wizard (same result twice = no-op) + corrections, crowns: manual taps or `enterScores` → `leaderFromScores`, kingfall, GameView (leadMode, leadLabel, scores, leadFixed) |
| `players.ts` / `join.ts` | Name/ticker/color checks (blocklist, reserved tickers), avatars (≤200 KB, magic-byte check), join/late join/rejoin requests and approvals, leave, ticker override |
| `trading.ts` | Buy/sell via engine with gates; friendly errors |
| `market.ts` | Impulse queue, `runTick`, cached price history (`priceHistoryPoints`), cached mood terms |
| `indexTerms.ts` | Hidden index growth/drops from games and results (GM view + tick) |
| `votes.ts` | Round lifecycle, ballots, bounty, streak tips, vote views (no tallies/drift) |
| `field.ts` | Mood readings, re-roll log, notifications, GM offsets |
| `espionage.ts` | Create/reassign (rejected memos only)/read/respond (same answer twice = no-op)/resolve, delayed TV reveal, peek, rewards incl. `hint` |
| `hints.ts` | Tip grants (idempotent per source+ref, deterministic draw), sources (results, streak, minter, memo), buy, re-roll trade-in, GM send, player/GM views |
| `handicap.ts` | Hourly evaluation, team averaging, gifts (adjustment `gift`) + tip credit, manual offsets (Master), correction re-evaluation, GM view + log, player gift list |
| `achievements.ts` | `awardAchievements` (after each result, quarter resolution and End) |
| `rules.ts` | Rulebook CRUD (http/https links only), house-rules seed |
| `seating.ts` | Tables, positions (0–1 fractions), seat assignment |
| `sounds.ts` | Uploads (MP3/OGG/WAV/M4A ≤ 8 MB, magic-byte check) to `MEDIA_DIR/sounds`, cues (final_round, intermission, achievement, night_end, collapse), ambient by library `sound_theme`, soundboard |
| `minter.ts` | Server-authoritative sync, first-tier tips, leaderboard push (throttled 3 s), TV crawl |
| `prompts.ts` | Close-trading / end-night prompts with dismiss + re-prompt signatures |
| `recap.ts` | Finale (podium + recap slides), finale clock, recap unlock, statement data |
| `pdf.ts` | Statement PDF (pdfkit, Helvetica, plain) |
| `exports.ts` | Night JSON (`zero-sum-night/1`; includes tips and the handicap log; GM only), CSV (standings/results/trades, formula-injection safe, BOM), archive list |
| `views.ts` | **Role-filtered views: the hidden-mechanics boundary** (§10). Public view has `marketTick`; player `me` has `tips`, `gifts`, `tipShop`; GM `gm` has `indexTerms`, `tips`, `handicap` |
| `feed.ts` / `audit.ts` | Feed events (public or GM-only) / audit log |

**Auto sound cues:** pause → intermission; End → collapse; finale finished → night_end; achievement → achievement. Missing cue files fall back to synthesized tones on the TV.

### REST API (summary)
- **Public:** `GET /api/health`, `GET /api/setup/status`, `GET /api/night` (GM view if GM cookie), `GET /api/rules`, `GET/POST /api/join`, `POST /api/join/rejoin`, `GET /api/join/status`, `/uploads/avatars/:file`, `/media/sounds/:file`.
- **Setup/GM auth:** `POST /api/setup`, `POST /api/gm/login|logout|device-type|unlock`, `GET /api/gm/me`, sessions + pause/resume, sub-GM CRUD, `GET /api/gm/audit`.
- **Night (Master):** `POST /api/nights`, `PATCH /api/night`, `POST /api/night/:action` (open-joins, start, pause {minutes}, resume, close-trading, end, archive), `PATCH /api/night/settings`, `POST /api/night/adjustments`, `POST /api/night/finale/skip|replay`.
- **Any GM:** `POST /api/night/prompts/dismiss`, `GET /api/nights` (archive).
- **Library/games:** library CRUD + `export`/`import`; games CRUD, `start`, `prefill`, `result`, `correct`, `leader` (manual games only), `scores` (`{scores:[{playerId, score}]}`, any GM, scored games only).
- **Field (any GM):** `/api/requests/:id/approve|deny`, `POST /api/mood`, `/api/rerolls`, `/api/notifications`, `/api/challenges` (+ `/reassign`, `/resolve`), `POST /api/sounds/play`, **`POST /api/tips` {playerId, tier}**.
- **Master setup:** `/api/players/:id/leave`, `PATCH /api/players/:id` (ticker), `PATCH /api/securities/:id/offset`, **`PATCH /api/handicap/:playerId` {offset −4..4}**, rules CRUD, tables CRUD + `/seat`, `/api/seats/clear`, sound upload/delete, `GET /api/export/night.json?night=`, `GET /api/export/{standings|results|trades}.csv?night=`.
- **Player (device token):** `GET /api/me`, `POST /api/trade/buy {securityId, gold}` / `sell {securityId, sharesH}`, `POST /api/me/messages/:id/read`, `POST /api/vote`, `POST /api/me/challenges/:id/read|respond|peek`, `GET /api/minter`, `POST /api/minter/sync`, `GET /api/me/statement`, `GET /api/me/statement.pdf`.
- **Player tips and gifts:** `POST /api/me/tips/:id/read`, `POST /api/me/gifts/:id/read`, `POST /api/me/tips/buy {tier}`, `POST /api/me/tips/trade-reroll`.
- **Errors** are `{error: code, message}`. Many codes have no server message; the client maps them through `copy.errors`.

### Sockets
- **Rooms:** `public` (TV + players), `tv`, `gm`, `player:<id>`, `gms:<sessionId>`. A paused GM device is moved to `public`.
- **State:**
  - `snapshot` on connect: full, with market `history`.
  - `state:update`: **partial** (changed top-level keys only; market rows carry `tail`). The TV room also gets `{tv:{seating, ambient}}`.
  - `player:update`: private `me`, full.
- **Events:**
  - Night lifecycle: `night:update` (`{created}` makes the TV reload), `night:paused`, `night:resumed`, `night:ended`, **`night:archived`** (phones drop their device token and return to join; TV reloads).
  - Games and votes: `game:update`, `leader:update`, `vote:call`, `vote:update`.
  - Feed and achievements: `feed:new`, `achievement:new`.
  - Espionage: `espionage:notice` (TV), `espionage:update` (GM).
  - Sound: `sound:play` (TV). Minter: `minter:leaderboard`, `tv:crawl` (TV). Rules: `rules:update`.
  - Finale: `finale:replay` (TV), `recap:done`.
  - GM devices: `device:approval`, `gm:device_pause`, `handicap:update`.
  - Player-only: `vote:bounty`, `espionage:new`, `espionage:result`, `notify:player`, `hint:new`, `gift:new`.
- **Client store rules (important):** `shared/socket.ts` merges `state:update` via **`mergeUpdate`** (shallow; `gm` one level deeper; market tails appended), and merges `player:update` (as `me`) and `minter:leaderboard` **into the store**.
  - **Never replace the store wholesale** on an update: updates are partial now.
  - Before this rule, components set `s.me` locally and the next public update reverted it (a real bug found in the Phase 6 e2e).

---

## 8. Client (`packages/client`)

Entries: `index.html` (landing), `play.html`, `gm.html`, `display.html`. Aliases: `@shared`, `@copy`. Static, bundled, offline. Hashed assets are served with an immutable cache header.

**Shared**
- `api.ts` (ApiError), `socket.ts` (`connectLive`, `mergeUpdate`, `nightNow`), `copy.ts` (`t(key, vars)`), `format.ts` (`gold`, `signedGold`, `clock`…), `types.ts` (all view shapes), `feedText.ts`, `markdown.ts` (safe subset; escapes first).
- `ui.ts`: toast, `run`, **`errorText`**. Never shows a raw code; maps through `copy.errors`, with generic and network fallbacks.
- Components and styles: `Avatar`, `Sparkline`, `Toasts`, `base.css` (bland, gold accent).

**Phone (`play/`)**
- **Shell:** boot sequence (~3 s, once per tab session), home grid with **red count badges only** (no banners), vibrate on new items, rotate prompt in landscape, centered phone frame on desktop.
- **Join screen** re-checks `/api/join` every 4 s (it notices when joins open). Photo errors show `phone.photo_failed`.
- **Apps:**
  - Vote (icon only while a poll is open), Wallet, Market, Standings, Feed, Rules (searchable), Profile, NFT Minter.
  - **Messages:** the tip line (buy buttons if enabled; re-roll trade-in with cooldown), anonymous tips and gifts (newest first), GM notifications, encrypted espionage memos (decrypt, accept/reject, peek tool, dead clue, tip reward).
- **Incoming call:** full-screen when a poll opens. Answer opens Vote; Decline snoozes, keyed per night+quarter in localStorage; the badge stays.
- **Lock screens:** pause (countdown + "Open NFT Minter") and ended (until the finale finishes). A player who left sees a "checked out" notice.
- **`Statement.svelte`:** Final Account Statement + PDF download (fetch with header → blob).
- **Fun apps registry:** `play/fun/index.ts`.
- **Storage:** local `gn_device`, `gn_pending`, `gn_feed_seen`, `gn_call_done`; session `gn_booted`.

**GM (`gm/`)**: laptop sidebar, or phone bottom bar (the first four field routes + More).
- **Field screens:**
  - Dashboard: state, clock, quarter, poll status, pause with countdown, approvals, **score entry per active scored game** (`ScoreEntry.svelte`: − / number / + per player, Save) or crown taps for manual games, prompts, after-collapse controls + exports. The End confirmation counts games that will be cancelled.
  - Games: schedule incl. table and **"Who's leading"** (locked if the library sets it), result wizard (busy-guarded), re-roll log.
  - Mood. Espionage (reward types incl. **Mechanic tip** + tier).
  - Messages: **Send a tip**, **Tips given tonight** log, notifications.
  - Players.
- **Setup screens:**
  - Market: offsets, mood terms, **Index (hidden from players)** growth/dips/net, kingfall list.
  - **Handicaps** (Master): auto on/off, per-player auto / ± manual / level / why, log.
  - Seating (drag-drop), Soundboard, Rulebook, Join QR (printable; editable LAN URL), Archive & exports.
  - Library ("Who's leading" + score name per game), Settings (auto-generated), Devices & GMs, Audit log.
  - Plus Setup, Login and Locked.

**TV (`tv/`)**
- Terminal boot lines, headline bar, standings, now playing (crowns + progress), rotating panel every 15 s (up next / market board / seating / top minters), bottom ticker crawl.
- Sequential lower-thirds (espionage, achievements, dethronings, poll opening, trading closed), "polls are open" strip, intermission overlay, ambient loop, synthesized cue tones (`tones.ts`).
- Reloads itself on a new or archived night.
- **`Finale.svelte`:** SPECIAL REPORT → prices crash to zero → collapse line → podium 3rd→2nd→1st → recap slides → "statements on your phones". It's driven by the server's `recapUntil`, with clock skew corrected from `serverTime`.
- "Enable audio" must be clicked once.

**Known harmless warnings:** `svelte-check` shows 3 warnings in `ResultWizard.svelte` ("captures the initial value of `game`"). That's intentional: one wizard instance per game.

---

## 9. Copy (`copy/en.json`)

Top-level keys:
- securities, achievements, brand, feed, status, modes, landing, trade_errors, minter, tv (banners, recap, finale…), gm (prompts)
- phone (apps, call, vote, memo, rewards incl. `hint`, statement, tip line `tip_*`, `gift_*`, `photo_failed`, `left_notice`, …)
- **lead** (crown modes), **hints** (tip texts), **errors** (a sentence per server error code + `generic` / `network`)

**Rules**
- The server reads the brand and achievement names for the PDF.
- Copy **never states hidden mechanics**; event-stock blurbs only hint. Tips are the one place mechanics are revealed, and only to the player who earned them.
- **Player-facing copy never says "handicap" or "pity".** Gifts are "from another associate, who asked to stay anonymous"; tips are "Anonymous tip".
- House rules (`assets/house-rules.json`) were written to reveal nothing hidden; a test checks for words like drift, hidden, kingfall, mood, secretly.

---

## 10. Hidden mechanics (must stay hidden)

| Hidden from | What |
|---|---|
| **Players and GM** | Vote-share drift · gold paid for "cosmetic" vote-based achievements (Market Oracle) · espionage stock nudges (±3% agent stock, SHDW bump) |
| **Players only** (GM sees) | Mood-driven price impact · GM price offsets · kingfall → crypto spike · index growth from games and start dips (`gm.indexTerms`) · crypto downward drift · handicaps (levels, reasons; gifts look like anonymous gifts; handicap tips look like any tip) |
| **Hinted only** | What drives the event stocks; anything a tip reveals to its recipient |

**Rules**
- **Never revealed at the end.** Not in the recap, statements, PDF or player-visible exports (exports are GM-only files).
- **Enforcement:** `services/views.ts` builds every view field by field; never spread DB rows into a view. The socket delta layer only diffs those views.
- **Never sent to anyone:** `drift`, price `causes`/`fair`/`target`, `impulses`, `lastFair`/`leaverFair`/`baseline`/`noise`, credential/pin/token hashes, `gold_hidden` / hidden achievement gold. The GM ledger shows **visible** achievement gold only; hidden gold is folded into totals and never itemized.
- **GM-only fields:** `gmOffset`, `moodTerm`, `ledger`, `overrides`, `baseline`, `indexTerms`, `handicap`, the tip log, and the GM-only feed (kingfall, corrections, espionage success, re-rolls).
- **Seating** is GM + TV only (sent to the `tv` room, never `public`).
- **Statements** show final gold and trading result but **no gold breakdown**, because a breakdown would let players subtract out hidden gold and gifts.
- **Tests assert these:** `FORBIDDEN_KEYS` and `GM_ONLY_KEYS` (incl. `"indexTerms"`) in `test/helpers.ts`; structural checks in phase6–9 and socket tests; a player view must not contain the word "handicap". The 60× night harness also scans every frame every client receives. Run them after any view change.

---

## 11. Simulation (`packages/sim`)

**What it does**
- Headless full nights using the real engine.
- **Agents:** the original seven (holder, trader, self-pumper, coalition, crypto gambler, random, inactive) plus 20 more types, 27 in total, e.g. fee-aware minimalist, crown chaser, active trader, pump crew, kingmaker crew, game grinder, social butterfly, leader/underdog voter, momentum chaser, contrarian, panic seller, all-in YOLO, event speculator, dead-stock lone wolf. Each has low/mid/high skill. Runs use worker threads.
- `paramSets.ts`: `spec-original`/baseline, `old-x1-tuned`, `recommended`, `slippage-alt`.
- **Reports:** `packages/sim/reports/REPORT.md` (targets) and `STUDY.md` (population study); `results.json` is gitignored. Copies are in the Project ("Sim Report — Phase 2", "Player-Type Study").

**Results from the Oct 24 tuning**
- **Recommended set:** 9/9 targets at 12 players, 8/9 at 20 players.
  - At 12 players: market share of the winner's gold 14%; a solo pump is unprofitable in 100% of runs; coalition ROI 5.7%.
  - The 20-player miss: bottom-quartile comeback 4.9% vs the 5–15% target.
- **Study findings** (edge vs never-trades of the same skill):
  - Best: fee-aware minimalist about +12, crown chaser about +9, active trader about +8.
  - Worst: self-pumper about −22, contrarian about −10, momentum chaser about −7.5.
  - These are flagged as "possible exploits" (>15% ahead); the user chose to keep the crown edge (decision 10).

**⚠ Not re-run since Oct 27.** The linear payout curve, index growth, crypto drift and handicaps all shift the economy. Hints and handicaps aren't modelled in the sim at all. The numbers above describe the old economy.

**Gaps:** the sim tracks gold by source and has an example-night narrator, but **no per-trade trace** (the user asked; it doesn't exist, and they said not to build it).

---

## 12. Testing

**Unit and integration** (`npm test`)
- engine 112, server 74, sim 4 (190 total), all passing. `npm run typecheck` is clean (0 errors, the 3 known warnings).
- **Server test helpers:**
  - `makeApp()` builds an in-memory DB with a fake clock (`t.clock.advance(ms)`).
  - `liveNight(t, n)` returns the Master cookie plus device tokens.
  - `call()` sends requests; `tickOnce(ctx)` drives the loop; `recordingBus()` captures emits.
  - `test/sockets.test.ts` boots real sockets (incl. delta / tail / cached-snapshot tests).

**Browser harnesses (`e2e/`, see its README; need Playwright 1.63 + Chromium)**
- **`e2e/rounds/r01…r10`:** 10 human-behaviour bug rounds.
  - Each starts its own server and checks what real people do: double taps, refreshes, junk input, Wi-Fi drops, crashes, two GMs, load (14 phones + 2 GMs + TV).
  - Final regression: **0 page errors, 0 server errors**.
  - Remaining flags are **known false positives**, listed in the e2e README.
- **`e2e/night/run.mjs`:** the 60× simulated night.
  - 10 phones driven through the real UI, the GM switching randomly between laptop and phone, the TV, and a `catan-risk` pack import.
  - Catan from real data (median 71 turns, 251 colonist.io games; tabletop pace from the box's 60–120 min); 6-player Risk is modelled (3.5–5.5 h, eliminations spread over the game).
  - **Last run (after the performance fixes):**
    - no leaks in ~39k frames; 0 page errors; API p50 11 ms / p95 29 ms;
    - index +14.5%, crypto down, statements/PDFs correct;
    - 103 MB of state JSON in total, down from 434 MB before the deltas.

**Other evidence**
- **Sync check (ad hoc):** a client connected for 45 s at 60× (126 ticks, trades, a game, scores, a message, a pause) merged into exactly the same state as a fresh snapshot (TV and GM). Updates averaged 1.4 KB vs 11.8 KB full, before compression. `permessage-deflate` is negotiated.
- **Discouraging-moment analysis** of the first test night was done by hand from its export (§14).

**Not verified**
- Physical phones (vibration, call screen, iOS Safari, real Wi-Fi), real TV audio.
- The Docker build inside the sandbox (Docker Hub is blocked there; the user's server builds it fine).
- The headless sim after Oct 27 (§11).

---

## 13. Deployment

**Standard install** (README):
```sh
git clone https://github.com/mscottwhit12-hub/Zero-Sum.git zero-sum
cd zero-sum && docker compose up -d --build
```
- **Image:** `node:22-bookworm-slim`, multi-stage. The build stage has python3/make/g++ for better-sqlite3; it runs `npm ci`, builds the client, then `npm prune --omit=dev`.
- **Runtime:** `ENTRYPOINT docker/entrypoint.sh` (chowns /data and /media, then `setpriv` to user `node` uid 1000). CMD `node node_modules/tsx/dist/cli.mjs packages/server/src/main.ts`. Healthcheck `/api/health`.
- **The container listens on 8080.** Volumes: `/data` (sqlite, avatars) and `/media` (sounds). Compose uses `${ZS_PORT:-8080}:8080` and `TZ`.
- The first build needs internet; runtime needs none. Migrations run automatically on start.

**The user's actual setup (working since Oct 26)**
- Ubuntu server `whitserv`, user `mscottwhit`, reached via Tailscale IP `100.125.8.126`.
- The repo is cloned at `~/jellyfin/zero-sum`, with a `zero-sum` service block in their large existing compose file `/home/mscottwhit/jellyfin/docker-compose.yml`:
  - `build: ./zero-sum`, `image: zero-sum:latest`
  - volumes `./zero-sum/data:/data`, `./zero-sum/media:/media`
  - ports **`"6969:8080"`** (the earlier `6969:6969` mistake is fixed and confirmed)
- **Update:**
  ```sh
  cd ~/jellyfin/zero-sum && git pull
  cd ~/jellyfin && docker compose up -d --build zero-sum
  ```
- **Access:** players use `http://100.125.8.126:6969` on the tailnet. Party guests probably won't be on Tailscale, so for a real night the **LAN IP** goes on the join QR (Join QR screen, editable URL). ufw is inactive.
- **Portainer:** the Portainer web editor can't build from a local path. The options given were to pre-build the image over SSH, or to publish an image to GHCR. **GHCR publishing doesn't exist yet**; offer it if they want `image:` pulls.

---

## 14. Open problems, risks and gotchas

### Gameplay problems seen in testing (not solved, or only partly)
1. **One long game decides the night.** In the first test night, 6-player Risk paid 49% of all game gold, and its winner jumped from 5th to 1st on one result. The formula (hours × players) is locked; the linear curve and handicaps soften it but don't change it.
2. **Long idle stretches.** In the first test night, two players had no game for the first 1 h 44 m, and four Risk players were eliminated hours before the end with nothing else to play. Handicaps help idle players a little; nothing else addresses this yet.
3. **Other discouraging moments** (one simulated night, signals not patterns):
   - repeated last places; several players never held a crown;
   - heavy traders losing to fees; "Not enough gold" taps;
   - a "safe" index buy losing money (before index growth);
   - DEAD bets never moving the price;
   - half the room with no achievement or bounty.
4. **Handicap levels swing hour to hour.** One player went 5 → 1 → 5 in the deep test night. The first check (1 h in) runs on very little data. Smoothing was discussed, not decided.
5. **The hint pool is thin:** 10 tips, only **one common**. Most sources pay common tips, so repeats come fast.
6. **Market Oracle collision:** the "two correct picks in a row" tip can fire at the same moment Market Oracle unlocks, which might let a player connect the two.
7. **The headless sim isn't re-run** after the Oct 27 economy changes (§11).

### Performance (items 7–20 of the Oct 27 audit; 1–6 are fixed)
Measured on the 2-core sandbox against the deep test night's DB (10 players, 1,264 ticks) and copies scaled to 20 players and 20 archived nights.
- **7. Missing indexes:** per-broadcast lookups on trade, feed_event, notification, challenge, game, leader_tap, adjustment and mood_reading scan the whole table across **all past nights**.
- **8. Trades:** a player's trade history (`trade WHERE player_id`) scans the entire trade table for every player on every broadcast.
- **9. Database growth:** each price row stores a ~135-byte `causes` debug JSON (~2.5 MB a night). The DB grows ~4 MB a night with no pruning or VACUUM.
- **10. Night export** loads every price row (1.5 MB / 50 ms per 10-player night; doubles at 20 players).
- **11. Tick loop:** recomputes the full night state every second just for the quarter check, and `voteStep` recomputes it again (two full computes per second, even when idle).
- **12. Index terms** reload and re-score all finished games every tick and every GM broadcast.
- **13. Game cards:** each game card costs ~4 lookups per broadcast (crown replay with its own night lookup, latest scores, participants, pause overlap).
- **14. Player views:** ~8 lookups per player per broadcast (~160 at 20 players).
- **15. Messages** re-read all notifications per player and re-parse `read_by` JSON every broadcast.
- **16. GM handicap view:** one query per player for the latest evaluation, plus re-parsing up to 150 log rows.
- **17. Phone Market:** redraws all 15 sparklines on every update (up to 4/s); heavy on cheap Android phones.
- **18. TV** redraws its clock every 250 ms, and its finale animation runs on the same timer; heavy for smart-TV browsers.
- **19. NFT Minter** re-renders every 200 ms and syncs every 3 s per phone, including on the pause screen where everyone mints at once.
- **20. Incoming call** vibrates every 3 s until answered (battery).

### Other risks and gotchas
- **PIN unlock has no rate limit** (a 4-digit PIN; physical access to the paused laptop is needed).
- **Minter double-tap buys two** (normal for a clicker; noted, not changed).
- `PATCH settings` with `null` resets a whole section to defaults, by design. The Settings UI doesn't send that, but the API accepts it.
- `recap.ts` "best trade" includes auto-sells (forced). "Trade of the night" can be tiny (e.g. +0.2) on short nights.
- The PDF uses Helvetica (WinAnsi), so avoid characters like `→` in PDF text. Times print in the server TZ (set `TZ`).
- Espionage reveals are wall-clock and don't fire while paused (they reveal on resume).
- `GET /api/night` returns the GM view if a GM cookie is present, otherwise the public view.
- **Test mode:** restarting a `ZS_TIME_SCALE` server resets its scaled clock. Statement and phone times look odd at 60×. Client animations run at real speed, so finale recap slides can't be judged at 60×.

**Dev gotchas**
- **`pkill -f <pattern>` kills the agent's own shell** (twice now); kill by pid from `ps` instead.
- **WAL:** copy `*.sqlite-wal` too when copying a live DB, or you get stale data.
- Fastify rejects an empty body with `content-type: application/json`; send `{}`.
- Playwright/Chromium is preinstalled in the sandbox; don't reinstall. ESM imports ignore `NODE_PATH`, so the e2e scripts load Playwright via `createRequire`.
- Docker Hub is blocked in the sandbox.
- `.npmrc legacy-peer-deps` is required.
- Write tool paths: the repo lived at `/root/zero-sum` early in one session (`~` = `/root`); it's now at `/home/claude/zero-sum` with a symlink. Use absolute paths.

---

## 15. Placeholders and waiting on the user

| Item | Current placeholder |
|---|---|
| Achievement list | 4 dummies (above); the user will supply the real list |
| Hint pool | 10 tips (1 common); the user wants more, "returned to at some point" |
| Tip gold values | 2 / 4 / 8 (assumed, used by handicaps) |
| Tip prices (buying, off by default) | 5 / 10 / 20 gold |
| Handicap composite weights | 40/35/25 (fixed in code, not settings) |
| Brand / security names | Bullion & Associates, BNN, IDX / COIN / SCIC / SHDW / DEAD, PlaceholderCoin etc. in copy |
| Visual theme | Bland; TV "broadcast" and Minter are placeholders by request |
| Minter tiers | Made-up numbers |
| PDF layout | Plain |
| Tiebreaks | Average of spanned places (`tieRule`) |
| Espionage custom reward | Free text; the GM grants it by hand |
| Sounds | None bundled; cues use synthesized tones; the user uploads local files |
| Sub GM scope | All field actions incl. sending tips; setup, settings and handicaps are Master only |
| Test pack defaults | Catan 1.5 h (midpoint of 60–120 min), Risk 4 h (inside 1–8 h; no published 6-player figure) |

---

## 16. Discussed but not done

Don't build any of these until the user asks; several are only ideas.

**Agreed in principle, details open**
- **More hint-pool entries,** especially common ones. The user said the pool "will have to get returned to at some point".
- **Handicap smoothing** between hourly checks (open problem 4).
- **More comeback mechanics:** the user asked for "better comeback mechanics for people in low spots consistently". Handicaps and the softer curve are the first answer. What else should change for low-ranked players is open; the user said "I'm unsure what should change about how the game works for players based on handicap". A stock-market effect from handicaps was explicitly deferred: "if the other things thought up aren't enough then yes … but for now no".
- **Idle-time fixes** (open problem 2). Raised by the analysis, no decision yet.

**Smaller items noted**
- Add entered game scores to the night export (backlog).
- Performance items 7–20 (§14). The user had 1–6 fixed and the rest only identified.
- GHCR image publishing (offered for Portainer, never requested).

**From earlier sessions, still possible**
- Visual theme pass · real achievements · rank arrows on standings · renaming the in-app brand to Zero-Sum · physical-device fixes after the first real night.

**Brainstorm material already given to the user** (in this session's chat, not the repo)
- 15 hint-source ideas (decisions recorded in the Decisions Log).
- 30 hint texts (accepted ones are in the pool; rejected ones are listed in the log).
- 22 open handicap questions (answered; see decision 23).
- 23 discouraging moments from the first test night (§14).
- 20 performance problems (§14).

---

## 17. Project knowledge (claude.ai Project "GAME_NIGHT")

- `Game Night Platform — Build Spec v1.md`: the authoritative original spec (Oct 24 2026).
- `Game Night Platform — Handoff.md`: the earlier, pre-spec handoff (superseded by the spec).
- `Decisions Log.md`: **the master sheet**. Locked decisions, kept current, including all Oct 26–27 decisions with the yes/no answers to the hint lists.
- `Sim Report — Phase 2.md`, `Player-Type Study.md`: sim outputs (pre-Oct 27 economy).
- `Zero-Sum — Engineering Handoff.md`: this document (also in the repo at `docs/HANDOFF.md`).

When decisions change, update the Decisions Log and this file together.
