<script lang="ts">
  /**
   * Catan board: the GM's control panel and live tracker. Pick a player (at the table or in the list), enter their
   * settlements and cities with big steppers, tap who holds Longest Road / Largest Army, keep a timestamped history
   * with typed notes. The board adds up the public victory points and shows where they come from.
   * All rules live in ./def.ts; this file only draws and calls those operations.
   */
  import Avatar from '../../../shared/Avatar.svelte';
  import type { BoardPlayer, BoardProps } from '../contract';
  import {
    AWARDS,
    NOTE_MAX,
    addNote,
    breakdown,
    canUpgrade,
    cfg,
    describeEntry,
    holder,
    ordinal,
    pl,
    recap,
    recordReroll,
    setAward,
    setCities,
    setSettlements,
    status,
    upgradeToCity,
    type Breakdown,
    type CatanState,
  } from './def';

  let { ctx, state: game, onchange, onfinish }: BoardProps<CatanState> = $props();

  let picked = $state<number | null>(null);
  let noteText = $state('');
  let noteAbout = $state('');
  let showAll = $state(false);
  let showRecap = $state(false);
  let busy = $state<Record<number, boolean>>({});
  let rerollFailed = $state<Record<number, boolean>>({});
  /** Board width: wide (laptop) shows every player's panel at once in a scrolling right column. */
  let RW = $state(0);
  const wide = $derived(RW >= 900);
  let W = $state(0);

  /** Only pass on a genuinely new state (the host may also dedupe, but this keeps double taps quiet). */
  const apply = (next: CatanState) => {
    if (next !== game) onchange(next);
  };
  const now = () => Date.now();
  const nameOf = (id: number) => ctx.players.find((p) => p.id === id)?.name ?? 'Another player';
  const first = (n: string) => n.split(/\s+/)[0] ?? n;

  // ---- derived
  const sel = $derived(picked !== null && ctx.players.some((p) => p.id === picked) ? picked : (ctx.players[0]?.id ?? null));
  const selPlayer = $derived(ctx.players.find((p) => p.id === sel) ?? null);
  const stat = $derived(status(game, ctx));
  const standings = $derived(recap(game, ctx));
  const maxS = $derived(cfg(ctx.settings, 'maxSettlements'));
  const maxC = $derived(cfg(ctx.settings, 'maxCities'));
  const leftOf = (id: number) => ctx.rerollsLeft[id] ?? 0;
  const entries = $derived([...game.log].reverse());
  const shownEntries = $derived(showAll ? entries : entries.slice(0, 30));
  /** The crown is shown only when exactly one player leads (everyone level at the start means no crown). */
  const crownId = $derived(stat.leaders.length === 1 ? stat.leaders[0]! : null);
  const holderName = (key: 'longestRoad' | 'largestArmy') => {
    const id = holder(game, ctx, key);
    return id === null ? 'nobody' : nameOf(id);
  };

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

  // ---- table drawing (seats spaced evenly along the table edge, clockwise from the top-left, seat 1 first)
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  function seatPoints(seats: number, tw: number, th: number, icon: number, gap = 3): { seat: number; x: number; y: number }[] {
    const per = 2 * (tw + th);
    const out: { seat: number; x: number; y: number }[] = [];
    const off = icon / 2 + gap;
    for (let i = 0; i < seats; i++) {
      const d = ((i + 0.5) * per) / seats;
      let x: number, y: number;
      if (d < tw) {
        x = -tw / 2 + d;
        y = -th / 2 - off;
      } else if (d < tw + th) {
        x = tw / 2 + off;
        y = -th / 2 + (d - tw);
      } else if (d < 2 * tw + th) {
        x = tw / 2 - (d - tw - th);
        y = th / 2 + off;
      } else {
        x = -tw / 2 - off;
        y = th / 2 - (d - 2 * tw - th);
      }
      out.push({ seat: i + 1, x, y });
    }
    return out;
  }
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
    rerollFailed = {};
    if (wide) document.getElementById(`catan-p-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

  const submitNote = () => {
    if (!noteText.trim()) return;
    apply(addNote(game, ctx, noteText, noteAbout === '' ? null : Number(noteAbout), now()));
    noteText = '';
  };

  /** "Settlements 2 + Cities 4 + Longest Road 2 = 8": where the points come from (awards only when held). */
  const sumText = (b: Breakdown) => {
    const parts = [`Settlements ${b.settlementPts}`, `Cities ${b.cityPts}`];
    if (b.longestRoad) parts.push(`Longest Road ${b.longestRoad}`);
    if (b.largestArmy) parts.push(`Largest Army ${b.largestArmy}`);
    return `${parts.join(' + ')} = ${b.total}`;
  };
  /** The awards a player holds, for the badges on their seat and the spoken label. */
  const heldAwards = (id: number) => AWARDS.filter((a) => holder(game, ctx, a.key) === id);

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

{#snippet playerPanel(p: BoardPlayer)}
  {@const d = pl(game, ctx, p.id)}
  {@const b = breakdown(game, ctx, p.id)}
    <section class="panel pp" class:cur={p.id === sel} id={`catan-p-${p.id}`}>
      <div class="spread">
        <div class="row">
          <Avatar name={p.name} color={p.color} src={p.avatarPath} size={36} />
          <h2>{p.name}{crownId === p.id ? ' ♛' : ''}</h2>
        </div>
        <span class="badge" class:live={crownId === p.id}>{b.total} {b.total === 1 ? 'point' : 'points'}</span>
      </div>
      <p class="small muted">{sumText(b)}</p>

      {@render stepper(`Settlements (up to ${maxS})`, d.settlements, [1], (v) => apply(setSettlements(game, ctx, p.id, v, now())))}
      {@render stepper(`Cities (up to ${maxC})`, d.cities, [1], (v) => apply(setCities(game, ctx, p.id, v, now())))}
      <button class="big" disabled={!canUpgrade(game, ctx, p.id)} onclick={() => apply(upgradeToCity(game, ctx, p.id, now()))}>Upgrade a settlement to a city</button>

      <div class="field">
        <span class="small muted">Awards (tap to give it to {first(p.name)}; tap again to take it away)</span>
        <div class="row">
          {#each AWARDS as aw (aw.key)}
            {@const held = holder(game, ctx, aw.key) === p.id}
            <button class="chip" class:on={held} aria-pressed={held} onclick={() => apply(setAward(game, ctx, aw.key, held ? null : p.id, now()))}>
              {aw.label} +{cfg(ctx.settings, aw.setting)}
            </button>
          {/each}
        </div>
      </div>

      {#if ctx.rerollsAllowed}
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

<div class="catanhost" bind:clientWidth={RW}>
<div class="catan" class:wide>
<div class="left">
  <section class="panel">
    <div class="spread">
      <h2>Catan</h2>
      <div class="row">
        <span class="badge">First to {stat.target} points</span>
        {#if !stat.reached}
          <button onclick={() => (showRecap = !showRecap)}>{showRecap ? 'Hide recap' : 'Recap'}</button>
        {/if}
      </div>
    </div>
    <p class="small">
      Longest Road: <strong>{holderName('longestRoad')}</strong> · Largest Army: <strong>{holderName('largestArmy')}</strong>
    </p>
    {#if stat.reached}
      <p class="win">
        <strong>{stat.winners.map(nameOf).join(' and ')} {stat.winners.length === 1 ? 'has' : 'have'} reached {stat.target} points.</strong>
        Tap Game over to finish; the places are filled in for you.
      </p>
    {/if}
    {#if onfinish}
      <button class="big" class:primary={stat.reached} onclick={() => onfinish?.()}>{stat.reached ? 'Game over' : 'End game early'}</button>
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
              {@const pts = breakdown(game, ctx, pp.id).total}
              {@const held = heldAwards(pp.id)}
              <button
                class="seat"
                class:sel={pp.id === sel}
                style="left:{W / 2 + sp.x}px;top:{H / 2 + sp.y}px;width:{S}px;height:{S}px"
                onclick={() => pick(pp.id)}
                aria-label={`${pp.name}, ${pts} points${held.map((a) => `, ${a.label}`).join('')}`}
              >
                <Avatar name={pp.name} color={pp.color} src={pp.avatarPath} size={S} />
                {#if held.length}
                  <span class="aws" aria-hidden="true">{#each held as a (a.key)}<b>{a.short}</b>{/each}</span>
                {/if}
                <span class="lbl" class:above={top} style="font-size:{FS}px;max-width:{Math.round(S * 1.8)}px">
                  <b>{first(pp.name)}{crownId === pp.id ? ' ♛' : ''}</b>
                  <i>{pts} pts</i>
                </span>
              </button>
            {:else}
              <div class="seat empty" style="left:{W / 2 + sp.x}px;top:{H / 2 + sp.y}px;width:{S}px;height:{S}px"></div>
            {/if}
          {/each}
        {/if}
      </div>
      <p class="small muted">Beside each name: points. Badge on a seat: LR = Longest Road, LA = Largest Army.</p>
    </section>
  {/if}

  {#if seating.rest.length}
    <section class="panel">
      {#if ctx.table}<p class="small muted">Not at the table</p>{/if}
      <div class="row">
        {#each seating.rest as p (p.id)}
          <button class="chip" class:on={p.id === sel} onclick={() => pick(p.id)}>
            <Avatar name={p.name} color={p.color} src={p.avatarPath} size={24} />
            {first(p.name)} · {breakdown(game, ctx, p.id).total}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if !wide && selPlayer}{@render playerPanel(selPlayer)}{/if}

  <section class="panel">
    <h3>Standings if the game ended now</h3>
    <div class="scroll-x">
      <table>
        <thead>
          <tr><th>Place</th><th>Player</th><th class="num">Points</th><th class="num">Settl.</th><th class="num">Cities</th><th class="num">Road</th><th class="num">Army</th></tr>
        </thead>
        <tbody>
          {#each standings as r (r.playerId)}
            <tr>
              <td class="mono">{ordinal(r.place)}{r.tied ? '=' : ''}</td>
              <td><button class="link" onclick={() => pick(r.playerId)}>{r.name}</button></td>
              <td class="num mono"><strong>{r.points}</strong></td>
              <td class="num mono">{r.settlements}</td>
              <td class="num mono">{r.cities}</td>
              <td class="num mono">{r.awards.includes('Longest Road') ? '✓' : '–'}</td>
              <td class="num mono">{r.awards.includes('Largest Army') ? '✓' : '–'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  {#if showRecap || stat.reached}
    <section class="panel">
      <h3>Board recap (public points)</h3>
      <p class="small muted">The places are decided on the result screen. Hidden victory-point cards are not counted here.</p>
      <div class="grid2">
        {#each standings as r (r.playerId)}
          <div class="card">
            <div class="spread"><strong>{r.name}</strong><span class="badge">{r.points} {r.points === 1 ? 'point' : 'points'}</span></div>
            <p class="small">{r.settlements} {r.settlements === 1 ? 'settlement' : 'settlements'}, {r.cities} {r.cities === 1 ? 'city' : 'cities'}{r.awards.length ? `, ${r.awards.join(' and ')}` : ''}.</p>
            <p class="small muted">
              {#each r.lost as l (l.label)}Held {l.label}, then {l.to ? `${l.to} took it` : 'it was released'}.<br />{/each}
              {#if r.rerollsUsed}Re-rolls used: {r.rerollsUsed}{/if}
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
      <p class="muted small">Nothing yet. Every change, award transfer and note will show here with its time.</p>
    {:else}
      <ul class="log">
        {#each shownEntries as e (e.id)}
          <li class:note-entry={e.kind === 'note'}>
            <span class="mono muted small" style="white-space:nowrap">{time(e.t)}</span>
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
    {#each ctx.players as p (p.id)}{@render playerPanel(p)}{/each}
  </div>
{/if}
</div>
</div>

<style>
  .catan {
    max-width: 40rem;
    margin: 0 auto;
  }
  .catan.wide {
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
  /* LR / LA badges sit on the lower edge of the avatar, so they can never be clipped like label text. */
  .aws {
    position: absolute;
    left: 50%;
    bottom: -1px;
    transform: translateX(-50%);
    display: flex;
    gap: 1px;
    line-height: 1;
    pointer-events: none;
  }
  .aws b {
    font: 700 9px/1 var(--font);
    padding: 2px 3px;
    border-radius: 5px;
    background: var(--accent);
    color: var(--accent-ink);
    border: 1px solid var(--panel);
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
    min-height: 44px;
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
  button.link {
    border: 0;
    background: none;
    padding: 0.3rem 0;
    min-height: 40px;
    text-decoration: underline;
    text-align: left;
  }
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.5rem;
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
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }
  .note select {
    grid-column: 1 / -1;
    min-height: 44px;
    min-width: 0;
    max-width: 100%;
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
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.4rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
  }
  .log li.note-entry span:last-child {
    font-weight: 600;
  }
</style>
