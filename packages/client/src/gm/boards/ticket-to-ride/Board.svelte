<script lang="ts">
  /**
   * Ticket to Ride board: the GM's control panel. Players sit around the table showing trains left; the GM ticks
   * players through the final round, then types in each player's final score (the players count it themselves)
   * and opens the result screen. There is no live leader. All rules live in ./def.ts.
   */
  import { tick } from 'svelte';
  import Avatar from '../../../shared/Avatar.svelte';
  import type { BoardPlayer, BoardProps } from '../contract';
  import {
    applyBreakdownTotal,
    atFinalTrains,
    bdOf,
    breakdownTotal,
    bumpFinalScore,
    cfg,
    clock,
    duration,
    finishWarnings,
    hasBreakdown,
    markStarted,
    ordinal,
    pl,
    ranking,
    recordReroll,
    reportText,
    setBreakdownField,
    setFinalScore,
    setLastTurn,
    setLongest,
    setTickets,
    setTrains,
    status,
    syncEnded,
    type TtrPlayer,
    type TtrState,
  } from './def';
  import { clamp, seatPoints } from './seating';

  let { ctx, state: game, onchange, onfinish }: BoardProps<TtrState> = $props();

  let picked = $state<number | null>(null);
  let confirmFinish = $state(false);
  let copyMsg = $state('');
  let showReport = $state(false);
  let busy = $state<Record<number, boolean>>({});
  let rerollFailed = $state<Record<number, boolean>>({});
  /** Board width: wide (laptop) shows every player's panel at once in a scrolling right column. */
  let RW = $state(0);
  const wide = $derived(RW >= 900);
  let W = $state(0);

  // ---- game clock: the host's start/end if it gives them, else the board's own.
  // Opening the tab saves nothing: the moment it opened is kept in memory and is stamped into the state together
  // with the first real change, so a second device that merely looks can never overwrite someone's edit.
  const openedAt = Date.now();
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (nowMs = Date.now()), 15000);
    return () => clearInterval(id);
  });

  /** Passes on a genuinely new state (a no-op change saves nothing), stamping the start time and the finish time into it. */
  const apply = (next: TtrState) => {
    if (next === game) return;
    onchange(syncEnded(markStarted(next, openedAt), ctx, Date.now()));
  };
  const clk = $derived(clock(markStarted(game, openedAt), ctx, nowMs));
  const clockTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const nameOf = (id: number | null) => ctx.players.find((p) => p.id === id)?.name ?? 'A player';
  const first = (n: string) => n.trim().split(/\s+/)[0] || 'Player';
  const mine = (id: number) => pl(game, id, ctx.settings);

  // ---- derived
  const sel = $derived(picked !== null && ctx.players.some((p) => p.id === picked) ? picked : (ctx.players[0]?.id ?? null));
  const selPlayer = $derived(ctx.players.find((p) => p.id === sel) ?? null);
  const stat = $derived(status(game, ctx));
  const warns = $derived(finishWarnings(game, ctx));
  const rows = $derived(ranking(game, ctx));
  const trainsStart = $derived(cfg(ctx.settings, 'trainsStart'));
  const finalTrains = $derived(cfg(ctx.settings, 'finalRoundTrains'));
  const ticketsMax = $derived(cfg(ctx.settings, 'ticketsMax'));
  const scoreMax = $derived(cfg(ctx.settings, 'scoreMax'));
  const tiebreak = $derived(cfg(ctx.settings, 'ticketTiebreak') >= 1);
  const leftOf = (id: number) => ctx.rerollsLeft[id] ?? 0;
  const waitingNames = $derived(stat.waitingFor.map((id) => first(nameOf(id))).join(', '));

  /** Seat number -> player (first claim wins); everyone else (no seat, no table, shared seat) goes in `rest`. */
  const seating = $derived.by(() => {
    const bySeat = new Map<number, BoardPlayer>();
    const rest: BoardPlayer[] = [];
    const t = ctx.table;
    for (const p of ctx.players) {
      if (t && p.seat !== null && p.seat >= 1 && p.seat <= t.seats && !bySeat.has(p.seat)) bySeat.set(p.seat, p);
      else rest.push(p);
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

  // ---- actions
  const pick = async (id: number) => {
    picked = id;
    rerollFailed = {};
    await tick();
    document.getElementById(`ttr-p-${id}`)?.scrollIntoView({ block: wide ? 'nearest' : 'start', behavior: 'smooth' });
  };

  /** Saves a typed number, then shows what was actually kept (it may have been clamped or rounded). */
  const commitNumber = (e: Event, current: number, set: (v: number) => number) => {
    const input = e.currentTarget as HTMLInputElement;
    const n = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(n)) input.value = String(current);
    else input.value = String(set(n));
  };
  /** Applies a change and gives back the value the board now holds for that player. */
  const edit = (next: TtrState, pid: number, read: (p: TtrPlayer) => number): number => {
    apply(next);
    return read(pl(next, pid, ctx.settings));
  };

  /** Copies the stats report; if the browser refuses, shows the text to copy by hand. */
  async function copyReport() {
    try {
      await navigator.clipboard.writeText(reportText(game, ctx));
      copyMsg = 'Copied.';
    } catch {
      showReport = true;
      copyMsg = 'Could not copy automatically. Select the text below and copy it.';
    }
  }

  /** The final score box: empty clears the score. */
  const commitScore = (e: Event, pid: number) => {
    const input = e.currentTarget as HTMLInputElement;
    const t = input.value.trim();
    const n = Number(t);
    if (t !== '' && !Number.isFinite(n)) {
      input.value = String(mine(pid).finalScore ?? '');
      return;
    }
    const next = setFinalScore(game, ctx, pid, t === '' ? null : n);
    apply(next);
    input.value = String(next.players[pid]?.finalScore ?? '');
  };
  const bumpScore = (pid: number, by: number) => apply(bumpFinalScore(game, ctx, pid, by));

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
</script>

{#snippet stepper(label: string, value: number, steps: number[], set: (v: number) => number)}
  <div class="field">
    <span class="small muted">{label}</span>
    <div class="stepper">
      {#each [...steps].reverse() as s (s)}
        <button onclick={() => set(value - s)} aria-label={`${label} minus ${s}`}>−{s}</button>
      {/each}
      <input class="mono" type="number" inputmode="numeric" {value} aria-label={label} onchange={(e) => commitNumber(e, value, set)} />
      {#each steps as s (s)}
        <button onclick={() => set(value + s)} aria-label={`${label} plus ${s}`}>+{s}</button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet playerPanel(who: BoardPlayer)}
  {@const d = mine(who.id)}
  {@const bd = bdOf(d)}
  {@const hasBd = hasBreakdown(d)}
  {@const bdTotal = breakdownTotal(d, ctx.settings)}
  <section class="panel pp" class:cur={who.id === sel} id={`ttr-p-${who.id}`}>
    <div class="spread">
      <div class="row">
        <Avatar name={who.name} color={who.color} src={who.avatarPath} size={36} />
        <h2>{who.name}</h2>
      </div>
      {#if d.finalScore !== null}
        <span class="badge live">Final score {d.finalScore}</span>
      {:else if atFinalTrains(d.trains, ctx.settings)}
        <span class="badge warn">{d.trains} trains left</span>
      {/if}
    </div>

    {@render stepper(`Trains left (of ${trainsStart})`, d.trains, [1, 5], (v) => edit(setTrains(game, ctx, who.id, v), who.id, (x) => x.trains))}

    {#if stat.finalActive}
      <div class="field">
        <button class="chip big" class:on={d.lastTurnDone} aria-pressed={d.lastTurnDone} onclick={() => apply(setLastTurn(game, ctx, who.id, !d.lastTurnDone))}>
          {d.lastTurnDone ? 'Last turn played' : 'Last turn still to play'}
        </button>
      </div>
    {/if}

    <div class="field">
      <span class="small muted">Final score (counted by the players at the end)</span>
      <div class="stepper">
        <button disabled={d.finalScore === null} onclick={() => bumpScore(who.id, -10)} aria-label="Final score minus 10">−10</button>
        <button disabled={d.finalScore === null} onclick={() => bumpScore(who.id, -1)} aria-label="Final score minus 1">−1</button>
        <input
          class="mono"
          type="number"
          inputmode="numeric"
          min={-scoreMax}
          max={scoreMax}
          placeholder="–"
          value={d.finalScore ?? ''}
          aria-label="Final score"
          onchange={(e) => commitScore(e, who.id)}
        />
        <button onclick={() => bumpScore(who.id, 1)} aria-label="Final score plus 1">+1</button>
        <button onclick={() => bumpScore(who.id, 10)} aria-label="Final score plus 10">+10</button>
      </div>
      {#if d.finalScore !== null}
        <button class="link" onclick={() => apply(setFinalScore(game, ctx, who.id, null))}>Clear final score</button>
      {/if}
    </div>

    <details class="bd" open={hasBd}>
      <summary>Where the points came from (optional, for the stats report)</summary>
      {@render stepper('Points from routes (trains placed)', bd.routes, [1, 10], (v) => edit(setBreakdownField(game, ctx, who.id, 'routes', v), who.id, (x) => bdOf(x).routes))}
      {@render stepper('Points from completed destination tickets', bd.ticketPts, [1, 10], (v) => edit(setBreakdownField(game, ctx, who.id, 'ticketPts', v), who.id, (x) => bdOf(x).ticketPts))}
      {@render stepper('Points lost on failed tickets (enter as a plus number)', bd.ticketLost, [1, 10], (v) => edit(setBreakdownField(game, ctx, who.id, 'ticketLost', v), who.id, (x) => bdOf(x).ticketLost))}
      {@render stepper('Destination tickets failed (how many)', bd.ticketsFailed, [1], (v) => edit(setBreakdownField(game, ctx, who.id, 'ticketsFailed', v), who.id, (x) => bdOf(x).ticketsFailed))}
      <div class="field">
        <button class="chip big" class:on={bd.longest} aria-pressed={bd.longest} onclick={() => apply(setLongest(game, ctx, who.id, !bd.longest))}>
          {bd.longest ? `Has the Longest Continuous Route (+${cfg(ctx.settings, 'longestBonus')})` : 'Longest Continuous Route: not held'}
        </button>
      </div>
      {#if hasBd}
        <p class="small muted">The breakdown adds up to <strong class="mono">{bdTotal}</strong>{d.finalScore !== null ? `; the final score is ${d.finalScore}` : '; no final score yet'}.</p>
        {#if d.finalScore !== bdTotal}
          <button class="big" onclick={() => apply(applyBreakdownTotal(game, ctx, who.id))}>Use {bdTotal} as the final score</button>
        {/if}
      {/if}
    </details>

    {#if tiebreak}
      {@render stepper(`Destination tickets completed (up to ${ticketsMax}, only used to break ties)`, d.tickets, [1], (v) => edit(setTickets(game, ctx, who.id, v), who.id, (x) => x.tickets))}
    {/if}

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

<div class="ttrhost" bind:clientWidth={RW}>
<div class="ttr" class:wide>
<div class="left">
  <section class="panel">
    <div class="spread">
      <h2>Ticket to Ride</h2>
      <div class="row">
        <span class="badge" class:live={stat.allScored}>{stat.scored} of {ctx.players.length} final scores in</span>
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
      {ctx.players.length} playing: {ctx.players.map((p) => first(p.name)).join(', ')}
    </p>
    {#if stat.finalActive && stat.triggerId !== null && !stat.allScored}
      <p class="final">
        <strong>Final round.</strong>
        {nameOf(stat.triggerId)} is down to {mine(stat.triggerId).trains} {mine(stat.triggerId).trains === 1 ? 'train' : 'trains'} (final round at {finalTrains} or fewer).
        Everyone, {first(nameOf(stat.triggerId))} included, gets one more turn.
        {#if stat.waitingFor.length}
          <span class="muted">Still to play: {waitingNames}.</span>
        {:else}
          <strong>All last turns are played. Count the scores.</strong>
        {/if}
      </p>
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
            {@const pp = seating.bySeat.get(sp.seat)}
            {@const top = sp.y < -fit.th / 2}
            {#if pp}
              {@const d = mine(pp.id)}
              <button
                class="seat"
                class:sel={pp.id === sel}
                style="left:{W / 2 + sp.x}px;top:{fit.cy + sp.y}px;width:{S}px;height:{S}px"
                onclick={() => pick(pp.id)}
                aria-label={`${pp.name}, ${d.trains} trains left${d.finalScore !== null ? `, final score ${d.finalScore}` : ''}`}
              >
                <Avatar name={pp.name} color={pp.color} src={pp.avatarPath} size={S} />
                <span class="lbl" class:above={top} style="font-size:{FS}px;max-width:{fit.lw}px">
                  <b>{first(pp.name)}</b>
                  <i>{d.trains} left{d.finalScore !== null ? ` · ${d.finalScore}` : ''}</i>
                </span>
              </button>
            {:else}
              <div class="seat empty" style="left:{W / 2 + sp.x}px;top:{fit.cy + sp.y}px;width:{S}px;height:{S}px"></div>
            {/if}
          {/each}
        {/if}
      </div>
      <p class="small muted">Beside each name: trains left · final score (once entered).</p>
    </section>
  {/if}

  {#if seating.rest.length}
    <section class="panel">
      {#if ctx.table}<p class="small muted">Not at the table</p>{/if}
      <div class="row">
        {#each seating.rest as p (p.id)}
          <button class="chip" class:on={p.id === sel} onclick={() => pick(p.id)}>
            <Avatar name={p.name} color={p.color} src={p.avatarPath} size={24} />
            {first(p.name)}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if !wide && selPlayer}{@render playerPanel(selPlayer)}{/if}

  <section class="panel">
    <h3>{stat.allScored ? 'Final result' : 'Final scores'}</h3>
    {#if !stat.allScored}
      <p class="small muted">No places are shown until every player has a final score. The players count the Longest Route bonus themselves; type in their totals.</p>
    {/if}
    <div class="scroll-x">
      <table>
        <thead>
          <tr>
            {#if stat.allScored}<th>Place</th>{/if}
            <th>Player</th><th class="num">Score</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.playerId)}
            <tr>
              {#if stat.allScored}<td class="mono">{ordinal(r.place)}{r.tied ? '=' : ''}</td>{/if}
              <td>
                <button class="link" onclick={() => pick(r.playerId)}>{r.name}</button>
                <span class="detail small muted">Trains {r.trains}{#if tiebreak} · Tickets {r.tickets}{/if}</span>
              </td>
              <td class="num mono">{r.finalScore ?? '–'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if stat.allScored && rows.some((r) => r.tied)}
      <p class="small muted">{tiebreak ? 'Equal scores are split by destination tickets completed; ' : ''}an "=" is a shared place. You can still adjust it on the result screen.</p>
    {/if}
  </section>

  <section class="panel">
    <h3>Stats report</h3>
    <p class="small muted">Uses the points breakdowns entered for each player. Copy it to paste into a spreadsheet or a post-game report.</p>
    {#each rows as r (r.playerId)}
      {#if r.breakdownLine}<p class="small"><strong>{first(r.name)}</strong>: {r.breakdownLine}</p>{/if}
    {/each}
    <button class="big" onclick={copyReport}>Copy stats report</button>
    {#if copyMsg}<p class="small muted">{copyMsg}</p>{/if}
    {#if showReport}<textarea class="report" readonly rows="8" value={reportText(game, ctx)}></textarea>{/if}
  </section>

  <section class="panel">
    <h3>Game over</h3>
    <p class="small muted">
      {stat.allScored ? 'Every final score is in.' : `${ctx.players.length - stat.scored} player${ctx.players.length - stat.scored === 1 ? ' has' : 's have'} no final score yet; they will share the last place.`}
    </p>
    {#if confirmFinish}
      <div class="final">
        <strong>Open the result screen?</strong>
        {#each warns as warning (warning)}<p class="small">{warning}</p>{/each}
        <div class="row">
          <button class="primary big" onclick={() => { confirmFinish = false; onfinish?.(); }}>Yes, open it</button>
          <button class="big" onclick={() => (confirmFinish = false)}>Keep playing</button>
        </div>
      </div>
    {:else}
      <button class="primary big" disabled={!onfinish} onclick={() => (confirmFinish = true)}>Game over: open results</button>
    {/if}
  </section>
</div>
{#if wide}
  <div class="right" aria-label="All players">
    {#each ctx.players as p (p.id)}{@render playerPanel(p)}{/each}
  </div>
{/if}
</div>
</div>

<style>
  .ttr {
    max-width: 40rem;
    margin: 0 auto;
  }
  .ttr.wide {
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
  .right :global(.stepper) {
    min-width: 0;
  }
  .right :global(.stepper input) {
    min-width: 0;
    width: 100%;
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
  details.bd {
    margin: 0.4rem 0;
  }
  details.bd summary {
    min-height: 44px;
    display: flex;
    align-items: center;
    cursor: pointer;
  }
  .report {
    width: 100%;
    margin-top: 0.5rem;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
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
