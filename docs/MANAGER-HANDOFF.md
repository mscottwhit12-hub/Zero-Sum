# Zero-Sum: Manager Handoff

**As of:** Oct 29 2026 · **For:** the next Claude manager on Zero-Sum (you replace the previous one) · **Repo:** `github.com/mscottwhit12-hub/Zero-Sum` (`main`)

Read this first, then `docs/HANDOFF.md` §2–§4 (how Tate works, locked decisions, current state). Use the rest of HANDOFF.md as reference only when a task needs it.

---

## 1. Your job: manager and integrator, not the main coder

Tate promoted Claude from lead engineer to **manager + integrator** of a small team of AI engineers. You:
1. **Scope work and write briefs ("packs")** for the engineers: a short BRIEF.md plus only the files they need.
2. **Review and integrate** what they hand back: apply it on a branch, fix small integration issues, typecheck, run the unit tests and browser harnesses, look at screenshots (360 px phone, laptop), and report to Tate.
3. **Push only when Tate says so** (see §5).
4. **Keep the docs current:** this file, `docs/HANDOFF.md`, and the Decisions Log ("master sheet", in the claude.ai Project and in your notes).

You still write code, but only **plumbing, wiring, integration fixes and small changes**. Anything with real volume (a new board, a theme, a big feature) goes to an engineer. If you catch yourself writing hundreds of lines, stop and brief someone instead.

## 2. Token efficiency (Tate's standing rule)

Tate wants you **token-efficient** and **outsourcing whenever possible**.
- Don't read the whole codebase. `grep` for what you need; read files in parts.
- Packs contain **only what the engineer needs**; they can't see the repo. No full-source dumps (Gem is the one exception, see §3).
- Short replies: sharp and to the point, no praise, no recaps (HANDOFF §2). One question at a time with lettered options and a recommendation, "Go with X?".
- When Tate says "if there are problems, don't solve them, just write them up", do exactly that: a short report file for the engineer, not fixes.
- Reuse the existing browser harnesses rather than writing new ones; add a small harness only for a new feature.

## 3. The team

Engineers **can't access the repo or run the app**. Tate relays everything: you give him a zip or a single file, he pastes it to the engineer, and he brings the engineer's zip back to you. Every engineer treats **Tate as product owner** for open gameplay questions and hands back **a zip of changed files at repo paths + ≤10 lines** (what's done, what Tate decided, what's unsure).

| Name | Role | Currently | Best way to work with them |
|---|---|---|---|
| **Jim** | Board engineer | **Free.** Monopoly delivered, integrated and pushed Oct 29 (`575ba1d`). Built Risk before. Open from his notes: 39 board settings need grouping on GM Settings; board English hardcoded. | Give him the current live version of his previous board as a reference ("copy these patterns"), the binding contract, and a list of rule variants to ask Tate about rather than pick himself. Reliable; one known bug pattern: reusing a loop variable name inside the player-panel snippet (it emptied Risk's eliminator list). |
| **Ollama** | Board engineer | **Catan** GM board only. Memory-wiped and restarted Oct 28. Brief: `team/ollama-catan-BRIEF.md` | Assume **zero context**: every brief must be fully standalone (what Zero-Sum is, the contract, reference board, constraints). **If Ollama is on anything other than the Catan board, he switches to the Catan board.** |
| **No** | Board engineer | **Free.** Delivered Ticket to Ride (USA + Europe), integrated and pushed Oct 28. | Strong work: ships tests, a bug log (`docs/boards/ttr-bug-log.xlsx`) and BUG ids. His README had no "Tate decided" lines, so ask him to list each decision Tate made. Ready for a new game pack (ask Tate which game). |
| **Server** | GUI / art direction | Phone theme **phase 1 delivered and pushed** Oct 29. Next: **phase 2, the TV**, plus phone fixes 1–4 in `team/server-REVIEW-1.md` (hand that file to Tate for Server if he hasn't already). Brief: `team/server-BRIEF.md`, `team/server-FOLLOW-UP.md`. | Rule: **"change how things look, never how they work"** (scripts untouched). He can't compile or render, so you must build, test and compare against `team/phone-all.html` (the approved look; Tate wants it reproduced **exactly**). Give feedback as a short file. **Class names are now a test contract** (`button.app`, `.nb`, `button.r`/`span.t`, `button.pick`, `button.tipc`/`.rd`, `button.mono`, `button.mint`, `.call`, `.rb.a`/`.rb.d`). The GM console stays plain. |
| **Gem** | Advisor (unlimited tokens) | Briefed with the full project (`GEM-ZERO-SUM-COMPLETE.txt` / gem pack). **No advice received yet.** Brief: `team/gem-BRIEF.md` | Reviews and proposes; **doesn't code**. The one teammate who gets the whole picture (full source + docs), as a single text file or zip. His advice arrives via Tate as short buildable notes; you decide how to build and ask Tate about anything gameplay. |

**Board contract** (`packages/client/src/gm/boards/contract.ts`, now **v1.2**): binding for every board engineer and additive only. v1.2 added optional `startedAt` / `endsAt` to the context (start + the library game's length). Engineers import only their folder, `../contract` and `../../../shared/Avatar.svelte`; you register boards in `gm/boards/index.ts` and add their entry to `assets/classics.json` (seeded per game by name on boot).

## 4. Integration routine (what worked)

1. Unzip the hand-back into its own scratch folder. Read the engineer's notes. Check the scope rules: files only where allowed, no new dependencies, scripts untouched for Server (compare `<script>` blocks against `git show HEAD:`).
2. `git checkout -b <engineer>-<thing>`, copy the files in.
3. `npx svelte-check` (in `packages/client`), `npm test --workspaces`, `npm run build -w packages/client`.
4. Browser harnesses (Playwright, real server): `e2e/rounds/r01…r11`, `e2e/seating`, `e2e/boards/run.mjs` (Risk), `e2e/boards/ttr.mjs`, `e2e/features/run.mjs`, `e2e/features/pwa.mjs`. Run them one after another, never in parallel (they share ports). Kill stale servers **by pid** (`ps aux | grep "[s]rc/main.ts"`), **never `pkill -f`** (it kills your own shell).
5. Screenshots: 360 px phone, laptop width. Look at them.
6. Report to Tate: verdict, what you fixed, test counts, then open questions one at a time. Ask before pushing.
7. After the push: update HANDOFF.md §4, the e2e README, the Decisions Log, and the claude.ai Project copies.

**Known false positives** (not bugs): r03 two trade-toast wording checks; r05 "Start disabled while paused"; r06 PIN-lock text; r09 `{"market":null}` → 200; r10 hourly handicap under load + phone wallet mismatch after chaos.

## 5. Tate's push and update rules

- **Ask before every push**, even after earlier approvals ("Push it?"). Tate said: "i give you permission to push you just have to ask so i can allow it." The session's stop hook nags about unpushed commits; **Tate's rule wins**. Commit locally, then ask.
- Commits end with the session's attribution lines.
- Tate tests only by installing from GitHub. His update command:
  ```
  cd ~/jellyfin/zero-sum && git pull
  cd ~/jellyfin && docker compose up -d --build zero-sum
  ```
- Server: Dell T3630 (2018 i7, 32 GB, integrated graphics) on LAN; players reach it over plain http. Migrations run automatically.

## 6. Where things stand (Oct 29)

**Live on `main`:** everything through the feedback round; Risk, Ticket to Ride (USA, Europe) and Monopoly boards; the phone theme (phase 1); the iPhone home-screen app (full screen via Add to Home Screen; Android later, maybe a light app). Tests: client 263, engine 116, server 92, sim 4; all harnesses green apart from the false positives above.

**Waiting on deliveries:** Ollama (Catan), Server (TV theme + phone fixes), Gem (first advice).

**To brief out (Tate: manager doesn't build):**
- Theme English to `copy/en.json` (`team/server-REVIEW-1.md` #5): give to an engineer.
- New packs for No and Jim once Tate picks games.
- Harness `e2e/boards/monopoly.mjs` added; `e2e/features/run.mjs` chat selectors fixed to `button.row-btn` (theme commit had wrongly renamed them).

**Agreed but not designed:** games where the table doesn't matter (e.g. Kahoot): an option to skip table/seats. Ask Tate for the details before briefing anyone.

**Biggest unknown:** no real full night yet on real phones, a real TV and party Wi-Fi. Tate has been testing pieces live. On iPhone, Reduce Motion turns off the app-open zoom on purpose (Tate's phone has it on).

**Waiting on Tate:** real achievement list, more anonymous tips, final brand/stock names (the home-screen name "Zero-Sum" is a placeholder), and which game No does next.

## 7. In this package

| File | What |
|---|---|
| `MANAGER-HANDOFF.md` | This sheet |
| `HANDOFF.md` | Full engineering handoff (architecture, rules, decisions, history) |
| `Decisions Log.md` | Master sheet of Tate's decisions, newest at the bottom |
| `team/` | Each engineer's current brief, Server's follow-up, review and approved mockup (`phone-all.html`), the board contract |
| `e2e-README.md` | What each browser harness checks |

The code is on GitHub; clone it, don't ask for zips.
