<script lang="ts">
  import { t } from '@shared/copy';
  import { run } from '@shared/ui';
  import type { MyChallenge, PlayerState, Reward } from '@shared/types';
  import { dapi } from '../device';
  let { s }: { s: PlayerState } = $props();

  const read = (id: number) => dapi('POST', `/api/me/messages/${id}/read`).catch(() => {});
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Encrypted memos: tap to "decrypt" (marks read), then accept/reject.
  let decrypting = $state<number | null>(null);
  let opened = $state<Set<number>>(new Set());
  async function decrypt(c: MyChallenge) {
    decrypting = c.id;
    await new Promise((r) => setTimeout(r, 900));
    await dapi('POST', `/api/me/challenges/${c.id}/read`).catch(() => {});
    opened = new Set([...opened, c.id]);
    decrypting = null;
  }
  const isOpen = (c: MyChallenge) => c.status !== 'sent' || opened.has(c.id);
  const respond = (c: MyChallenge, accept: boolean) => run(() => dapi('POST', `/api/me/challenges/${c.id}/respond`, { accept }));

  function rewardText(r: Reward) {
    if (r.type === 'gold') return t('phone.rewards.gold', { gold: r.gold ?? '' });
    if (r.type === 'custom') return t('phone.rewards.custom', { text: r.text ?? '' });
    return t(`phone.rewards.${r.type}`);
  }
  const scramble = (len: number) => Array.from({ length: len }, () => '▓▒░█'[Math.floor(Math.random() * 4)]).join('');

  // Peek tool
  let peekTarget = $state<Record<number, number | ''>>({});
  const others = $derived(s.players.filter((p) => p.id !== s.me?.id));
  const ticker = (id: string) => s.market.find((m) => m.id === id)?.ticker ?? id;
  const usePeek = (c: MyChallenge) => run(() => dapi('POST', `/api/me/challenges/${c.id}/peek`, { targetPlayerId: Number(peekTarget[c.id]) }));
  const nameOf = (id: number | null) => s.players.find((p) => p.id === id)?.displayName ?? '?';
</script>

{#each s.me?.challenges ?? [] as c (c.id)}
  <div class="msg panel memo" class:unread={c.status === 'sent'}>
    <span class="small muted mono">{time(c.createdAt)} · {t('phone.memo_title')}</span>
    {#if !isOpen(c)}
      <button class="mono" onclick={() => decrypt(c)} disabled={decrypting === c.id}>
        {decrypting === c.id ? t('phone.memo_decrypting') : t('phone.memo_tap')}
      </button>
      <span class="mono muted small">{scramble(32)}</span>
    {:else}
      <span>{c.text}</span>
      <span class="small"><strong>{t('phone.memo_reward')}:</strong> {rewardText(c.reward)}</span>
      {#if c.status === 'sent' || c.status === 'read'}
        <div class="actions">
          <button class="primary" onclick={() => respond(c, true)}>{t('phone.memo_accept')}</button>
          <button onclick={() => respond(c, false)}>{t('phone.memo_reject')}</button>
        </div>
      {:else}
        <span class="small muted">{t(`phone.memo_status.${c.status}`)}</span>
      {/if}
      {#if c.status === 'succeeded' && c.reward.type === 'dead_clue'}
        <span class="small">{t('phone.dead_clue')}</span>
      {/if}
      {#if c.peek}
        {#if !c.peek.used}
          <span class="small">{t('phone.peek_pick')}</span>
          <div class="actions">
            <select bind:value={peekTarget[c.id]}>
              <option value="">—</option>
              {#each others as p (p.id)}<option value={p.id}>{p.displayName}</option>{/each}
            </select>
            <button class="primary" disabled={!peekTarget[c.id]} onclick={() => usePeek(c)}>Look</button>
          </div>
        {:else}
          <span class="small"><strong>{nameOf(c.peek.targetId)}</strong></span>
          {#each c.peek.trades as tr}
            <span class="small mono">{time(tr.createdAt)} {tr.side.toUpperCase()} {ticker(tr.securityId)} {(tr.sharesH / 100).toFixed(2)} @ {tr.price.toFixed(2)}</span>
          {:else}
            <span class="small muted">{t('phone.peek_none')}</span>
          {/each}
        {/if}
      {/if}
    {/if}
  </div>
{/each}

{#each s.me?.messages ?? [] as m (m.id)}
  <button class="msg panel" class:unread={!m.read} onclick={() => !m.read && read(m.id)}>
    <span class="small muted">{time(m.createdAt)} · Compliance Office</span>
    <span>{m.message}</span>
  </button>
{/each}
{#if !s.me?.messages.length && !s.me?.challenges.length}<p class="muted">No messages.</p>{/if}

<style>
  .msg {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    text-align: left;
    gap: 0.3rem;
  }
  .memo {
    border-style: dashed;
  }
  .unread {
    border-left: 4px solid var(--accent);
  }
</style>
