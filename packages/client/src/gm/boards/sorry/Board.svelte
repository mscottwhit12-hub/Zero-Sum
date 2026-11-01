<script lang="ts">
  /**
   * Sorry! board: the GM's live tracker. Players sit around the table showing how many pawns are home; the GM taps
   * one button when a pawn comes out of Start, enters the Safety zone or gets Home, and logs who sent whose pawn back
   * to Start. The crown follows pawns home, then in Safety. All rules live in ./def.ts.
   */
  import { tick } from 'svelte';
  import Avatar from '../../../shared/Avatar.svelte';
  import type { BoardPlayer, BoardProps } from '../contract';
  import {
    ZONES,
    ZONE_LABEL,
    bumpPawn,
    cfg,
    clock,
    duration,
    endGame,
    entryLine,
    finishWarnings,
    markStarted,
    movePawn,
    ordinal,
    ranking,
    redoLast,
    redoNext,
    reopenGame,
    statsOf,
    turnOrder,
    undoLast,
    zonesOf,
    type SorryState,
    type Zone,
  } from './def';
  import { clamp, seatPoints } from './seating';

  let { ctx, state: game, onchange, onfinish }: BoardProps<SorryState> = $props();

  let picked = $state<number | null>(null);
  let confirmFinish = $state(false);
  let showAllHistory = $state(false);
  /** Board width: wide (laptop) shows every player's panel at once in a scrolling right column. */
  let RW = $state(0);
  const wide = $derived(RW >= 900);
  let W = $state(0);

  // ---- correcting a pawn (kept per player)
  let fixOpen = $state<Record<number, boolean>>({});
  let fixFrom = $state<Record<number, Zone | null>>({});
  let fixTo = $state<Record<number, Zone | null>>({});

  // ---- ending the game
  let endOpen = $state(false);

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
  const apply = (next: SorryState) => {
    if (next === game) return;
    onchange(markStarted(next, openedAt));
  };
  const clk = $derived(clock(markStarted(game, openedAt), ctx, nowMs));
  const clockTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const nameOf = (id: number | null) => ctx.players.find((x) => x.id === id)?.name ?? 'A player';
  const first = (n: string) => n.trim().split(/\s+/)[0] || 'Player';
  const fmtAt = (at: number | null) => (at === null ? '' : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));

  // ---- derived
  const pawns = $derived(cfg(ctx.settings, 'pawns'));
  const over = $derived(game.over);
  const rows = $derived(ranking(game, ctx));
  const zoneOf = (id: number) => zonesOf(game, ctx, id);
  const lastEntry = $derived(game.entries[game.entries.length - 1] ?? null);
  const redoE = $derived(redoNext(game));
  const warns = $derived(finishWarnings(game, ctx));
  const winners = $derived(rows.filter((r) => r.finished));
  const order = $derived(turnOrder(game, ctx));
  const sel = $derived(picked !== null && ctx.players.some((x) => x.id === picked) ? picked : (order[0] ?? null));
  const selPlayer = $derived(ctx.players.find((x) => x.id === sel) ?? null);
  const shownHistory = $derived([...game.entries].reverse().slice(0, showAllHistory ? game.entries.length : 12));

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

  const pick = async (id: number) => {
    picked = id;
    await tick();
    document.getElementById(`sr-p-${id}`)?.scrollIntoView({ block: wide ? 'nearest' : 'start', behavior: 'smooth' });
  };

  function move(pid: number, from: Zone, to: Zone) {
    apply(movePawn(game, ctx, pid, from, to, Date.now()));
  }
  function bump(victim: number, by: number | null) {
    apply(bumpPawn(game, ctx, victim, by, Date.now()));
  }
  function applyFix(pid: number) {
    const f = fixFrom[pid];
    const t = fixTo[pid];
    if (!f || !t) return;
    const next = movePawn(game, ctx, pid, f, t, Date.now());
    if (next === game) return;
    fixFrom[pid] = null;
    fixTo[pid] = null;
    fixOpen[pid] = false;
    apply(next);
  }

  function confirmEnd() {
    const next = endGame(game, Date.now());
    if (next === game) return;
    apply(next);
    endOpen = false;
  }
</script>

{#snippet playerPanel(who: BoardPlayer)}
  {@const z = zoneOf(who.id)}
  {@const st = statsOf(game, who.id)}
  {@const done = z.home >= pawns}
  <section class="panel pp" class:cur={who.id === sel} id={`sr-p-${who.id}`}>
    <div class="spread">
      <div class="row">
        <Avatar name={who.name} color={who.color} src={who.avatarPath} size={36} />
        <h2>{who.name}</h2>
      </div>
      <div class="row">
        {#if done}<span class="badge live">All home</span>{/if}
        <span class="badge mono">{z.home}/{pawns} home</span>
      </div>
    </div>

    <div class="zones" aria-label="Where the pawns are">
      {#each ZONES as zn (zn)}
        <div class="zone" class:hot={zn === 'home' && z.home > 0}>
          <span class="mono n">{z[zn]}</span>
          <span class="small muted">{ZONE_LABEL[zn]}</span>
        </div>
      {/each}
    </div>

    {#if !over}
      <div class="row quick">
        <button class="big" disabled={z.start < 1} onclick={() => move(who.id, 'start', 'board')}>Out of Start</button>
        <button class="big" disabled={z.board < 1} onclick={() => move(who.id, 'board', 'safety')}>Into Safety zone</button>
      </div>
      <div class="row quick">
        <button class="big" disabled={z.safety < 1} onclick={() => move(who.id, 'safety', 'home')}>Safety to Home</button>
        <button class="big" disabled={z.board < 1} onclick={() => move(who.id, 'board', 'home')}>Board to Home</button>
      </div>

      <div class="field">
        <span class="small muted">{first(who.name)} sent a pawn back to Start. Whose?</span>
        <div class="row">
          {#each ctx.players as x (x.id)}
            <button class="chip big" disabled={zoneOf(x.id).board < 1} onclick={() => bump(x.id, who.id)}>
              <Avatar name={x.name} color={x.color} src={x.avatarPath} size={24} />
              {x.id === who.id ? 'Their own' : first(x.name)}
            </button>
          {/each}
        </div>
      </div>

      {#if fixOpen[who.id]}
        <div class="field fix">
          <span class="small muted">Correct a pawn of {first(who.name)}: where was it, and where is it now?</span>
          <div class="row">
            {#each ZONES as zn (zn)}
              <button class="chip big" class:on={fixFrom[who.id] === zn} aria-pressed={fixFrom[who.id] === zn} disabled={z[zn] < 1} onclick={() => (fixFrom[who.id] = zn)}>From: {ZONE_LABEL[zn]}</button>
            {/each}
          </div>
          <div class="row">
            {#each ZONES as zn (zn)}
              <button class="chip big" class:on={fixTo[who.id] === zn} aria-pressed={fixTo[who.id] === zn} onclick={() => (fixTo[who.id] = zn)}>To: {ZONE_LABEL[zn]}</button>
            {/each}
          </div>
          <div class="row quick">
            <button class="primary big" disabled={!fixFrom[who.id] || !fixTo[who.id] || fixFrom[who.id] === fixTo[who.id]} onclick={() => applyFix(who.id)}>Move it</button>
            <button class="big" onclick={() => (fixOpen[who.id] = false)}>Cancel</button>
          </div>
        </div>
      {:else}
        <button class="link" onclick={() => (fixOpen[who.id] = true)}>Correct a pawn…</button>
      {/if}
    {/if}

    <p class="small muted stats">
      Sent back {st.bumpsMade} {st.bumpsMade === 1 ? 'pawn' : 'pawns'} · was sent back {st.bumpsTaken} {st.bumpsTaken === 1 ? 'time' : 'times'}{#if st.ownBumps} (own slide {st.ownBumps}){/if}
    </p>
  </section>
{/snippet}

<div class="srhost" bind:clientWidth={RW}>
<div class="sr" class:wide>
<div class="left">
  <section class="panel">
    <div class="spread">
      <h2>Sorry!</h2>
      <div class="row">
        <span class="badge">{pawns} pawns each</span>
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

    {#if !over}
      <p class="small muted">Tap a player, then log each pawn that leaves Start, enters Safety or gets Home. The crown follows pawns home, then in Safety.</p>
      <div class="row quick">
        <button class="big" disabled={!lastEntry} onclick={() => apply(undoLast(game))}>
          Undo last{lastEntry ? `: ${entryLine(lastEntry, nameOf)}` : ''}
        </button>
        {#if redoE}
          <button class="big" onclick={() => apply(redoLast(game))}>Put back: {entryLine(redoE, nameOf)}</button>
        {/if}
      </div>
      {#if winners.length}
        <p class="final"><strong>{winners.map((w) => first(w.name)).join(' and ')} {winners.length === 1 ? 'has' : 'have'} every pawn home.</strong> End the game below.</p>
      {/if}
    {:else}
      <p class="final"><strong>Game over.</strong></p>
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
                aria-label={`${seated.name}, ${zoneOf(seated.id).home} of ${pawns} pawns home`}
              >
                <Avatar name={seated.name} color={seated.color} src={seated.avatarPath} size={S} />
                <span class="lbl" class:above={top} style="font-size:{FS}px;max-width:{fit.lw}px">
                  <b>{first(seated.name)}</b>
                  <i>{zoneOf(seated.id).home}/{pawns} home</i>
                </span>
              </button>
            {:else}
              <div class="seat empty" style="left:{W / 2 + sp.x}px;top:{fit.cy + sp.y}px;width:{S}px;height:{S}px"></div>
            {/if}
          {/each}
        {/if}
      </div>
      <p class="small muted">Beside each name: pawns home.</p>
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
    <div class="scroll-x">
      <table>
        <thead>
          <tr><th>Place</th><th>Player</th><th class="num">Home</th><th class="num">Safety</th></tr>
        </thead>
        <tbody>
          {#each rows as r (r.playerId)}
            <tr>
              <td class="mono">{ordinal(r.place)}{r.tied ? '=' : ''}</td>
              <td>
                <button class="link" onclick={() => pick(r.playerId)}>{r.name}</button>
                <span class="detail small muted">
                  {r.zones.board} on the board · {r.zones.start} in Start{#if r.stats.bumpsMade || r.stats.bumpsTaken} · sent back {r.stats.bumpsMade}, was sent back {r.stats.bumpsTaken}{/if}
                </span>
              </td>
              <td class="num mono">{r.zones.home}</td>
              <td class="num mono">{r.zones.safety}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="small muted">Ranked by pawns home, then in Safety, then out of Start. An "=" is a shared place; you can still adjust it on the result screen.</p>
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
            <span>{entryLine(en, nameOf)}</span>
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
      <p class="small muted">The game was ended. Open the results to finish.</p>
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
      <p class="small muted">When the game is over (or you call time), end it here. Places follow the standings above.</p>
      <button class="primary big" disabled={!game.entries.length} onclick={() => (endOpen = true)}>End the game…</button>
    {:else}
      {#each warns as w (w)}<p class="final small">{w}</p>{/each}
      <div class="row">
        <button class="primary big" onclick={confirmEnd}>Yes, end the game</button>
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
  .sr {
    max-width: 40rem;
    margin: 0 auto;
  }
  .sr.wide {
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
  .stats {
    margin: 0.4rem 0 0;
  }

  /* where the pawns are */
  .zones {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.35rem;
    margin: 0.5rem 0;
  }
  .zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.4rem 0.2rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    text-align: center;
    line-height: 1.2;
  }
  .zone.hot {
    border-color: var(--accent);
  }
  .zone .n {
    font-size: 1.8rem;
  }
  .fix {
    margin-top: 0.4rem;
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
