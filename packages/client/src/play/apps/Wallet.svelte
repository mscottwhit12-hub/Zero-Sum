<script lang="ts">
  import { gold, price, signedGold } from '@shared/format';
  import type { PlayerState } from '@shared/types';
  import { securityName } from '../names';
  let { s }: { s: PlayerState } = $props();
  const me = $derived(s.me!);
  const sec = (id: string) => s.market.find((m) => m.id === id);
</script>

<div class="cd">
  <div class="kv"><span>Gold</span><b class="big2">{gold(me.cashH)}</b></div>
  <div class="kv"><span>Net worth</span><b>{gold(me.netWorthH)}</b></div>
  <div class="kv"><span>Rank</span><b>{me.rank ?? '—'} / {s.standings.length}</b></div>
  <div class="kv"><span>Re-rolls left</span><b>{me.rerollsLeft}</b></div>
  <div class="kv"><span>Can still invest</span><b>{gold(me.capRemainingH)}</b></div>
</div>

<div class="cd">
  <h3>Holdings</h3>
  {#each me.holdings as h (h.securityId + (h.short ? ':s' : ''))}
    {@const m = sec(h.securityId)}
    <div class="hl">
      <span>{m ? securityName(s, m) : h.securityId} <span class="muted small mono">{h.short ? 'short' : `${(h.sharesH / 100).toFixed(2)} sh`}</span></span>
      <span class="mono">{gold(h.valueH)} <span class="small" class:good={h.valueH >= h.costBasisH} class:bad={h.valueH < h.costBasisH}>{signedGold(h.valueH - h.costBasisH)}</span></span>
    </div>
  {/each}
  {#if !me.holdings.length}<p>No holdings.</p>{/if}
</div>

<div class="cd">
  <h3>Recent trades</h3>
  {#each me.trades.slice(0, 15) as tr, i (i)}
    {@const m = sec(tr.securityId)}
    <div class="hl small">
      <span>{tr.forced ? (tr.short ? 'Auto-closed short' : 'Auto-sell') : tr.short ? (tr.side === 'sell' ? 'Shorted' : 'Closed short') : tr.side === 'buy' ? 'Bought' : 'Sold'} {m ? securityName(s, m) : tr.securityId}</span>
      <span class="mono">{(tr.sharesH / 100).toFixed(2)} @ {price(tr.price)} · {signedGold(tr.cashH)}</span>
    </div>
  {/each}
  {#if !me.trades.length}<p>No trades yet.</p>{/if}
</div>
