<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '@shared/copy';
  import { gold, price, signedGold } from '@shared/format';
  import { nightNow } from '@shared/socket';
  import Sparkline from '@shared/Sparkline.svelte';
  import { run } from '@shared/ui';
  import type { PlayerState, Security } from '@shared/types';
  import { dapi } from '../device';
  import { pct, securityBlurb, securityName } from '../names';

  let { s }: { s: PlayerState } = $props();
  let selected = $state<string | null>(null);
  let amount = $state<number | ''>('');
  let sellShares = $state<number | ''>('');
  let busy = $state(false);
  let now = $state(Date.now());
  const timer = setInterval(() => (now = Date.now()), 1000);
  onDestroy(() => clearInterval(timer));

  const me = $derived(s.me!);
  const open = $derived(s.night?.status === 'live' && !s.night.tradingClosed);
  const rules = $derived(s.night!.rules);
  const order = { player: 0, index: 1, crypto: 2, event: 3, dead: 4 } as const;
  const list = $derived([...s.market].sort((a, b) => order[a.kind] - order[b.kind] || securityName(s, a).localeCompare(securityName(s, b))));
  const sec = $derived(s.market.find((m) => m.id === selected) ?? null);
  const holding = $derived(me.holdings.find((h) => h.securityId === selected) ?? null);
  const nms = $derived(nightNow(s.night, now));
  const unlocked = $derived(holding ? holding.lots.filter((l) => l.unlockNms <= nms).reduce((a, l) => a + l.sharesH, 0) : 0);
  const maxBuy = $derived(Math.floor(Math.min(me.cashH, me.capRemainingH) / 10) / 10);
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const msg = (e: unknown) => e;

  async function doBuy() {
    if (!sec || !amount) return;
    busy = true;
    const r = await run(() => dapi<{ sharesH: number }>('POST', '/api/trade/buy', { securityId: sec.id, gold: Number(amount) }));
    busy = false;
    if (r) {
      amount = '';
      navigator.vibrate?.(30);
    }
  }
  async function doSell(all: boolean) {
    if (!sec) return;
    busy = true;
    const r = await run(() => dapi('POST', '/api/trade/sell', { securityId: sec.id, shares: all ? 'all' : Number(sellShares) }));
    busy = false;
    if (r) sellShares = '';
  }
  void msg;
  const change = (m: Security) => pct(m.price, m.history[0] ?? m.price);
</script>

{#if !sec}
  {#if !open}<p class="notice small">{s.night?.tradingClosed ? t('trade_errors.market_closed') : 'Trading opens when the market is live.'}</p>{/if}
  {#each list as m (m.id)}
    {@const h = me.holdings.find((x) => x.securityId === m.id)}
    <button class="row-btn" onclick={() => (selected = m.id)}>
      <span class="left">
        <strong>{securityName(s, m)}</strong>
        <span class="muted small mono">{m.ticker}{m.playerId === me.id ? ' · you' : ''}{h ? ` · ${(h.sharesH / 100).toFixed(2)} sh` : ''}</span>
      </span>
      <Sparkline values={m.history} />
      <span class="right mono">
        {price(m.price)}
        <span class="small" class:good={Number(change(m)) >= 0} class:bad={Number(change(m)) < 0}>{change(m)}%</span>
      </span>
    </button>
  {/each}
{:else}
  <button onclick={() => (selected = null)}>‹ All stocks</button>
  <div class="panel" style="margin-top:.5rem">
    <div class="spread">
      <div><h2>{securityName(s, sec)}</h2><span class="muted mono small">{sec.ticker}</span></div>
      <strong class="mono" style="font-size:1.4rem">{price(sec.price)}</strong>
    </div>
    <Sparkline values={sec.history} width={300} height={70} />
    {#if securityBlurb(sec)}<p class="small muted">{securityBlurb(sec)}</p>{/if}
  </div>

  {#if holding}
    <div class="panel small">
      <div class="spread"><span class="muted">You hold</span><span class="mono">{(holding.sharesH / 100).toFixed(2)} sh · {gold(holding.valueH)}</span></div>
      <div class="spread"><span class="muted">Paid</span><span class="mono">{gold(holding.costBasisH)} ({signedGold(holding.valueH - holding.costBasisH)})</span></div>
      {#each holding.lots as l, i (i)}
        <div class="spread muted"><span>Lot {i + 1}: {(l.sharesH / 100).toFixed(2)} sh</span><span class="mono">{l.unlockNms > nms ? `locked ${mmss(l.unlockNms - nms)}` : 'unlocked'}</span></div>
      {/each}
    </div>
  {/if}

  <div class="panel">
    <h3>Buy</h3>
    <div class="row">
      <input type="number" step="any" min="1" placeholder="Gold" bind:value={amount} style="width:110px" />
      {#each [1, 5, 10] as q}<button class="chip" onclick={() => (amount = q)}>{q}</button>{/each}
      <button class="chip" onclick={() => (amount = maxBuy)}>Max</button>
    </div>
    <p class="small muted">Fee {Math.round(rules.feeFrac * 100)}% · shares lock for {rules.lockoutMinutes} min · you can invest {gold(me.capRemainingH)} more</p>
    <button class="primary big" disabled={!open || busy || !amount} onclick={doBuy}>Buy</button>
  </div>

  {#if holding}
    <div class="panel">
      <h3>Sell</h3>
      <div class="row">
        <input type="number" step="any" min="0.01" placeholder="Shares" bind:value={sellShares} style="width:110px" />
        <button disabled={!open || busy || !sellShares} onclick={() => doSell(false)}>Sell</button>
        <button class="primary" disabled={!open || busy || unlocked === 0} onclick={() => doSell(true)}>Sell all unlocked ({(unlocked / 100).toFixed(2)})</button>
      </div>
    </div>
  {/if}
{/if}

<style>
  .row-btn {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.6rem;
    align-items: center;
    width: 100%;
    text-align: left;
    margin-bottom: 0.4rem;
    padding: 0.55rem 0.7rem;
    background: var(--panel);
  }
  .left {
    display: flex;
    flex-direction: column;
  }
  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .notice {
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    color: var(--warn);
  }
</style>
