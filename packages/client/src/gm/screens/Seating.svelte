<script lang="ts">
  import { onDestroy } from 'svelte';
  import { gameClockShort, gameTag } from '@shared/gameTime';
  import { del, patch, post } from '@shared/api';
  import { run } from '@shared/ui';
  import type { GmState, SeatingTable, WhoAmI } from '@shared/types';
  import FloorPlan from '@shared/FloorPlan.svelte';
  import PropSprite from '@shared/PropSprite.svelte';
  import { PROP_KINDS, TABLE_COLORS, propKind } from '@gn/engine';
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
  const moveSeat = (id: number, seatPos: number[]) => run(() => patch(`/api/tables/${id}`, { seatPos }));
  /** Turn a table in 15° steps (the server keeps it in 0–345). */
  const paint = (t: SeatingTable, color: string | null) => run(() => patch(`/api/tables/${t.id}`, { color }));
  const turn = (t: SeatingTable, by: number) => run(() => patch(`/api/tables/${t.id}`, { rotation: (t.rotation ?? 0) + by }));
  const seatPlayer = (tableId: number, seat: number, playerId: number | null) => run(() => post(`/api/tables/${tableId}/seat`, { seat, playerId }));

  let selected = $state<number | null>(null);
  const sel = $derived(tables.find((t) => t.id === selected) ?? null);
  // Table props: pick one on the plan to move/resize it there; add, turn and remove here.
  let selProp = $state<number | null>(null);
  const prop = $derived(sel?.props?.find((p) => p.id === selProp) ?? null);
  const PROP_GROUPS = [
    { id: 'board', label: 'Boards' },
    { id: 'pieces', label: 'Pieces' },
    { id: 'drinks', label: 'Drinks' },
    { id: 'smoke', label: 'Smoke' },
  ] as const;
  async function addProp(kind: string) {
    if (!sel) return;
    const r = await run(() => post<{ id: number }>(`/api/tables/${sel.id}/props`, { kind }));
    if (r) selProp = r.id;
  }
  const saveProp = (id: number, g: Record<string, unknown>) => run(() => patch(`/api/props/${id}`, g));
  const removeProp = async (id: number) => {
    if (await run(() => del(`/api/props/${id}`))) selProp = null;
  };

  // A running game whose players aren't all sitting at its table: show it, and offer to seat them when the table
  // has enough empty seats (players seated elsewhere move over). Never forced.
  const problems = $derived(
    (gs?.games ?? [])
      .filter((g) => g.status === 'active' && g.tableId != null)
      .flatMap((g) => {
        const t = tables.find((x) => x.id === g.tableId);
        if (!t) return [];
        const here = new Set(t.assignments.map((a) => a.playerId));
        const missing = g.participants.map((p) => p.playerId).filter((id) => !here.has(id) && !gs?.players.find((p) => p.id === id)?.left);
        if (!missing.length) return [];
        const free = Array.from({ length: t.seats }, (_, i) => i + 1).filter((s) => !t.assignments.some((a) => a.seat === s));
        const where = (id: number) => tables.find((x) => x.assignments.some((a) => a.playerId === id))?.name ?? null;
        return [{ game: g, table: t, missing: missing.map((id) => ({ id, at: where(id) })), free }];
      }),
  );
  const problemKey = $derived(problems.map((p) => `${p.game.id}:${p.missing.map((m) => m.id).join(',')}`).join('|'));
  let dismissed = $state('');
  async function seatThem(p: (typeof problems)[number]) {
    for (const [i, m] of p.missing.entries()) {
      const ok = await run(() => post(`/api/tables/${p.table.id}/seat`, { seat: p.free[i], playerId: m.id }));
      if (ok === undefined) return;
    }
    selected = p.table.id;
  }
  let newName = $state('');
  let newSeats = $state(4);
  const seatOf = (t: SeatingTable, n: number) => t.assignments.find((a) => a.seat === n)?.playerId ?? null;
  /** Add or remove a seat on an existing table. Removing takes the highest-numbered seat. Anything that would be lost (a seated player, hand-placed seats) is confirmed first. */
  function setSeats(t: SeatingTable, to: number) {
    if (!Number.isInteger(to) || to < 2 || to > 8 || to === t.seats) return;
    const out = t.assignments.filter((a) => a.seat > to);
    const loses: string[] = [];
    if (out.length) loses.push(`unseat ${out.map((a) => playerName(gs, a.playerId)).join(', ')}`);
    if (t.seatPos) loses.push('put the seats you moved back to even spacing');
    if (loses.length && !confirm(`${to < t.seats ? `Removing seat ${t.seats}` : 'Adding a seat'} will ${loses.join(' and ')}. Go ahead?`)) return;
    return run(() => patch(`/api/tables/${t.id}`, { seats: to }));
  }
  /** Blank, unchanged or refused names put the old name back in the box instead of leaving the wrong text there. */
  async function rename(t: SeatingTable, input: HTMLInputElement) {
    const name = input.value.trim();
    if (!name || name === t.name) {
      input.value = t.name;
      return;
    }
    if ((await run(() => patch(`/api/tables/${t.id}`, { name }), 'Renamed')) === undefined) input.value = t.name;
  }
  function deleteTableAsk(t: SeatingTable) {
    const games = (gs?.games ?? []).filter((g) => g.tableId === t.id).length;
    const bits = [t.assignments.length ? `${t.assignments.length} seated player${t.assignments.length > 1 ? 's' : ''} will be unseated` : '', games ? `${games} linked game${games > 1 ? 's' : ''} will lose their table` : ''].filter(Boolean);
    if (!confirm(`Delete ${t.name}?${bits.length ? ` ${bits.join(' and ')}.` : ''}`)) return;
    return run(() => del(`/api/tables/${t.id}`), 'Deleted').then(() => (selected = null));
  }
  const assign = (t: SeatingTable, seat: number, playerId: string) => run(() => post(`/api/tables/${t.id}/seat`, { seat, playerId: playerId === '' ? null : Number(playerId) }));
</script>

{#if problems.length && problemKey !== dismissed}
  <section class="panel seat-warn" role="alert">
    <h3>Seating doesn't match a running game</h3>
    {#each problems as p (p.game.id)}
      <div class="seat-prob">
        <p>
          <b>{p.game.name}</b> is running at <b>{p.table.name}</b>, but
          {#each p.missing as m, i (m.id)}{i ? (i === p.missing.length - 1 ? ' and ' : ', ') : ' '}<b>{playerName(gs, m.id)}</b> <span class="muted">({m.at ? `at ${m.at}` : 'not seated'})</span>{/each}
          {p.missing.length === 1 ? "isn't" : "aren't"} sitting there.
        </p>
        <div class="row">
          <button onclick={() => (selected = p.table.id)}>Show {p.table.name}</button>
          {#if master && p.free.length >= p.missing.length}
            <button class="primary" onclick={() => seatThem(p)}>Seat {p.missing.length === 1 ? 'them' : 'them all'} at {p.table.name}</button>
          {:else if master}
            <span class="small muted">{p.table.name} has {p.free.length} free seat{p.free.length === 1 ? '' : 's'}: move people by hand.</span>
          {/if}
        </div>
      </div>
    {/each}
    <button class="small" onclick={() => (dismissed = problemKey)}>Seating is right, dismiss</button>
  </section>
{/if}

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
      ? 'Drag a table to move it. Select it, then drag the gold handles to resize (right edge = length, bottom edge = width, corner = both); drag the round ⟳ knob to turn it in 15° steps. Drag players onto seats; dropping on an occupied seat swaps. Drag an empty seat to move it around its table. Only GMs and the TV see this.'
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
    onseatpos={moveSeat}
    selectedPropId={selProp}
    onselectprop={(tid, pid) => ((selected = tid), (selProp = pid))}
    onprop={(id, g) => saveProp(id, g)}
    onrotate={(id, deg) => run(() => patch(`/api/tables/${id}`, { rotation: deg }))}
  />
</section>

{#if sel}
  <section class="panel">
    <div class="spread">
      {#if master}
        <label class="field" style="margin:0"><span class="small muted">Table name</span>
          <input value={sel.name} maxlength="40" style="width:200px" onchange={(e) => rename(sel, e.currentTarget as HTMLInputElement)} onkeydown={(e) => { if (e.key === 'Escape') { (e.currentTarget as HTMLInputElement).value = sel.name; (e.currentTarget as HTMLInputElement).blur(); } }} />
        </label>
      {:else}
        <h2>{sel.name}</h2>
      {/if}
      {#if master}
        <span class="row">
          <span class="small muted">Seats</span>
          <button aria-label="Remove a seat" disabled={sel.seats <= 2} onclick={() => setSeats(sel, sel.seats - 1)}>−</button>
          <b aria-live="polite">{sel.seats}</b>
          <button aria-label="Add a seat" disabled={sel.seats >= 8} onclick={() => setSeats(sel, sel.seats + 1)}>+</button>
          {#if sel.seatPos}<button onclick={() => run(() => patch(`/api/tables/${sel.id}`, { seatPos: null }), 'Seats evened out')}>Even out seats</button>{/if}
          <span class="small muted">Turn</span>
          <button aria-label="Turn left 15°" onclick={() => turn(sel, -15)}>⟲</button>
          <b class="mono" aria-live="polite">{sel.rotation ?? 0}°</b>
          <button aria-label="Turn right 15°" onclick={() => turn(sel, 15)}>⟳</button>
          <button class="danger" onclick={() => deleteTableAsk(sel)}>Delete</button>
        </span>
        <span class="row colors" role="group" aria-label="Table colour">
          <span class="small muted">Colour</span>
          <button class="sw none" class:on={!sel.color} title="Theme colour" aria-label="Theme colour" onclick={() => paint(sel, null)}>✕</button>
          {#each TABLE_COLORS as c (c.id)}
            <button class="sw" class:on={sel.color === c.id} style="background:{c.id}" title={c.label} aria-label={c.label} onclick={() => paint(sel, c.id)}></button>
          {/each}
          <label class="sw custom" title="Any colour"><input type="color" aria-label="Any colour" value={sel.color ?? '#1f6b3a'} onchange={(e) => paint(sel, (e.currentTarget as HTMLInputElement).value)} /></label>
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
  {#if master}
    <section class="panel">
      <h3>Props on {sel.name}</h3>
      <p class="small muted">Tap one to put it on the table, then drag it there; the round handle resizes it. A table with props can't be resized.</p>
      {#if prop}
        {@const k = propKind(prop.kind)}
        <div class="row prop-sel">
          <b>{k?.label ?? prop.kind}</b>{#if prop.gameId}<span class="small muted">(placed by the running game)</span>{/if}
          <button aria-label="Turn left 15°" onclick={() => saveProp(prop.id, { rotation: prop.rotation - 15 })}>⟲</button>
          <b class="mono">{prop.rotation}°</b>
          <button aria-label="Turn right 15°" onclick={() => saveProp(prop.id, { rotation: prop.rotation + 15 })}>⟳</button>
          <button aria-label="Smaller" onclick={() => saveProp(prop.id, { w: prop.w / 1.2 })}>−</button>
          <button aria-label="Bigger" onclick={() => saveProp(prop.id, { w: prop.w * 1.2 })}>+</button>
          <button class="danger" onclick={() => removeProp(prop.id)}>Remove</button>
          <button onclick={() => (selProp = null)}>Done</button>
        </div>
      {/if}
      {#each PROP_GROUPS as g (g.id)}
        <div class="small muted">{g.label}</div>
        <div class="palette">
          {#each PROP_KINDS.filter((k) => k.group === g.id) as k (k.id)}
            <button class="pal" title={k.label} aria-label="Add {k.label}" onclick={() => addProp(k.id)}><span class="pic"><PropSprite kind={k.id} /></span><span class="small">{k.label}</span></button>
          {/each}
        </div>
      {/each}
    </section>
  {/if}
{/if}
{#if master && tables.length}
  <div class="actions"><button onclick={() => confirm('Clear every seat?') && run(() => post('/api/seats/clear'), 'Seats cleared')}>Clear all seats</button></div>
{/if}

<style>
  .palette {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0.2rem 0 0.6rem;
  }
  .pal {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    width: 5.6rem;
    padding: 0.4rem 0.3rem;
    min-height: 0;
  }
  .pal .pic {
    width: 3.2rem;
    height: 2.4rem;
    display: block;
  }
  .prop-sel {
    margin: 0.3rem 0 0.7rem;
    flex-wrap: wrap;
  }
  .seat-warn {
    border-color: var(--warn);
  }
  .seat-prob {
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--line);
  }
  .colors {
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.4rem;
  }
  .sw {
    width: 32px;
    height: 32px;
    min-width: 32px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid var(--line);
  }
  .sw.on {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .sw.none {
    font-size: 0.8rem;
  }
  .sw.custom {
    position: relative;
    overflow: hidden;
    background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
    cursor: pointer;
  }
  .sw.custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
</style>
