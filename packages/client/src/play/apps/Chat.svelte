<script lang="ts">
  /** Player chat: one-to-one and group threads. Every message is kept; Compliance (the GMs) can read them. */
  import { onDestroy, onMount, tick } from 'svelte';
  import { run } from '@shared/ui';
  import type { ChatMessage, ChatThread, PlayerState } from '@shared/types';
  import { dapi } from '../device';

  let { s }: { s: PlayerState } = $props();
  const me = $derived(s.me?.id ?? 0);
  const others = $derived(s.players.filter((p) => p.id !== me && !p.left));
  const nameOf = (id: number) => s.players.find((p) => p.id === id)?.displayName ?? '?';
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const title = (t: ChatThread) => (t.kind === 'dm' ? t.members.filter((m) => m !== me).map(nameOf).join(', ') : (t.name ?? t.members.filter((m) => m !== me).map(nameOf).join(', ')));

  let chats = $state<ChatThread[]>([]);
  let open = $state<ChatThread | null>(null);
  let messages = $state<ChatMessage[]>([]);
  let draft = $state('');
  let sending = $state(false);
  let composing = $state(false);
  let picked = $state<number[]>([]);
  let groupName = $state('');
  let listEl = $state<HTMLDivElement | null>(null);

  async function loadList() {
    const r = await dapi<{ chats: ChatThread[] }>('GET', '/api/me/chats').catch(() => null);
    if (r) chats = r.chats;
  }
  async function openThread(t: ChatThread) {
    open = t;
    const r = await run(() => dapi<{ thread: ChatThread; messages: ChatMessage[] }>('GET', `/api/me/chats/${t.id}`));
    if (r) {
      open = r.thread;
      messages = r.messages;
      await markRead();
      await scrollDown();
    }
  }
  async function markRead() {
    if (!open || !messages.length) return;
    await dapi('POST', `/api/me/chats/${open.id}/read`, { upTo: messages[messages.length - 1]!.id }).catch(() => {});
  }
  async function scrollDown() {
    await tick();
    listEl?.scrollTo({ top: listEl.scrollHeight });
  }
  async function send(e: Event) {
    e.preventDefault();
    if (!open || !draft.trim() || sending) return;
    sending = true;
    const clientId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const r = await run(() => dapi<{ message: ChatMessage }>('POST', `/api/me/chats/${open!.id}/messages`, { text: draft, clientId }));
    sending = false;
    if (r) {
      draft = '';
      if (!messages.some((m) => m.id === r.message.id)) messages = [...messages, r.message];
      await scrollDown();
    }
  }
  async function start() {
    if (!picked.length) return;
    const r = await run(() => dapi<{ chat: ChatThread }>('POST', '/api/me/chats', { members: picked, name: groupName || undefined }));
    if (r) {
      composing = false;
      picked = [];
      groupName = '';
      await loadList();
      await openThread(r.chat);
    }
  }
  const toggle = (id: number) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  function onChat(e: Event) {
    const m = (e as CustomEvent<ChatMessage>).detail;
    if (open && m.threadId === open.id) {
      if (!messages.some((x) => x.id === m.id)) messages = [...messages, m];
      void markRead();
      void scrollDown();
    }
    void loadList();
  }
  onMount(() => {
    void loadList();
    window.addEventListener('gn:chat', onChat);
  });
  onDestroy(() => window.removeEventListener('gn:chat', onChat));
</script>

{#if open}
  <div class="thread">
    <div class="spread head">
      <button onclick={() => ((open = null), loadList())}>‹ Chats</button>
      <strong class="grow center">{title(open)}</strong>
    </div>
    {#if open.kind === 'group'}<p class="small muted center">{open.members.map(nameOf).join(', ')}</p>{/if}
    <div class="msgs" bind:this={listEl}>
      {#each messages as m (m.id)}
        <div class="msg" class:mine={m.playerId === me}>
          {#if m.playerId !== me && open.kind === 'group'}<span class="small muted">{nameOf(m.playerId)}</span>{/if}
          <span class="bubble">{m.text}</span>
          <span class="tiny muted">{time(m.createdAt)}</span>
        </div>
      {:else}
        <p class="muted small center">No messages yet.</p>
      {/each}
    </div>
    <form class="compose" onsubmit={send}>
      <input bind:value={draft} maxlength="500" placeholder="Message" aria-label="Message" />
      <button class="primary" type="submit" disabled={!draft.trim() || sending}>Send</button>
    </form>
    <p class="tiny muted center">Compliance keeps a record of every message.</p>
  </div>
{:else if composing}
  <div class="panel">
    <h3>New chat</h3>
    <p class="small muted">Pick one associate for a private chat, or several for a group.</p>
    <div class="row wrap">
      {#each others as p (p.id)}
        <button class="chip" class:on={picked.includes(p.id)} onclick={() => toggle(p.id)}>{p.displayName}</button>
      {/each}
    </div>
    {#if picked.length > 1}<input bind:value={groupName} maxlength="40" placeholder="Group name (optional)" aria-label="Group name" />{/if}
    <div class="row">
      <button onclick={() => ((composing = false), (picked = []))}>Cancel</button>
      <button class="primary" disabled={!picked.length} onclick={start}>Start chat</button>
    </div>
  </div>
{:else}
  <div class="row"><button class="primary grow" onclick={() => (composing = true)}>New chat</button></div>
  {#each chats as c (c.id)}
    <button class="row-btn" onclick={() => openThread(c)}>
      <span class="grow">
        <strong>{title(c)}</strong>
        <span class="small muted last">{c.last ? `${c.last.playerId === me ? 'You' : nameOf(c.last.playerId)}: ${c.last.text}` : 'No messages yet'}</span>
      </span>
      {#if c.unread}<span class="badge-count">{c.unread}</span>{/if}
    </button>
  {:else}
    <p class="muted small center">No chats yet. Start one to talk strategy.</p>
  {/each}
{/if}

<style>
  .thread {
    display: flex;
    flex-direction: column;
    height: calc(100dvh - 9rem);
    gap: 0.4rem;
  }
  .thread .msgs {
    flex: 1;
    min-height: 0;
  }
  .head {
    gap: 0.5rem;
  }
  .center {
    text-align: center;
  }
  .msgs {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.25rem;
  }
  .msg {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: 85%;
  }
  .msg.mine {
    align-self: flex-end;
    align-items: flex-end;
  }
  .bubble {
    padding: 0.4rem 0.6rem;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--line);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .mine .bubble {
    background: color-mix(in srgb, var(--accent) 22%, var(--panel));
  }
  .tiny {
    font-size: 0.7rem;
  }
  .compose {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem;
  }
  .row-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    margin-top: 0.4rem;
  }
  .last {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 70vw;
  }
  .wrap {
    flex-wrap: wrap;
  }
  .badge-count {
    min-width: 1.3rem;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: var(--bad);
    color: #fff;
    font-size: 0.75rem;
    text-align: center;
  }
</style>
