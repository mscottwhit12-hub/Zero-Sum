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
  // Image cards: the server draws SVGs; the phone turns each into a PNG up front, so a tap can open the share
  // sheet at once (iOS refuses to share if the tap has to wait for image work first).
  let cards = $state<string[]>([]);
  let files = $state<(File | null)[]>([]); // same order as `cards`; null where a card couldn't be converted
  const ready = $derived(files.filter((f): f is File => !!f));
  let started = false;
  async function toPng(src: string, name: string): Promise<File | null> {
    const img = new Image();
    // onload, not decode(): Safari can reject decode() for SVG images that draw fine.
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error('card image'));
      img.src = src;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 1080;
    c.height = img.naturalHeight || 1350;
    c.getContext('2d')!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return blob ? new File([blob], name, { type: 'image/png' }) : null;
  }
  async function loadCards() {
    const out: string[] = [];
    const pngs: (File | null)[] = [];
    for (const n of [1, 2, 3]) {
      const res = await fetch(`/api/me/cards/${n}.svg`, { headers: { 'x-device-token': deviceToken() ?? '' } });
      if (!res.ok) continue;
      const src = URL.createObjectURL(new Blob([await res.text()], { type: 'image/svg+xml' }));
      out.push(src);
      const f = await toPng(src, `game-night-${n}.png`).catch(() => null);
      pngs.push(f);
    }
    cards = out;
    files = pngs;
  }
  $effect(() => {
    if (s && !started) {
      started = true;
      loadCards().catch(() => {}); // no cards is fine: the PDF button still works
    }
  });
  const sharable = (list: File[]) => (navigator as Navigator & { canShare?: (d: unknown) => boolean }).canShare?.({ files: list }) === true;
  function downloadFiles(list: File[]) {
    for (const f of list) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }
  }
  /** One share sheet with every image: on an iPhone it offers "Save N Images", straight to Photos. */
  let sharing = false; // a second tap while the sheet is open would only error
  async function saveImages(list: File[]) {
    if (!list.length || sharing) return;
    if (!sharable(list)) return downloadFiles(list);
    sharing = true;
    try {
      await navigator.share({ files: list });
    } catch (e) {
      // Closing the sheet is not an error.
      if (!['AbortError', 'InvalidStateError'].includes((e as Error).name)) toast(t('phone.statement.save_failed'), 'error');
    } finally {
      sharing = false;
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
    {@const x = s.stats}
    <div class="cd">
      <div class="kv"><span>Title</span><b>{x.title}</b></div>
      <div class="kv"><span>Gold from games</span><b>{gold(x.gameGoldH)}</b></div>
      {#each x.games as gm, i (i)}<div class="kv small"><span>{gm.name}</span><b>{gm.dnf ? 'DNF' : gm.placement != null ? `${gm.placement}/${gm.players}` : '—'} · +{gold(gm.goldH)}</b></div>{/each}
      <div class="kv"><span>Trades · fees</span><b>{x.tradeCount} · {gold(x.feesH)}</b></div>
      <div class="kv"><span>Biggest short win</span><b>{x.bestShortH == null ? '—' : signedGold(x.bestShortH)}</b></div>
      {#if x.ownStock}<div class="kv"><span>{x.ownStock.ticker} high · low · close</span><b>{x.ownStock.high.toFixed(2)} · {x.ownStock.low.toFixed(2)} · {x.ownStock.close.toFixed(2)}</b></div>{/if}
      <div class="kv"><span>Biggest backer</span><b>{x.biggestBacker?.name ?? '—'}</b></div>
      <div class="kv"><span>Bounties</span><b>{gold(x.bountiesH)}</b></div>
      <div class="kv"><span>Re-rolls used</span><b>{x.rerollsUsed}</b></div>
      <div class="kv"><span>Minter rank</span><b>{x.minterRank == null ? '—' : `#${x.minterRank}`}</b></div>
      <div class="kv"><span>Playing · idle</span><b>{x.playHours.toFixed(1)} h · {x.idleHours.toFixed(1)} h</b></div>
      <div class="kv"><span>Chat messages</span><b>{x.chatMessages}</b></div>
    </div>
    {#if cards.length}
      <div class="muted small">Cards to share</div>
      <div class="cards">
        {#each cards as src, i (src)}
          <button class="card" onclick={() => (files[i] ? saveImages([files[i]!]) : toast(t('phone.statement.save_failed'), 'error'))} aria-label={`Save card ${i + 1}`}><img {src} alt={`Card ${i + 1}`} /></button>
        {/each}
      </div>
      <div class="muted small">Tap a card to save or share just that one.</div>
    {/if}
    {#if ready.length}
      <button class="primary wide" onclick={() => saveImages(ready)}>{t('phone.statement.save_images')}</button>
      <div class="muted small">{t('phone.statement.save_hint')}</div>
    {/if}
    <button class="wide" disabled={busy} onclick={download}>{t('phone.statement.download')}</button>
    <div class="muted small">{t('phone.statement.trades')} ({s.trades.length})</div>
    {#each s.trades as tr, i (i)}
      <div class="tr">
        <span>{time(tr.at)} {tr.forced ? 'AUTO' : tr.side.toUpperCase()} {tr.ticker}</span>
        <span>{tr.profitH == null ? gold(tr.cashH) : signedGold(tr.profitH)}</span>
      </div>
    {/each}
  {/if}
</div>

<style>
  .cards { display: flex; gap: 0.5rem; overflow-x: auto; padding: 0.25rem 0; }
  .card { flex: 0 0 auto; padding: 0; border: 0; background: none; }
  .card img { width: 140px; height: auto; display: block; border-radius: 4px; }
</style>
