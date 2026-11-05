<script lang="ts">
  /** One table prop picture (see propArt.ts). Fills its box; the box sets the size. */
  import { propKind } from '@gn/engine';
  import { propArt } from './propArt';
  let { kind }: { kind: string } = $props();
  const aspect = $derived(propKind(kind)?.aspect ?? 1);
</script>

<svg viewBox="0 0 {100 * aspect} 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="width:100%;height:100%;display:block">
  <!-- eslint-disable-next-line svelte/no-at-html-tags: constant art from propArt.ts, never user input -->
  {@html propArt(kind)}
</svg>
