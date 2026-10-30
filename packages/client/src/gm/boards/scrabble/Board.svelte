<script lang="ts">
  /**
   * Scrabble board: the GM's score sheet. Players sit around the table showing their running total; the GM types
   * ONE number per turn (word optional), can undo the last entry, and sees the tiles left in the bag. When the game
   * ends the GM enters the tiles left on the racks and the final totals reach the crown. There is no live leader.
   * All rules live in ./def.ts.
   */
  import { tick } from 'svelte';
  import Avatar from '../../../shared/Avatar.svelte';
  import type { BoardPlayer, BoardProps } from '../contract';
  import {
    DICTIONARIES,
    addExchange,
    addLostChallenge,
    addPass,
    addPenalty,
    addPlay,
    bagCount,
    cfg,
    challengeOff,
    clock,
    currentPlayer,
    duration,
    endGame,
    entryPoints,
    entryText,
    finishWarnings,
    markStarted,
    ordinal,
    rackMax,
    ranking,
    rankWith,
    recordReroll,
    redoLast,
    redoNext,
    reopenGame,
    scorelessRun,
    setBag,
    setFirst,
    statsOf,
    totalScore,
    turnClock,
    undoLast,
    type EndMode,
    type ScrabbleState,
  } from './def';
  import { clamp, seatPoints } from './seating';

  let { ctx, state: game, onchange, onfinish }: BoardProps<ScrabbleState> = $props();

  let picked = $state<number | null>(null);
  let confirmFinish = $state(false);
  let busy = $state<Record<number, boolean>>({});
  let rerollFailed = $state<Record<number, boolean>>({});
  let showAllHistory = $state(false);
  /** Players whose big score is waiting for the second tap ("are you sure?"). */
  let bigPending = $state<Record<number, boolean>>({});
  /** Board width: wide (laptop) shows every player's panel at once in a scrolling right column. */
  let RW = $state(0);
  const wide = $derived(RW >= 900);
  let W = $state(0);

  // ---- turn entry drafts (kept per player, so switching players never loses a half-typed number)
  let scoreDraft = $state<Record<number, string>>({});
  let wordDraft = $state<Record<number, string>>({});
  let bingoOn = $state<Record<number, boolean>>({});
  let tilesDraft = $state<Record<number, number>>({});

  // ---- ending the game
  let endOpen = $state(false);
  let endMode = $state<EndMode | null>(null);
  let endOut = $state<number | null>(null);
  let rackDraft = $state<Record<number, string>>({});

  // ---- clocks: the host's start/end if it gives them, else the board's own.
  // Opening the tab saves nothing: the moment it opened is kept in memory and is stamped into the state together
  // with the first real change, so a second device that merely looks can never overwrite someone's edit.
  const openedAt = Date.now();
  let nowMs = $state(Date.now());
  const ticking = $derived(cfg(ctx.settings, 'turnSeconds') > 0 && !game.over);
  $effect(() => {
    const id = setInterval(() => (nowMs = Date.now()), ticking ? 1000 : 15000);
    return () => clearInterval(id);
  });

  /** Passes on a genuinely new state (a no-op change saves nothing), stamping the start time into it. */
  const apply = (next: ScrabbleState) => {
    if (next === game) return;
    onchange(markStarted(next, openedAt));
  };
  const clk = $derived(clock(markStarted(game, openedAt), ctx, nowMs));
  const clockTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const nameOf = (id: number | null) => ctx.players.find((x) => x.id === id)?.name ?? 'A player';
  const first = (n: string) => n.trim().split(/\s+/)[0] || 'Player';
  const total = (id: number) => totalScore(game, ctx, id);

  // ---- derived
  const turnId = $derived(currentPlayer(game, ctx));
  const sel = $derived(picked !== null && ctx.players.some((x) => x.id === picked) ? picked : (turnId ?? ctx.players[0]?.id ?? null));
  const selPlayer = $derived(ctx.players.find((x) => x.id === sel) ?? null);
  const rows = $derived(ranking(game, ctx));
  const bag = $derived(bagCount(game, ctx));
  const run = $derived(scorelessRun(game));
  const runLimit = $derived(cfg(ctx.settings, 'scorelessLimit'));
  const tclock = $derived(turnClock(game, ctx, nowMs));
  const over = $derived(game.over);
  const adjustOn = $derived(cfg(ctx.settings, 'endAdjust') >= 1);
  const bingoBonus = $derived(cfg(ctx.settings, 'bingoBonus'));
  const rackSize = $derived(cfg(ctx.settings, 'rackSize'));
  const turnMax = $derived(cfg(ctx.settings, 'turnMax'));
  const bigScore = $derived(cfg(ctx.settings, 'bigScore'));
  const redoE = $derived(redoNext(game));
  const rule = $derived(cfg(ctx.settings, 'challengeRule'));
  const penaltyPts = $derived(cfg(ctx.settings, 'challengePenalty'));
  const dict = $derived(DICTIONARIES[cfg(ctx.settings, 'dictionary')] ?? '');
  const lastEntry = $derived(game.entries[game.entries.length - 1] ?? null);
  const warns = $derived(finishWarnings(game, ctx));
  const leftOf = (id: number) => ctx.rerollsLeft[id] ?? 0;
  const shownHistory = $derived([...game.entries].reverse().slice(0, showAllHistory ? game.entries.length : 12));
  const mmss = (sec: number) => `${Math.floor(Math.abs(sec) / 60)}:${String(Math.abs(sec) % 60).padStart(2, '0')}`;
  const fmtAt = (at: number | null) => (at === null ? '' : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  const sign = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

  /** Seat number -> player (first claim wins); everyone else (no seat, no table, shared seat) goes in `rest`. */
  const seating = $derived.by(() => {
    const bySeat = new Map<number, BoardPlayer>();
    const rest: BoardPlayer[] = [];
    const t = ctx.table;
    for (const x of ctx.players) {
      if (t && x.seat !== null && x.seat >= 1 && x.seat <= t.seats && !bySeat.has(x.seat)) bySeat.set(x.seat, x);
      else rest.push(x);
    }
    return { bySeat, rest };
  });

  // ---- table drawing (geometry as in the TV table view)
  const S = $derived(Math.round(clamp(W * 0.12, 44, 56)));
  const FS = 12;
  /** Height reserved for a seat's two-line name label. */
  const LBL = FS * 2.6 + 4;
  /**
   * Table size, plus the height the drawing really needs: it grows only as far as the seats and their labels reach,
   * so a small table, or empty seats at the top or bottom, leave no blank band. `cy` is the table's centre line.
   */
  const fit = $derived.by(() => {
    const t = ctx.table;
    if (!t || W <= 0) return { tw: 0, th: 0, cy: 0, H: 0, lw: 0 };
    const mx = S * 1.5 + 4;
    const myFull = S + LBL;
    const aspect = t.w / t.h;
    const tw = Math.min(Math.max(40, W - 2 * mx), Math.max(30, W / 1.25 - 2 * myFull) * aspect);
    const th = tw / aspect;
    let lo = -th / 2;
    let hi = th / 2;
    const labels: { x: number; y0: number; y1: number }[] = [];
    for (const sp of seatPoints(t.seats, tw, th, S, 6)) {
      const occupied = seating.bySeat.has(sp.seat);
      const above = sp.y < -th / 2;
      lo = Math.min(lo, sp.y - S / 2 - (occupied && above ? LBL : 0));
      hi = Math.max(hi, sp.y + S / 2 + (occupied && !above ? LBL : 0));
      if (occupied) labels.push({ x: sp.x, y0: above ? sp.y - S / 2 - LBL : sp.y + S / 2, y1: above ? sp.y - S / 2 : sp.y + S / 2 + LBL });
    }
    // widest name label (up to 2.2 seats wide) that does not run into a neighbouring label
    const clash = (width: number) => labels.some((a, i) => labels.some((b, j) => j > i && Math.abs(a.x - b.x) < width && a.y0 < b.y1 && b.y0 < a.y1));
    let lw = Math.round(S * 2.2);
    while (lw > S * 1.5 && clash(lw)) lw -= 2;
    return { tw, th, cy: 4 - lo, H: hi - lo + 8, lw };
  });

  // ---- turn entry
  const draftOf = (id: number) => scoreDraft[id] ?? '';
  const draftValue = (id: number): number | null => {
    const t = draftOf(id);
    if (!/^\d{1,5}$/.test(t)) return null;
    const n = Number(t);
    return n >= 1 && n <= turnMax ? n : null;
  };
  const tilesOf = (id: number) => tilesDraft[id] ?? cfg(ctx.settings, 'defaultTiles');

  const pick = async (id: number) => {
    picked = id;
    rerollFailed = {};
    await tick();
    document.getElementById(`scr-p-${id}`)?.scrollIntoView({ block: wide ? 'nearest' : 'start', behavior: 'smooth' });
  };

  /** After an entry the next player in turn is up: show their panel (and, after a score, open their number pad). */
  const moveOn = async (next: ScrabbleState, focusInput: boolean) => {
    picked = null;
    confirmFinish = false;
    const nid = currentPlayer(next, ctx);
    await tick();
    if (nid === null) return;
    document.getElementById(`scr-p-${nid}`)?.scrollIntoView({ block: wide ? 'nearest' : 'start', behavior: 'smooth' });
    if (focusInput) document.getElementById(`scr-in-${nid}`)?.focus({ preventScroll: true });
  };

  function submit(id: number) {
    const v = draftValue(id);
    if (v === null || game.over) return;
    // a score this big is more often a typo (240 for 24) than a real play: ask once before adding it
    if (v >= bigScore && !bigPending[id]) {
      bigPending[id] = true;
      return;
    }
    const next = addPlay(game, ctx, id, v, { word: wordDraft[id] ?? '', bingo: !!bingoOn[id], tiles: tilesOf(id) }, Date.now());
    if (next === game) return;
    scoreDraft[id] = '';
    bigPending[id] = false;
    wordDraft[id] = '';
    bingoOn[id] = false;
    apply(next);
    moveOn(next, true);
  }
  function simple(make: (s: ScrabbleState) => ScrabbleState) {
    const next = make(game);
    if (next === game) return;
    apply(next);
    moveOn(next, false);
  }
  const doUndo = () => simple((s) => undoLast(s));

  async function useReroll(pid: number) {
    if (busy[pid] || leftOf(pid) <= 0) return;
    busy[pid] = true;
    rerollFailed = { ...rerollFailed, [pid]: false };
    try {
      await ctx.useReroll(pid);
      apply(recordReroll(game, ctx, pid));
    } catch {
      rerollFailed = { ...rerollFailed, [pid]: true };
    } finally {
      busy[pid] = false;
    }
  }

  /** The bag number box: shows what was actually kept (it may have been clamped). */
  const commitBag = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const n = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(n)) {
      input.value = String(bag);
      return;
    }
    const next = setBag(game, ctx, n);
    apply(next);
    input.value = String(bagCount(next, ctx));
  };

  // ---- ending the game
  const effMode = $derived<EndMode>(endMode ?? (bag === 0 && game.entries.length ? 'out' : runLimit > 0 && run >= runLimit ? 'blocked' : 'time'));
  const rackPlayers = $derived(effMode === 'time' || !adjustOn ? [] : ctx.players.filter((x) => effMode === 'blocked' || x.id !== endOut));
  const rackNums = $derived.by(() => {
    const out: Record<number, number> = {};
    for (const x of ctx.players) {
      const t = (rackDraft[x.id] ?? '').trim();
      out[x.id] = /^\d{1,3}$/.test(t) ? Number(t) : 0;
    }
    return out;
  });
  const endPreview = $derived(endGame(game, ctx, effMode, endOut, rackNums));
  const endValid = $derived(effMode !== 'out' || endOut !== null);
  const previewRows = $derived(rankWith(game, ctx, endValid && endPreview !== game ? endPreview.over : null));
  const modeText = (m: EndMode) => (m === 'out' ? 'a player used all their tiles' : m === 'blocked' ? 'nobody could move' : 'stopped early, no tiles adjustment');

  /** Things that look off about the way the GM is ending the game (they do not block it). */
  const endWarn = $derived.by(() => {
    const out: string[] = [];
    if (effMode === 'out' && bag > 0) out.push(`The bag still has ${bag} ${bag === 1 ? 'tile' : 'tiles'}. A player can only go out once the bag is empty.`);
    if (effMode === 'blocked' && runLimit > 0 && run < runLimit) out.push(`Only ${run} scoreless ${run === 1 ? 'turn' : 'turns'} in a row so far (the game normally ends at ${runLimit}).`);
    if (effMode === 'blocked' && bag > 0) out.push(`The bag still has ${bag} ${bag === 1 ? 'tile' : 'tiles'}, so players could still draw.`);
    return out;
  });

  function confirmEnd() {
    if (!endValid) return;
    const next = endGame(game, ctx, effMode, endOut, rackNums, Date.now());
    if (next === game) return;
    apply(next);
    endOpen = false;
    endMode = null;
    endOut = null;
    rackDraft = {};
  }
</script>

{#snippet stepper(label: string, value: number, steps: number[], set: (v: number) => void)}
  <div class="field">
    <span class="small muted">{label}</span>
    <div class="stepper">
      {#each [...steps].reverse() as st (st)}
        <button onclick={() => set(value - st)} aria-label={`${label} minus ${st}`}>−{st}</button>
      {/each}
      <input class="mono" type="number" inputmode="numeric" {value} aria-label={label} onchange={(e) => commitBag(e)} />
      {#each steps as st (st)}
        <button onclick={() => set(value + st)} aria-label={`${label} plus ${st}`}>+{st}</button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet playerPanel(who: BoardPlayer)}
  {@const st = statsOf(game, who.id)}
  {@const mine = who.id === turnId}
  {@const v = draftValue(who.id)}
  {@const bing = !!bingoOn[who.id]}
  <section class="panel pp" class:cur={who.id === sel} id={`scr-p-${who.id}`}>
    <div class="spread">
      <div class="row">
        <Avatar name={who.name} color={who.color} src={who.avatarPath} size={36} />
        <h2>{who.name}</h2>
      </div>
      <div class="row">
        {#if mine && !over}<span class="badge live">Their turn</span>{/if}
        <span class="badge mono">{total(who.id)}</span>
      </div>
    </div>

    {#if !over}
      <div class="field">
        <label class="small muted" for={`scr-in-${who.id}`}>Score for this turn{bing ? ` (+${bingoBonus} bingo is added)` : ''}</label>
        <div class="entry">
          <input
            id={`scr-in-${who.id}`}
            class="mono score"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            autocomplete="off"
            placeholder="0"
            maxlength="5"
            value={draftOf(who.id)}
            oninput={(e) => {
              const input = e.currentTarget as HTMLInputElement;
              const clean = input.value.replace(/[^0-9]/g, '').slice(0, 5);
              input.value = clean;
              scoreDraft[who.id] = clean;
              bigPending[who.id] = false;
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter') submit(who.id);
            }}
          />
          <button class="primary big" class:warnbtn={bigPending[who.id]} disabled={v === null} onclick={() => submit(who.id)}>{bigPending[who.id] ? `Yes, ${v}` : 'Add'}</button>
        </div>
        {#if draftOf(who.id) !== '' && v === null}<p class="error small">Enter a whole number from 1 to {turnMax}.</p>{/if}
        {#if bigPending[who.id] && v !== null}<p class="small final">{v} is a big score. Tap "Yes, {v}" to add it, or fix the number.</p>{/if}
      </div>

      <div class="row opts">
        <button class="chip big" class:on={bing} aria-pressed={bing} onclick={() => (bingoOn[who.id] = !bing)}>Bingo +{bingoBonus}</button>
        {#if !bing}
          <div class="mini" aria-label="Tiles played">
            <button aria-label="One tile less" disabled={tilesOf(who.id) <= 1} onclick={() => (tilesDraft[who.id] = Math.max(1, tilesOf(who.id) - 1))}>−</button>
            <span class="mono">{tilesOf(who.id)} {tilesOf(who.id) === 1 ? 'tile' : 'tiles'}</span>
            <button aria-label="One tile more" disabled={tilesOf(who.id) >= rackSize} onclick={() => (tilesDraft[who.id] = Math.min(rackSize, tilesOf(who.id) + 1))}>+</button>
          </div>
        {:else}
          <span class="small muted">{rackSize} tiles</span>
        {/if}
      </div>

      <div class="field">
        <input
          class="word"
          type="text"
          autocomplete="off"
          autocapitalize="characters"
          placeholder="Word (optional)"
          maxlength="30"
          aria-label="Word played (optional)"
          value={wordDraft[who.id] ?? ''}
          oninput={(e) => (wordDraft[who.id] = (e.currentTarget as HTMLInputElement).value)}
          onkeydown={(e) => {
            if (e.key === 'Enter') submit(who.id);
          }}
        />
      </div>

      <div class="row quick">
        <button class="big" onclick={() => simple((s) => addPass(s, ctx, who.id, Date.now()))}>Pass</button>
        <button class="big" onclick={() => simple((s) => addExchange(s, ctx, who.id, Date.now()))}>Exchanged tiles</button>
        {#if rule === 2}
          <button class="big" onclick={() => simple((s) => addLostChallenge(s, ctx, who.id, Date.now()))}>Lost a challenge (skips turn)</button>
        {:else if rule === 1 && penaltyPts > 0}
          <button class="big" onclick={() => simple((s) => addLostChallenge(s, ctx, who.id, Date.now()))}>Lost a challenge (−{penaltyPts})</button>
        {/if}
        {#if mine && tclock && tclock.penalty > 0}
          <button class="big" onclick={() => simple((s) => addPenalty(s, ctx, who.id, tclock.penalty, 'overtime', Date.now()))}>Overtime −{tclock.penalty}</button>
        {/if}
      </div>
    {/if}

    <p class="small muted stats">
      {st.plays} {st.plays === 1 ? 'play' : 'plays'}{#if st.best > 0} · best {st.bestWord ? `${st.bestWord} ` : ''}{st.best}{/if}{#if st.bingos} · {st.bingos} {st.bingos === 1 ? 'bingo' : 'bingos'}{/if}{#if st.passes + st.exchanges} · {st.passes + st.exchanges} {st.passes + st.exchanges === 1 ? 'pass/exchange' : 'passes/exchanges'}{/if}{#if st.lostChallenges} · {st.lostChallenges} lost {st.lostChallenges === 1 ? 'challenge' : 'challenges'}{/if}
    </p>

    {#if ctx.rerollsAllowed}
      <div class="field">
        <div class="spread">
          <span>Re-rolls left: <strong class="mono">{leftOf(who.id)}</strong></span>
          <button class="big" disabled={busy[who.id] || leftOf(who.id) <= 0} onclick={() => useReroll(who.id)}>Use a re-roll</button>
        </div>
        {#if rerollFailed[who.id]}<p class="error">That re-roll could not be used. Check how many are left and try again.</p>{/if}
      </div>
    {/if}
  </section>
{/snippet}

<div class="scrhost" bind:clientWidth={RW}>
<div class="scr" class:wide>
<div class="left">
  <section class="panel">
    <div class="spread">
      <h2>Scrabble</h2>
      <div class="row">
        <span class="badge" class:live={bag === 0 && game.entries.length > 0}>{bag} in the bag</span>
      </div>
    </div>
    <p class="small clock">
      {#if clk}
        <span>{clk.finished ? 'Finished after' : 'Playing for'} <strong class="mono">{duration(clk.elapsedMs)}</strong></span>
        {#if clk.endsAt !== null && clk.remainingMs !== null}
          · <span>planned end <strong class="mono">{clockTime(clk.endsAt)}</strong></span>
          · <span class:bad={clk.over}>{clk.over ? `${duration(clk.remainingMs)} over` : clk.finished ? `${duration(clk.remainingMs)} early` : `${duration(clk.remainingMs)} left`}</span>
        {/if}
      {:else}
        <span class="muted">Starting the game clock…</span>
      {/if}
    </p>
    <p class="small muted">
      {ctx.players.length} playing: {ctx.players.map((x) => first(x.name)).join(', ')}{dict ? ` · Dictionary: ${dict}` : ''}
    </p>

    {#if !over}
      <p class="turnline">
        {#if turnId !== null}
          <strong>{game.entries.length ? 'Next up' : 'First up'}: {nameOf(turnId)}</strong>
          {#if tclock}
            <span class="mono" class:bad={tclock.over}>{tclock.over ? `+${mmss(tclock.remainingSec)} over` : `${mmss(tclock.remainingSec)} left`}</span>
          {/if}
        {/if}
      </p>
      {#if !game.entries.length && ctx.players.length > 1}
        <div class="field">
          <span class="small muted">Who plays first? (the player with the tile closest to A)</span>
          <div class="row">
            {#each ctx.players as x (x.id)}
              <button class="chip" class:on={x.id === turnId} aria-pressed={x.id === turnId} onclick={() => apply(setFirst(game, ctx, x.id))}>
                <Avatar name={x.name} color={x.color} src={x.avatarPath} size={24} />
                {first(x.name)}
              </button>
            {/each}
          </div>
        </div>
      {/if}
      <div class="row quick">
        <button class="big" disabled={!lastEntry} onclick={doUndo}>
          Undo last{lastEntry ? `: ${first(nameOf(lastEntry.pid))} ${entryPoints(lastEntry) !== 0 ? sign(entryPoints(lastEntry)) : lastEntry.kind}` : ''}
        </button>
        {#if redoE}
          <button class="big" onclick={() => simple((s) => redoLast(s))}>Put back: {first(nameOf(redoE.pid))} {entryPoints(redoE) !== 0 ? sign(entryPoints(redoE)) : redoE.kind}</button>
        {/if}
        {#if lastEntry && lastEntry.kind === 'play'}
          <button class="big" onclick={() => simple((s) => challengeOff(s, ctx))}>Last play challenged off</button>
        {/if}
      </div>
      {#if runLimit > 0 && run >= runLimit}
        <p class="final"><strong>{run} scoreless turns in a row.</strong> The game can end now (end it below).</p>
      {:else if runLimit > 0 && run > 0}
        <p class="small muted">{run} scoreless {run === 1 ? 'turn' : 'turns'} in a row (the game can end at {runLimit}).</p>
      {/if}
      {#if bag === 0 && game.entries.length > 0}
        <p class="final"><strong>The bag is empty.</strong> The game ends when a player uses all their tiles, or when nobody can move.</p>
      {/if}
    {:else}
      <p class="final"><strong>Game ended:</strong> {modeText(over.mode)}. The crown now shows the final scores.</p>
    {/if}
  </section>

  {#if ctx.table}
    <section class="panel">
      <div class="tv-table" bind:clientWidth={W} style="height:{fit.H}px">
        {#if W > 0}
          <div class="tbl" style="width:{fit.tw}px;height:{fit.th}px;top:{fit.cy}px">
            <strong>{ctx.table.name}</strong>
          </div>
          {#each seatPoints(ctx.table.seats, fit.tw, fit.th, S, 6) as sp (sp.seat)}
            {@const seated = seating.bySeat.get(sp.seat)}
            {@const top = sp.y < -fit.th / 2}
            {#if seated}
              <button
                class="seat"
                class:sel={seated.id === sel}
                style="left:{W / 2 + sp.x}px;top:{fit.cy + sp.y}px;width:{S}px;height:{S}px"
                onclick={() => pick(seated.id)}
                aria-label={`${seated.name}, ${total(seated.id)} points${seated.id === turnId && !over ? ', their turn' : ''}`}
              >
                <Avatar name={seated.name} color={seated.color} src={seated.avatarPath} size={S} />
                <span class="lbl" class:above={top} style="font-size:{FS}px;max-width:{fit.lw}px">
                  <b>{seated.id === turnId && !over ? '▶ ' : ''}{first(seated.name)}</b>
                  <i>{total(seated.id)}</i>
                </span>
              </button>
            {:else}
              <div class="seat empty" style="left:{W / 2 + sp.x}px;top:{fit.cy + sp.y}px;width:{S}px;height:{S}px"></div>
            {/if}
          {/each}
        {/if}
      </div>
      <p class="small muted">Beside each name: points{over ? '' : ' so far'}. ▶ marks whose turn it is.</p>
    </section>
  {/if}

  {#if seating.rest.length}
    <section class="panel">
      {#if ctx.table}<p class="small muted">Not at the table</p>{/if}
      <div class="row">
        {#each seating.rest as x (x.id)}
          <button class="chip" class:on={x.id === sel} onclick={() => pick(x.id)}>
            <Avatar name={x.name} color={x.color} src={x.avatarPath} size={24} />
            {first(x.name)}{x.id === turnId && !over ? ' ▶' : ''}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if !wide && selPlayer}{@render playerPanel(selPlayer)}{/if}

  <section class="panel">
    <h3>{over ? 'Final result' : 'Standings'}</h3>
    {#if !over}
      <p class="small muted">Running totals. The crown only shows scores once the game is ended below.</p>
    {/if}
    <div class="scroll-x">
      <table>
        <thead>
          <tr><th>Place</th><th>Player</th><th class="num">Score</th></tr>
        </thead>
        <tbody>
          {#each rows as r (r.playerId)}
            <tr>
              <td class="mono">{ordinal(r.place)}{r.tied ? '=' : ''}</td>
              <td>
                <button class="link" onclick={() => pick(r.playerId)}>{r.name}</button>
                <span class="detail small muted">
                  {r.stats.plays} {r.stats.plays === 1 ? 'play' : 'plays'}{#if r.stats.best > 0} · best {r.stats.best}{/if}{#if r.adj !== 0} · tiles {sign(r.adj)} (was {r.base}){/if}
                </span>
              </td>
              <td class="num mono">{r.total}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if rows.some((r) => r.tied)}
      <p class="small muted">An "=" is a shared place. You can still adjust it on the result screen.</p>
    {/if}
  </section>

  <section class="panel">
    <h3>Tiles in the bag</h3>
    {@render stepper(`Tiles left in the bag (of ${cfg(ctx.settings, 'tilesTotal')})`, bag, [1, 5], (v) => apply(setBag(game, ctx, v)))}
    <p class="small muted">Worked out from the tiles played in each turn. Count the bag and type the real number any time to correct it.</p>
  </section>

  <section class="panel">
    <div class="spread">
      <h3>History</h3>
      <span class="small muted">{game.entries.length} {game.entries.length === 1 ? 'entry' : 'entries'}</span>
    </div>
    {#if !game.entries.length}
      <p class="small muted">Nothing entered yet.</p>
    {:else}
      <ul class="hist">
        {#each shownHistory as en (en.id)}
          <li>
            <span class="small muted mono">{fmtAt(en.at)}</span>
            <span><strong>{first(nameOf(en.pid))}</strong> {entryText(en)}</span>
          </li>
        {/each}
      </ul>
      {#if game.entries.length > 12}
        <button class="link" onclick={() => (showAllHistory = !showAllHistory)}>{showAllHistory ? 'Show only the latest' : `Show all ${game.entries.length}`}</button>
      {/if}
    {/if}
  </section>

  <section class="panel">
    <h3>End of the game</h3>
    {#if over}
      <p class="small muted">The game was ended: {modeText(over.mode)}.{#if adjustOn && over.mode !== 'time'} The tiles left were {over.mode === 'out' ? `subtracted, and added to ${first(nameOf(over.wentOut))}` : 'subtracted'}.{/if}</p>
      {#if confirmFinish}
        <div class="final">
          <strong>Open the result screen?</strong>
          {#each warns as warning (warning)}<p class="small">{warning}</p>{/each}
          <div class="row">
            <button class="primary big" onclick={() => { confirmFinish = false; onfinish?.(); }}>Yes, open it</button>
            <button class="big" onclick={() => (confirmFinish = false)}>Not yet</button>
          </div>
        </div>
      {:else}
        <div class="row">
          <button class="primary big" disabled={!onfinish} onclick={() => (confirmFinish = true)}>Open results</button>
          <button class="big" onclick={() => apply(reopenGame(game))}>Reopen the game</button>
        </div>
      {/if}
    {:else if !endOpen}
      <p class="small muted">When the game is over, enter the tiles left on the racks here. The final scores then reach the crown.</p>
      <button class="primary big" disabled={!game.entries.length} onclick={() => (endOpen = true)}>End the game…</button>
    {:else}
      <div class="field">
        <span class="small muted">How did it end?</span>
        <div class="row">
          <button class="chip big" class:on={effMode === 'out'} aria-pressed={effMode === 'out'} onclick={() => (endMode = 'out')}>A player used all their tiles</button>
          <button class="chip big" class:on={effMode === 'blocked'} aria-pressed={effMode === 'blocked'} onclick={() => (endMode = 'blocked')}>Nobody can move</button>
          <button class="chip big" class:on={effMode === 'time'} aria-pressed={effMode === 'time'} onclick={() => (endMode = 'time')}>Stopped early (time)</button>
        </div>
      </div>

      {#if effMode === 'out'}
        <div class="field">
          <span class="small muted">Who went out?</span>
          <div class="row">
            {#each ctx.players as x (x.id)}
              <button class="chip big" class:on={endOut === x.id} aria-pressed={endOut === x.id} onclick={() => (endOut = x.id)}>{first(x.name)}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#if rackPlayers.length && (effMode !== 'out' || endOut !== null)}
        <div class="field">
          <span class="small muted">Points on the tiles each player has left (0 to {rackMax(ctx)}; empty = 0)</span>
          {#each rackPlayers as x (x.id)}
            <label class="rackrow">
              <span>{first(x.name)}</span>
              <input
                class="mono"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="3"
                placeholder="0"
                value={rackDraft[x.id] ?? ''}
                oninput={(e) => {
                  const input = e.currentTarget as HTMLInputElement;
                  const clean = input.value.replace(/[^0-9]/g, '').slice(0, 3);
                  input.value = clean;
                  rackDraft[x.id] = clean;
                }}
              />
            </label>
          {/each}
        </div>
      {:else if effMode === 'time'}
        <p class="small muted">No tiles adjustment: places use the running totals.</p>
      {/if}

      {#each endWarn as w (w)}<p class="final small">{w}</p>{/each}

      {#if endValid}
        <div class="scroll-x">
          <table>
            <thead><tr><th>Place</th><th>Player</th><th class="num">Final</th></tr></thead>
            <tbody>
              {#each previewRows as r (r.playerId)}
                <tr>
                  <td class="mono">{ordinal(r.place)}{r.tied ? '=' : ''}</td>
                  <td>{r.name}{#if r.adj !== 0} <span class="small muted">({r.base} {sign(r.adj)})</span>{/if}</td>
                  <td class="num mono">{r.total}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <div class="row">
        <button class="primary big" disabled={!endValid} onclick={confirmEnd}>Apply and show final scores</button>
        <button class="big" onclick={() => (endOpen = false)}>Keep playing</button>
      </div>
    {/if}
  </section>
</div>
{#if wide}
  <div class="right" aria-label="All players">
    {#each ctx.players as x (x.id)}{@render playerPanel(x)}{/each}
  </div>
{/if}
</div>
</div>

<style>
  .scr {
    max-width: 40rem;
    margin: 0 auto;
  }
  .scr.wide {
    max-width: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 27rem);
    gap: 0.75rem;
    align-items: start;
  }
  .right {
    position: sticky;
    top: 0.5rem;
    max-height: calc(100vh - 5rem);
    overflow-y: auto;
    display: grid;
    gap: 0.5rem;
    padding-right: 2px;
  }
  .right :global(.panel) {
    margin: 0;
    min-width: 0;
  }
  .pp {
    scroll-margin-top: 8px;
  }
  .pp.cur {
    outline: 2px solid var(--accent);
  }
  .clock {
    margin: 0.4rem 0 0;
  }
  .clock span {
    white-space: nowrap;
  }
  .turnline {
    margin: 0.5rem 0;
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .final {
    margin: 0.6rem 0 0;
    padding: 0.6rem;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    color: var(--warn);
  }
  .quick {
    margin: 0.4rem 0;
  }
  button.warnbtn {
    border-color: var(--warn);
    color: var(--warn);
  }
  .quick button {
    flex: 1 1 8rem;
  }
  .opts {
    align-items: center;
    margin: 0.2rem 0;
  }
  .stats {
    margin: 0.4rem 0 0;
  }

  /* number pad entry */
  .entry {
    display: flex;
    gap: 0.4rem;
    align-items: stretch;
  }
  .entry input.score {
    flex: 1 1 6rem;
    min-width: 0;
    min-height: 56px;
    text-align: center;
    font-size: 1.8rem;
  }
  .entry button {
    flex: 0 0 auto;
    min-width: 5rem;
    min-height: 56px;
    font-size: 1.1rem;
  }
  input.word {
    width: 100%;
    min-height: 44px;
    text-transform: uppercase;
  }
  .mini {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .mini button {
    min-width: 44px;
    min-height: 44px;
    font-size: 1.1rem;
  }
  .mini span {
    min-width: 4.5rem;
    text-align: center;
  }

  /* history */
  .hist {
    list-style: none;
    margin: 0.3rem 0;
    padding: 0;
    display: grid;
    gap: 0.25rem;
  }
  .hist li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .hist li > span:first-child {
    flex: 0 0 4.5rem;
  }

  /* racks at the end */
  .rackrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin: 0.3rem 0;
  }
  .rackrow input {
    flex: 0 0 6rem;
    min-height: 48px;
    text-align: center;
    font-size: 1.2rem;
  }

  /* table */
  .tv-table {
    position: relative;
    width: 100%;
    overflow: hidden;
  }
  .tbl {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    overflow: hidden;
    padding: 0 6px;
  }
  .tbl strong {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    text-align: center;
    font-size: 0.9rem;
  }
  .seat {
    position: absolute;
    transform: translate(-50%, -50%);
    padding: 0;
    min-height: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    line-height: 0;
  }
  .seat.sel {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .seat.empty {
    border: 2px dashed var(--muted);
    opacity: 0.6;
  }
  .lbl {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 5px;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.2;
    white-space: nowrap;
    color: var(--text);
    pointer-events: none;
  }
  .lbl.above {
    top: auto;
    bottom: 100%;
    margin: 0 0 5px;
  }
  .lbl b,
  .lbl i {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-style: normal;
  }
  .lbl i {
    color: var(--muted);
    font-size: 0.92em;
  }

  /* chips, steppers */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .stepper {
    display: flex;
    gap: 0.3rem;
    align-items: stretch;
  }
  .stepper button {
    flex: 0 0 auto;
    min-width: 3rem;
    min-height: 48px;
    padding: 0 0.4rem;
    font-size: 1rem;
  }
  .stepper input {
    flex: 1 1 4rem;
    min-width: 3.5rem;
    min-height: 48px;
    text-align: center;
    font-size: 1.2rem;
  }
  button.chip {
    min-height: 44px;
  }
  button.chip.big {
    min-height: 48px;
  }
  .detail {
    display: block;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0.3rem 0;
    min-width: 44px;
    min-height: 44px;
    text-decoration: underline;
    text-align: left;
  }
</style>
