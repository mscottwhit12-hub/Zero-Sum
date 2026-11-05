<script lang="ts">
  /**
   * Crop a profile photo: a round window over the picture; drag to move it, pinch or use the slider to zoom.
   * "Use photo" hands back the square crop, encoded small enough for the server (≤512 px, <200 KB).
   */
  import { onDestroy } from 'svelte';
  import { encodeAvatar } from './device';

  let { file, ondone, oncancel }: { file: File; ondone: (dataUrl: string) => void; oncancel: () => void } = $props();
  const V = 260; // viewport size, px
  let bmp = $state<ImageBitmap | null>(null);
  let url = $state('');
  let failed = $state(false);
  let zoom = $state(1);
  let ox = $state(0);
  let oy = $state(0);
  $effect(() => {
    const u = URL.createObjectURL(file);
    url = u;
    createImageBitmap(file)
      .then((b) => (bmp = b))
      .catch(() => (failed = true));
    return () => URL.revokeObjectURL(u);
  });
  onDestroy(() => bmp?.close());

  const base = $derived(bmp ? V / Math.min(bmp.width, bmp.height) : 1); // "cover" scale at zoom 1
  const scale = $derived(base * zoom);
  /** Keep the picture covering the whole window. */
  function bound() {
    if (!bmp) return;
    const mx = Math.max(0, (bmp.width * scale - V) / 2);
    const my = Math.max(0, (bmp.height * scale - V) / 2);
    ox = Math.min(mx, Math.max(-mx, ox));
    oy = Math.min(my, Math.max(-my, oy));
  }
  $effect(() => {
    void zoom;
    bound();
  });

  const pts = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; z: number } | null = null;
  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), z: zoom };
    }
  }
  function move(e: PointerEvent) {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      zoom = Math.min(4, Math.max(1, (pinch.z * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / (pinch.d || 1)));
      return;
    }
    ox += e.clientX - prev.x;
    oy += e.clientY - prev.y;
    bound();
  }
  function up(e: PointerEvent) {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
  }

  let busy = $state(false);
  async function use() {
    if (!bmp) return;
    busy = true;
    try {
      const size = V / scale; // square in picture pixels
      const sx = bmp.width / 2 - ox / scale - size / 2;
      const sy = bmp.height / 2 - oy / scale - size / 2;
      const out = Math.min(512, Math.round(size));
      const c = document.createElement('canvas');
      c.width = out;
      c.height = out;
      c.getContext('2d')!.drawImage(bmp, sx, sy, size, size, 0, 0, out, out);
      ondone(encodeAvatar(c));
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }
</script>

<div class="crop" role="dialog" aria-label="Crop your photo">
  {#if failed}
    <p>That picture couldn't be opened. Try another one.</p>
    <button onclick={oncancel}>Close</button>
  {:else}
    <p class="small">Drag to move · pinch or slide to zoom</p>
    <div
      class="win"
      style="width:{V}px;height:{V}px"
      role="presentation"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
    >
      {#if bmp && url}
        <img src={url} alt="" draggable="false" style="width:{bmp.width * scale}px;height:{bmp.height * scale}px;transform:translate(calc(-50% + {ox}px), calc(-50% + {oy}px))" />
      {/if}
      <div class="ring" aria-hidden="true"></div>
    </div>
    <label class="field"><span class="small">Zoom</span><input type="range" min="1" max="4" step="0.01" bind:value={zoom} /></label>
    <div class="row">
      <button onclick={oncancel}>Cancel</button>
      <button class="primary" disabled={!bmp || busy} onclick={use}>Use photo</button>
    </div>
  {/if}
</div>

<style>
  .crop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    padding: 0.8rem 0;
  }
  .win {
    position: relative;
    overflow: hidden;
    border-radius: 12px;
    touch-action: none;
    background: #000;
    cursor: grab;
    max-width: 100%;
  }
  .win img {
    position: absolute;
    left: 50%;
    top: 50%;
    max-width: none;
    user-select: none;
    -webkit-user-drag: none;
    pointer-events: none;
  }
  .ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    box-shadow: 0 0 0 999px #000a;
    border: 2px solid #fff8;
    pointer-events: none;
  }
  .field {
    width: 260px;
    max-width: 100%;
  }
</style>
