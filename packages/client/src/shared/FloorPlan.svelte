<script lang="ts">
  /**
   * Seating floor plan: tables with their seats drawn around them. Editable mode (Master GM) lets you drag
   * a table, resize it (right edge = width, bottom edge = height, corner = both) and drag players between
   * seats and the unseated tray. An empty seat can be dragged to another spot around its table. Read-only mode (TV) just draws it.
   */
  import Avatar from './Avatar.svelte';
  import { fitProp, inkOn, propKind } from '@gn/engine';
  import PropSprite from './PropSprite.svelte';
  import { clamp, edgeDistance, minSize, SEAT_EDGE, seatFractions, seatPoints, snapToFree, TABLE_H, TABLE_W } from './seating';
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
    onseatpos = undefined,
    selectedPropId = null,
    onselectprop = undefined,
    onprop = undefined,
    onrotate = undefined,
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
    /** An empty seat was dragged: the table's new seat positions (0–1 fractions along its edge, one per seat). */
    onseatpos?: (tableId: number, pos: number[]) => unknown;
    /** Table props: the selected one (edit handles), picking one, and a move/resize to save. */
    selectedPropId?: number | null;
    onselectprop?: (tableId: number, propId: number) => void;
    onprop?: (propId: number, g: { x: number; y: number; w: number; rotation?: number }) => unknown;
    /** A table turned by dragging its turn handle (whole degrees, 15° steps). */
    onrotate?: (id: number, deg: number) => unknown;
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
  /** An empty seat being dragged (or just dropped, until the server's update arrives). */
  let liveSeat = $state<{ tableId: number; seat: number; f: number } | null>(null);
  let seatTok = 0;

  type Op =
    | { kind: 'move'; id: number; offX: number; offY: number; sx: number; sy: number; moved: boolean }
    | { kind: 'resize'; id: number; axis: 'w' | 'h' | 'wh'; sx: number; sy: number; cx: number; cy: number; deg: number; tw: number; th: number; minW: number; minH: number; moved: boolean }
    | { kind: 'player'; playerId: number; from: { tableId: number; seat: number } | null; sx: number; sy: number; moved: boolean }
    | { kind: 'seat'; tableId: number; seat: number; sx: number; sy: number; moved: boolean }
    | { kind: 'prop'; tableId: number; propId: number; mode: 'move' | 'size'; sx: number; sy: number; x0: number; y0: number; w0: number; d0: number; moved: boolean }
    | { kind: 'turn'; tableId: number; propId: number | null; sx: number; sy: number; a0: number; r0: number; moved: boolean };
  type Prop = NonNullable<SeatingTable['props']>[number];
  /** The prop being dragged, shown where it is now (kept briefly after the drop until the server agrees). */
  let liveProp = $state<{ id: number; x: number; y: number; w: number; rotation?: number } | null>(null);
  /** A table being turned by its handle (its live angle). */
  let liveTurn = $state<{ id: number; deg: number } | null>(null);
  let turnTok = 0;
  /** Angle 0–359 snapped to 15° steps. */
  const snap15 = (d: number) => (((Math.round(d / 15) * 15) % 360) + 360) % 360;
  let propTok = 0;
  const propGeo = (p: Prop) => (liveProp && liveProp.id === p.id ? { ...p, ...liveProp } : p);
  let op: Op | null = null;

  const geo = (t: SeatingTable): Geo => (live && live.id === t.id ? live : t);
  /** The table's seat positions, with the seat being dragged shown where it is now. */
  const posOf = (t: SeatingTable): number[] => {
    const base = seatFractions(t.seats, t.seatPos);
    return liveSeat && liveSeat.tableId === t.id ? base.map((f, i) => (i + 1 === liveSeat!.seat ? liveSeat!.f : f)) : base;
  };
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
    op = { kind: 'resize', id: t.id, axis, sx: e.clientX, sy: e.clientY, cx: g.x * W, cy: g.y * H, deg: rotOf(t), tw, th, minW: m.w, minH: m.h, moved: false };
  }
  function startPlayer(e: PointerEvent, playerId: number, from: { tableId: number; seat: number } | null) {
    if (!editable) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    op = { kind: 'player', playerId, from, sx: e.clientX, sy: e.clientY, moved: false };
  }

  /** Screen point → the table's own frame (px from its centre, before its rotation). */
  function toTable(t: SeatingTable, cx: number, cy: number) {
    const r = planEl!.getBoundingClientRect();
    const g = geo(t);
    return rot(cx - (r.left + g.x * W), cy - (r.top + g.y * H), -rotOf(t));
  }
  function startProp(e: PointerEvent, t: SeatingTable, p: Prop, mode: 'move' | 'size') {
    if (!editable) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onselectprop?.(t.id, p.id);
    const g = geo(t);
    const c = { x: p.x * g.w * W, y: p.y * g.h * W };
    const at = toTable(t, e.clientX, e.clientY);
    op = { kind: 'prop', tableId: t.id, propId: p.id, mode, sx: e.clientX, sy: e.clientY, x0: p.x, y0: p.y, w0: p.w, d0: Math.max(4, Math.hypot(at.x - c.x, at.y - c.y)), moved: false };
  }
  function startSeat(e: PointerEvent, t: SeatingTable, seat: number) {
    if (!editable) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    op = { kind: 'seat', tableId: t.id, seat, sx: e.clientX, sy: e.clientY, moved: false };
  }

  // Rotation (15° steps): the table and its seats turn around the table's centre; avatars and text stay upright.
  const rotOf = (t: SeatingTable) => (liveTurn && liveTurn.id === t.id ? liveTurn.deg : (t.rotation ?? 0));
  /** Width of upright text `sh` tall, centred on a w×h box turned `deg`, that stays inside the box. */
  function stripRoom(w: number, h: number, deg: number, sh: number) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    let best = Infinity;
    for (const y of [sh / 2, -sh / 2]) {
      let lo = -Infinity, hi = Infinity;
      if (Math.abs(c) > 1e-6) { const p = (-w / 2 - y * s) / c, q = (w / 2 - y * s) / c; lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q)); } else if (Math.abs(y * s) > w / 2) return 0;
      if (Math.abs(s) > 1e-6) { const p = (y * c - h / 2) / s, q = (y * c + h / 2) / s; lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q)); } else if (Math.abs(y * c) > h / 2) return 0;
      best = Math.min(best, 2 * Math.min(hi, -lo)); // text is centred on the table, so the narrower side sets the room
    }
    return Math.max(0, best);
  }
  let meas: CanvasRenderingContext2D | null = null;
  const textW = (txt: string, px: number) => {
    meas ??= document.createElement('canvas').getContext('2d');
    if (!meas) return txt.length * px * 0.62;
    meas.font = `700 ${px}px ${getComputedStyle(planEl?.querySelector('.body') ?? document.body).fontFamily}`;
    return meas.measureText(txt).width;
  };
  /** Split a name into two lines at the word break nearest its middle (null if it has no break). */
  const halves = (txt: string): [string, string] | null => {
    const sp = [...txt.matchAll(/ /g)].map((m) => m.index!);
    if (!sp.length) return null;
    const i = sp.reduce((b, x) => (Math.abs(x - txt.length / 2) < Math.abs(b - txt.length / 2) ? x : b));
    return [txt.slice(0, i), txt.slice(i + 1)];
  };
  /**
   * Largest font (≤ base, ≥ 9 px) at which the label fits upright inside the turned table, letting the first line
   * (the name) wrap onto two lines when that fits bigger. Returns the font, the room per line, and whether it wraps.
   */
  function fitLabel(lines: { text: string; k: number }[], base: number, w: number, h: number, deg: number, pad: number, wrap = true) {
    const split = wrap ? halves(lines[0]!.text) : null;
    const tryAt = (f: number, two: boolean) => {
      const ls = two && split ? [{ text: split[0], k: lines[0]!.k }, { text: split[1], k: lines[0]!.k }, ...lines.slice(1)] : lines;
      const room = stripRoom(w, h, deg, ls.reduce((n, l) => n + l.k * f * 1.25, 0) + 6) * 0.9 - pad * f;
      return { ok: Math.max(...ls.map((l) => textW(l.text, l.k * f))) <= room, room };
    };
    let last = { fs: 9, max: 0, wrap: false };
    for (let f = base; f >= 9; f--) {
      const one = tryAt(f, false);
      last = { fs: f, max: Math.max(0, Math.round(one.room)), wrap: false };
      if (one.ok) return last;
      if (split) { const two = tryAt(f, true); if (two.ok) return { fs: f, max: Math.max(0, Math.round(two.room)), wrap: true }; }
    }
    return last;
  }
  /** Rotate a point (relative to the table centre) by `deg`. */
  const rot = (x: number, y: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
  };
  function seatAt(cx: number, cy: number) {
    if (!planEl) return null;
    const r = planEl.getBoundingClientRect();
    const px = cx - r.left;
    const py = cy - r.top;
    let best: { tableId: number; seat: number; d: number } | null = null;
    for (const t of tables) {
      const g = geo(t);
      for (const p of seatPoints(t.seats, g.w * W, g.h * W, S, 3, posOf(t))) {
        const q = rot(p.x, p.y, rotOf(t));
        const d = Math.hypot(px - (g.x * W + q.x), py - (g.y * H + q.y));
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

  /** Grab a turn handle (a table's, or a prop's when `p` is given): the angle follows the pointer around the centre. */
  function startTurn(e: PointerEvent, t: SeatingTable, p: Prop | null) {
    if (!editable || !planEl) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (p) onselectprop?.(t.id, p.id);
    const r = planEl.getBoundingClientRect();
    const g = geo(t);
    let a0: number;
    if (p) {
      const at = toTable(t, e.clientX, e.clientY);
      a0 = (Math.atan2(at.y - p.y * g.h * W, at.x - p.x * g.w * W) * 180) / Math.PI;
    } else a0 = (Math.atan2(e.clientY - (r.top + g.y * H), e.clientX - (r.left + g.x * W)) * 180) / Math.PI;
    op = { kind: 'turn', tableId: t.id, propId: p?.id ?? null, sx: e.clientX, sy: e.clientY, a0, r0: p ? p.rotation : rotOf(t), moved: false };
  }

  function move(e: PointerEvent) {
    if (!op || !planEl) return;
    const r = planEl.getBoundingClientRect();
    if (Math.hypot(e.clientX - op.sx, e.clientY - op.sy) > 3) op.moved = true;
    if (!op.moved) return;
    if (op.kind === 'move' && live) {
      live = { ...live, x: clamp((e.clientX - op.offX - r.left) / W, 0, 1), y: clamp((e.clientY - op.offY - r.top) / H, 0, 1) };
    } else if (op.kind === 'resize' && live) {
      // The drag in the table's own frame (it may be rotated).
      const d = rot(e.clientX - op.sx, e.clientY - op.sy, -op.deg);
      const tw = op.axis === 'h' ? op.tw : clamp(op.tw + d.x, op.minW * W, TABLE_W.max * W);
      const th = op.axis === 'w' ? op.th : clamp(op.th + d.y, op.minH * W, TABLE_H.max * W);
      // The opposite edges stay put; the centre moves half the growth, along the table's own axes.
      const shift = rot((tw - op.tw) / 2, (th - op.th) / 2, op.deg);
      live = { id: live.id, w: tw / W, h: th / W, x: clamp((op.cx + shift.x) / W, 0, 1), y: clamp((op.cy + shift.y) / H, 0, 1) };
    } else if (op.kind === 'seat') {
      // The seat follows the pointer to the nearest free spot on the edge of its own table.
      const so = op;
      const t = tables.find((x) => x.id === so.tableId);
      if (!t) return;
      const g = geo(t);
      const tw = g.w * W;
      const th = g.h * W;
      const per = 2 * (tw + th);
      const local = rot(e.clientX - (r.left + g.x * W), e.clientY - (r.top + g.y * H), -rotOf(t));
      const d = edgeDistance(local.x, local.y, tw, th);
      const others = posOf(t).filter((_, i) => i + 1 !== so.seat).map((f) => f * per);
      const snapped = snapToFree(d, others, per, SEAT_EDGE * W);
      if (snapped !== null) liveSeat = { tableId: t.id, seat: so.seat, f: snapped / per };
    } else if (op.kind === 'prop') {
      const po = op;
      const t = tables.find((x) => x.id === po.tableId);
      const p = t?.props?.find((x) => x.id === po.propId);
      const kind = p ? propKind(p.kind) : null;
      if (!t || !p || !kind) return;
      const g = geo(t);
      const tw = g.w * W;
      const th = g.h * W;
      const at = toTable(t, e.clientX, e.clientY);
      const start = toTable(t, po.sx, po.sy);
      let next = { x: po.x0, y: po.y0, w: po.w0, rotation: p.rotation };
      if (po.mode === 'move') next = { ...next, x: po.x0 + (at.x - start.x) / tw, y: po.y0 + (at.y - start.y) / th };
      else next = { ...next, w: po.w0 * (Math.hypot(at.x - po.x0 * tw, at.y - po.y0 * th) / po.d0) };
      const f = fitProp(kind, next, g.w, g.h);
      liveProp = { id: p.id, x: f.x, y: f.y, w: f.w };
    } else if (op.kind === 'turn') {
      const to = op;
      const t = tables.find((x) => x.id === to.tableId);
      if (!t) return;
      const g = geo(t);
      if (to.propId === null) {
        const a = (Math.atan2(e.clientY - (r.top + g.y * H), e.clientX - (r.left + g.x * W)) * 180) / Math.PI;
        liveTurn = { id: t.id, deg: snap15(to.r0 + a - to.a0) };
      } else {
        const p = t.props?.find((x) => x.id === to.propId);
        const kind = p ? propKind(p.kind) : null;
        if (!p || !kind) return;
        const at = toTable(t, e.clientX, e.clientY);
        const a = (Math.atan2(at.y - p.y * g.h * W, at.x - p.x * g.w * W) * 180) / Math.PI;
        const f = fitProp(kind, { x: p.x, y: p.y, w: p.w, rotation: snap15(to.r0 + a - to.a0) }, g.w, g.h);
        liveProp = { id: p.id, x: f.x, y: f.y, w: f.w, rotation: f.rotation };
      }
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
    if (o.kind === 'turn' && o.propId === null) {
      const lt = liveTurn;
      const tok = ++turnTok;
      if (!o.moved || !lt) {
        liveTurn = null;
        return;
      }
      try {
        await onrotate?.(lt.id, lt.deg);
      } finally {
        setTimeout(() => {
          if (tok === turnTok) liveTurn = null;
        }, 400);
      }
      return;
    }
    if (o.kind === 'prop' || o.kind === 'turn') {
      const lp = liveProp;
      const tok = ++propTok;
      if (!o.moved || !lp) {
        liveProp = null;
        return;
      }
      try {
        await onprop?.(lp.id, lp.rotation === undefined ? { x: lp.x, y: lp.y, w: lp.w } : { x: lp.x, y: lp.y, w: lp.w, rotation: lp.rotation });
      } finally {
        setTimeout(() => {
          if (tok === propTok) liveProp = null;
        }, 400);
      }
      return;
    }
    if (o.kind === 'seat') {
      const t = tables.find((x) => x.id === o.tableId);
      const ls = liveSeat;
      const tok = ++seatTok;
      if (!o.moved || !t || !ls) {
        liveSeat = null;
        return;
      }
      try {
        await onseatpos?.(t.id, posOf(t));
      } finally {
        // Keep the seat where it was dropped until the server's update arrives.
        setTimeout(() => {
          if (tok === seatTok) liveSeat = null;
        }, 400);
      }
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
    liveSeat = null;
    liveProp = null;
    liveTurn = null;
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
        {@const deg = rotOf(t)}
        {@const cntText = `${t.assignments.length}/${t.seats}${gameName && t.gameId ? ` · ${gameName(t.gameId)}` : ''}`}
        {@const withGame = th >= 34 && !!gameName && !!t.gameId}
        {@const P1 = t.props?.length && withGame ? fitLabel([{ text: `${t.name} · ${gameName!(t.gameId!)}`, k: 1 }], Math.round(fs * 0.75), tw, th, deg, 1.1, false) : null}
        {@const pillGame = !!P1 && P1.fs > 9}
        {@const L = t.props?.length
          ? pillGame ? P1! : fitLabel([{ text: t.name, k: 1 }], Math.round(fs * 0.75), tw, th, deg, 1.1, false)
          : fitLabel(th >= 34 ? [{ text: t.name, k: 1 }, { text: cntText, k: 0.8 }] : [{ text: t.name, k: 1 }], fs, tw, th, deg, 0.3)}
        <div class="tw" class:sel={selectedId === t.id} style="left:{g.x * W}px;top:{g.y * H}px;width:{tw}px;height:{th}px;transform:translate(-50%, -50%) rotate({deg}deg)">
          <button
            class="body"
            class:on={selectedId === t.id}
            class:ro={!editable}
            style="font-size:{L.fs}px;--txt-rot:{-deg}deg;--lbl-max:{L.max}px{t.color ? `;background:${t.color};color:${inkOn(t.color)}` : ''}"
            onpointerdown={(e) => startMove(e, t)}
            onclick={() => onselect?.(t.id)}
          >
            {#if !t.props?.length}
              <span class="lb" class:wrap={L.wrap}>
                <strong>{t.name}</strong>
                {#if th >= 34}<span class="muted cnt">{cntText}</span>{/if}
              </span>
            {/if}
          </button>
          {#each t.props ?? [] as pr (pr.id)}
            {@const q = propGeo(pr)}
            {@const k = propKind(pr.kind)}
            {#if k}
              {@const pw = q.w * tw}
              <div
                class="prop"
                class:edit={editable}
                class:psel={selectedPropId === pr.id}
                style="left:{tw / 2 + q.x * tw}px;top:{th / 2 + q.y * th}px;width:{pw}px;height:{pw / k.aspect}px;transform:translate(-50%, -50%) rotate({q.rotation}deg)"
                title={k.label}
                role="presentation"
                onpointerdown={(e) => startProp(e, t, pr, 'move')}
              >
                <PropSprite kind={pr.kind} />
                {#if editable && selectedPropId === pr.id}<div class="phd" role="presentation" title="Drag to resize" onpointerdown={(e) => startProp(e, t, pr, 'size')}></div><div class="rh prh" role="presentation" title="Drag to turn (15° steps)" onpointerdown={(e) => startTurn(e, t, pr)}>⟳</div>{/if}
              </div>
            {/if}
          {/each}
          {#if t.props?.length}
            <!-- label above the props, on a pill, never catching the pointer -->
            <div class="plbl" style="font-size:{L.fs}px;--txt-rot:{-deg}deg;{L.max >= L.fs * 2.5 ? `max-width:${L.max + L.fs * 1.1}px` : 'max-width:none'}"><strong>{t.name}</strong>{#if pillGame}<span class="cnt">&nbsp;· {gameName!(t.gameId!)}</span>{/if}</div>
          {/if}
          {#each seatPoints(t.seats, tw, th, S, 3, posOf(t)) as p (p.seat)}
            {@const pid = t.assignments.find((a) => a.seat === p.seat)?.playerId ?? null}
            {@const pl = pid == null ? null : (byId.get(pid) ?? null)}
            <div
              class="seat"
              class:target={hover?.tableId === t.id && hover?.seat === p.seat}
              class:empty={!pl}
              class:mv={editable && !pl && !dots}
              class:moving={liveSeat?.tableId === t.id && liveSeat?.seat === p.seat}
              class:dot={dots && !!pl}
              style="left:{tw / 2 + p.x}px;top:{th / 2 + p.y}px;width:{S}px;height:{S}px;font-size:{Math.round(S * 0.4)}px;transform:translate(-50%, -50%) rotate({-deg}deg)"
              title={pl ? pl.displayName : editable && !dots ? `Seat ${p.seat}: drag to move it around the table` : `Seat ${p.seat}`}
              onpointerdown={(e) => !pl && !dots && startSeat(e, t, p.seat)}
              role="presentation"
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
          {#if editable && selectedId === t.id && onrotate}
            <div class="rh trh" role="presentation" title="Drag to turn (15° steps)" onpointerdown={(e) => startTurn(e, t, null)}>⟳</div>
          {/if}
          {#if editable && selectedId === t.id && !t.props?.length}
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
  .plbl {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%) rotate(var(--txt-rot, 0deg));
    z-index: 2;
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0.05em 0.5em;
    border-radius: 0.5em;
    background: #000a;
    color: #fff;
  }
  .prop {
    position: absolute;
    pointer-events: none;
    z-index: 1;
  }
  .prop.edit {
    pointer-events: auto;
    cursor: move;
    touch-action: none;
  }
  .prop.psel {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
  }
  /* turn handles: a round knob off the top-left corner; drag it round the centre */
  .rh {
    position: absolute;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    border: 2px solid #fff;
    font-size: 13px;
    line-height: 1;
    cursor: grab;
    touch-action: none;
    user-select: none;
    z-index: 5;
    box-shadow: 0 1px 4px #0006;
  }
  .rh::before {
    content: '';
    position: absolute;
    inset: -10px;
    border-radius: 50%;
  }
  .rh:active {
    cursor: grabbing;
  }
  .trh {
    left: -11px;
    top: -11px;
  }
  .prh {
    left: -11px;
    top: -11px;
    width: 18px;
    height: 18px;
    font-size: 11px;
  }
  .phd {
    position: absolute;
    right: -8px;
    bottom: -8px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid #fff;
    cursor: nwse-resize;
  }
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
  /* table text always reads left to right, however the table is turned */
  .body > .lb {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: var(--lbl-max, 100%);
    rotate: var(--txt-rot, 0deg);
  }
  .body > .lb.wrap strong {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .body .muted {
    color: inherit;
    opacity: 0.75;
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
  .seat.mv {
    cursor: grab;
    touch-action: none;
  }
  .seat.moving {
    z-index: 3;
    border-style: solid;
    border-color: var(--accent);
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
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    padding: 0 0.3em;
    border-radius: 0.4em;
    z-index: 2;
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
