<script lang="ts">
  /**
   * Night end on the TV (spec §17.1): SPECIAL REPORT → tickers turn red and crash to zero →
   * "THE MARKET HAS COLLAPSED. ONLY GOLD REMAINS." → podium 3rd → 2nd → 1st → recap carousel.
   * Timed from the server's recap clock (phones unlock when it ends); `replayFrom` restarts it locally.
   */
  import { t } from '@shared/copy';
  import { gold } from '@shared/format';
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
  const placeLabel = (r: number) => t(`tv.place.${r}`);
  // Reveal order 3rd → 2nd → 1st: rank 3 first, rank 1 last.
  const shown = $derived(f.podium.filter((p) => p.rank > 3 - revealed));
  function slideBody(x: RecapSlide): string {
    switch (x.id) {
      case 'top_trade':
      case 'best_investment':
        return t(`tv.recap.${x.id}_body`, { player: name(x.playerId), ticker: x.ticker, gold: gold(x.profitH) });
      case 'worst_investment':
        return t('tv.recap.worst_investment_body', { player: name(x.playerId), ticker: x.ticker, gold: gold(-x.profitH) });
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

<div class="finale">
  {#if phase === 'collapse'}
    <div class="report mono">{t('tv.special_report')}</div>
    <div class="board mono">
      {#each s.market as m (m.id)}
        <div class="tick"><span>{m.ticker}</span><span>{(m.price * crash).toFixed(2)}</span><span>▼</span></div>
      {/each}
    </div>
    {#if crash < 0.15}<h1 class="headline">{t('tv.collapse')}</h1>{/if}
  {:else if phase === 'podium' || phase === 'done'}
    <h2 class="muted">{t('tv.podium')}</h2>
    <div class="podium">
      {#each [2, 1, 3] as r (r)}
        <div class="step r{r}">
          {#each shown.filter((p) => p.rank === r) as p (p.playerId)}
            <div class="who">{name(p.playerId)}</div>
            <div class="mono gold">{gold(p.goldH)}</div>
          {/each}
          <div class="block mono">{placeLabel(r)}</div>
        </div>
      {/each}
    </div>
    {#if phase === 'done'}<p class="ready">{t('tv.statements_ready')}</p>{/if}
  {:else if slide}
    <div class="slide">
      <h2>{t(`tv.recap.${slide.id}`)}</h2>
      {#if slide.id === 'hours'}
        {#each slide.leaders as l (l.playerId)}<p class="big">{name(l.playerId)} <span class="mono muted">{l.hours} h</span></p>{/each}
      {:else if slide.id === 'achievements'}
        <div class="ach">
          {#each slide.items as a, i (i)}<p>{name(a.playerId)} — <strong>{t(`achievements.${a.type}.name`)}</strong></p>{/each}
        </div>
      {:else}
        <p class="big">{slideBody(slide)}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .finale {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 2rem;
    font-size: clamp(16px, 1.5vw, 28px);
    text-align: center;
  }
  .report {
    background: var(--bad);
    color: #fff;
    padding: 0.4rem 1.2rem;
    letter-spacing: 0.3em;
    font-weight: 700;
  }
  .board {
    display: grid;
    grid-template-columns: repeat(4, minmax(8em, 1fr));
    gap: 0.4rem 2rem;
    color: var(--bad);
  }
  .tick {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }
  .headline {
    font-size: 2.4em;
    max-width: 22em;
  }
  .podium {
    display: flex;
    align-items: flex-end;
    gap: 1.5rem;
  }
  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 9em;
    gap: 0.3rem;
  }
  .block {
    width: 100%;
    background: var(--panel);
    border: 1px solid var(--line);
    padding: 0.5rem;
  }
  .r1 .block {
    height: 9em;
    border-color: var(--accent);
    color: var(--accent);
  }
  .r2 .block {
    height: 6em;
  }
  .r3 .block {
    height: 4em;
  }
  .who {
    font-size: 1.3em;
    font-weight: 700;
  }
  .gold {
    color: var(--accent);
  }
  .slide h2 {
    letter-spacing: 0.1em;
  }
  .big {
    font-size: 1.6em;
  }
  .ach {
    max-height: 60vh;
    overflow: hidden;
  }
  .ready {
    margin-top: 1rem;
  }
</style>
