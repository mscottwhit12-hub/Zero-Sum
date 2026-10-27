<script lang="ts">
  /** Final Account Statement (spec §15.3), shown once the TV finale has finished. */
  import { onMount } from 'svelte';
  import { t } from '@shared/copy';
  import { gold, signedGold } from '@shared/format';
  import { toast, errorText } from '@shared/ui';
  import type { Statement } from '@shared/types';
  import { dapi, deviceToken } from './device';

  let s = $state<Statement | null>(null);
  let err = $state<string | null>(null);
  onMount(async () => {
    try {
      s = await dapi<Statement>('GET', '/api/me/statement');
    } catch (e) {
      err = errorText(e);
    }
  });
  let busy = $state(false);
  async function download() {
    busy = true;
    try {
      const res = await fetch('/api/me/statement.pdf', { headers: { 'x-device-token': deviceToken() ?? '' } });
      if (!res.ok) throw new Error(res.statusText);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'statement.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      busy = false;
    }
  }
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<div class="pad">
  {#if err}
    <p class="muted">{err}</p>
  {:else if !s}
    <p class="muted">{t('phone.statement.loading')}</p>
  {:else}
    <div class="small muted mono">{s.night.name} · {s.night.date}</div>
    <h2>{t('phone.statement.title')}</h2>
    <div class="center">
      <div class="small muted">{t('phone.statement.gold')}</div>
      <div class="mono hero">{gold(s.goldH)}</div>
      <div>{s.rank == null ? '' : t('phone.statement.rank', { rank: s.rank, players: s.players })}</div>
      {#if s.rankStart != null}<div class="small muted">{t('phone.statement.movement', { start: s.rankStart, end: s.rank ?? '—', best: s.rankBest ?? '—' })}</div>{/if}
    </div>
    <div class="panel rows">
      <div class="spread"><span>{t('phone.statement.trading')}</span><span class="mono">{signedGold(s.tradingResultH)}</span></div>
      {#if s.bestTrade}<div class="spread"><span>{t('phone.statement.best')}</span><span class="mono">{s.bestTrade.ticker} {signedGold(s.bestTrade.profitH ?? 0)}</span></div>{/if}
      {#if s.worstTrade}<div class="spread"><span>{t('phone.statement.worst')}</span><span class="mono">{s.worstTrade.ticker} {signedGold(s.worstTrade.profitH ?? 0)}</span></div>{/if}
      <div class="spread"><span>{t('phone.statement.votes')}</span><span class="mono">{s.correctVotes} / {s.votesCast}</span></div>
      <div class="spread"><span>{t('phone.statement.nfts')}</span><span class="mono">{s.nftsMinted.toLocaleString()}</span></div>
      <div class="spread"><span>{t('phone.statement.achievements')}</span><span>{s.achievements.length ? s.achievements.map((a) => t(`achievements.${a}.name`)).join(', ') : t('phone.statement.none')}</span></div>
    </div>
    <button class="primary wide" disabled={busy} onclick={download}>{t('phone.statement.download')}</button>
    <h3 class="small muted">{t('phone.statement.trades')} ({s.trades.length})</h3>
    {#each s.trades as tr, i (i)}
      <div class="spread small mono line">
        <span>{time(tr.at)} {tr.forced ? 'AUTO' : tr.side.toUpperCase()} {tr.ticker}</span>
        <span>{tr.profitH == null ? gold(tr.cashH) : signedGold(tr.profitH)}</span>
      </div>
    {/each}
  {/if}
</div>

<style>
  .pad {
    padding: 1rem;
  }
  .center {
    text-align: center;
    margin: 1rem 0;
  }
  .hero {
    font-size: 2.4rem;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .wide {
    width: 100%;
    margin: 0.8rem 0;
    min-height: 48px;
  }
  .line {
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--line);
  }
</style>
