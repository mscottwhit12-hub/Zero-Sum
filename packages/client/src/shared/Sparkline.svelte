<script lang="ts">
  let { values, width = 80, height = 24 }: { values: number[]; width?: number; height?: number } = $props();
  const points = $derived.by(() => {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  });
  const up = $derived(values.length > 1 && values[values.length - 1]! >= values[0]!);
</script>

<svg {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
  {#if points}<polyline {points} fill="none" stroke={up ? 'var(--good)' : 'var(--bad)'} stroke-width="1.5" />{/if}
</svg>
