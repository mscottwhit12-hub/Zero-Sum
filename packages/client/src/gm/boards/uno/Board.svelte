<script lang="ts">
  /**
   * Uno board: the GM's score sheet. Players sit around the table showing their points; after each round the GM taps
   * who went out and types the points they won (one number), or, if they like, each other player's leftover points
   * (the board adds them up). The first to reach the target wins. The crown follows the points live. All rules live
   * in ./def.ts.
   */
  import { tick } from 'svelte';
  import Avatar from '../../../shared/Avatar.svelte';
  import type { BoardPlayer, BoardProps } from '../contract';
  import {
    addRound,
    cfg,
    clock,
    duration,
    endGame,
    finishWarnings,
    houseRules,
    markStarted,
    ordinal,
    ranking,
    redoLast,
    redoNext,
    reopenGame,
    roundLine,
    roundsWon,
    targetWinner,
    toGo,
    totalOf,
    turnOrder,
    undoLast,
    type UnoState,
  } from './def';
  import { clamp, seatPoints } from './seating';

  let { ctx, state: game, onchange, onfinish }: BoardProps<UnoState> = $props();

  let picked = $state<number | null>(null);
  let confirmFinish = $state(false);
  let showAllHistory = $state(false);
  /** Board width: wide (laptop) shows every player's panel at once in a scrolling right column. */
  let RW = $state(0);
  const wide = $derived(RW >= 900);
  let W = $state(0);

  // ---- the round being entered
  let winner = $state<number | null>(null);
  let pointsText = $state('');
  let breakdownOn = $state(false);
  let handText = $state<Record<number, string>>({});
  /** The score is big (typo guard): the GM must tap once more to confirm. */
  let bigPending = $state(false);

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
  const apply = (next: UnoState) => {
    if (next === game) return;
    onchange(markStarted(next, openedAt));
  };
  const clk = $derived(clock(markStarted(game, openedAt), ctx, nowMs));
  const clockTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const nameOf = (id: number | null) => ctx.players.find((x) => x.id === id)?.name ?? 'A player';
  const first = (n: string) => n.trim().split(/\s+/)[0] || 'Player';
  const fmtAt = (at: number | null) => (at === null ? '' : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));

  // ---- derived
  const target = $derived(cfg(ctx.settings, 'target'));
  const actionValue = $derived(cfg(ctx.settings, 'actionValue'));
  const wildValue = $derived(cfg(ctx.settings, 'wildValue'));
  const bigRound = $derived(cfg(ctx.settings, 'bigRound'));
  const handMax = $derived(cfg(ctx.settings, 'handMax'));
  const rules = $derived(houseRules(ctx.settings));
  const over = $derived(game.over);
  const rows = $derived(ranking(game, ctx));
  const tw = $derived(targetWinner(game, ctx));
  const redoE = $derived(redoNext(game));
  const lastRound = $derived(game.rounds[game.rounds.length - 1] ?? null);
  const warns = $derived(finishWarnings(game, ctx));
  const order = $derived(turnOrder(game, ctx));
  const sel = $derived(picked !== null && ctx.players.some((x) => x.id === picked) ? picked : (order[0] ?? null));
  const selPlayer = $derived(ctx.players.find((x) => x.id === sel) ?? null);
  const total = (id: number) => totalOf(game, id);
  const shownRounds = $derived(
    game.rounds
      .map((r, i) => ({ r, n: i + 1 }))
      .reverse()
      .slice(0, showAllHistory ? game.rounds.length : 10),
  );

  // the round form
  const losers = $derived(ctx.players.filter((x) => x.id !== winner));
  const handNum = (id: number): number => {
    const t = (handText[id] ?? '').trim();
    return /^\d{1,3}$/.test(t) ? Number(t) : 0;
  };
  const handsObj = $derived.by(() => {
    const out: Record<number, number> = {};
    for (const x of losers) out[x.id] = handNum(x.id);
    return out;
  });
  const handsSum = $derived(Object.values(handsObj).reduce((a, b) => a + b, 0));
  const typedPoints = $derived(/^\d{1,4}$/.test(pointsText.trim()) ? Number(pointsText.trim()) : null);
  const roundPoints = $derived(breakdownOn ? handsSum : typedPoints);
  const canAdd = $derived(!over && tw === null && winner !== null && roundPoints !== null && addRound(game, ctx, winner, roundPoints, breakdownOn ? handsObj : null) !== game);
  const badPoints = $derived(!breakdownOn && pointsText.trim() !== '' && typedPoints === null);

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
    const tw2 = Math.min(Math.max(40, W - 2 * mx), Math.max(30, W / 1.25 - 2 * myFull) * aspect);
    const th = tw2 / aspect;
    let lo = -th / 2;
    let hi = th / 2;
    const labels: { x: number; y0: number; y1: number }[] = [];
    for (const sp of seatPoints(t.seats, tw2, th, S, 6)) {
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
    return { tw: tw2, th, cy: 4 - lo, H: hi - lo + 8, lw };
  });

  const pick = async (id: number) => {
    picked = id;
    await tick();
    document.getElementById(`un-p-${id}`)?.scrollIntoView({ block: wide ? 'nearest' : 'start', behavior: 'smooth' });
  };

  /** "Went out" on a player's panel or chip: choose the winner of the round being entered. */
  async function setWinner(id: number) {
    winner = id;
    bigPending = false;
    await tick();
    document.getElementById(breakdownOn ? 'un-hand-first' : 'un-points')?.focus({ preventScroll: false });
  }

  function addHand(id: number, v: number) {
    handText[id] = String(handNum(id) + v);
    bigPending = false;
  }

  function resetForm() {
    winner = null;
    pointsText = '';
    handText = {};
    bigPending = false;
  }

  function submitRound() {
    if (!canAdd || winner === null || roundPoints === null) return;
    if (roundPoints >= bigRound && !bigPending) {
      bigPending = true;
      return;
    }
    const next = addRound(game, ctx, winner, roundPoints, breakdownOn ? handsObj : null, Date.now());
    if (next === game) return;
    apply(next);
    resetForm();
  }

  function confirmEnd() {
    const next = endGame(game, Date.now());
    if (next === game) return;
    apply(next);
    endOpen = false;
  }
</script>

{#snippet playerPanel(who: BoardPlayer)}
  {@const t = total(who.id)}
  {@const won = roundsWon(game, who.id)}
  <section class="panel pp" class:cur={who.id === sel} id={`un-p-${who.id}`}>
    <div class="spread">
      <div class="row">
        <Avatar name={who.name} color={who.color} src={who.avatarPath} size={36} />
        <h2>{who.name}</h2>
      </div>
      <div class="row">
        {#if tw === who.id}<span class="badge live">Winner</span>{/if}
        <span class="badge mono">{t}</span>
      </div>
    </div>
    <p class="small muted">
      {#if tw === who.id}Reached {target} points.{:else}{toGo(game, ctx, who.id)} points to go to {target}.{/if}
      Went out in {won} {won === 1 ? 'round' : 'rounds'}.
    </p>
    {#if !over && tw === null}
      <button class="big" onclick={() => setWinner(who.id)}>{first(who.name)} went out this round</button>
    {/if}
  </section>
{/snippet}

<div class="unhost" bind:clientWidth={RW}>
<div class="un" class:wide>
<div class="left">
  <section class="panel">
    <div class="spread">
      <h2>Uno</h2>
      <div class="row">
        <span class="badge">First to {target}</span>
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
    {#if rules.length}<p class="small muted">House rules on the table: {rules.join(', ')}.</p>{/if}

    {#if over}
      <p class="final"><strong>Game over.</strong></p>
    {:else if tw !== null}
      <p class="final"><strong>{first(nameOf(tw))} reached {target} points and wins!</strong> End the game below.</p>
    {/if}

    {#if !over}
      <div class="row quick">
        <button class="big" disabled={!lastRound} onclick={() => apply(undoLast(game))}>
          Undo last round{lastRound ? `: ${first(nameOf(lastRound.winner))} ${lastRound.points}` : ''}
        </button>
        {#if redoE}
          <button class="big" onclick={() => apply(redoLast(game))}>Put back: {first(nameOf(redoE.winner))} {redoE.points}</button>
        {/if}
      </div>
    {/if}
  </section>

  {#if !over && tw === null}
    <section class="panel">
      <h3>Round {game.rounds.length + 1}</h3>
      <p class="small muted">Who went out? Tap a name, then type the points they won (the cards left in everyone else's hands).</p>
      <div class="row">
        {#each ctx.players as x (x.id)}
          <button class="chip big" class:on={winner === x.id} aria-pressed={winner === x.id} onclick={() => setWinner(x.id)}>
            <Avatar name={x.name} color={x.color} src={x.avatarPath} size={24} />
            {first(x.name)}
          </button>
        {/each}
      </div>

      {#if winner !== null}
        {#if !breakdownOn}
          <label class="small muted" for="un-points">Points {first(nameOf(winner))} won this round</label>
          <div class="entry">
            <input
              id="un-points"
              class="mono score"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              placeholder="0"
              maxlength="4"
              value={pointsText}
              oninput={(e) => {
                const input = e.currentTarget as HTMLInputElement;
                const clean = input.value.replace(/[^0-9]/g, '').slice(0, 4);
                input.value = clean;
                pointsText = clean;
                bigPending = false;
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter') submitRound();
              }}
            />
            <button class="primary big" disabled={!canAdd} onclick={submitRound}>Add round</button>
          </div>
          {#if badPoints}<p class="error small">Type a whole number of points.</p>{/if}
          {#if typedPoints !== null && !canAdd}<p class="error small">The board does not accept that many points for one round.</p>{/if}
        {:else}
          <p class="small muted">Points left in each other player's hand (0 to {handMax}). Quick add: {actionValue} for a Skip, Reverse or Draw Two, {wildValue} for a Wild; type number cards yourself.</p>
          {#each losers as x, i (x.id)}
            <div class="handrow">
              <span>{first(x.name)}</span>
              <input
                id={i === 0 ? 'un-hand-first' : undefined}
                class="mono"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                autocomplete="off"
                placeholder="0"
                maxlength="3"
                aria-label={`Points left in ${x.name}'s hand`}
                value={handText[x.id] ?? ''}
                oninput={(e) => {
                  const input = e.currentTarget as HTMLInputElement;
                  const clean = input.value.replace(/[^0-9]/g, '').slice(0, 3);
                  input.value = clean;
                  handText[x.id] = clean;
                  bigPending = false;
                }}
              />
              <button class="big" onclick={() => addHand(x.id, actionValue)}>+{actionValue}</button>
              <button class="big" onclick={() => addHand(x.id, wildValue)}>+{wildValue}</button>
            </div>
          {/each}
          <p class="sum">Round total <strong class="mono">{handsSum}</strong></p>
          <button class="primary big" disabled={!canAdd} onclick={submitRound}>Add round</button>
          {#if handsSum > 0 && !canAdd}<p class="error small">A hand can be at most {handMax} points, and the round at most {cfg(ctx.settings, 'roundMax')}.</p>{/if}
        {/if}

        {#if bigPending && roundPoints !== null}
          <div class="final">
            <strong>{roundPoints} points in one round. Is that right?</strong>
            <div class="row">
              <button class="primary big" onclick={submitRound}>Yes, add {roundPoints}</button>
              <button class="big" onclick={() => (bigPending = false)}>No, let me fix it</button>
            </div>
          </div>
        {/if}

        <div class="row quick">
          <button class="link" onclick={() => { breakdownOn = !breakdownOn; bigPending = false; }}>{breakdownOn ? 'Type one number instead' : 'Break it down by player instead'}</button>
          <button class="link" onclick={resetForm}>Clear</button>
        </div>
      {/if}
    </section>
  {/if}

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
                aria-label={`${seated.name}, ${total(seated.id)} points`}
              >
                <Avatar name={seated.name} color={seated.color} src={seated.avatarPath} size={S} />
                <span class="lbl" class:above={top} style="font-size:{FS}px;max-width:{fit.lw}px">
                  <b>{first(seated.name)}</b>
                  <i>{total(seated.id)}</i>
                </span>
              </button>
            {:else}
              <div class="seat empty" style="left:{W / 2 + sp.x}px;top:{fit.cy + sp.y}px;width:{S}px;height:{S}px"></div>
            {/if}
          {/each}
        {/if}
      </div>
      <p class="small muted">Beside each name: points so far.</p>
    </section>
  {/if}

  {#if seating.rest.length}
    <section class="panel">
      <p class="small muted">{ctx.table ? 'Not at the table' : 'Players'}: tap a name to see their points and panel.</p>
      <div class="row">
        {#each seating.rest as x (x.id)}
          <button class="chip" class:on={x.id === sel} aria-label={`Show ${x.name}'s panel, ${total(x.id)} points`} onclick={() => pick(x.id)}>
            <Avatar name={x.name} color={x.color} src={x.avatarPath} size={24} />
            {first(x.name)} <span class="mono muted">{total(x.id)}</span>
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
          <tr><th>Place</th><th>Player</th><th class="num">Points</th></tr>
        </thead>
        <tbody>
          {#each rows as r (r.playerId)}
            <tr>
              <td class="mono">{ordinal(r.place)}{r.tied ? '=' : ''}</td>
              <td>
                <button class="link" onclick={() => pick(r.playerId)}>{r.name}</button>
                <span class="detail small muted">{r.winner ? 'reached the target' : `${toGo(game, ctx, r.playerId)} to go`} · went out in {r.won} {r.won === 1 ? 'round' : 'rounds'}</span>
              </td>
              <td class="num mono">{r.total}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="small muted">The first to reach {target} wins; everyone else is ranked by points. An "=" is a shared place; you can still adjust it on the result screen.</p>
  </section>

  <section class="panel">
    <div class="spread">
      <h3>Rounds</h3>
      <span class="small muted">{game.rounds.length} {game.rounds.length === 1 ? 'round' : 'rounds'}</span>
    </div>
    {#if !game.rounds.length}
      <p class="small muted">No rounds yet.</p>
    {:else}
      <ul class="hist">
        {#each shownRounds as item (item.r.id)}
          <li>
            <span class="small muted mono">{fmtAt(item.r.at)}</span>
            <span>{roundLine(item.r, item.n, nameOf)}</span>
          </li>
        {/each}
      </ul>
      {#if game.rounds.length > 10}
        <button class="link" onclick={() => (showAllHistory = !showAllHistory)}>{showAllHistory ? 'Show only the latest' : `Show all ${game.rounds.length}`}</button>
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
      <p class="small muted">When someone reaches {target}, or you call time, end the game here. Places follow the standings above.</p>
      <button class="primary big" disabled={!game.rounds.length} onclick={() => (endOpen = true)}>End the game…</button>
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
  .un {
    max-width: 40rem;
    margin: 0 auto;
  }
  .un.wide {
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
  .detail {
    display: block;
  }
  .sum {
    display: flex;
    justify-content: space-between;
    margin: 0.5rem 0;
  }

  /* number entry */
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
    min-width: 6rem;
    min-height: 56px;
    font-size: 1.1rem;
  }
  .handrow {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.3rem 0;
  }
  .handrow > span {
    flex: 1 1 4rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .handrow input {
    flex: 0 0 5rem;
    min-height: 48px;
    text-align: center;
    font-size: 1.2rem;
  }
  .handrow button {
    flex: 0 0 auto;
    min-width: 3.5rem;
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
