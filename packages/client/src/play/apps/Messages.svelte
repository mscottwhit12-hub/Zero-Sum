<script lang="ts">
  import { t } from '@shared/copy';
  import { run } from '@shared/ui';
  import type { MyChallenge, PlayerState, Reward, TipTier } from '@shared/types';
  import { clock } from '@shared/format';
  import { nightNow } from '@shared/socket';
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
    if (r.type === 'hint') return t('phone.rewards.hint', { tier: t(`phone.tip_tiers.${r.tier ?? 'common'}`) });
    if (r.type === 'custom') return t('phone.rewards.custom', { text: r.text ?? '' });
    if (r.type === 'wiretap') return t(r.mode === 'pair' ? 'phone.rewards.wiretap_pair' : 'phone.rewards.wiretap');
    return t(`phone.rewards.${r.type}`);
  }
  const scramble = (len: number) => Array.from({ length: len }, () => '▓▒░█'[Math.floor(Math.random() * 4)]).join('');

  // Peek tool
  let peekTarget = $state<Record<number, number | ''>>({});
  const others = $derived(s.players.filter((p) => p.id !== s.me?.id));
  const ticker = (id: string) => s.market.find((m) => m.id === id)?.ticker ?? id;
  const usePeek = (c: MyChallenge) => run(() => dapi('POST', `/api/me/challenges/${c.id}/peek`, { targetPlayerId: Number(peekTarget[c.id]) }));
  const nameOf = (id: number | null) => s.players.find((p) => p.id === id)?.displayName ?? '?';
  // Wiretap tool
  let tapA = $state<Record<number, number | ''>>({});
  let tapB = $state<Record<number, number | ''>>({});
  const useTap = (c: MyChallenge) =>
    run(() => dapi('POST', `/api/me/challenges/${c.id}/wiretap`, c.wiretap?.mode === 'pair' ? { a: Number(tapA[c.id]), b: Number(tapB[c.id]) } : {}));
  const tapThread = (th: { kind: string; name: string | null; members: number[] }, from: number) =>
    th.kind === 'dm' ? `to ${th.members.filter((m) => m !== from).map(nameOf).join(', ')}` : `in ${th.name ?? th.members.map(nameOf).join(', ')}`;

  // Anonymous tips and gifts, newest first.
  const inbox = $derived(
    [
      ...(s.me?.tips ?? []).map((x) => ({ key: `t${x.id}`, kind: 'tip' as const, id: x.id, createdAt: x.createdAt, read: x.read, text: t(`hints.${x.hintId}`, x.vars) })),
      ...(s.me?.gifts ?? []).map((x) => ({ key: `g${x.id}`, kind: 'gift' as const, id: x.id, createdAt: x.createdAt, read: x.read, text: t('phone.gift_body', { gold: (x.goldH / 100).toFixed(1) }) })),
    ].sort((a, b) => b.createdAt - a.createdAt),
  );
  const readTip = (id: number) => dapi('POST', `/api/me/tips/${id}/read`).catch(() => {});
  const readGift = (id: number) => dapi('POST', `/api/me/gifts/${id}/read`).catch(() => {});
  let busy = $state(false);
  const once = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    busy = true;
    try {
      await run(fn);
    } finally {
      busy = false;
    }
  };
  const buy = (tier: TipTier) => once(() => dapi('POST', '/api/me/tips/buy', { tier }));
  const trade = () => once(() => dapi('POST', '/api/me/tips/trade-reroll'));
  let nowWall = $state(Date.now());
  $effect(() => {
    const h = setInterval(() => (nowWall = Date.now()), 1000);
    return () => clearInterval(h);
  });
  const nowNms = $derived(nightNow(s.night, nowWall));
</script>

{#if s.me?.tipShop?.buy || (s.me?.tipShop?.tradeIn && s.me.tipShop.tradeIn.tokens > 0)}
  <div class="cd shop">
    <p>{t('phone.tip_shop')}</p>
    {#if s.me.tipShop.buy}
      <div class="actions">
        {#each ['common', 'rarer', 'rarest'] as tier (tier)}
          {@const price = s.me.tipShop.buy[tier as TipTier]}
          <button disabled={busy || (s.me?.cashH ?? 0) < price * 100 || s.night?.status !== 'live'} onclick={() => buy(tier as TipTier)}>
            {t('phone.tip_buy', { tier: t(`phone.tip_tiers.${tier}`), price })}
          </button>
        {/each}
      </div>
    {/if}
    {#if s.me.tipShop.tradeIn && s.me.tipShop.tradeIn.tokens > 0}
      {@const wait = s.me.tipShop.tradeIn.nextAtNms != null && nowNms < s.me.tipShop.tradeIn.nextAtNms}
      <button class="wide" style="margin:0.4rem 0 0;min-height:44px" disabled={busy || wait || s.night?.status !== 'live'} onclick={trade}>{t('phone.tip_trade')}</button>
      {#if wait}<p>{t('phone.tip_trade_wait', { time: clock((s.me.tipShop.tradeIn.nextAtNms ?? 0) - nowNms) })}</p>{/if}
    {/if}
  </div>
{/if}

{#each inbox as item (item.key)}
  {#if item.kind === 'tip'}
    <button class="tipc" class:rd={item.read} onclick={() => !item.read && readTip(item.id)}>
      <span class="h">{time(item.createdAt)} · {t('phone.tip_from')}</span>
      <span>{item.text}</span>
    </button>
  {:else}
    <button class="tipc" class:rd={item.read} onclick={() => !item.read && readGift(item.id)}>
      <span class="h">{time(item.createdAt)} · {t('phone.gift_from')}</span>
      <span>{item.text}</span>
    </button>
  {/if}
{/each}

{#each s.me?.challenges ?? [] as c (c.id)}
  <div class="tipc memo" class:rd={c.status !== 'sent'}>
    <span class="h">{time(c.createdAt)} · {t('phone.memo_title')}</span>
    {#if !isOpen(c)}
      <button class="mono" onclick={() => decrypt(c)} disabled={decrypting === c.id}>
        {decrypting === c.id ? t('phone.memo_decrypting') : t('phone.memo_tap')}
      </button>
      <span class="scr2">{scramble(32)}</span>
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
      {#if c.wiretap}
        {#if !c.wiretap.result}
          {#if c.wiretap.mode === 'pair'}
            <span class="small">Pick two associates. You'll hear one random message between them.</span>
            <div class="actions">
              <select bind:value={tapA[c.id]} aria-label="First associate">
                <option value="">—</option>
                {#each others as p (p.id)}<option value={p.id}>{p.displayName}</option>{/each}
              </select>
              <select bind:value={tapB[c.id]} aria-label="Second associate">
                <option value="">—</option>
                {#each others as p (p.id)}<option value={p.id}>{p.displayName}</option>{/each}
              </select>
              <button class="primary" disabled={!tapA[c.id] || !tapB[c.id] || tapA[c.id] === tapB[c.id]} onclick={() => useTap(c)}>Listen in</button>
            </div>
          {:else}
            <span class="small">One random message from a chat you're not in. One use.</span>
            <div class="actions"><button class="primary" onclick={() => useTap(c)}>Listen in</button></div>
          {/if}
        {:else}
          {@const r = c.wiretap.result}
          <span class="small muted">{time(r.message.createdAt)} · {nameOf(r.message.playerId)} {tapThread(r.thread, r.message.playerId)}</span>
          <span class="tap">“{r.message.text}”</span>
        {/if}
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
  <button class="tipc" class:rd={m.read} onclick={() => !m.read && read(m.id)}>
    <span class="h">{time(m.createdAt)} · Compliance Office</span>
    <span>{m.message}</span>
  </button>
{/each}
{#if !s.me?.messages.length && !s.me?.challenges.length && !inbox.length}<p class="muted">No messages.</p>{/if}
