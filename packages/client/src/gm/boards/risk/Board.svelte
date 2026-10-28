<script lang="ts">
  /**
   * Risk board: the GM's control panel and live tracker. Pick a player (at the table or in the list), edit their
   * numbers with big steppers, tick continents, eliminate / undo, keep a timestamped history with typed notes.
   * All rules live in ./def.ts; this file only draws and calls those operations.
   */
  import Avatar from '../../../shared/Avatar.svelte';
  import type { BoardPlayer, BoardProps } from '../contract';
  import {
    CONTINENTS,
    NOTE_MAX,
    addNote,
    cfg,
    describeEntry,
    eliminate,
    ordinal,
    pl,
    recap,
    recordReroll,
    reinforcements,
    restore,
    setArmies,
    setContinent,
    setTerritories,
    status,
    type RiskState,
  } from './def';
  import { clamp, seatPoints } from './seating';

  let { ctx, state: game, onchange }: BoardProps<RiskState> = $props();

  let picked = $state<number | null>(null);
  let elimFor = $state<number | null>(null);
  let noteText = $state('');
  let noteAbout = $state('');
  let showAll = $state(false);
  let showRecap = $state(false);
  let busy = $state<Record<number, boolean>>({});
  let rerollFailed = $state(false);
  let W = $state(0);

  /** Only pass on a genuinely new state (the host may also dedupe, but this keeps double taps quiet). */
  const apply = (next: RiskState) => {
    if (next !== game) onchange(next);
  };
  const now = () => Date.now();
  const nameOf = (id: number) => ctx.players.find((p) => p.id === id)?.name ?? 'Another player';
  const first = (n: string) => n.split(/\s+/)[0] ?? n;

  // ---- derived
  const sel = $derived(picked !== null && ctx.players.some((p) => p.id === picked) ? picked : (ctx.players[0]?.id ?? null));
  const selPlayer = $derived(ctx.players.find((p) => p.id === sel) ?? null);
  const selData = $derived(sel === null ? null : pl(game, sel));
  const stat = $derived(status(game, ctx));
  const standings = $derived(recap(game, ctx));
  const assigned = $derived(ctx.players.reduce((n, p) => n + pl(game, p.id).territories, 0));
  const total = $derived(cfg(ctx.settings, 'territoryTotal'));
  const armiesMax = $derived(cfg(ctx.settings, 'armiesMax'));
  const leftOf = (id: number) => ctx.rerollsLeft[id] ?? 0;
  const entries = $derived([...game.log].reverse());
  const shownEntries = $derived(showAll ? entries : entries.slice(0, 30));

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

  // ---- actions
  const pick = (id: number) => {
    picked = id;
    elimFor = null;
    rerollFailed = false;
  };

  const commitNumber = (e: Event, current: number, set: (v: number) => void) => {
    const input = e.currentTarget as HTMLInputElement;
    const n = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(n)) input.value = String(current);
    else set(n);
  };

  async function useReroll(pid: number) {
    if (busy[pid] || leftOf(pid) <= 0) return;
    busy[pid] = true;
    rerollFailed = false;
    try {
      await ctx.useReroll(pid);
      apply(recordReroll(game, ctx, pid, now()));
    } catch {
      rerollFailed = true;
    } finally {
      busy[pid] = false;
    }
  }

  const doEliminate = (pid: number, by: number | null) => {
    apply(eliminate(game, ctx, pid, by, now()));
    elimFor = null;
  };

  const submitNote = () => {
    if (!noteText.trim()) return;
    apply(addNote(game, ctx, noteText, noteAbout === '' ? null : Number(noteAbout), now()));
    noteText = '';
  };

  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
</script>

{#snippet stepper(label: string, value: number, steps: number[], set: (v: number) => void)}
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

<div class="risk">
  <section class="panel">
    <div class="spread">
      <h2>Risk</h2>
      <div class="row">
        <span class="badge" class:warn={assigned > total}>{assigned} / {total} territories assigned</span>
        <span class="badge">{stat.alive.length} of {ctx.players.length} still in</span>
        {#if !stat.over}
          <button onclick={() => (showRecap = !showRecap)}>{showRecap ? 'Hide recap' : 'Recap'}</button>
        {/if}
      </div>
    </div>
    {#if stat.over && stat.winnerId !== null}
      <p class="win"><strong>{nameOf(stat.winnerId)} has conquered the world.</strong> Finish the game from the result screen; the places are filled in for you.</p>
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
                class:out={d.eliminated}
                style="left:{W / 2 + sp.x}px;top:{H / 2 + sp.y}px;width:{S}px;height:{S}px"
                onclick={() => pick(pp.id)}
                aria-label={`${pp.name}, ${d.eliminated ? 'eliminated' : `${d.territories} territories`}`}
              >
                <Avatar name={pp.name} color={pp.color} src={pp.avatarPath} size={S} />
                <span class="lbl" class:above={top} style="font-size:{FS}px;max-width:{Math.round(S * 1.8)}px">
                  <b>{first(pp.name)}</b>
                  <i>{d.eliminated ? 'out' : `${d.territories} · +${reinforcements(d, ctx.settings)}`}</i>
                </span>
              </button>
            {:else}
              <div class="seat empty" style="left:{W / 2 + sp.x}px;top:{H / 2 + sp.y}px;width:{S}px;height:{S}px"></div>
            {/if}
          {/each}
        {/if}
      </div>
      <p class="small muted">Beside each name: territories · reinforcements per turn.</p>
    </section>
  {/if}

  {#if seating.rest.length}
    <section class="panel">
      {#if ctx.table}<p class="small muted">Not at the table</p>{/if}
      <div class="row">
        {#each seating.rest as p (p.id)}
          {@const d = pl(game, p.id)}
          <button class="chip" class:on={p.id === sel} class:out={d.eliminated} onclick={() => pick(p.id)}>
            <Avatar name={p.name} color={p.color} src={p.avatarPath} size={24} />
            {first(p.name)}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if selPlayer && selData}
    <section class="panel">
      <div class="spread">
        <div class="row">
          <Avatar name={selPlayer.name} color={selPlayer.color} src={selPlayer.avatarPath} size={36} />
          <h2>{selPlayer.name}</h2>
        </div>
        <span class="badge" class:live={!selData.eliminated}>
          {selData.eliminated ? 'Eliminated' : `+${reinforcements(selData, ctx.settings)} per turn`}
        </span>
      </div>

      {#if selData.eliminated}
        <p>
          Out{selData.eliminatedBy !== null ? `, eliminated by ${nameOf(selData.eliminatedBy)}` : ''}.
          {#if selData.eliminatedAt !== null}<span class="muted small">{time(selData.eliminatedAt)}</span>{/if}
        </p>
        <button class="big" onclick={() => apply(restore(game, ctx, selPlayer.id, now()))}>Undo elimination</button>
      {:else}
        {@render stepper('Territories', selData.territories, [1, 5], (v) => apply(setTerritories(game, ctx, selPlayer.id, v, now())))}
        {@render stepper(`Armies (up to ${armiesMax})`, selData.armies, [1, 5], (v) => apply(setArmies(game, ctx, selPlayer.id, v, now())))}

        <div class="field">
          <span class="small muted">Continents held at the start of their turn</span>
          <div class="row">
            {#each CONTINENTS as c (c.key)}
              {@const held = selData.continents.includes(c.key)}
              <button class="chip" class:on={held} aria-pressed={held} onclick={() => apply(setContinent(game, ctx, selPlayer.id, c.key, !held, now()))}>
                {c.label} +{cfg(ctx.settings, c.setting)}
              </button>
            {/each}
          </div>
        </div>

        {#if ctx.rerollsAllowed}
          <div class="field">
            <div class="spread">
              <span>Re-rolls left: <strong class="mono">{leftOf(selPlayer.id)}</strong></span>
              <button class="big" disabled={busy[selPlayer.id] || leftOf(selPlayer.id) <= 0} onclick={() => useReroll(selPlayer.id)}>Use a re-roll</button>
            </div>
            {#if rerollFailed}<p class="error">That re-roll could not be used. Check how many are left and try again.</p>{/if}
          </div>
        {/if}

        {#if elimFor === selPlayer.id}
          <div class="field">
            <p><strong>Who eliminated {selPlayer.name}?</strong></p>
            <div class="row">
              {#each ctx.players.filter((p) => p.id !== selPlayer.id && !pl(game, p.id).eliminated) as p (p.id)}
                <button class="big" onclick={() => doEliminate(selPlayer.id, p.id)}>{first(p.name)}</button>
              {/each}
              <button class="big" onclick={() => doEliminate(selPlayer.id, null)}>Not sure</button>
              <button class="big" onclick={() => (elimFor = null)}>Cancel</button>
            </div>
          </div>
        {:else}
          <button class="big danger" disabled={stat.alive.length <= 1} onclick={() => (elimFor = selPlayer.id)}>Eliminate {first(selPlayer.name)}</button>
        {/if}
      {/if}
    </section>
  {/if}

  <section class="panel">
    <h3>Standings if the game ended now</h3>
    <div class="scroll-x">
      <table>
        <thead>
          <tr><th>Place</th><th>Player</th><th class="num">Per turn</th><th class="num">Terr.</th><th class="num">Armies</th></tr>
        </thead>
        <tbody>
          {#each standings as r (r.playerId)}
            <tr class:out={r.eliminated}>
              <td class="mono">{ordinal(r.place)}{r.tied ? '=' : ''}</td>
              <td><button class="link" onclick={() => pick(r.playerId)}>{r.name}</button></td>
              <td class="num mono">{r.eliminated ? '–' : `+${r.reinforcements}`}</td>
              <td class="num mono">{r.territories}</td>
              <td class="num mono">{r.armies}</td>
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
              {#if r.eliminated}Eliminated{r.eliminatedBy ? ` by ${r.eliminatedBy}` : ''}.{:else}Finished with {r.territories} territories and {r.armies} armies.{/if}
            </p>
            <p class="small muted">
              Most territories held: {r.peakTerritories}
              {#if r.continents.length}<br />Continents at the end: {r.continents.join(', ')}{/if}
              {#if r.knockouts}<br />Players eliminated: {r.knockouts}{/if}
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
        {#each ctx.players as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
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
      <p class="muted small">Nothing yet. Every change and note will show here with its time.</p>
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

<style>
  .risk {
    max-width: 40rem;
    margin: 0 auto;
  }
  .win {
    margin: 0.6rem 0 0;
    padding: 0.6rem;
    border: 1px solid var(--good);
    border-radius: var(--radius);
    color: var(--good);
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

  /* chips, steppers */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .chip.out {
    opacity: 0.5;
  }
  .stepper {
    display: flex;
    gap: 0.3rem;
    align-items: stretch;
  }
  .stepper button {
    flex: 0 0 auto;
    min-width: 2.9rem;
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
    grid-template-columns: 5.6rem 1fr;
    gap: 0.4rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
  }
  .log li.note-entry span:last-child {
    font-weight: 600;
  }
</style>
