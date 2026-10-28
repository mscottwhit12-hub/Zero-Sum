<script lang="ts">
  /**
   * Seating floor plan: tables with their seats drawn around them. Editable mode (Master GM) lets you drag
   * a table, resize it (right edge = width, bottom edge = height, corner = both) and drag players between
   * seats and the unseated tray. Read-only mode (TV) just draws it.
   */
  import Avatar from './Avatar.svelte';
  import { clamp, minSize, seatPoints, TABLE_H, TABLE_W } from './seating';
  import type { PlayerInfo, SeatingTable } from './types';

  let {
    tables,
    players,
    editable = false,
    tray = false,
    selectedId = null,
    aspect = 1.5,
    labels = undefined,
    dots = false,
    gameName = undefined,
    onselect = undefined,
    onmove = undefined,
    onresize = undefined,
    onseat = undefined,
  }: {
    tables: SeatingTable[];
    players: PlayerInfo[];
    editable?: boolean;
    tray?: boolean;
    selectedId?: number | null;
    aspect?: number;
    labels?: boolean;
    /** Seats drawn as plain filled / empty dots: no avatars, names or numbers (TV full-floor view). */
    dots?: boolean;
    gameName?: (id: number | null) => string;
    onselect?: (id: number) => void;
    onmove?: (id: number, x: number, y: number) => unknown;
    onresize?: (id: number, g: { x: number; y: number; w: number; h: number }) => unknown;
    onseat?: (tableId: number, seat: number, playerId: number | null) => unknown;
  } = $props();

  let W = $state(0);
  const H = $derived(W / aspect);
  const S = $derived(Math.round(clamp(W * 0.055, 20, 40)));
  const showLabels = $derived(!dots && (labels ?? W >= 520));
  let planEl = $state<HTMLDivElement | null>(null);
  let trayEl = $state<HTMLDivElement | null>(null);

  type Geo = { x: number; y: number; w: number; h: number };
  let live = $state<({ id: number } & Geo) | null>(null);
  let liveTok = 0;
  let ghost = $state<{ playerId: number; x: number; y: number } | null>(null);
  let hover = $state<{ tableId: number; seat: number } | null>(null);
  let overTray = $state(false);
  let draggingPlayer = $state<number | null>(null);

  type Op =
    | { kind: 'move'; id: number; offX: number; offY: number; sx: number; sy: number; moved: boolean }
    | { kind: 'resize'; id: number; axis: 'w' | 'h' | 'wh'; sx: number; sy: number; tlx: number; tly: number; tw: number; th: number; minW: number; minH: number; moved: boolean }
    | { kind: 'player'; playerId: number; from: { tableId: number; seat: number } | null; sx: number; sy: number; moved: boolean };
  let op: Op | null = null;

  const geo = (t: SeatingTable): Geo => (live && live.id === t.id ? live : t);
  const byId = $derived(new Map(players.map((p) => [p.id, p])));
  const seatedIds = $derived(new Set(tables.flatMap((t) => t.assignments.map((a) => a.playerId))));
  const unseated = $derived(players.filter((p) => !p.left && !seatedIds.has(p.id)));
  const first = (n: string) => n.split(/\s+/)[0] ?? n;

  function startMove(e: PointerEvent, t: SeatingTable) {
    onselect?.(t.id);
    if (!editable || !planEl) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = planEl.getBoundingClientRect();
    const g = geo(t);
    liveTok++;
    live = { id: t.id, x: g.x, y: g.y, w: g.w, h: g.h };
    op = { kind: 'move', id: t.id, offX: e.clientX - (r.left + g.x * W), offY: e.clientY - (r.top + g.y * H), sx: e.clientX, sy: e.clientY, moved: false };
  }
  function startResize(e: PointerEvent, t: SeatingTable, axis: 'w' | 'h' | 'wh') {
    if (!editable) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const g = geo(t);
    const tw = g.w * W;
    const th = g.h * W;
    liveTok++;
    live = { id: t.id, x: g.x, y: g.y, w: g.w, h: g.h };
    const m = minSize(t.seats);
    op = { kind: 'resize', id: t.id, axis, sx: e.clientX, sy: e.clientY, tlx: g.x * W - tw / 2, tly: g.y * H - th / 2, tw, th, minW: m.w, minH: m.h, moved: false };
  }
  function startPlayer(e: PointerEvent, playerId: number, from: { tableId: number; seat: number } | null) {
    if (!editable) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    op = { kind: 'player', playerId, from, sx: e.clientX, sy: e.clientY, moved: false };
  }

  function seatAt(cx: number, cy: number) {
    if (!planEl) return null;
    const r = planEl.getBoundingClientRect();
    const px = cx - r.left;
    const py = cy - r.top;
    let best: { tableId: number; seat: number; d: number } | null = null;
    for (const t of tables) {
      const g = geo(t);
      for (const p of seatPoints(t.seats, g.w * W, g.h * W, S)) {
        const d = Math.hypot(px - (g.x * W + p.x), py - (g.y * H + p.y));
        if (d <= S * 0.9 && (!best || d < best.d)) best = { tableId: t.id, seat: p.seat, d };
      }
    }
    return best ? { tableId: best.tableId, seat: best.seat } : null;
  }
  const inside = (el: HTMLElement | null, x: number, y: number) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  function move(e: PointerEvent) {
    if (!op || !planEl) return;
    const r = planEl.getBoundingClientRect();
    if (Math.hypot(e.clientX - op.sx, e.clientY - op.sy) > 3) op.moved = true;
    if (!op.moved) return;
    if (op.kind === 'move' && live) {
      live = { ...live, x: clamp((e.clientX - op.offX - r.left) / W, 0, 1), y: clamp((e.clientY - op.offY - r.top) / H, 0, 1) };
    } else if (op.kind === 'resize' && live) {
      const dx = e.clientX - op.sx;
      const dy = e.clientY - op.sy;
      const tw = op.axis === 'h' ? op.tw : clamp(op.tw + dx, op.minW * W, TABLE_W.max * W);
      const th = op.axis === 'w' ? op.th : clamp(op.th + dy, op.minH * W, TABLE_H.max * W);
      // The top-left corner stays put; the centre follows the new size.
      live = { id: live.id, w: tw / W, h: th / W, x: clamp((op.tlx + tw / 2) / W, 0, 1), y: clamp((op.tly + th / 2) / H, 0, 1) };
    } else if (op.kind === 'player') {
      ghost = { playerId: op.playerId, x: e.clientX, y: e.clientY };
      draggingPlayer = op.playerId;
      hover = seatAt(e.clientX, e.clientY);
      overTray = inside(trayEl, e.clientX, e.clientY);
    }
  }

  async function up() {
    if (!op) return;
    const o = op;
    op = null;
    if (o.kind === 'player') {
      const target = hover;
      const toTray = overTray;
      ghost = null;
      hover = null;
      overTray = false;
      draggingPlayer = null;
      if (!o.moved) return;
      if (target && !(o.from && o.from.tableId === target.tableId && o.from.seat === target.seat)) await onseat?.(target.tableId, target.seat, o.playerId);
      else if (!target && toTray && o.from) await onseat?.(o.from.tableId, o.from.seat, null);
      return;
    }
    const l = live;
    const tok = liveTok;
    if (!l || !o.moved) {
      live = null;
      return;
    }
    try {
      if (o.kind === 'move') await onmove?.(l.id, l.x, l.y);
      else await onresize?.(l.id, { x: l.x, y: l.y, w: l.w, h: l.h });
    } finally {
      // Hold the dragged geometry briefly so the table doesn't snap back before the server update arrives.
      setTimeout(() => {
        if (tok === liveTok) live = null;
      }, 400);
    }
  }
  function cancel() {
    op = null;
    live = null;
    ghost = null;
    hover = null;
    overTray = false;
    draggingPlayer = null;
  }
</script>

<div class="fp" onpointermove={move} onpointerup={up} onpointercancel={cancel} role="application">
  <div class="plan" bind:this={planEl} bind:clientWidth={W} style="aspect-ratio:{aspect}">
    {#if W > 0}
      {#each tables as t (t.id)}
        {@const g = geo(t)}
        {@const tw = g.w * W}
        {@const th = g.h * W}
        {@const fs = Math.round(clamp(th * 0.26, 10, Math.max(14, W * 0.032)))}
        <div class="tw" class:sel={selectedId === t.id} style="left:{g.x * W}px;top:{g.y * H}px;width:{tw}px;height:{th}px">
          <button
            class="body"
            class:on={selectedId === t.id}
            class:ro={!editable}
            style="font-size:{fs}px"
            onpointerdown={(e) => startMove(e, t)}
            onclick={() => onselect?.(t.id)}
          >
            <strong>{t.name}</strong>
            {#if th >= 34}<span class="muted cnt">{t.assignments.length}/{t.seats}{gameName && t.gameId ? ` · ${gameName(t.gameId)}` : ''}</span>{/if}
          </button>
          {#each seatPoints(t.seats, tw, th, S) as p (p.seat)}
            {@const pid = t.assignments.find((a) => a.seat === p.seat)?.playerId ?? null}
            {@const pl = pid == null ? null : (byId.get(pid) ?? null)}
            <div
              class="seat"
              class:target={hover?.tableId === t.id && hover?.seat === p.seat}
              class:empty={!pl}
              class:dot={dots && !!pl}
              style="left:{tw / 2 + p.x}px;top:{th / 2 + p.y}px;width:{S}px;height:{S}px;font-size:{Math.round(S * 0.4)}px"
              title={pl ? pl.displayName : `Seat ${p.seat}`}
            >
              {#if dots}
                <!-- filled / empty only -->
              {:else if pl}
                <div class="who" class:drag={editable} class:lift={draggingPlayer === pl.id} onpointerdown={(e) => startPlayer(e, pl.id, { tableId: t.id, seat: p.seat })} role="presentation">
                  <Avatar name={pl.displayName} color={pl.color} src={pl.avatarPath} size={S} />
                </div>
                {#if showLabels}<span class="lbl" style="font-size:{Math.max(10, Math.round(S * 0.3))}px;max-width:{Math.round(S * 2)}px">{first(pl.displayName)}</span>{/if}
              {:else}
                <span class="num">{p.seat}</span>
              {/if}
            </div>
          {/each}
          {#if editable && selectedId === t.id}
            <div class="hd hw" onpointerdown={(e) => startResize(e, t, 'w')} role="presentation" title="Drag to change length"></div>
            <div class="hd hh" onpointerdown={(e) => startResize(e, t, 'h')} role="presentation" title="Drag to change width"></div>
            <div class="hd hc" onpointerdown={(e) => startResize(e, t, 'wh')} role="presentation" title="Drag to resize"></div>
          {/if}
        </div>
      {/each}
      {#if !tables.length}<p class="muted none">No tables yet.</p>{/if}
    {/if}
  </div>

  {#if tray}
    <div class="tray" class:over={overTray} bind:this={trayEl}>
      <span class="small muted">{unseated.length ? 'Unseated' : 'Everyone is seated'}{editable && unseated.length ? ' — drag onto a seat' : ''}</span>
      {#each unseated as p (p.id)}
        <div class="chip" class:drag={editable} class:lift={draggingPlayer === p.id} onpointerdown={(e) => startPlayer(e, p.id, null)} role="presentation">
          <Avatar name={p.displayName} color={p.color} src={p.avatarPath} size={24} />
          <span class="small">{p.displayName}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if ghost}
    {@const gp = byId.get(ghost.playerId)}
    {#if gp}
      <div class="ghost" style="left:{ghost.x}px;top:{ghost.y}px">
        <Avatar name={gp.displayName} color={gp.color} src={gp.avatarPath} size={S + 6} />
        <span class="small">{gp.displayName}</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .fp {
    width: 100%;
  }
  .plan {
    position: relative;
    width: 100%;
    outline: 1px dashed var(--line);
    border-radius: 8px;
    overflow: hidden;
    touch-action: none;
  }
  .tw {
    position: absolute;
    transform: translate(-50%, -50%);
  }
  .tw.sel {
    z-index: 3;
  }
  .body {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 2px 4px;
    margin: 0;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
    line-height: 1.15;
  }
  .body.ro {
    cursor: default;
  }
  .body.on {
    outline: 2px solid var(--accent);
  }
  .body strong,
  .cnt {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cnt {
    font-size: 0.8em;
  }
  .seat {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    z-index: 1;
  }
  .seat.empty {
    border: 1.5px dashed var(--muted);
    color: var(--muted);
  }
  .seat.dot {
    background: var(--accent);
  }
  .seat.target {
    border: 2px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    z-index: 2;
  }
  .who {
    line-height: 0;
    border-radius: 50%;
  }
  .who.drag,
  .chip.drag {
    cursor: grab;
    touch-action: none;
  }
  .lift {
    opacity: 0.35;
  }
  .lbl {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    line-height: 1.1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
    color: var(--text);
  }
  .hd {
    position: absolute;
    background: var(--accent);
    border-radius: 3px;
    z-index: 4;
    touch-action: none;
  }
  .hw {
    right: 1px;
    top: 50%;
    width: 8px;
    height: 24px;
    transform: translateY(-50%);
    cursor: ew-resize;
  }
  .hh {
    bottom: 1px;
    left: 50%;
    width: 24px;
    height: 8px;
    transform: translateX(-50%);
    cursor: ns-resize;
  }
  .hc {
    right: 1px;
    bottom: 1px;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
  }
  .none {
    text-align: center;
    margin-top: 20%;
  }
  .tray {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.5rem;
    padding: 0.4rem 0.5rem;
    min-height: 40px;
    border: 1px dashed var(--line);
    border-radius: 8px;
  }
  .tray.over {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 2px 8px 2px 3px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--panel);
    user-select: none;
  }
  .ghost {
    position: fixed;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
    z-index: 100;
    filter: drop-shadow(0 2px 6px rgb(0 0 0 / 0.35));
  }
</style>
