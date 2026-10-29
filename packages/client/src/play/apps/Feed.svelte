<script lang="ts">
  import { feedText } from '@shared/feedText';
  import type { PlayerState } from '@shared/types';
  let { s }: { s: PlayerState } = $props();
</script>

<div class="cd">
  {#each s.feed as f (f.id)}
    <div class="ln"><span>{new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>{feedText(f, s.players)}</div>
  {/each}
  {#if !s.feed.length}<p>Quiet so far.</p>{/if}
</div>
