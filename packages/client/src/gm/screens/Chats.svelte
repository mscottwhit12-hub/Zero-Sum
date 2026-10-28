<script lang="ts">
  /** Every player chat tonight (GMs can read them all; players are told Compliance keeps a record). */
  import { onDestroy, onMount } from 'svelte';
  import { get } from '@shared/api';
  import { run } from '@shared/ui';
  import type { ChatMessage, ChatThread, GmState } from '@shared/types';
  import { playerName } from '../lib';

  let { gs }: { gs: GmState | null } = $props();
  let chats = $state<ChatThread[]>([]);
  let open = $state<ChatThread | null>(null);
  let messages = $state<ChatMessage[]>([]);
  const name = (id: number) => playerName(gs, id);
  const title = (t: ChatThread) => (t.name ? `${t.name} (${t.members.map(name).join(', ')})` : t.members.map(name).join(' ↔ '));
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

  async function load() {
    const r = await get<{ chats: ChatThread[] }>('/api/gm/chats').catch(() => null);
    if (r) chats = r.chats;
    if (open) await show(open, false);
  }
  async function show(t: ChatThread, toast = true) {
    open = t;
    const r = toast ? await run(() => get<{ thread: ChatThread; messages: ChatMessage[] }>(`/api/gm/chats/${t.id}`)) : await get<{ thread: ChatThread; messages: ChatMessage[] }>(`/api/gm/chats/${t.id}`).catch(() => null);
    if (r) messages = r.messages;
  }
  const onChat = () => void load();
  onMount(() => {
    void load();
    window.addEventListener('gn:gm-chat', onChat);
  });
  onDestroy(() => window.removeEventListener('gn:gm-chat', onChat));
</script>

<div class="cols">
  <section class="panel">
    <h2>Player chats</h2>
    <p class="small muted">Every message tonight, with its time. Also in the night export.</p>
    {#each chats as c (c.id)}
      <button class="row-btn" class:on={open?.id === c.id} onclick={() => show(c)}>
        <span class="grow">
          <strong>{title(c)}</strong>
          <span class="small muted">{c.kind === 'dm' ? 'Private' : 'Group'} · {c.count} message{c.count === 1 ? '' : 's'}{c.last ? ` · last ${time(c.last.createdAt)}` : ''}</span>
        </span>
      </button>
    {:else}
      <p class="muted">No chats yet.</p>
    {/each}
  </section>
  {#if open}
    <section class="panel">
      <h3>{title(open)}</h3>
      <table>
        <tbody>
          {#each messages as m (m.id)}
            <tr><td class="mono small muted">{time(m.createdAt)}</td><td><strong>{name(m.playerId)}</strong></td><td>{m.text}</td></tr>
          {:else}
            <tr><td class="muted">No messages yet.</td></tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
</div>

<style>
  .cols {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    align-items: start;
  }
  .row-btn {
    display: flex;
    width: 100%;
    text-align: left;
    margin-top: 0.4rem;
  }
  .row-btn.on {
    outline: 2px solid var(--accent);
  }
  .row-btn span span {
    display: block;
  }
</style>
