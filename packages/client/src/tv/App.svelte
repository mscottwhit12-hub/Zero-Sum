<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '@shared/copy';
  import { feedText } from '@shared/feedText';
  import { clock, gold, timeOfDay } from '@shared/format';
  import { connectLive, nightNow } from '@shared/socket';
  import type { PublicState } from '@shared/types';

  // Basic TV (Phase 4). The full broadcast look is deferred (decision: keep visuals bland).
  const live = connectLive<PublicState>('tv');
  let s = $state<PublicState | null>(null);
  let connected = $state(false);
  const u1 = live.state.subscribe((v) => (s = v));
  const u2 = live.connected.subscribe((v) => (connected = v));
  let now = $state(Date.now());
  const timer = setInterval(() => (now = Date.now()), 1000);
  let audio = $state(false);
  onDestroy(() => {
    u1();
    u2();
    clearInterval(timer);
    live.close();
  });

  const name = (id: number | null) => s?.players.find((p) => p.id === id)?.displayName ?? '—';
  const ticker = (id: number) => s?.players.find((p) => p.id === id)?.ticker ?? '';
  const active = $derived((s?.games ?? []).filter((g) => g.status === 'active'));
  const next = $derived((s?.games ?? []).filter((g) => g.status === 'scheduled').slice(0, 5));
  const progress = (h: number | null, planned: number | null) => (h && planned ? Math.min(100, (h / planned) * 100) : 0);
</script>

<div class="tv">
  <header class="spread">
    <div class="row">
      <strong class="brand">{t('brand.tv')}</strong>
      {#if s?.night}<span class="muted">{s.night.name}</span>{/if}
    </div>
    <div class="row mono">
      {#if s?.night}
        <span class="badge" class:live={s.night.status === 'live'} class:warn={s.night.status === 'paused'}>{t(`status.${s.night.status}`)}</span>
        {#if s.night.tradingClosed}<span class="badge warn">Trading closed</span>{/if}
        {#if s.night.currentQuarter}<span>Q{s.night.currentQuarter}</span>{/if}
        <span class="clock">{clock(nightNow(s.night, now))}</span>
      {/if}
      <span class="dot" style="background:{connected ? 'var(--good)' : 'var(--bad)'}"></span>
      {#if !audio}<button onclick={() => (audio = true)}>Enable audio</button>{/if}
    </div>
  </header>

  {#if !s?.night || s.night.status === 'archived'}
    <p class="center muted">Stand by. No night is in session.</p>
  {:else}
    <main>
      <section class="panel standings">
        <h2>Standings</h2>
        <table>
          <thead><tr><th>#</th><th>Associate</th><th></th><th class="num">Net worth</th></tr></thead>
          <tbody>
            {#each s.standings as r (r.playerId)}
              <tr>
                <td class="rank">{r.rank}</td>
                <td>{name(r.playerId)}</td>
                <td class="mono muted">{ticker(r.playerId)}</td>
                <td class="num">{gold(r.netWorthH)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !s.standings.length}<p class="muted">Awaiting associates…</p>{/if}
      </section>

      <section class="right">
        <div class="panel">
          <h2>Now playing</h2>
          {#each active as g (g.id)}
            <div class="game">
              <div class="spread">
                <strong>{g.name}</strong>
                <span class="crown">{g.leaderId ? `♛ ${name(g.leaderId)}` : ''}</span>
              </div>
              <div class="bar"><i style="width:{progress(g.hours, g.plannedDurationHours)}%"></i></div>
              <div class="small muted">{g.participants.map((p) => name(p.playerId)).join(' · ')}</div>
            </div>
          {/each}
          {#if !active.length}<p class="muted">No games in progress.</p>{/if}
        </div>
        <div class="panel">
          <h2>Up next</h2>
          {#each next as g (g.id)}
            <div class="spread small"><span>{g.name}</span><span class="muted mono">{timeOfDay(g.plannedStart)}</span></div>
          {/each}
          {#if !next.length}<p class="muted small">Nothing scheduled.</p>{/if}
        </div>
      </section>
    </main>

    <footer class="panel feed">
      {#each s.feed.slice(0, 4) as f (f.id)}
        <div class="small"><span class="mono muted">{new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> {feedText(f, s.players)}</div>
      {/each}
    </footer>
  {/if}
</div>

<style>
  .tv {
    min-height: 100vh;
    padding: 1rem 1.5rem;
    font-size: clamp(15px, 1.25vw, 24px);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .brand {
    color: var(--accent);
    letter-spacing: 0.04em;
  }
  .clock {
    font-size: 1.3em;
  }
  main {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 1rem;
    flex: 1;
  }
  .standings td {
    padding: 0.45rem 0.4rem;
    font-size: 1.1em;
  }
  .rank {
    width: 2.5em;
    color: var(--muted);
  }
  .game {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line);
  }
  .game .bar {
    margin: 0.35rem 0;
  }
  .crown {
    color: var(--accent);
  }
  .feed {
    margin: 0;
  }
  .center {
    text-align: center;
    margin-top: 20vh;
    font-size: 1.4em;
  }
  @media (max-width: 800px) {
    main {
      grid-template-columns: 1fr;
    }
  }
</style>
