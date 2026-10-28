<script lang="ts">
  import { onDestroy } from 'svelte';
  import { gameClockShort, gameTag } from '@shared/gameTime';
  import { del, patch, post } from '@shared/api';
  import { run } from '@shared/ui';
  import type { GmState, SeatingTable, WhoAmI } from '@shared/types';
  import FloorPlan from '@shared/FloorPlan.svelte';
  import { activePlayers, playerName } from '../lib';

  let { gs, whoami }: { gs: GmState | null; whoami: WhoAmI } = $props();
  const master = $derived(whoami.role === 'master');
  const tables = $derived(gs?.gm?.seating ?? []);
  const seated = $derived(new Set(tables.flatMap((t) => t.assignments.map((a) => a.playerId))));
  let now = $state(Date.now());
  const tick = setInterval(() => (now = Date.now()), 15_000);
  onDestroy(() => clearInterval(tick));
  /** Table label: its game plus when it started (and for how long) or when it's due. */
  const gameName = (id: number | null) => {
    const g = id == null ? null : (gs?.games.find((x) => x.id === id) ?? null);
    if (!g) return '';
    const c = gameClockShort(g, now);
    const tag = gameTag(g, now);
    return [g.name, c, tag === 'filibuster' ? 'Filibuster' : tag === 'tardy' ? 'Tardy' : ''].filter(Boolean).join(' · ');
  };

  const moveTable = (id: number, x: number, y: number) => run(() => patch(`/api/tables/${id}`, { x, y }));
  const resizeTable = (id: number, g: { x: number; y: number; w: number; h: number }) => run(() => patch(`/api/tables/${id}`, g));
  const seatPlayer = (tableId: number, seat: number, playerId: number | null) => run(() => post(`/api/tables/${tableId}/seat`, { seat, playerId }));

  let selected = $state<number | null>(null);
  const sel = $derived(tables.find((t) => t.id === selected) ?? null);
  let newName = $state('');
  let newSeats = $state(4);
  const seatOf = (t: SeatingTable, n: number) => t.assignments.find((a) => a.seat === n)?.playerId ?? null;
  const assign = (t: SeatingTable, seat: number, playerId: string) => run(() => post(`/api/tables/${t.id}/seat`, { seat, playerId: playerId === '' ? null : Number(playerId) }));
</script>

<section class="panel">
  <div class="spread">
    <h2>Seating</h2>
    {#if master}
      <form class="row" onsubmit={(e) => (e.preventDefault(), run(() => post('/api/tables', { name: newName || undefined, seats: Number(newSeats) }), 'Table added').then(() => (newName = '')))}>
        <input placeholder="Table name" bind:value={newName} style="width:140px" />
        <input type="number" min="2" max="8" bind:value={newSeats} style="width:70px" title="Seats" />
        <button class="primary" type="submit" disabled={!gs?.night}>Add table</button>
      </form>
    {/if}
  </div>
  <p class="small muted">
    {master
      ? 'Drag a table to move it. Select it, then drag the gold handles to resize (right edge = length, bottom edge = width, corner = both). Drag players onto seats; dropping on an occupied seat swaps. Only GMs and the TV see this.'
      : 'Click a table to see its seats. Only GMs and the TV see this.'}
  </p>
  <FloorPlan
    tables={tables}
    players={gs?.players ?? []}
    editable={master}
    tray
    selectedId={selected}
    gameName={gameName}
    onselect={(id) => (selected = id)}
    onmove={moveTable}
    onresize={resizeTable}
    onseat={seatPlayer}
  />
</section>

{#if sel}
  <section class="panel">
    <div class="spread">
      <h2>{sel.name}</h2>
      {#if master}
        <span class="row">
          <input type="number" min="2" max="8" value={sel.seats} style="width:70px" onchange={(e) => run(() => patch(`/api/tables/${sel.id}`, { seats: Number((e.currentTarget as HTMLInputElement).value) }))} />
          <button class="danger" onclick={() => confirm(`Delete ${sel.name}?`) && run(() => del(`/api/tables/${sel.id}`), 'Deleted').then(() => (selected = null))}>Delete</button>
        </span>
      {/if}
    </div>
    <div class="grid2">
      {#each Array.from({ length: sel.seats }, (_, i) => i + 1) as n (n)}
        <label class="field"><span>Seat {n}</span>
          <select disabled={!master} value={String(seatOf(sel, n) ?? '')} onchange={(e) => assign(sel, n, (e.currentTarget as HTMLSelectElement).value)}>
            <option value="">— empty —</option>
            {#each activePlayers(gs) as p (p.id)}<option value={String(p.id)}>{p.displayName}{seated.has(p.id) && seatOf(sel, n) !== p.id ? ' (moves)' : ''}</option>{/each}
          </select>
        </label>
      {/each}
    </div>
    <p class="small muted">Seated: {sel.assignments.map((a) => `${a.seat}. ${playerName(gs, a.playerId)}`).join(' · ') || 'nobody'}</p>
  </section>
{/if}
{#if master && tables.length}
  <div class="actions"><button onclick={() => confirm('Clear every seat?') && run(() => post('/api/seats/clear'), 'Seats cleared')}>Clear all seats</button></div>
{/if}
