<script lang="ts">
  import { del, patch, post } from '@shared/api';
  import { run } from '@shared/ui';
  import type { GmState, SeatingTable, WhoAmI } from '@shared/types';
  import { activePlayers, playerName } from '../lib';

  let { gs, whoami }: { gs: GmState | null; whoami: WhoAmI } = $props();
  const master = $derived(whoami.role === 'master');
  const tables = $derived(gs?.gm?.seating ?? []);
  const seated = $derived(new Set(tables.flatMap((t) => t.assignments.map((a) => a.playerId))));
  const unseated = $derived(activePlayers(gs).filter((p) => !seated.has(p.id)));
  const gameName = (id: number | null) => (id == null ? '' : (gs?.games.find((g) => g.id === id)?.name ?? ''));

  // Drag tables around the floor plan (positions saved as 0–1 fractions).
  let plan = $state<HTMLDivElement | null>(null);
  let drag = $state<{ id: number; x: number; y: number } | null>(null);
  function down(e: PointerEvent, t: SeatingTable) {
    if (!master) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id: t.id, x: t.x, y: t.y };
  }
  function move(e: PointerEvent) {
    if (!drag || !plan) return;
    const r = plan.getBoundingClientRect();
    drag = { ...drag, x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }
  async function up() {
    if (!drag) return;
    const d = drag;
    await run(() => patch(`/api/tables/${d.id}`, { x: d.x, y: d.y }));
    drag = null;
  }
  const pos = (t: SeatingTable) => (drag?.id === t.id ? drag : t);

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
        <input type="number" min="1" max="20" bind:value={newSeats} style="width:70px" title="Seats" />
        <button class="primary" type="submit" disabled={!gs?.night}>Add table</button>
      </form>
    {/if}
  </div>
  <p class="small muted">Drag tables to match the room. Click a table to assign seats. Only GMs and the TV see this.</p>
  <div class="plan" bind:this={plan} onpointermove={move} onpointerup={up} role="application">
    {#each tables as t (t.id)}
      {@const p = pos(t)}
      <button
        class="tbl"
        class:on={selected === t.id}
        style="left:{p.x * 100}%;top:{p.y * 100}%"
        onpointerdown={(e) => down(e, t)}
        onclick={() => (selected = t.id)}
      >
        <strong>{t.name}</strong>
        <span class="small muted">{t.assignments.length}/{t.seats}{t.gameId ? ` · ${gameName(t.gameId)}` : ''}</span>
      </button>
    {/each}
    {#if !tables.length}<p class="muted center">No tables yet.</p>{/if}
  </div>
  {#if unseated.length}<p class="small muted">Unseated: {unseated.map((p) => p.displayName).join(', ')}</p>{/if}
</section>

{#if sel}
  <section class="panel">
    <div class="spread">
      <h2>{sel.name}</h2>
      {#if master}
        <span class="row">
          <input type="number" min="1" max="20" value={sel.seats} style="width:70px" onchange={(e) => run(() => patch(`/api/tables/${sel.id}`, { seats: Number((e.currentTarget as HTMLInputElement).value) }))} />
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

<style>
  .plan {
    position: relative;
    height: 420px;
    border: 1px dashed var(--line);
    border-radius: 8px;
    margin-top: 0.5rem;
    touch-action: none;
    overflow: hidden;
  }
  .tbl {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 96px;
    padding: 0.5rem;
    cursor: grab;
  }
  .tbl.on {
    outline: 2px solid var(--accent);
  }
  .center {
    text-align: center;
    margin-top: 180px;
  }
</style>
