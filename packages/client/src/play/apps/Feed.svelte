<script lang="ts">
  import { feedText } from '@shared/feedText';
  import type { PlayerState } from '@shared/types';
  let { s }: { s: PlayerState } = $props();
</script>

<div class="panel">
  {#each s.feed as f (f.id)}
    <div class="line small"><span class="muted mono">{new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> {feedText(f, s.players)}</div>
  {/each}
  {#if !s.feed.length}<p class="muted">Quiet so far.</p>{/if}
</div>

<style>
  .line {
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--line);
  }
</style>
