<script lang="ts">
  import { gold, price, signedGold } from '@shared/format';
  import type { PlayerState } from '@shared/types';
  import { securityName } from '../names';
  let { s }: { s: PlayerState } = $props();
  const me = $derived(s.me!);
  const sec = (id: string) => s.market.find((m) => m.id === id);
</script>

<div class="panel">
  <div class="spread"><span class="muted">Gold</span><strong class="mono big">{gold(me.cashH)}</strong></div>
  <div class="spread"><span class="muted">Net worth</span><span class="mono">{gold(me.netWorthH)}</span></div>
  <div class="spread"><span class="muted">Rank</span><span class="mono">{me.rank ?? '—'} / {s.standings.length}</span></div>
  <div class="spread"><span class="muted">Re-rolls left</span><span class="mono">{me.rerollsLeft}</span></div>
  <div class="spread"><span class="muted">Can still invest</span><span class="mono">{gold(me.capRemainingH)}</span></div>
</div>

<div class="panel">
  <h3>Holdings</h3>
  {#each me.holdings as h (h.securityId)}
    {@const m = sec(h.securityId)}
    <div class="spread line">
      <span>{m ? securityName(s, m) : h.securityId} <span class="muted small mono">{(h.sharesH / 100).toFixed(2)} sh</span></span>
      <span class="mono">{gold(h.valueH)} <span class="small" class:good={h.valueH >= h.costBasisH} class:bad={h.valueH < h.costBasisH}>{signedGold(h.valueH - h.costBasisH)}</span></span>
    </div>
  {/each}
  {#if !me.holdings.length}<p class="muted small">No holdings.</p>{/if}
</div>

<div class="panel">
  <h3>Recent trades</h3>
  {#each me.trades.slice(0, 15) as tr, i (i)}
    {@const m = sec(tr.securityId)}
    <div class="spread small line">
      <span>{tr.forced ? 'Auto-sell' : tr.side === 'buy' ? 'Bought' : 'Sold'} {m ? securityName(s, m) : tr.securityId}</span>
      <span class="mono">{(tr.sharesH / 100).toFixed(2)} @ {price(tr.price)} · {signedGold(tr.cashH)}</span>
    </div>
  {/each}
  {#if !me.trades.length}<p class="muted small">No trades yet.</p>{/if}
</div>

<style>
  .big {
    font-size: 1.4rem;
  }
  .line {
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--line);
  }
</style>
