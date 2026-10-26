<script lang="ts">
  import { t } from '@shared/copy';
  import { gold } from '@shared/format';
  import type { PlayerState } from '@shared/types';
  let { s }: { s: PlayerState } = $props();
  const r = $derived(s.night!.rules);
</script>

<div class="panel small stack">
  <p class="muted">{t('phone.rules_soon')}</p>
  <h3>House rules (market)</h3>
  <p>Buy any stock with gold. Each purchase is locked for {r.lockoutMinutes} minutes, then you can sell it (oldest first).</p>
  <p>Trade fee: {Math.round(r.feeFrac * 100)}%. You can have at most {gold(r.investCapH)} gold invested at once. Minimum trade: {gold(r.minTradeH)} gold.</p>
  <p>At the end of the night every holding is sold automatically. A {Math.round(r.endSellProfitFeeFrac * 100)}% fee applies to profits; losses are exempt.</p>
  <p>Ranking is by net worth: your gold plus what your stocks would sell for. The winner is whoever has the most gold after the collapse.</p>
</div>
