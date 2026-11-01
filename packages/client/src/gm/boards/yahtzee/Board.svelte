<script lang="ts">
  /**
   * Yahtzee board: the GM's score sheet. Players sit around the table; with live tracking on the GM taps a box and
   * enters the score (fixed boxes are one tap, free boxes take a sanity-checked number) and the board does every sum.
   * With live tracking off nothing is asked during play and the final totals are typed when the game ends.
   * There is no live leader: the crown only shows scores once the game is over. All rules live in ./def.ts.
   */
  import { tick } from 'svelte';
  import Avatar from '../../../shared/Avatar.svelte';
  import type { BoardPlayer, BoardProps } from '../contract';
  import {
    BOX_LABEL,
    LOWER,
    UPPER,
    addBonus,
    boxHint,
    boxRule,
    canBonus,
    cfg,
    clearBox,
    clock,
    duration,
    endGame,
    entryText,
    finalMax,
    finishWarnings,
    gameCount,
    gameTotals,
    markStarted,
    nextAfter,
    ordinal,
    progress,
    ranking,
    recordReroll,
    redoLast,
    redoNext,
    removeBonus,
    reopenGame,
    setBox,
    sheetOf,
    totalScore,
    turnOrder,
    undoLast,
    validBox,
    type BoxKey,
    type Sheet,
    type YahtzeeState,
  } from './def';
  import { clamp, seatPoints } from './seating';

  let { ctx, state: game, onchange, onfinish }: BoardProps<YahtzeeState> = $props();

  let picked = $state<number | null>(null);
  let confirmFinish = $state(false);
  let busy = $state<Record<number, boolean>>({});
  let rerollFailed = $state<Record<number, boolean>>({});
  let showAllHistory = $state(false);
  /** Board width: wide (laptop) shows every player's panel at once in a scrolling right column. */
  let RW = $state(0);
  const wide = $derived(RW >= 900);
  let W = $state(0);

  // ---- entry drafts (kept per player, so switching players never loses a half-typed number)
  let curGame = $state(0);
  let openBox = $state<Record<number, BoxKey | null>>({});
  let numDraft = $state<Record<number, string>>({});
  /** Live tracking off: players whose sheet the GM chose to fill in anyway. */
  let sheetOpen = $state<Record<number, boolean>>({});

  // ---- ending the game
  let endOpen = $state(false);
  let finalDraft = $state<Record<number, string>>({});

  // ---- clock: the host's start/end if it gives them, else the board's own.
  // Opening the tab saves nothing: the moment it opened is kept in memory and is stamped into the state together
  // with the first real change, so a second device that merely looks can never overwrite someone's edit.
  const openedAt = Date.now();
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (nowMs = Date.now()), 15000);
    return () => clearInterval(id);
  });

  /** Passes on a genuinely new state (a no-op change saves nothing), stamping the start time into it. */
  const apply = (next: YahtzeeState) => {
    if (next === game) return;
    onchange(markStarted(next, openedAt));
  };
  const clk = $derived(clock(markStarted(game, openedAt), ctx, nowMs));
  const clockTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const nameOf = (id: number | null) => ctx.players.find((x) => x.id === id)?.name ?? 'A player';
  const first = (n: string) => n.trim().split(/\s+/)[0] || 'Player';
  const total = (id: number) => totalScore(game, ctx, id);

  // ---- derived
  const tracking = $derived(cfg(ctx.settings, 'tracking') >= 1);
  const games = $derived(gameCount(game, ctx));
  const cg = $derived(Math.min(curGame, games - 1));
  const over = $derived(game.over);
  const rows = $derived(ranking(game, ctx));
  const lastEntry = $derived(game.entries[game.entries.length - 1] ?? null);
  /** A suggestion only: the player after whoever was entered last. */
  const upId = $derived(lastEntry ? nextAfter(game, ctx, lastEntry.pid) : (turnOrder(game, ctx)[0] ?? null));
  const sel = $derived(picked !== null && ctx.players.some((x) => x.id === picked) ? picked : (upId ?? ctx.players[0]?.id ?? null));
  const selPlayer = $derived(ctx.players.find((x) => x.id === sel) ?? null);
  const redoE = $derived(redoNext(game));
  const warns = $derived(finishWarnings(game, ctx));
  const leftOf = (id: number) => ctx.rerollsLeft[id] ?? 0;
  const shownHistory = $derived([...game.entries].reverse().slice(0, showAllHistory ? game.entries.length : 12));
  const fmtAt = (at: number | null) => (at === null ? '' : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  /** Totals are only meaningful (and only shown) with tracking on, or once the game is over. */
  const showTotals = $derived(tracking || !!over || game.entries.length > 0);
  const upperAt = $derived(cfg(ctx.settings, 'upperBonusAt'));
  const upperPts = $derived(cfg(ctx.settings, 'upperBonus'));
  const bonusPts = $derived(cfg(ctx.settings, 'yahtzeeBonus'));

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

  // ---- entry
  const draftOf = (id: number) => numDraft[id] ?? '';
  const draftValue = (id: number, box: BoxKey): number | null => {
    const t = draftOf(id);
    if (!/^\d{1,3}$/.test(t)) return null;
    const n = Number(t);
    return validBox(ctx.settings, box, n) ? n : null;
  };

  const pick = async (id: number) => {
    picked = id;
    rerollFailed = {};
    await tick();
    document.getElementById(`yz-p-${id}`)?.scrollIntoView({ block: wide ? 'nearest' : 'start', behavior: 'smooth' });
  };

  /** After a box is filled the next seat is up: show their panel. */
  const moveOn = async (from: number) => {
    confirmFinish = false;
    const nid = nextAfter(game, ctx, from);
    if (nid === null || nid === from) return;
    picked = nid;
    await tick();
    document.getElementById(`yz-p-${nid}`)?.scrollIntoView({ block: wide ? 'nearest' : 'start', behavior: 'smooth' });
  };

  const toggleBox = async (pid: number, box: BoxKey) => {
    const opening = openBox[pid] !== box;
    openBox[pid] = opening ? box : null;
    numDraft[pid] = '';
    if (opening && boxRule(ctx.settings, box).kind === 'free') {
      await tick();
      document.getElementById(`yz-in-${pid}`)?.focus({ preventScroll: true });
    }
  };

  function writeBox(pid: number, box: BoxKey, value: number) {
    const wasEmpty = sheetOf(game, pid, cg).boxes[box] === undefined;
    const next = setBox(game, ctx, pid, cg, box, value, Date.now());
    if (next === game) return;
    numDraft[pid] = '';
    openBox[pid] = null;
    apply(next);
    if (wasEmpty) moveOn(pid);
  }
  function submitFree(pid: number, box: BoxKey) {
    const v = draftValue(pid, box);
    if (v === null || game.over) return;
    writeBox(pid, box, v);
  }
  function removeBox(pid: number, box: BoxKey) {
    const next = clearBox(game, ctx, pid, cg, box, Date.now());
    if (next === game) return;
    openBox[pid] = null;
    apply(next);
  }
  const simple = (make: (s: YahtzeeState) => YahtzeeState) => apply(make(game));

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

  // ---- ending the game
  const finalNums = $derived.by(() => {
    const out: Record<number, number> = {};
    for (const x of ctx.players) {
      const t = (finalDraft[x.id] ?? '').trim();
      if (/^\d{1,5}$/.test(t)) out[x.id] = Number(t);
    }
    return out;
  });
  const finalLimit = $derived(finalMax(game, ctx));
  const finalBad = $derived(ctx.players.filter((x) => (finalDraft[x.id] ?? '').trim() !== '' && (finalNums[x.id] === undefined || finalNums[x.id]! > finalLimit)));
  const endPreview = $derived(endGame(game, ctx, finalNums));
  const previewRows = $derived(ranking(endPreview, ctx));
  const sheetOnly = (id: number) => totalScore({ ...game, over: null }, ctx, id);

  function confirmEnd() {
    if (finalBad.length) return;
    const next = endGame(game, ctx, finalNums, Date.now());
    if (next === game) return;
    apply(next);
    endOpen = false;
    finalDraft = {};
  }
</script>

{#snippet boxRows(pl: BoardPlayer, list: readonly BoxKey[], sh: Sheet)}
  {#each list as b (b)}
    {@const val = sh.boxes[b]}
    {@const rule = boxRule(ctx.settings, b)}
    {@const isOpen = openBox[pl.id] === b}
    {@const dv = draftValue(pl.id, b)}
    <li class="brow" class:open={isOpen}>
      <button class="bbtn" disabled={!!over} aria-expanded={isOpen} onclick={() => toggleBox(pl.id, b)}>
        <span>{BOX_LABEL[b]}</span>
        <span class="mono val" class:empty={val === undefined}>{val === undefined ? '–' : val === 0 ? '0 (scratch)' : val}</span>
      </button>
      {#if isOpen && !over}
        <div class="bentry">
          {#if rule.kind === 'fixed'}
            <div class="row quick">
              <button class="primary big" onclick={() => writeBox(pl.id, b, rule.value)}>Scored {rule.value}</button>
              <button class="big" onclick={() => writeBox(pl.id, b, 0)}>Scratch (0)</button>
            </div>
          {:else}
            <label class="small muted" for={`yz-in-${pl.id}`}>{BOX_LABEL[b]}: {boxHint(ctx.settings, b)}</label>
            <div class="entry">
              <input
                id={`yz-in-${pl.id}`}
                class="mono score"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                autocomplete="off"
                placeholder="0"
                maxlength="3"
                value={draftOf(pl.id)}
                oninput={(e) => {
                  const input = e.currentTarget as HTMLInputElement;
                  const clean = input.value.replace(/[^0-9]/g, '').slice(0, 3);
                  input.value = clean;
                  numDraft[pl.id] = clean;
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter') submitFree(pl.id, b);
                }}
              />
              <button class="primary big" disabled={dv === null} onclick={() => submitFree(pl.id, b)}>Add</button>
            </div>
            {#if draftOf(pl.id) !== '' && dv === null}<p class="error small">Not possible for this box. It takes {boxHint(ctx.settings, b)}.</p>{/if}
            {#if rule.zero}
              <div class="row quick">
                <button class="big" onclick={() => writeBox(pl.id, b, 0)}>Scratch (0)</button>
              </div>
            {/if}
          {/if}
          {#if val !== undefined}
            <button class="link" onclick={() => removeBox(pl.id, b)}>Clear this box</button>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
{/snippet}

{#snippet playerPanel(who: BoardPlayer)}
  {@const sh = sheetOf(game, who.id, cg)}
  {@const tt = gameTotals(game, ctx, who.id, cg)}
  {@const pr = progress(game, ctx, who.id)}
  {@const mine = who.id === upId}
  {@const showSheet = tracking || !!sheetOpen[who.id]}
  <section class="panel pp" class:cur={who.id === sel} id={`yz-p-${who.id}`}>
    <div class="spread">
      <div class="row">
        <Avatar name={who.name} color={who.color} src={who.avatarPath} size={36} />
        <h2>{who.name}</h2>
      </div>
      <div class="row">
        {#if mine && !over && game.entries.length}<span class="badge live">Next up</span>{/if}
        {#if showTotals}<span class="badge mono">{total(who.id)}</span>{/if}
      </div>
    </div>

    {#if !tracking && !over && !showSheet}
      <p class="small muted">Live tracking is off. Type the final total when the game ends.</p>
      <button class="big" onclick={() => (sheetOpen[who.id] = true)}>Fill in this sheet anyway</button>
    {/if}

    {#if showSheet}
      {#if games > 1}<p class="small muted">Game {cg + 1} of {games}. Boxes filled over the sitting: {pr.filled} of {pr.of}.</p>
      {:else}<p class="small muted">Boxes filled: {pr.filled} of {pr.of}.</p>{/if}

      <h3 class="sec">Upper section</h3>
      <ul class="boxes">{@render boxRows(who, UPPER, sh)}</ul>
      <p class="sum small">
        <span>Upper total <strong class="mono">{tt.upper}</strong></span>
        <span class="muted">
          {#if tt.upperBonus > 0}bonus +{tt.upperBonus} earned{:else}bonus +{upperPts} at {upperAt}: {tt.toBonus} to go{/if}
        </span>
      </p>

      <h3 class="sec">Lower section</h3>
      <ul class="boxes">{@render boxRows(who, LOWER, sh)}</ul>

      {#if bonusPts > 0}
        <div class="field">
          <div class="spread">
            <span>Extra Yahtzees: <strong class="mono">{tt.extra}</strong>{#if tt.extra > 0} (+{tt.yahtzeeBonus}){/if}</span>
            <div class="row">
              <button class="big" disabled={!!over || sh.extra < 1} aria-label="Take one extra Yahtzee off" onclick={() => simple((s) => removeBonus(s, ctx, who.id, cg, Date.now()))}>−1</button>
              <button class="big" disabled={!canBonus(game, ctx, who.id, cg)} onclick={() => simple((s) => addBonus(s, ctx, who.id, cg, Date.now()))}>+ Extra Yahtzee (+{bonusPts})</button>
            </div>
          </div>
          <p class="small muted">
            Only after a scored {cfg(ctx.settings, 'yahtzee')} in the Yahtzee box. After an extra Yahtzee the player fills the matching upper box if it is open; if not, any open lower box, and full house ({cfg(ctx.settings, 'fullHouse')}) and the straights ({cfg(ctx.settings, 'smallStraight')} and {cfg(ctx.settings, 'largeStraight')}) score their full value.
          </p>
        </div>
      {/if}

      <p class="sum">
        <span>{games > 1 ? `Game ${cg + 1} total` : 'Total'} <strong class="mono">{tt.total}</strong></span>
        {#if games > 1}<span class="muted">Sitting total <strong class="mono">{total(who.id)}</strong></span>{/if}
      </p>
      {#if !tracking && !over}
        <button class="link" onclick={() => (sheetOpen[who.id] = false)}>Hide this sheet</button>
      {/if}
    {/if}

    {#if ctx.rerollsAllowed}
      <div class="field">
        <div class="spread">
          <span>Re-rolls left: <strong class="mono">{leftOf(who.id)}</strong></span>
          <button class="big" disabled={busy[who.id] || leftOf(who.id) <= 0} onclick={() => useReroll(who.id)}>Use a re-roll (one extra roll)</button>
        </div>
        {#if rerollFailed[who.id]}<p class="error">That re-roll could not be used. Check how many are left and try again.</p>{/if}
      </div>
    {/if}
  </section>
{/snippet}

<div class="yzhost" bind:clientWidth={RW}>
<div class="yz" class:wide>
<div class="left">
  <section class="panel">
    <div class="spread">
      <h2>Yahtzee</h2>
      <div class="row">
        <span class="badge">{tracking ? 'Live tracking on' : 'Final totals only'}</span>
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
    <p class="small muted">{ctx.players.length} playing: {ctx.players.map((x) => first(x.name)).join(', ')}</p>

    {#if games > 1}
      <div class="field">
        <span class="small muted">Which game are you filling in?</span>
        <div class="row">
          {#each Array.from({ length: games }, (_, i) => i) as gi (gi)}
            <button class="chip big" class:on={gi === cg} aria-pressed={gi === cg} onclick={() => (curGame = gi)}>Game {gi + 1}</button>
          {/each}
        </div>
      </div>
    {/if}

    {#if !over}
      <p class="small muted">
        {#if tracking}Tap a player, then a box. Fixed boxes are one tap; the rest take a number the board checks.{:else}Nothing to enter during play. When the game is over, type each player's final total below.{/if}
        The crown shows scores only once the game is over.
      </p>
      {#if tracking}
        <div class="row quick">
          <button class="big" disabled={!lastEntry} onclick={() => simple((s) => undoLast(s))}>
            Undo last{lastEntry ? `: ${first(nameOf(lastEntry.pid))} ${entryText(lastEntry, games)}` : ''}
          </button>
          {#if redoE}
            <button class="big" onclick={() => simple((s) => redoLast(s))}>Put back: {first(nameOf(redoE.pid))} {entryText(redoE, games)}</button>
          {/if}
        </div>
      {/if}
    {:else}
      <p class="final"><strong>Game over.</strong> The crown now shows the final scores.</p>
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
                aria-label={`${seated.name}${showTotals ? `, ${total(seated.id)} points` : ''}`}
              >
                <Avatar name={seated.name} color={seated.color} src={seated.avatarPath} size={S} />
                <span class="lbl" class:above={top} style="font-size:{FS}px;max-width:{fit.lw}px">
                  <b>{first(seated.name)}</b>
                  {#if showTotals}<i>{total(seated.id)}</i>{/if}
                </span>
              </button>
            {:else}
              <div class="seat empty" style="left:{W / 2 + sp.x}px;top:{fit.cy + sp.y}px;width:{S}px;height:{S}px"></div>
            {/if}
          {/each}
        {/if}
      </div>
      {#if showTotals}<p class="small muted">Beside each name: points{over ? '' : ' so far'}.</p>{/if}
    </section>
  {/if}

  {#if seating.rest.length}
    <section class="panel">
      {#if ctx.table}<p class="small muted">Not at the table</p>{/if}
      <div class="row">
        {#each seating.rest as x (x.id)}
          <button class="chip" class:on={x.id === sel} onclick={() => pick(x.id)}>
            <Avatar name={x.name} color={x.color} src={x.avatarPath} size={24} />
            {first(x.name)}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if !wide && selPlayer}{@render playerPanel(selPlayer)}{/if}

  <section class="panel">
    <h3>{over ? 'Final result' : 'Standings'}</h3>
    {#if !showTotals}
      <p class="small muted">Nothing entered yet. Standings appear here once there are scores.</p>
    {:else}
      {#if !over}
        <p class="small muted">Running totals from the sheets. The crown only shows scores once the game is over.</p>
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
                    {#if r.typed}final total typed{:else}{r.filled} of {r.of} boxes{#if r.upperBonus} · upper bonus{/if}{#if r.yahtzees > 0} · {r.yahtzees} {r.yahtzees === 1 ? 'Yahtzee' : 'Yahtzees'}{/if}{/if}
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
    {/if}
  </section>

  {#if tracking}
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
              <span><strong>{first(nameOf(en.pid))}</strong> {entryText(en, games)}</span>
            </li>
          {/each}
        </ul>
        {#if game.entries.length > 12}
          <button class="link" onclick={() => (showAllHistory = !showAllHistory)}>{showAllHistory ? 'Show only the latest' : `Show all ${game.entries.length}`}</button>
        {/if}
      {/if}
    </section>
  {/if}

  <section class="panel">
    <h3>End of the game</h3>
    {#if over}
      <p class="small muted">The game was ended. {Object.keys(over.finals).length ? 'Typed final totals count; players without one use their sheet.' : 'Totals come from the sheets.'}</p>
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
      <p class="small muted">
        {#if tracking}When the game is over, end it here. You can type a final total for anyone, or leave it empty to use their sheet.{:else}When the game is over, end it here and type each player's final total.{/if}
        The final scores then reach the crown.
      </p>
      <button class="primary big" onclick={() => (endOpen = true)}>End the game…</button>
    {:else}
      <div class="field">
        <span class="small muted">
          Final total for the whole sitting (0 to {finalLimit}){tracking ? '; empty = use the sheet' : ''}
        </span>
        {#each ctx.players as x (x.id)}
          <label class="rackrow">
            <span>{first(x.name)}{#if tracking || sheetOnly(x.id) > 0}<span class="small muted"> (sheet {sheetOnly(x.id)})</span>{/if}</span>
            <input
              class="mono"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="5"
              placeholder={tracking ? String(sheetOnly(x.id)) : '0'}
              value={finalDraft[x.id] ?? ''}
              oninput={(e) => {
                const input = e.currentTarget as HTMLInputElement;
                const clean = input.value.replace(/[^0-9]/g, '').slice(0, 5);
                input.value = clean;
                finalDraft[x.id] = clean;
              }}
            />
          </label>
        {/each}
      </div>
      {#each finalBad as x (x.id)}<p class="error small">{first(x.name)}: a final total can be 0 to {finalLimit}.</p>{/each}
      {#each warns.filter((w) => !w.startsWith('The game has not been ended')) as w (w)}<p class="final small">{w}</p>{/each}

      <div class="scroll-x">
        <table>
          <thead><tr><th>Place</th><th>Player</th><th class="num">Final</th></tr></thead>
          <tbody>
            {#each previewRows as r (r.playerId)}
              <tr>
                <td class="mono">{ordinal(r.place)}{r.tied ? '=' : ''}</td>
                <td>{r.name}</td>
                <td class="num mono">{r.total}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="row">
        <button class="primary big" disabled={finalBad.length > 0} onclick={confirmEnd}>Apply and show final scores</button>
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
  .yz {
    max-width: 40rem;
    margin: 0 auto;
  }
  .yz.wide {
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
  .quick button {
    flex: 1 1 8rem;
    padding-top: 0.4rem;
    padding-bottom: 0.4rem;
  }

  /* the score sheet */
  .sec {
    margin: 0.7rem 0 0.2rem;
  }
  .boxes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.2rem;
  }
  .brow {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .brow.open {
    outline: 2px solid var(--accent);
  }
  .bbtn {
    width: 100%;
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0 0.7rem;
    border: 0;
    background: none;
    text-align: left;
  }
  .val {
    font-size: 1.1rem;
  }
  .val.empty {
    color: var(--muted);
  }
  .bentry {
    min-width: 0;
    padding: 0.4rem 0.7rem 0.6rem;
  }
  .sum {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin: 0.5rem 0;
  }

  /* number pad entry */
  .entry {
    display: flex;
    gap: 0.4rem;
    align-items: stretch;
    margin: 0.2rem 0;
  }
  .entry input.score {
    flex: 1 1 0;
    width: 0;
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

  /* final totals at the end */
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

  /* chips */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
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
