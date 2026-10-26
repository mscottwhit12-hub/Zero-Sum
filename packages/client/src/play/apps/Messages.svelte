<script lang="ts">
  import type { PlayerState } from '@shared/types';
  import { dapi } from '../device';
  let { s }: { s: PlayerState } = $props();
  const read = (id: number) => dapi('POST', `/api/me/messages/${id}/read`).catch(() => {});
</script>

{#each s.me?.messages ?? [] as m (m.id)}
  <button class="msg panel" class:unread={!m.read} onclick={() => !m.read && read(m.id)}>
    <span class="small muted">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Compliance Office</span>
    <span>{m.message}</span>
  </button>
{/each}
{#if !s.me?.messages.length}<p class="muted">No messages.</p>{/if}

<style>
  .msg {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    text-align: left;
    gap: 0.2rem;
  }
  .unread {
    border-left: 4px solid var(--accent);
  }
</style>
