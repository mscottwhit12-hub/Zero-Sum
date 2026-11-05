<script lang="ts">
  /**
   * Night end on the TV (spec §17.1): SPECIAL REPORT → tickers turn red and crash to zero →
   * "THE MARKET HAS COLLAPSED. ONLY GOLD REMAINS." → podium 3rd → 2nd → 1st → recap carousel.
   * Timed from the server's recap clock (phones unlock when it ends); `replayFrom` restarts it locally.
   */
  import { t } from '@shared/copy';
  import { goldTv } from '@shared/format';
  import type { RecapSlide, TvState } from '@shared/types';

  let { s, now, replayFrom }: { s: TvState; now: number; replayFrom: number | null } = $props();
  const f = $derived(s.finale!);
  const total = $derived(f.timing.collapseSeconds + 3 * f.timing.podiumStepSeconds + f.slides.length * f.timing.recapSlideSeconds);
  // Server clock → local clock offset (serverTime was "now" when the state was sent).
  const start = $derived(replayFrom ?? (s.night!.recapUntil ?? s.night!.serverTime) - total * 1000);
  const el = $derived(Math.max(0, (now - start) / 1000));
  const podiumAt = $derived(f.timing.collapseSeconds);
  const slidesAt = $derived(podiumAt + 3 * f.timing.podiumStepSeconds);
  const phase = $derived(el < podiumAt ? 'collapse' : el < slidesAt ? 'podium' : el < total ? 'recap' : 'done');
  const revealed = $derived(phase === 'collapse' ? 0 : phase === 'podium' ? Math.min(3, 1 + Math.floor((el - podiumAt) / f.timing.podiumStepSeconds)) : 3);
  const slide = $derived<RecapSlide | null>(phase === 'recap' ? (f.slides[Math.floor((el - slidesAt) / f.timing.recapSlideSeconds)] ?? null) : null);
  // Collapse: prices fall to zero over the first ~70% of the collapse segment.
  const crash = $derived(Math.max(0, 1 - el / (f.timing.collapseSeconds * 0.7)));

  const name = (id: number) => s.players.find((p) => p.id === id)?.displayName ?? '?';
  // Profile pictures on the finale (Tate's QoL list): the player's photo when they set one, else initials on their colour.
  const playerOf = (id: number) => s.players.find((p) => p.id === id);
  const initials = (id: number) => name(id).split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
  const placeLabel = (r: number) => t(`tv.place.${r}`);
  // Reveal order 3rd → 2nd → 1st: rank 3 first, rank 1 last.
  const shown = $derived(f.podium.filter((p) => p.rank > 3 - revealed));
  function slideBody(x: RecapSlide): string {
    switch (x.id) {
      case 'top_trade':
      case 'best_investment':
        return t(`tv.recap.${x.id}_body`, { player: name(x.playerId), ticker: x.ticker, gold: goldTv(x.profitH) });
      case 'worst_investment':
        return t('tv.recap.worst_investment_body', { player: name(x.playerId), ticker: x.ticker, gold: goldTv(-x.profitH) });
      case 'most_predicted':
        return t('tv.recap.most_predicted_body', { player: name(x.playerId), votes: x.votes });
      case 'long_reigns':
        return t('tv.recap.long_reigns_body', { count: x.count });
      case 'mood':
        return t('tv.recap.mood_body', { cheeriest: name(x.cheeriest), moodiest: name(x.moodiest) });
      case 'espionage':
        return t('tv.recap.espionage_body', { sent: x.sent, accepted: x.accepted, completed: x.completed, exposed: x.exposed });
      case 'minter':
        return t('tv.recap.minter_body', { player: name(x.playerId), minted: x.minted.toLocaleString() });
      default:
        return '';
    }
  }
</script>

{#snippet av(id: number, xl: boolean)}
  {@const pl = playerOf(id)}
  <span class="av" class:xl class:pic={!!pl?.avatarPath} style="background:{pl?.color ?? 'var(--navy-hi)'}">{#if pl?.avatarPath}<img src={pl.avatarPath} alt="" />{:else}{initials(id)}{/if}</span>
{/snippet}

<div class="finale">
  {#if phase === 'collapse'}
    {@const cols = s.market.length <= 6 ? 3 : s.market.length <= 12 ? 4 : 5}
    <div class="fin collapse" class:thud={crash < 0.15}>
      <div class="siren"></div>
      <div class="report mono">{t('tv.special_report')}</div>
      <div class="board mono" class:gone={crash < 0.15} style="--cols:{cols};--rows:{Math.max(1, Math.ceil(s.market.length / cols))}">
        {#each s.market as m, i (m.id)}
          <div class="tick" style="--i:{i}"><span class="tk">{m.ticker}</span><span class="px">{(m.price * crash).toFixed(2)}</span><span class="ar">▼</span></div>
        {/each}
      </div>
      {#if crash < 0.15}
        <div class="flash"></div>
        <h1 class="headline">{t('tv.collapse')}<span class="stamp">{t('brand.gm')}</span></h1>
      {/if}
    </div>
  {:else if phase === 'podium'}
    {@const ini = (id: number) => name(id).split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()}
    <div class="pod">
      <h2 class="muted">{t('tv.podium')}</h2>
      <div class="podium">
        {#each [2, 1, 3] as r (r)}
          {@const here = shown.filter((p) => p.rank === r)}
          {#if r > 3 - revealed && here.length}
            <div class="step r{r}" style="--k:{here.length}">
              {#if r === 1}
                <div class="glow"></div>
                {#each [[4, 10], [90, 4], [2, 30], [96, 16], [18, 6], [80, 8], [6, 62], [94, 58]] as pt, k}
                  <i class="spark" style="left:{pt[0]}%;top:{pt[1]}%;--k:{k}">✦</i>
                {/each}
              {/if}
              <div class="plist">
                {#if r === 1}<span class="crown">♛</span>{/if}
                <div class="names">
                  {#each here as p, i (p.playerId)}
                    <div class="pl" style="--d:{0.55 + i * 0.15}s">
                      {@render av(p.playerId, true)}
                      <div class="who">{name(p.playerId)}</div>
                      <div class="mono gold">{goldTv(p.goldH)}</div>
                    </div>
                  {/each}
                </div>
              </div>
              <div class="block mono">{placeLabel(r)}</div>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {:else if phase === 'done'}
    <div class="closing">
      <div class="plate2">
        <span class="stamp">{t('brand.gm')}</span>
        <div class="phone"><span class="ring"></span><span class="ring r2"></span><i class="scr"></i></div>
        <p class="ready">{t('tv.statements_ready')}</p>
        <div class="fchips">
          {#each [1, 2, 3] as r (r)}
            {@const here = f.podium.filter((p) => p.rank === r)}
            {#if here.length}
              <div class="fchip"><span class="mono">{placeLabel(r)}</span>{here.map((p) => name(p.playerId)).join(' · ')}</div>
            {/if}
          {/each}
        </div>
      </div>
      <div class="bfoot"><b>{t('brand.company')}</b><i>{t('brand.tagline')}</i></div>
    </div>
  {:else if slide}
    {@const ini = (id: number) => name(id).split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()}
    {@const col = (id: number) => s.players.find((q) => q.id === id)?.color ?? 'var(--navy-hi)'}
    {#key slide.id}
      <div class="slide s-{slide.id}">
        <div class="plate"><i class="ic"></i><h2>{t(`tv.recap.${slide.id}`)}</h2><span class="tag mono">{t('brand.tv')}</span></div>
        <div class="stage">
          {#if slide.id === 'hours'}
            {@const mx = Math.max(1, ...slide.leaders.map((l) => l.hours))}
            <div class="bars">
              {#each slide.leaders as l, i (l.playerId)}
                <div class="brow" style="--d:{0.35 + i * 0.18}s;--w:{(l.hours / mx) * 100}%">
                  {@render av(l.playerId, true)}
                  <p class="big nm">{name(l.playerId)}</p>
                  <div class="trk"><i></i></div>
                  <span class="mono hrs">{l.hours} h</span>
                </div>
              {/each}
            </div>
          {:else if slide.id === 'achievements'}
            {@const c = slide.items.length > 5 ? 2 : 1}
            <div class="ach" style="--c:{c};--rows:{Math.max(1, Math.ceil(slide.items.length / c))}">
              {#each slide.items as a, i (i)}<p style="--d:{0.3 + i * 0.12}s">{@render av(a.playerId, false)}<span>{name(a.playerId)} — <strong>{t(`achievements.${a.type}.name`)}</strong></span></p>{/each}
            </div>
          {:else if slide.id === 'top_trade' || slide.id === 'best_investment' || slide.id === 'worst_investment'}
            {@const bad = slide.id === 'worst_investment'}
            <div class="hero">
              {@render av(slide.playerId, true)}
              <p class="big nm">{name(slide.playerId)}</p>
              <div class="chipt mono">{slide.ticker}</div>
              <div class="stat mono" class:up={!bad} class:down={bad}><span class="arw">{bad ? '▼' : '▲'}</span>{bad ? '−' : '+'}{goldTv(bad ? -slide.profitH : slide.profitH)}{#if bad}<span class="stamp">{t('brand.gm')}</span>{/if}</div>
            </div>
            <p class="big cap">{slideBody(slide)}</p>
          {:else if slide.id === 'most_predicted'}
            <div class="hero">
              {@render av(slide.playerId, true)}
              <p class="big nm">{name(slide.playerId)}</p>
              <div class="stat mono">{slide.votes}</div>
            </div>
            <p class="big cap">{slideBody(slide)}</p>
          {:else if slide.id === 'long_reigns'}
            <div class="hero"><div class="stat mono">{slide.count}</div></div>
            <p class="big cap">{slideBody(slide)}</p>
          {:else if slide.id === 'mood'}
            <div class="duo">
              <div class="face" style="--d:0.4s">{@render av(slide.cheeriest, true)}<span class="emo up">▲</span><p class="big nm">{name(slide.cheeriest)}</p></div>
              <div class="face" style="--d:0.7s">{@render av(slide.moodiest, true)}<span class="emo down">▼</span><p class="big nm">{name(slide.moodiest)}</p></div>
            </div>
            <p class="big cap">{slideBody(slide)}</p>
          {:else if slide.id === 'espionage'}
            {@const parts = slideBody(slide).split(' · ')}
            <div class="tiles">
              {#each parts as part, i (i)}
                <div class="tile" style="--d:{0.4 + i * 0.2}s"><b>{part.split(' ')[0]}</b><span>{part.split(' ').slice(1).join(' ')}</span></div>
              {/each}
            </div>
          {:else if slide.id === 'minter'}
            <div class="hero">
              {@render av(slide.playerId, true)}
              <p class="big nm">{name(slide.playerId)}</p>
              <div class="stat mono">{slide.minted.toLocaleString()}</div>
            </div>
            <p class="big cap">{slideBody(slide)}</p>
          {:else}
            <p class="big cap">{slideBody(slide)}</p>
          {/if}
        </div>
      </div>
    {/key}
  {/if}
</div>
