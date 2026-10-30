<script lang="ts">
  /**
   * Seconds until the next market tick. Counts from the server's last tick time (night.lastTickAt) using the
   * server clock (night.serverTime, so a phone with a wrong clock is still right), and the GM's tick setting
   * (night.tickSeconds). Shown only while ticks are running: night live and trading open.
   */
  import { onDestroy } from 'svelte';
  import { t } from './copy';
  import { secondsToNextTick } from './socket';
  import type { NightInfo } from './types';

  let { night }: { night: NightInfo | null | undefined } = $props();
  let now = $state(Date.now());
  const timer = setInterval(() => (now = Date.now()), 250);
  onDestroy(() => clearInterval(timer));

  // Server clock minus this device's clock, re-measured whenever a fresh state arrives.
  let offset = $state(0);
  $effect(() => {
    if (night) offset = night.serverTime - Date.now();
  });

  const secs = $derived(secondsToNextTick(night, now + offset));
</script>

{#if secs !== null}<span class="tickcd small muted mono">{t('tick.next', { s: secs })}</span>{/if}
