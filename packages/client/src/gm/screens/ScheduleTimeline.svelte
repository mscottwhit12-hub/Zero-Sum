<script lang="ts">
  /**
   * Graphical schedule: time runs left to right, each game is a block as wide as its planned length.
   * Rows = tables (drag a block to another row to move its table) or players (who plays when; overlaps show red).
   * Master: drag a scheduled block to move it (5-minute steps, never into the past), drag its right edge to change
   * its length, or drag a game from "Not on the clock" onto the timeline. Started and finished games don't move.
   */
  import { onDestroy } from 'svelte';
  import { patch } from '@shared/api';
  import { timeOfDay } from '@shared/format';
  import { gameTag, plannedEnd } from '@shared/gameTime';
  import { nightNow } from '@shared/socket';
  import { run } from '@shared/ui';
  import type { GameInfo, GmState } from '@shared/types';
  import { playerName } from '../lib';

  let { gs, editable }: { gs: GmState | null; editable: boolean } = $props();

  let view = $state<'tables' | 'players'>('tables');
  let now = $state(Date.now());
  const tick = setInterval(() => (now = Date.now()), 30_000);
  onDestroy(() => clearInterval(tick));

  const SNAP = 5 * 60_000;
  const ROW_H = 40;
  const LABEL_W = 110;
  const snap = (t: number) => Math.round(t / SNAP) * SNAP;
  const games = $derived((gs?.games ?? []).filter((g) => g.status !== 'cancelled'));
  const unplaced = $derived(games.filter((g) => g.status === 'scheduled' && g.plannedStart == null));

  // Time range: night start (or now) to the later of the planned night end and the last game.
  const night = $derived(gs?.night ?? null);
  const nightStart = $derived(night && night.status !== 'setup' && night.status !== 'joins_open' ? now - nightNow(night, now) : now);
  const range = $derived.by(() => {
    let a = Math.min(nightStart, now) - 15 * 60_000;
    let b = Math.max(nightStart + (night?.lengthMinutes ?? 240) * 60_000, now + 60 * 60_000);
    for (const g of games) {
      const s0 = g.startedAt ?? g.plannedStart;
      if (s0 == null) continue;
      a = Math.min(a, s0);
      b = Math.max(b, (g.status === 'final' ? g.endedAt : plannedEnd(g)) ?? s0 + 3_600_000, g.status === 'active' ? now : 0);
    }
    return { a: Math.floor(a / (30 * 60_000)) * 30 * 60_000, b: Math.ceil(b / (30 * 60_000)) * 30 * 60_000 };
  });
  let W = $state(800);
  const pxPerMin = $derived(Math.max(2, (W - LABEL_W) / ((range.b - range.a) / 60_000)));
  const x = (t: number) => ((t - range.a) / 60_000) * pxPerMin;
  const innerW = $derived(x(range.b));
  const ticks = $derived.by(() => {
    const out: number[] = [];
    for (let t = range.a; t <= range.b; t += 30 * 60_000) out.push(t);
    return out;
  });

  type Row = { key: string; label: string; tableId: number | null; playerId: number | null };
  const rows = $derived.by((): Row[] => {
    if (view === 'tables') {
      const tables = gs?.gm?.seating ?? [];
      return [...tables.map((t) => ({ key: `t${t.id}`, label: t.name, tableId: t.id, playerId: null })), { key: 't-none', label: 'No table', tableId: null, playerId: null }];
    }
    return (gs?.players ?? []).filter((p) => !p.left).map((p) => ({ key: `p${p.id}`, label: p.displayName, tableId: null, playerId: p.id }));
  });

  // Live drag state (local until saved).
  type Live = { id: number; start: number; hours: number; tableId: number | null };
  let live = $state<Live | null>(null);
  const span = (g: GameInfo) => {
    if (live && live.id === g.id) return { s: live.start, e: live.start + live.hours * 3_600_000, tableId: live.tableId };
    const s0 = g.startedAt ?? g.plannedStart ?? now;
    const e0 = g.status === 'final' && g.endedAt ? g.endedAt : (plannedEnd(g) ?? s0 + 3_600_000);
    return { s: s0, e: g.status === 'active' ? Math.max(e0, now) : e0, tableId: g.tableId };
  };
  const inRow = (g: GameInfo, r: Row) => {
    if (r.playerId != null) return g.participants.some((p) => p.playerId === r.playerId);
    return span(g).tableId === r.tableId;
  };
  /**
   * Per row: the games in it, stacked into lanes where they overlap, and which overlaps are clashes
   * (a player in two games at once, or a table hosting two at once; "No table" never clashes).
   */
  const layout = $derived.by(() => {
    const bad = new Set<string>();
    const lane = new Map<string, number>();
    const lanes = new Map<string, number>();
    for (const r of rows) {
      const list = games
        .filter((g) => (g.startedAt ?? g.plannedStart ?? (live?.id === g.id ? 1 : null)) != null && inRow(g, r))
        .map((g) => ({ g, ...span(g) }))
        .sort((a, b) => a.s - b.s);
      const ends: number[] = [];
      for (const it of list) {
        let l = ends.findIndex((e) => e <= it.s);
        if (l < 0) l = ends.push(0) - 1;
        ends[l] = it.e;
        lane.set(`${r.key}:${it.g.id}`, l);
      }
      lanes.set(r.key, Math.max(1, ends.length));
      const clashable = r.playerId != null || r.tableId != null;
      if (clashable)
        for (let i = 0; i < list.length; i++)
          for (let k = i + 1; k < list.length; k++) {
            const A = list[i]!;
            const B = list[k]!;
            if (A.g.status !== 'final' && B.g.status !== 'final' && A.s < B.e && B.s < A.e) {
              bad.add(`${r.key}:${A.g.id}`);
              bad.add(`${r.key}:${B.g.id}`);
            }
          }
    }
    return { bad, lane, lanes };
  });

  let gridEl = $state<HTMLDivElement | null>(null);
  type Op = { kind: 'move' | 'resize' | 'place'; id: number; sx: number; sy: number; start: number; hours: number; moved: boolean };
  let op: Op | null = null;

  function down(e: PointerEvent, g: GameInfo, kind: 'move' | 'resize') {
    if (!editable || g.status !== 'scheduled') return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const sp = span(g);
    op = { kind, id: g.id, sx: e.clientX, sy: e.clientY, start: sp.s, hours: g.plannedDurationHours ?? 1, moved: false };
    live = { id: g.id, start: sp.s, hours: g.plannedDurationHours ?? 1, tableId: g.tableId };
  }
  function downTray(e: PointerEvent, g: GameInfo) {
    if (!editable) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    op = { kind: 'place', id: g.id, sx: e.clientX, sy: e.clientY, start: now, hours: g.plannedDurationHours ?? 1, moved: false };
  }
  function rowAt(clientY: number): Row | null {
    if (!gridEl) return null;
    const r = gridEl.getBoundingClientRect();
    const i = Math.floor((clientY - r.top - 24) / ROW_H);
    return rows[i] ?? null;
  }
  function timeAt(clientX: number) {
    if (!gridEl) return now;
    const r = gridEl.getBoundingClientRect();
    return range.a + ((clientX - r.left - LABEL_W) / pxPerMin) * 60_000;
  }
  function move(e: PointerEvent) {
    if (!op) return;
    if (Math.hypot(e.clientX - op.sx, e.clientY - op.sy) > 4) op.moved = true;
    if (!op.moved) return;
    const g = games.find((x) => x.id === op!.id);
    if (!g) return;
    if (op.kind === 'resize') {
      const end = snap(op.start + op.hours * 3_600_000 + ((e.clientX - op.sx) / pxPerMin) * 60_000);
      const hours = Math.min(8, Math.max(0.25, (end - op.start) / 3_600_000));
      live = { id: g.id, start: op.start, hours, tableId: live?.tableId ?? g.tableId };
    } else {
      const base = op.kind === 'place' ? timeAt(e.clientX) : op.start + ((e.clientX - op.sx) / pxPerMin) * 60_000;
      const start = Math.max(snap(now + SNAP / 2), snap(base));
      const row = view === 'tables' ? rowAt(e.clientY) : null;
      live = { id: g.id, start, hours: op.hours, tableId: row ? row.tableId : (live?.tableId ?? g.tableId) };
    }
  }
  async function up() {
    if (!op) return;
    const o = op;
    op = null;
    const l = live;
    if (!o.moved || !l) {
      live = null;
      return;
    }
    const body: Record<string, unknown> = { plannedStart: l.start, plannedDurationHours: Math.round(l.hours * 100) / 100 };
    if (view === 'tables') body.tableId = l.tableId;
    await run(() => patch(`/api/games/${l.id}`, body));
    setTimeout(() => (live = null), 300);
  }
  const hm = (t: number) => timeOfDay(t);
</script>

<section class="panel">
  <div class="spread">
    <h2>Schedule</h2>
    <div class="row">
      <button class:primary={view === 'tables'} onclick={() => (view = 'tables')}>By table</button>
      <button class:primary={view === 'players'} onclick={() => (view = 'players')}>By player</button>
    </div>
  </div>
  {#if editable}<p class="small muted">Drag a scheduled game to move it{view === 'tables' ? ' (or onto another table)' : ''}; drag its right edge to change its length.{view === 'players' ? ' Red = a player booked into two games at once.' : ' Red = a table booked for two games at once.'}</p>{/if}

  <div class="tlwrap" bind:clientWidth={W}>
    <div class="grid" bind:this={gridEl} onpointermove={move} onpointerup={up} onpointercancel={() => ((op = null), (live = null))} role="application" style="height:{24 + rows.length * ROW_H}px;width:{LABEL_W + innerW}px">
      <div class="axis" style="left:{LABEL_W}px;width:{innerW}px">
        {#each ticks as t (t)}<span class="tick" style="left:{x(t)}px">{hm(t)}</span>{/each}
      </div>
      {#each rows as r, i (r.key)}
        <div class="row-line" style="top:{24 + i * ROW_H}px;height:{ROW_H}px">
          <span class="rlabel" style="width:{LABEL_W}px">{r.label}</span>
        </div>
      {/each}
      {#each ticks as t (t)}<div class="vline" style="left:{LABEL_W + x(t)}px"></div>{/each}
      {#if now >= range.a && now <= range.b}<div class="now" style="left:{LABEL_W + x(now)}px" title="Now"></div>{/if}
      {#if night}<div class="end" style="left:{LABEL_W + x(nightStart + night.lengthMinutes * 60_000)}px" title="Planned end of the night"></div>{/if}
      {#each rows as r, i (r.key)}
        {#each games.filter((g) => (g.startedAt ?? g.plannedStart ?? (live?.id === g.id ? 1 : null)) != null && inRow(g, r)) as g (g.id)}
          {@const sp = span(g)}
          {@const tag = gameTag(g, now)}
          {@const nl = layout.lanes.get(r.key) ?? 1}
          {@const li = layout.lane.get(`${r.key}:${g.id}`) ?? 0}
          {@const bh = (ROW_H - 8) / nl}
          <div
            class="blk {g.status}"
            class:thin={nl > 1}
            class:clash={layout.bad.has(`${r.key}:${g.id}`)}
            class:filibuster={tag === 'filibuster'}
            class:tardy={tag === 'tardy'}
            class:drag={editable && g.status === 'scheduled'}
            class:lift={live?.id === g.id}
            style="left:{LABEL_W + x(sp.s)}px;width:{Math.max(18, x(sp.e) - x(sp.s))}px;top:{24 + i * ROW_H + 4 + li * bh}px;height:{bh - (nl > 1 ? 1 : 0)}px;{g.color ? `--c:${g.color}` : ''}"
            title="{g.name} · {hm(sp.s)}–{hm(sp.e)}"
            onpointerdown={(e) => down(e, g, 'move')}
            role="presentation"
          >
            <span class="bn">{g.name}</span>
            <span class="bt">{hm(sp.s)}{tag === 'filibuster' ? ' · Filibuster' : tag === 'tardy' ? ' · Tardy' : ''}</span>
            {#if editable && g.status === 'scheduled'}<span class="rs" onpointerdown={(e) => down(e, g, 'resize')} role="presentation" title="Drag to change length"></span>{/if}
          </div>
        {/each}
      {/each}
    </div>
  </div>

  {#if unplaced.length}
    <div class="tray">
      <span class="small muted">Not on the clock{editable ? ' (drag onto the timeline)' : ''}:</span>
      {#each unplaced as g (g.id)}
        <span class="chip" class:drag={editable} onpointerdown={(e) => downTray(e, g)} onpointermove={move} onpointerup={up} role="presentation">{g.name}</span>
      {/each}
    </div>
  {/if}
  {#if view === 'players' && !(gs?.players ?? []).length}<p class="muted">No players yet.</p>{/if}
  {#if view === 'tables' && !(gs?.gm?.seating ?? []).length}<p class="small muted">No tables yet: games show in "No table". Add tables in Seating.</p>{/if}
</section>

<style>
  .tlwrap {
    overflow-x: auto;
    margin-top: 0.5rem;
  }
  .grid {
    position: relative;
    touch-action: none;
    user-select: none;
  }
  .axis {
    position: absolute;
    top: 0;
    height: 22px;
  }
  .tick {
    position: absolute;
    transform: translateX(-50%);
    font-size: 0.7rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .row-line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--line);
  }
  .rlabel {
    display: inline-block;
    padding: 0 0.4rem;
    line-height: 40px;
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vline {
    position: absolute;
    top: 22px;
    bottom: 0;
    width: 1px;
    background: var(--line);
    opacity: 0.6;
  }
  .now,
  .end {
    position: absolute;
    top: 18px;
    bottom: 0;
    width: 2px;
    background: var(--bad);
    z-index: 3;
  }
  .end {
    background: var(--muted);
    opacity: 0.7;
  }
  .blk {
    position: absolute;
    z-index: 2;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 6px;
    border-radius: 5px;
    overflow: hidden;
    background: color-mix(in srgb, var(--c, var(--accent)) 28%, var(--panel));
    border: 1px solid var(--c, var(--accent));
    font-size: 0.75rem;
    line-height: 1.15;
  }
  .blk.scheduled {
    border-style: dashed;
  }
  .blk.final {
    opacity: 0.5;
  }
  .blk.drag {
    cursor: grab;
  }
  .blk.lift {
    z-index: 4;
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.25);
  }
  .blk.clash {
    border: 2px solid var(--bad);
    background: color-mix(in srgb, var(--bad) 20%, var(--panel));
  }
  .blk.filibuster {
    border: 2px solid var(--warn);
  }
  .blk.tardy {
    border-color: var(--bad);
  }
  .bn {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bt {
    color: var(--muted);
    white-space: nowrap;
  }
  .blk.thin {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.68rem;
  }
  .rs {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: ew-resize;
    background: color-mix(in srgb, var(--c, var(--accent)) 60%, transparent);
  }
  .tray {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.5rem;
  }
  .chip.drag {
    cursor: grab;
    touch-action: none;
  }
</style>
