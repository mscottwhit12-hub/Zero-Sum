<script lang="ts">
  /**
   * Clue board: the GM's control panel and live tracker. Players around their table, each showing their suspect and
   * whether they're still in; per player: suspect token, wrong / correct accusation (with an optional note of what they
   * said), undo, crown (by hand), re-rolls. Plus who goes first, standings, a timestamped history with typed notes,
   * and the recap. The solution envelope is never entered here: the GM only taps "wrong" or "correct".
   * All rules live in ./def.ts; this file only draws and calls those operations.
   */
  import Avatar from '../../../shared/Avatar.svelte';
  import type { BoardPlayer, BoardProps } from '../contract';
  import {
    NOTE_MAX,
    ROOMS,
    SUSPECTS,
    WEAPONS,
    accText,
    accuseBlock,
    addNote,
    assignSuspect,
    correctAccusation,
    describeEntry,
    firstPlayer,
    ordinal,
    pl,
    recap,
    recordReroll,
    status,
    suspectBlock,
    suspectName,
    suspectShort,
    undoBlock,
    undoLast,
    wrongAccusation,
    wrongLimit,
    type Accusation,
    type ClueState,
  } from './def';
  import { clamp, seatPoints } from './seating';

  let { ctx, state: game, onchange, onfinish }: BoardProps<ClueState> = $props();

  let picked = $state<number | null>(null);
  let confirmFor = $state<{ pid: number; kind: 'wrong' | 'correct' } | null>(null);
  let noteText = $state('');
  let noteAbout = $state('');
  let showAll = $state(false);
  let showRecap = $state(false);
  let confirmTime = $state(false);
  let busy = $state<Record<number, boolean>>({});
  let rerollFailed = $state<Record<number, boolean>>({});
  /** Per-player message when a move isn't allowed (and why). */
  let notice = $state<Record<number, string>>({});
  /** What the player said in an accusation (all optional). */
  let accSuspect = $state<Record<number, string>>({});
  let accWeapon = $state<Record<number, string>>({});
  let accRoom = $state<Record<number, string>>({});
  /** Board width: wide (laptop) shows every player's panel at once in a scrolling right column. */
  let RW = $state(0);
  const wide = $derived(RW >= 900);
  let W = $state(0);

  /** Only pass on a genuinely new state (the host may also dedupe, but this keeps double taps quiet). */
  const apply = (next: ClueState) => {
    if (next !== game) onchange(next);
  };
  const now = () => Date.now();
  const nameOf = (id: number) => ctx.players.find((p) => p.id === id)?.name ?? 'Another player';
  const first = (n: string) => n.split(/\s+/)[0] ?? n;
  const say = (pid: number, msg: string) => (notice = { ...notice, [pid]: msg });

  // ---- derived
  const sel = $derived(picked !== null && ctx.players.some((p) => p.id === picked) ? picked : (ctx.players[0]?.id ?? null));
  const selPlayer = $derived(ctx.players.find((p) => p.id === sel) ?? null);
  const stat = $derived(status(game, ctx));
  const standings = $derived(recap(game, ctx));
  const starter = $derived(firstPlayer(game, ctx));
  const limit = $derived(wrongLimit(ctx.settings));
  const leftOf = (id: number) => ctx.rerollsLeft[id] ?? 0;
  const entries = $derived([...game.log].reverse());
  const shownEntries = $derived(showAll ? entries : entries.slice(0, 30));
  const lastAlive = $derived(stat.alive.length === 1 && ctx.players.length > 1 && stat.winnerId === null ? stat.alive[0]! : null);

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
  const H = $derived(W / 1.25);
  const S = $derived(Math.round(clamp(W * 0.12, 40, 56)));
  const FS = 12;
  const fit = $derived.by(() => {
    const t = ctx.table;
    if (!t) return { tw: 0, th: 0 };
    const mx = S * 1.5 + 4;
    const my = S + FS * 2.6 + 8;
    const aspect = t.w / t.h;
    const tw = Math.min(Math.max(40, W - 2 * mx), Math.max(30, H - 2 * my) * aspect);
    return { tw, th: tw / aspect };
  });

  /** The short line shown under a name on the table. */
  const seatNote = (id: number): string => {
    const d = pl(game, id);
    if (stat.winnerId === id) return 'solved it';
    if (d.out) return 'out';
    return d.suspect ? suspectShort(d.suspect) : '';
  };
  const badgeText = (id: number): string => {
    const d = pl(game, id);
    if (stat.winnerId === id) return 'Solved it';
    if (d.out) return 'Out';
    return d.wrong > 0 ? `${d.wrong} of ${limit} wrong` : 'In';
  };

  // ---- actions
  const pick = (id: number) => {
    picked = id;
    confirmFor = null;
    rerollFailed = {};
    if (wide) document.getElementById(`clue-p-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const accOf = (pid: number): Accusation => ({
    suspect: accSuspect[pid] || undefined,
    weapon: accWeapon[pid] || undefined,
    room: accRoom[pid] || undefined,
  });
  const clearAcc = (pid: number) => {
    accSuspect = { ...accSuspect, [pid]: '' };
    accWeapon = { ...accWeapon, [pid]: '' };
    accRoom = { ...accRoom, [pid]: '' };
  };

  async function useReroll(pid: number) {
    if (busy[pid] || leftOf(pid) <= 0) return;
    busy[pid] = true;
    rerollFailed = { ...rerollFailed, [pid]: false };
    try {
      await ctx.useReroll(pid);
      apply(recordReroll(game, ctx, pid, now()));
    } catch {
      rerollFailed = { ...rerollFailed, [pid]: true };
    } finally {
      busy[pid] = false;
    }
  }

  function askAccuse(pid: number, kind: 'wrong' | 'correct') {
    const why = accuseBlock(game, ctx, pid);
    if (why) return say(pid, why);
    say(pid, '');
    confirmFor = { pid, kind };
  }

  function doAccuse(pid: number, kind: 'wrong' | 'correct') {
    const why = accuseBlock(game, ctx, pid);
    confirmFor = null;
    if (why) return say(pid, why);
    say(pid, '');
    apply(kind === 'wrong' ? wrongAccusation(game, ctx, pid, accOf(pid), now()) : correctAccusation(game, ctx, pid, accOf(pid), now()));
    clearAcc(pid);
  }

  function doUndo(pid: number) {
    const why = undoBlock(game, ctx, pid);
    if (why) return say(pid, why);
    say(pid, '');
    confirmFor = null;
    apply(undoLast(game, ctx, pid, now()));
  }

  /** Returns false when the change isn't allowed (the dropdown is then put back to the current suspect). */
  function doSuspect(pid: number, value: string): boolean {
    const key = value === '' ? null : value;
    const why = suspectBlock(game, ctx, pid, key);
    if (why) {
      say(pid, why);
      return false;
    }
    say(pid, '');
    apply(assignSuspect(game, ctx, pid, key, now()));
    return true;
  }

  const submitNote = () => {
    if (!noteText.trim()) return;
    apply(addNote(game, ctx, noteText, noteAbout === '' ? null : Number(noteAbout), now()));
    noteText = '';
  };

  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
</script>

{#snippet playerPanel(p: BoardPlayer)}
  {@const d = pl(game, p.id)}
  {@const canAccuse = accuseBlock(game, ctx, p.id) === null}
  {@const canUndo = undoBlock(game, ctx, p.id) === null}
  <section class="panel pp" class:cur={p.id === sel} id={`clue-p-${p.id}`}>
    <div class="spread">
      <div class="row">
        <Avatar name={p.name} color={p.color} src={p.avatarPath} size={36} />
        <h2>{p.name}</h2>
      </div>
      <div class="row">
        <span class="badge" class:live={!d.out}>{badgeText(p.id)}</span>
      </div>
    </div>

    <div class="field">
      <label class="small muted" for={`clue-s-${p.id}`}>Suspect</label>
      <select
        id={`clue-s-${p.id}`}
        class="sel"
        value={d.suspect ?? ''}
        onchange={(e) => {
          if (!doSuspect(p.id, e.currentTarget.value)) e.currentTarget.value = pl(game, p.id).suspect ?? '';
        }}
      >
        <option value="">Not recorded</option>
        {#each SUSPECTS as c (c.key)}
          {@const holder = ctx.players.find((o) => o.id !== p.id && pl(game, o.id).suspect === c.key)}
          <option value={c.key} disabled={holder !== undefined}>{c.name}{holder ? ` (${first(holder.name)})` : ''}</option>
        {/each}
      </select>
    </div>

    {#if d.out && stat.winnerId !== p.id}
      <p>
        Out of the turn order, but still shows cards when someone suggests.
        {#if d.outAt !== null}<span class="muted small">{time(d.outAt)}</span>{/if}
      </p>
    {/if}

    {#if canAccuse}
      <div class="field">
        <span class="small muted">What they accused (optional, for the history)</span>
        <div class="accrow">
          <select class="sel" bind:value={accSuspect[p.id]} aria-label={`Suspect accused by ${p.name}`}>
            <option value="">Suspect…</option>
            {#each SUSPECTS as c (c.key)}<option value={c.key}>{c.name}</option>{/each}
          </select>
          <select class="sel" bind:value={accWeapon[p.id]} aria-label={`Weapon accused by ${p.name}`}>
            <option value="">Weapon…</option>
            {#each WEAPONS as c (c.key)}<option value={c.key}>{c.name}</option>{/each}
          </select>
          <select class="sel" bind:value={accRoom[p.id]} aria-label={`Room accused by ${p.name}`}>
            <option value="">Room…</option>
            {#each ROOMS as c (c.key)}<option value={c.key}>{c.name}</option>{/each}
          </select>
        </div>
      </div>

      {#if confirmFor && confirmFor.pid === p.id}
        <div class="field">
          {#if confirmFor.kind === 'correct'}
            <p><strong>{p.name} solved the case?</strong></p>
            <p class="small muted">This ends the game: {first(p.name)} is 1st.</p>
          {:else}
            <p><strong>{p.name} accused wrong?</strong></p>
            <p class="small muted">
              {#if d.wrong + 1 >= limit}{first(p.name)} will be out of the game (still shows cards).{:else}That will be wrong accusation {d.wrong + 1} of {limit}.{/if}
            </p>
          {/if}
          <div class="row">
            <button class="big" class:primary={confirmFor.kind === 'correct'} class:danger={confirmFor.kind === 'wrong'} onclick={() => doAccuse(p.id, confirmFor!.kind)}>
              {confirmFor.kind === 'correct' ? 'Yes, solved it' : 'Yes, wrong'}
            </button>
            <button class="big" onclick={() => { confirmFor = null; clearAcc(p.id); }}>Cancel</button>
          </div>
        </div>
      {:else}
        <div class="row">
          <button class="big danger" onclick={() => askAccuse(p.id, 'wrong')}>Wrong accusation</button>
          <button class="big primary" onclick={() => askAccuse(p.id, 'correct')}>Correct accusation</button>
        </div>
      {/if}
    {/if}

    {#if canUndo}
      <button class="link" onclick={() => doUndo(p.id)}>{stat.winnerId === p.id ? 'Undo: solved the case' : d.out ? 'Undo last wrong accusation (back in)' : 'Undo last wrong accusation'}</button>
    {/if}
    {#if notice[p.id]}<p class="error">{notice[p.id]}</p>{/if}

    <!-- No crown during Clue (Tate, Oct 29): the winner is only set by the result. -->
    {#if ctx.rerollsAllowed && !d.out && !stat.over}
      <div class="field">
        <div class="spread">
          <span>Re-rolls left: <strong class="mono">{leftOf(p.id)}</strong></span>
          <button class="big" disabled={busy[p.id] || leftOf(p.id) <= 0} onclick={() => useReroll(p.id)}>Use a re-roll</button>
        </div>
        {#if rerollFailed[p.id]}<p class="error">That re-roll could not be used. Check how many are left and try again.</p>{/if}
      </div>
    {/if}
  </section>
{/snippet}

<div class="cluehost" bind:clientWidth={RW}>
<div class="cluep" class:wide>
<div class="left">
  <section class="panel">
    <div class="spread">
      <h2>Clue</h2>
      <div class="row">
        <span class="badge">{stat.alive.length} of {ctx.players.length} still in</span>
        {#if starter && !stat.over}
          <span class="badge">First: {first(nameOf(starter.id))}{starter.suspect ? ` (${suspectName(starter.suspect)})` : ''}</span>
        {/if}
        {#if !stat.over}
          <button onclick={() => (showRecap = !showRecap)}>{showRecap ? 'Hide recap' : 'Recap'}</button>
        {/if}
      </div>
    </div>
    <p class="small muted">The solution envelope is never entered here. Tap wrong or correct when someone accuses.</p>
    {#if stat.winnerId !== null}
      <p class="win">
        <strong>{nameOf(stat.winnerId)} solved the case.</strong>
        {#if onfinish}Finish the game; the places are filled in for you.{/if}
      </p>
      {#if onfinish}<button class="big primary" onclick={() => onfinish?.()}>Open the result screen</button>{/if}
    {:else if stat.nobodyWins}
      <p class="win">
        <strong>Everyone accused wrong, so nobody wins.</strong>
        {#if onfinish}The last player out is 1st.{/if}
      </p>
      {#if onfinish}<button class="big primary" onclick={() => onfinish?.()}>Open the result screen</button>{/if}
    {:else}
      {#if lastAlive !== null}
        <p class="small">Only {nameOf(lastAlive)} is still in. They can still make an accusation.</p>
      {/if}
      {#if onfinish}
        {#if confirmTime}
          <div class="calltime">
            <strong>Call time with nobody solving it?</strong>
            <button class="big danger" onclick={() => { confirmTime = false; onfinish?.(); }}>Yes, finish</button>
            <button class="big" onclick={() => (confirmTime = false)}>Cancel</button>
          </div>
        {:else}
          <div class="calltime">
            <button class="big" onclick={() => (confirmTime = true)}>Call time and finish</button>
            <span class="small muted">Everyone still in ties for 1st.</span>
          </div>
        {/if}
      {/if}
    {/if}
  </section>

  {#if ctx.table}
    <section class="panel">
      <div class="tv-table" bind:clientWidth={W} style="height:{H}px">
        {#if W > 0}
          <div class="tbl" style="width:{fit.tw}px;height:{fit.th}px">
            <strong>{ctx.table.name}</strong>
          </div>
          {#each seatPoints(ctx.table.seats, fit.tw, fit.th, S, 6) as sp (sp.seat)}
            {@const pp = seating.bySeat.get(sp.seat)}
            {@const top = sp.y < -fit.th / 2}
            {#if pp}
              {@const d = pl(game, pp.id)}
              <button
                class="seat"
                class:sel={pp.id === sel}
                class:out={d.out && stat.winnerId !== pp.id}
                style="left:{W / 2 + sp.x}px;top:{H / 2 + sp.y}px;width:{S}px;height:{S}px"
                onclick={() => pick(pp.id)}
                aria-label={`${pp.name}, ${badgeText(pp.id)}${d.suspect ? `, ${suspectName(d.suspect)}` : ''}`}
              >
                <Avatar name={pp.name} color={pp.color} src={pp.avatarPath} size={S} />
                <span class="lbl" class:above={top} style="font-size:{FS}px;max-width:{Math.round(S * 1.8)}px">
                  <b>{first(pp.name)}</b>
                  <i>{seatNote(pp.id)}</i>
                </span>
              </button>
            {:else}
              <div class="seat empty" style="left:{W / 2 + sp.x}px;top:{H / 2 + sp.y}px;width:{S}px;height:{S}px"></div>
            {/if}
          {/each}
        {/if}
      </div>
      <p class="small muted">Under each name: suspect, or "out" after {limit === 1 ? 'a wrong accusation' : `${limit} wrong accusations`}.</p>
    </section>
  {/if}

  {#if seating.rest.length}
    <section class="panel">
      {#if ctx.table}<p class="small muted">Not at the table</p>{/if}
      <div class="row">
        {#each seating.rest as o (o.id)}
          {@const d = pl(game, o.id)}
          <button class="chip" class:on={o.id === sel} class:out={d.out && stat.winnerId !== o.id} onclick={() => pick(o.id)}>
            <Avatar name={o.name} color={o.color} src={o.avatarPath} size={24} />
            {first(o.name)}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if !wide && selPlayer}{@render playerPanel(selPlayer)}{/if}

  <section class="panel">
    <h3>Standings if the game ended now</h3>
    <div class="scroll-x">
      <table class="standings">
        <thead>
          <tr><th>Place</th><th>Player</th><th>Suspect</th><th class="num">Wrong</th><th>Status</th></tr>
        </thead>
        <tbody>
          {#each standings as r (r.playerId)}
            <tr class:out={r.out}>
              <td class="mono">{ordinal(r.place)}{r.tied ? '=' : ''}</td>
              <td><button class="link" onclick={() => pick(r.playerId)}>{r.name}</button></td>
              <td>{r.suspect ? suspectShort(r.suspect) : '–'}</td>
              <td class="num mono">{r.wrong}</td>
              <td>{r.solved ? 'Solved it' : r.out ? 'Out' : 'In'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  {#if showRecap || stat.over}
    <section class="panel">
      <h3>Game recap</h3>
      <div class="grid2">
        {#each standings as r (r.playerId)}
          <div class="card">
            <div class="spread"><strong>{r.name}</strong><span class="badge">{ordinal(r.place)}{r.tied ? ' (tied)' : ''}</span></div>
            <p class="small">
              {#if r.solved}Solved the case.{:else if r.out}Out after {r.wrong} wrong accusation{r.wrong === 1 ? '' : 's'}.{:else}Still in at the end.{/if}
            </p>
            <p class="small muted">
              {#if r.suspect}Suspect: {suspectName(r.suspect)}{/if}
              {#if r.rerollsUsed}<br />Re-rolls used: {r.rerollsUsed}{/if}
            </p>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section class="panel">
    <h3>Game history</h3>
    <div class="note">
      <select bind:value={noteAbout} aria-label="Note is about">
        <option value="">Whole game</option>
        {#each ctx.players as o (o.id)}<option value={String(o.id)}>{o.name}</option>{/each}
      </select>
      <input
        type="text"
        maxlength={NOTE_MAX}
        placeholder="Add a note to the history"
        bind:value={noteText}
        onkeydown={(e) => {
          if (e.key === 'Enter') submitNote();
        }}
      />
      <button class="primary big" disabled={!noteText.trim()} onclick={submitNote}>Add</button>
    </div>
    {#if !entries.length}
      <p class="muted small">Nothing yet. Every accusation and note will show here with its time.</p>
    {:else}
      <ul class="log">
        {#each shownEntries as e (e.id)}
          <li class:note-entry={e.kind === 'note'}>
            <span class="mono muted small">{time(e.t)}</span>
            <span>{describeEntry(e, nameOf)}</span>
          </li>
        {/each}
      </ul>
      {#if entries.length > 30}
        <button onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${entries.length}`}</button>
      {/if}
    {/if}
  </section>
</div>
{#if wide}
  <div class="right" aria-label="All players">
    {#each ctx.players as o (o.id)}{@render playerPanel(o)}{/each}
  </div>
{/if}
</div>
</div>

<style>
  .cluep {
    max-width: 40rem;
    margin: 0 auto;
  }
  .cluep.wide {
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
  .pp.cur {
    outline: 2px solid var(--accent);
  }
  .win {
    margin: 0.6rem 0;
    padding: 0.6rem;
    border: 1px solid var(--good);
    border-radius: var(--radius);
    color: var(--good);
  }
  .calltime {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.6rem;
  }

  /* table */
  .tv-table {
    position: relative;
    width: 100%;
    max-width: 34rem;
    margin: 0 auto;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .seat.out {
    opacity: 0.45;
  }
  .lbl {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 2px;
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
    margin: 0 0 2px;
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

  /* chips, selects */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .chip.out {
    opacity: 0.5;
  }
  .sel {
    min-height: 44px;
    max-width: 100%;
  }
  .accrow {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.4rem;
  }
  .accrow .sel {
    width: 100%;
  }
  .standings th,
  .standings td {
    padding: 0.4rem 0.3rem;
    font-size: 0.92rem;
  }

  /* standings, recap */
  tr.out td {
    opacity: 0.55;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0.3rem 0;
    min-height: 40px;
    text-decoration: underline;
    text-align: left;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.6rem;
  }
  .card p {
    margin: 0.3rem 0 0;
  }

  /* history */
  .note {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }
  .note select {
    grid-column: 1 / -1;
    min-height: 44px;
  }
  .note input {
    min-height: 48px;
  }
  .log {
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
  }
  .log li {
    display: grid;
    grid-template-columns: 7.2rem 1fr;
    gap: 0.4rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
  }
  .log li span:first-child {
    white-space: nowrap;
  }
  .log li.note-entry span:last-child {
    font-weight: 600;
  }
</style>
