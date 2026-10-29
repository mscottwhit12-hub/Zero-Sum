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

<div class="stm">
  {#if err}
    <p class="muted">{err}</p>
  {:else if !s}
    <p class="muted">{t('phone.statement.loading')}</p>
  {:else}
    <div class="hd2">{s.night.name} · {s.night.date}</div>
    <h2>{t('phone.statement.title')}</h2>
    <div class="ctr">
      <div class="muted">{t('phone.statement.gold')}</div>
      <div class="fin">{gold(s.goldH)}</div>
      <div style="font-size:1.05rem">{s.rank == null ? '' : t('phone.statement.rank', { rank: s.rank, players: s.players })}</div>
      {#if s.rankStart != null}<div class="muted small">{t('phone.statement.movement', { start: s.rankStart, end: s.rank ?? '—', best: s.rankBest ?? '—' })}</div>{/if}
    </div>
    <div class="cd" style="margin-top:1rem">
      <div class="kv"><span>{t('phone.statement.trading')}</span><b>{signedGold(s.tradingResultH)}</b></div>
      {#if s.bestTrade}<div class="kv"><span>{t('phone.statement.best')}</span><b>{s.bestTrade.ticker} {signedGold(s.bestTrade.profitH ?? 0)}</b></div>{/if}
      {#if s.worstTrade}<div class="kv"><span>{t('phone.statement.worst')}</span><b>{s.worstTrade.ticker} {signedGold(s.worstTrade.profitH ?? 0)}</b></div>{/if}
      <div class="kv"><span>{t('phone.statement.votes')}</span><b>{s.correctVotes} / {s.votesCast}</b></div>
      <div class="kv"><span>{t('phone.statement.nfts')}</span><b>{s.nftsMinted.toLocaleString()}</b></div>
      <div class="kv"><span>{t('phone.statement.achievements')}</span><b style="font:400 1rem var(--font)">{s.achievements.length ? s.achievements.map((a) => t(`achievements.${a}.name`)).join(', ') : t('phone.statement.none')}</b></div>
    </div>
    <button class="primary wide" disabled={busy} onclick={download}>{t('phone.statement.download')}</button>
    <div class="muted small">{t('phone.statement.trades')} ({s.trades.length})</div>
    {#each s.trades as tr, i (i)}
      <div class="tr">
        <span>{time(tr.at)} {tr.forced ? 'AUTO' : tr.side.toUpperCase()} {tr.ticker}</span>
        <span>{tr.profitH == null ? gold(tr.cashH) : signedGold(tr.profitH)}</span>
      </div>
    {/each}
  {/if}
</div>
