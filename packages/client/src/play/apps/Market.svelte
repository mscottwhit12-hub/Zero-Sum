<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '@shared/copy';
  import { gold, price, signedGold } from '@shared/format';
  import { nightNow } from '@shared/socket';
  import Sparkline from '@shared/Sparkline.svelte';
  import TickCountdown from '@shared/TickCountdown.svelte';
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
  const holding = $derived(me.holdings.find((h) => h.securityId === selected && !h.short) ?? null);
  const shortPos = $derived(me.holdings.find((h) => h.securityId === selected && h.short) ?? null);
  const shortUnlocked = $derived(shortPos ? shortPos.lots.filter((l) => l.unlockNms <= nms).reduce((a, l) => a + l.sharesH, 0) : 0);
  let shortAmount = $state<number | ''>('');
  const canShort = $derived(!!sec && sec.playerId !== me.id);
  const nms = $derived(nightNow(s.night, now));
  const unlocked = $derived(holding ? holding.lots.filter((l) => l.unlockNms <= nms).reduce((a, l) => a + l.sharesH, 0) : 0);
  const maxBuy = $derived(Math.floor(Math.min(me.cashH, me.capRemainingH) / 10) / 10);
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const msg = (e: unknown) => e;

  // Chart time range: the phone only keeps the last 60 prices, so other windows come from the server.
  const RANGES: { k: 'm10' | 'm30' | 'h1' | 'h2' | 'h4' | 'h8' | 'full'; min: number | null }[] = [
    { k: 'm10', min: 10 },
    { k: 'm30', min: 30 },
    { k: 'h1', min: 60 },
    { k: 'h2', min: 120 },
    { k: 'h4', min: 240 },
    { k: 'h8', min: 480 },
    { k: 'full', min: null },
  ];
  let range = $state<(typeof RANGES)[number]['k']>('m30');
  let series = $state<{ id: string; k: string; prices: number[]; from: number | null; to: number | null } | null>(null);
  let seriesReq = 0;
  // Refetch when the stock or range changes, and again whenever the price moves (a new tick).
  $effect(() => {
    const id = sec?.id;
    void sec?.price;
    const r = RANGES.find((x) => x.k === range)!;
    if (!id) return;
    const mine = ++seriesReq;
    dapi<{ prices: number[]; from: number | null; to: number | null }>('GET', `/api/market/${encodeURIComponent(id)}/history${r.min == null ? '' : `?minutes=${r.min}`}`)
      .then((d) => {
        if (mine === seriesReq) series = { id, k: r.k, prices: d.prices, from: d.from, to: d.to };
      })
      .catch(() => {});
  });
  const loaded = $derived(sec && series && series.id === sec.id && series.k === range ? series : null);
  // While the server answers, show what the phone already has, cut to the chosen window where it can be.
  const chartValues = $derived.by(() => {
    if (loaded) return loaded.prices;
    const h = sec?.history ?? [];
    const min = RANGES.find((x) => x.k === range)?.min;
    return min == null ? h : h.slice(-Math.ceil((min * 60) / (s.night?.tickSeconds || 20)) - 1);
  });
  /** What the chart really covers: shorter than the chip when the night is young. */
  const spanText = $derived.by(() => {
    if (!loaded || loaded.from == null || loaded.to == null) return '';
    const m = Math.max(1, Math.round((loaded.to - loaded.from) / 60_000));
    return m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
  });

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
  async function doShort() {
    if (!sec || !shortAmount) return;
    busy = true;
    const r = await run(() => dapi('POST', '/api/trade/short', { securityId: sec.id, gold: Number(shortAmount) }));
    busy = false;
    if (r) {
      shortAmount = '';
      navigator.vibrate?.(30);
    }
  }
  async function doCover() {
    if (!sec) return;
    busy = true;
    await run(() => dapi('POST', '/api/trade/cover', { securityId: sec.id, shares: 'all' }));
    busy = false;
  }
  void msg;
  const change = (m: Security) => pct(m.price, m.history[0] ?? m.price);
</script>

{#if !sec}
  {#if !open}<p class="notice small">{s.night?.tradingClosed ? t('trade_errors.market_closed') : 'Trading opens when the market is live.'}</p>{/if}
  <div class="sub">All prices final. Until they aren’t. <TickCountdown night={s.night} /></div>
  <div class="grp">
    {#each list as m (m.id)}
      {@const h = me.holdings.find((x) => x.securityId === m.id && !x.short)}
      {@const hs = me.holdings.find((x) => x.securityId === m.id && x.short)}
      {@const c = Number(change(m))}
      <button class="r k-{m.kind}" class:dead={m.kind === 'dead'} class:me={m.playerId === me.id} onclick={() => (selected = m.id)}>
        <span class="mono-t">{m.ticker.slice(0, 2)}</span>
        <b>{securityName(s, m)}</b>
        <span class="pr">{price(m.price)}</span>
        <span class="t">{m.ticker}{m.playerId === me.id ? ' · you' : ''}{h ? ` · ${(h.sharesH / 100).toFixed(2)} sh` : ''}{hs ? ' · short' : ''}</span>
        <span class="ch" class:up={c > 0} class:dn={c < 0} class:flat={c === 0}>{c > 0 ? `▲ +${change(m)}` : c < 0 ? `▼ −${change(m).replace('-', '')}` : '■ 0.0'}%</span>
      </button>
    {/each}
  </div>
{:else}
  <button class="back" onclick={() => (selected = null)}>‹ All stocks</button>
  <div class="cd">
    <div class="kv top">
      <div><h2>{securityName(s, sec)}</h2><span class="muted mono small">{sec.ticker}</span></div>
      <b class="px">{price(sec.price)}</b>
    </div>
    <Sparkline values={chartValues} width={300} height={70} />
    <div class="ranges" role="group" aria-label={t('phone.chart.aria')}>
      {#each RANGES as r (r.k)}
        <button class="chip" class:on={range === r.k} aria-pressed={range === r.k} onclick={() => (range = r.k)}>{t(`phone.chart.${r.k}`)}</button>
      {/each}
    </div>
    {#if spanText}<div class="muted small ctr" aria-live="polite">{t('phone.chart.span', { span: spanText })}</div>{/if}
    {#if securityBlurb(sec)}<p>{securityBlurb(sec)}</p>{/if}
  </div>

  {#if holding}
    <div class="cd">
      <div class="kv"><span>You hold</span><b>{(holding.sharesH / 100).toFixed(2)} sh · {gold(holding.valueH)}</b></div>
      <div class="kv"><span>Paid</span><b>{gold(holding.costBasisH)} ({signedGold(holding.valueH - holding.costBasisH)})</b></div>
      {#each holding.lots as l, i (i)}
        <div class="kv"><span>Lot {i + 1}: {(l.sharesH / 100).toFixed(2)} sh</span><b>{l.unlockNms > nms ? `locked ${mmss(l.unlockNms - nms)}` : 'unlocked'}</b></div>
      {/each}
    </div>
  {/if}

  <div class="cd">
    <h3>Buy</h3>
    <div class="row">
      <input type="number" step="any" min="1" placeholder="Gold" bind:value={amount} style="width:110px" />
      {#each [1, 5, 10] as q}<button class="chip" onclick={() => (amount = q)}>{q}</button>{/each}
      <button class="chip" onclick={() => (amount = maxBuy)}>Max</button>
    </div>
    <p>Fee {Math.round(rules.feeFrac * 100)}% · shares lock for {rules.lockoutMinutes} min · you can invest {gold(me.capRemainingH)} more</p>
    <button class="primary big" disabled={!open || busy || !amount} onclick={doBuy}>Buy</button>
  </div>

  {#if shortPos}
    <div class="cd">
      <div class="kv"><span>Your short</span><b>{gold(shortPos.valueH)}</b></div>
      <div class="kv"><span>Staked</span><b>{gold(shortPos.costBasisH)} ({signedGold(shortPos.valueH - shortPos.costBasisH)})</b></div>
      {#each shortPos.lots as l, i (i)}
        <div class="kv"><span>Short {i + 1}: from {price(l.entry ?? 0)}</span><b>{l.unlockNms > nms ? `locked ${mmss(l.unlockNms - nms)}` : 'unlocked'}</b></div>
      {/each}
      <button class="primary" disabled={!open || busy || shortUnlocked === 0} onclick={doCover}>Close short (unlocked)</button>
    </div>
  {/if}

  {#if canShort}
    <div class="cd">
      <h3>Short</h3>
      <p>Bet it falls: gain its % drop, lose its % rise. You can't lose more than you stake.</p>
      <div class="row">
        <input type="number" step="any" min="1" placeholder="Gold" bind:value={shortAmount} style="width:110px" />
        {#each [1, 5, 10] as q}<button class="chip" onclick={() => (shortAmount = q)}>{q}</button>{/each}
        <button class="chip" onclick={() => (shortAmount = maxBuy)}>Max</button>
      </div>
      <button class="big" disabled={!open || busy || !shortAmount} onclick={doShort}>Short</button>
    </div>
  {/if}

  {#if holding}
    <div class="cd">
      <h3>Sell</h3>
      <div class="row">
        <input type="number" step="any" min="0.01" placeholder="Shares" bind:value={sellShares} style="width:110px" />
        <button disabled={!open || busy || !sellShares} onclick={() => doSell(false)}>Sell</button>
        <button class="primary" disabled={!open || busy || unlocked === 0} onclick={() => doSell(true)}>Sell all unlocked ({(unlocked / 100).toFixed(2)})</button>
      </div>
    </div>
  {/if}
{/if}
