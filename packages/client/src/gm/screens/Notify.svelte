<script lang="ts">
  import { post } from '@shared/api';
  import { run } from '@shared/ui';
  import type { GmState } from '@shared/types';
  import { activePlayers, playerName } from '../lib';

  let { gs }: { gs: GmState | null } = $props();
  let mode = $state<'all' | 'players' | 'game'>('all');
  let picked = $state<number[]>([]);
  let gameId = $state<string>('');
  let message = $state('');
  const games = $derived((gs?.games ?? []).filter((g) => g.status === 'active' || g.status === 'scheduled'));
  const toggle = (id: number) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  async function send(e: Event) {
    e.preventDefault();
    const to = mode === 'all' ? { all: true } : mode === 'players' ? { players: picked } : { gameId: Number(gameId) };
    const r = await run(() => post('/api/notifications', { to, message }), 'Sent');
    if (r) message = '';
  }
  function who(to: string) {
    if (to === 'all') return 'Everyone';
    const ids = to.replace(/^players?:/, '').split(',').map(Number);
    return ids.map((id) => playerName(gs, id)).join(', ');
  }
</script>

<form class="panel" onsubmit={send}>
  <h2>Send a message</h2>
  <div class="row">
    <button type="button" class="chip" class:on={mode === 'all'} onclick={() => (mode = 'all')}>Everyone</button>
    <button type="button" class="chip" class:on={mode === 'players'} onclick={() => (mode = 'players')}>Players</button>
    <button type="button" class="chip" class:on={mode === 'game'} onclick={() => (mode = 'game')}>A table</button>
  </div>
  {#if mode === 'players'}
    <div class="row" style="margin-top:.5rem">
      {#each activePlayers(gs) as p (p.id)}
        <button type="button" class="chip" class:on={picked.includes(p.id)} onclick={() => toggle(p.id)}>{p.displayName}</button>
      {/each}
    </div>
  {:else if mode === 'game'}
    <label class="field" style="margin-top:.5rem"><span>Game</span>
      <select bind:value={gameId}>
        <option value="">—</option>
        {#each games as g (g.id)}<option value={String(g.id)}>{g.name}</option>{/each}
      </select>
    </label>
  {/if}
  <label class="field" style="margin-top:.5rem"><span>Message</span><textarea rows="3" maxlength="500" bind:value={message} required></textarea></label>
  <div class="actions"><button class="primary" type="submit" disabled={!gs?.night || !message.trim() || (mode === 'players' && !picked.length) || (mode === 'game' && !gameId)}>Send</button></div>
</form>

<section class="panel">
  <h2>Sent</h2>
  {#each gs?.gm?.notifications ?? [] as n (n.id)}
    <div class="line">
      <div class="small muted">{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {who(n.to)} · read by {n.readCount}</div>
      <div>{n.message}</div>
    </div>
  {:else}
    <p class="muted">Nothing sent yet.</p>
  {/each}
</section>
