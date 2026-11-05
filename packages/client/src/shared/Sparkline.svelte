<script lang="ts">
  /**
   * Price line. With `scrub`, dragging (or hovering) across it shows a vertical line and the price at that point
   * (and its time when `from`/`to` are given). Sideways drags only: vertical swipes still scroll the page.
   */
  let {
    values,
    width = 80,
    height = 24,
    scrub = false,
    from = null,
    to = null,
  }: { values: number[]; width?: number; height?: number; scrub?: boolean; from?: number | null; to?: number | null } = $props();
  const min = $derived(values.length ? Math.min(...values) : 0);
  const max = $derived(values.length ? Math.max(...values) : 0);
  const yOf = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const xOf = (i: number) => (i / Math.max(1, values.length - 1)) * width;
  const points = $derived(values.length < 2 ? '' : values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' '));
  const up = $derived(values.length > 1 && values[values.length - 1]! >= values[0]!);

  let at = $state<number | null>(null);
  function pick(e: PointerEvent) {
    if (!scrub || values.length < 2) return;
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    at = Math.round(f * (values.length - 1));
  }
  const timeAt = (i: number) =>
    from != null && to != null && values.length > 1
      ? new Date(from + ((to - from) * i) / (values.length - 1)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : null;
  const label = $derived(at == null || values[at] == null ? '' : `${values[at]!.toFixed(2)}${timeAt(at) ? ` · ${timeAt(at)}` : ''}`);
  // Keep the label inside the chart.
  const labelX = $derived(at == null ? 0 : Math.min(width - 40, Math.max(40, xOf(at))));
</script>

{#if scrub}
  <div class="spark-scrub" style="width:{width}px">
    <svg
      {width}
      {height}
      viewBox="0 0 {width} {height}"
      role="img"
      aria-label={label || 'Price chart: drag across it to read a price'}
      onpointerdown={(e) => {
        (e.currentTarget as SVGElement).setPointerCapture?.(e.pointerId);
        pick(e);
      }}
      onpointermove={(e) => (e.pointerType === 'mouse' || e.buttons ? pick(e) : null)}
      onpointerup={(e) => (e.pointerType === 'mouse' ? null : (at = null))}
      onpointercancel={() => (at = null)}
      onpointerleave={() => (at = null)}
    >
      {#if points}<polyline {points} fill="none" stroke={up ? 'var(--good)' : 'var(--bad)'} stroke-width="1.5" />{/if}
      {#if at != null && values[at] != null}
        <line x1={xOf(at)} x2={xOf(at)} y1="0" y2={height} stroke="currentColor" stroke-opacity="0.5" stroke-width="1" />
        <circle cx={xOf(at)} cy={yOf(values[at]!)} r="3.5" fill={up ? 'var(--good)' : 'var(--bad)'} />
      {/if}
    </svg>
    {#if label}<span class="spark-label mono" style="left:{labelX}px" aria-live="polite">{label}</span>{/if}
  </div>
{:else}
  <svg {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
    {#if points}<polyline {points} fill="none" stroke={up ? 'var(--good)' : 'var(--bad)'} stroke-width="1.5" />{/if}
  </svg>
{/if}

<style>
  .spark-scrub {
    position: relative;
    max-width: 100%;
  }
  .spark-scrub svg {
    touch-action: pan-y;
    cursor: crosshair;
    display: block;
    max-width: 100%;
  }
  .spark-label {
    position: absolute;
    top: -0.2rem;
    transform: translate(-50%, -100%);
    white-space: nowrap;
    font-size: 0.8rem;
    padding: 0.1rem 0.4rem;
    border-radius: 6px;
    background: var(--panel, #222);
    border: 1px solid var(--line, #888);
    pointer-events: none;
  }
</style>
