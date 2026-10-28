<script lang="ts">
  /**
   * Main Screen TV (/display). Placeholder broadcast layout (decision: keep visuals bland):
   * headline bar, standings, now playing, rotating panels (schedule / market / full floor / each seated table / minters),
   * bottom crawl, BREAKING lower-thirds, poll strip, intermission overlay, and TV-side audio.
   */
  import { onDestroy } from 'svelte';
  import { copy, t } from '@shared/copy';
  import { feedText } from '@shared/feedText';
  import { clock, goldTv, timeOfDay } from '@shared/format';
  import { connectLive, nightNow } from '@shared/socket';
  import FloorPlan from '@shared/FloorPlan.svelte';
  import TableView from './TableView.svelte';
  import { gameClockShort } from '@shared/gameTime';
  import Sparkline from '@shared/Sparkline.svelte';
  import type { FeedItem, TvState } from '@shared/types';
  import { cueTone } from './tones';
  import Finale from './Finale.svelte';

  // ---- boot sequence (terminal touch)
  const BOOT: string[] = (copy as unknown as { tv: { boot: string[] } }).tv.boot;
  let bootLine = $state(0);
  let booting = $state(true);
  (async () => {
    for (bootLine = 0; bootLine < BOOT.length; bootLine++) await new Promise((r) => setTimeout(r, 450));
    booting = false;
  })();

  // ---- lower-thirds: shown one at a time, each for its full duration
  type Banner = { text: string; kind: 'breaking' | 'exposed' | 'info'; ms: number };
  const queue: Banner[] = [];
  let banner = $state<Banner | null>(null);
  function pushBanner(text: string, kind: Banner['kind'] = 'breaking') {
    queue.push({ text, kind, ms: kind === 'exposed' ? 15000 : 9000 });
    if (!banner) nextBanner();
  }
  function nextBanner() {
    banner = queue.shift() ?? null;
    if (banner) setTimeout(nextBanner, banner.ms);
  }

  // ---- crawl extras (minter etc.), newest first, capped
  let crawlExtras = $state<string[]>([]);
  const addCrawl = (line: string) => (crawlExtras = [line, ...crawlExtras].slice(0, 6));

  // ---- audio (browsers need one click first)
  let audioOn = $state(false);
  let actx: AudioContext | null = null;
  let ambientEl = $state<HTMLAudioElement | null>(null);
  function enableAudio() {
    actx = new AudioContext();
    audioOn = true;
  }
  function playSound(d: { cue?: string; url?: string | null }) {
    if (!audioOn) return;
    if (d.url) void new Audio(d.url).play().catch(() => {});
    else if (d.cue && actx) cueTone(actx, d.cue);
  }

  let s = $state<TvState | null>(null);
  let connected = $state(false);
  const pname = (id: unknown) => s?.players.find((p) => p.id === Number(id))?.displayName ?? '?';
  const live = connectLive<TvState>('tv', {}, {
    'espionage:notice': (d) => {
      const x = d as { state: string; playerId?: number };
      if (x.state === 'memo') pushBanner(t('tv.memo'));
      else if (x.state === 'accepted') pushBanner(t('tv.memo_accepted'));
      else if (x.state === 'rejected') pushBanner(t('tv.memo_rejected'));
      else if (x.state === 'failed') pushBanner(t('tv.memo_failed', { player: pname(x.playerId) }), 'exposed');
    },
    'achievement:new': (d) => {
      const x = d as { playerId: number; type: string };
      pushBanner(t('tv.achievement', { player: pname(x.playerId), achievement: t(`achievements.${x.type}.name`) }), 'info');
    },
    'vote:call': (d) => pushBanner(t('tv.vote_open', { quarter: (d as { quarter: number }).quarter }), 'info'),
    'tv:crawl': (d) => {
      const x = d as { kind: string; ticker: string; minted: number };
      if (x.kind === 'minter') addCrawl(t('tv.minter_crawl', { ticker: x.ticker, minted: x.minted.toLocaleString() }));
    },
    'sound:play': (d) => playSound(d as { cue?: string; url?: string | null }),
    'finale:replay': () => (replayFrom = Date.now() + skew),
    // A night was archived or a new one created: start fresh.
    'night:archived': () => location.reload(),
    'night:update': (d) => {
      const x = d as { tradingClosed?: boolean; status?: string; created?: boolean };
      if (x.created) {
        location.reload();
        return;
      }
      if (x.tradingClosed && s?.night && !s.night.tradingClosed && x.status !== 'ended')
        pushBanner(t('tv.trading_closed_banner', { fee: Math.round(s.night.rules.endSellProfitFeeFrac * 100) }));
    },
  });
  let replayFrom = $state<number | null>(null);
  const u1 = live.state.subscribe((v) => (s = v));
  const u2 = live.connected.subscribe((v) => (connected = v));
  let now = $state(Date.now());
  const timer = setInterval(() => (now = Date.now()), 250);
  // Server clock estimate for the finale (TV and server clocks may differ).
  let skew = 0;
  $effect(() => {
    if (s?.night) skew = s.night.serverTime - Date.now();
  });
  const serverNow = $derived(now + skew);

  // Dethronings → lower-third (from the public feed; ids only increase).
  let lastFeedId = -1;
  $effect(() => {
    const feed: FeedItem[] = s?.feed ?? [];
    const top = feed[0]?.id ?? 0;
    if (lastFeedId >= 0) for (const f of [...feed].reverse()) if (f.id > lastFeedId && f.message === 'feed.dethroned') pushBanner(feedText(f, s!.players, { tv: true }), 'info');
    lastFeedId = Math.max(lastFeedId, top);
  });

  // Rotating panel. Seating expands into the full floor (filled/empty dots) then one close-up per table
  // that has someone seated. The step list is rebuilt from live state each time it advances.
  type Step = { kind: 'schedule' | 'market' | 'floor' | 'minters'; ms: number } | { kind: 'table'; tableId: number; ms: number };
  const PANEL_MS = 15000;
  const FLOOR_MS = 10000;
  const TABLE_MS = 8000;
  const steps = $derived.by((): Step[] => {
    const tables = s?.tv?.seating ?? [];
    const out: Step[] = [{ kind: 'schedule', ms: PANEL_MS }, { kind: 'market', ms: PANEL_MS }];
    if (tables.length) {
      out.push({ kind: 'floor', ms: FLOOR_MS });
      for (const tb of tables) if (tb.assignments.length) out.push({ kind: 'table', tableId: tb.id, ms: TABLE_MS });
    }
    out.push({ kind: 'minters', ms: PANEL_MS });
    return out;
  });
  let stepIdx = $state(0);
  let rot: ReturnType<typeof setTimeout>;
  function advance() {
    stepIdx = (stepIdx + 1) % steps.length;
    rot = setTimeout(advance, steps[stepIdx]?.ms ?? PANEL_MS);
  }
  rot = setTimeout(advance, PANEL_MS);
  const step = $derived(steps[Math.min(stepIdx, steps.length - 1)]!);
  const stepTable = $derived(step.kind === 'table' ? ((s?.tv?.seating ?? []).find((tb) => tb.id === step.tableId) ?? null) : null);
  /** A table's game for the TV: name plus a short clock ("1:12 in" / "at 9:00 PM"). */
  const gameName = (id: number | null) => {
    const g = id == null ? null : (s?.games.find((x) => x.id === id) ?? null);
    return g ? [g.name, gameClockShort(g as never, now)].filter(Boolean).join(' · ') : '';
  };

  onDestroy(() => {
    u1();
    u2();
    clearInterval(timer);
    clearTimeout(rot);
    live.close();
  });

  const name = (id: number | null) => s?.players.find((p) => p.id === id)?.displayName ?? '—';
  const ticker = (id: number) => s?.players.find((p) => p.id === id)?.ticker ?? '';
  const active = $derived((s?.games ?? []).filter((g) => g.status === 'active'));
  const next = $derived((s?.games ?? []).filter((g) => g.status === 'scheduled').slice(0, 6));
  const progress = (h: number | null, planned: number | null) => (h && planned ? Math.min(100, (h / planned) * 100) : 0);
  const paused = $derived(s?.night?.status === 'paused');
  const countdown = $derived.by(() => {
    const until = s?.night?.pauseUntil;
    if (!until) return null;
    const ms = Math.max(0, until - now);
    return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  });
  const pollLeft = $derived.by(() => {
    const v = s?.vote;
    if (!v?.open || v.windowEndsNms == null || !s?.night) return null;
    return clock(v.windowEndsNms - nightNow(s.night, now)).replace(/^0:/, '');
  });
  /** Change vs the previous recorded price (history may or may not already include the current one). */
  function change(h: number[], price: number) {
    const base = h.length && h[h.length - 1] !== price ? h[h.length - 1]! : h[h.length - 2];
    return base ? (price - base) / base : 0;
  }
  const crawl = $derived([
    ...crawlExtras,
    ...(s?.market ?? []).map((m) => {
      const c = change(m.history, m.price);
      return `${m.ticker} ${m.price.toFixed(2)} ${c >= 0 ? '▲' : '▼'}${Math.abs(c * 100).toFixed(1)}%`;
    }),
  ]);
  const headline = $derived(s?.feed?.[0] ? feedText(s.feed[0], s.players, { tv: true }) : '');

  // Ambient loop (per-game theme); silent during intermission.
  $effect(() => {
    const el = ambientEl;
    if (!el) return;
    const url = audioOn && !paused ? (s?.tv?.ambient?.url ?? null) : null;
    if (!url) return void el.pause();
    if (!el.src.endsWith(url)) el.src = url;
    void el.play().catch(() => {});
  });
</script>

<audio bind:this={ambientEl} loop preload="none"></audio>

{#if booting}
  <div class="boot mono">
    {#each BOOT.slice(0, bootLine + 1) as line}<div>{line}</div>{/each}
    <span class="cursor">█</span>
  </div>
{:else}
  <div class="tv">
    <header class="spread">
      <div class="row">
        <strong class="brand">{t('brand.tv')}</strong>
        {#if s?.night}<span class="muted">{s.night.name}</span>{/if}
      </div>
      <div class="row mono">
        {#if s?.night}
          <span class="badge" class:live={s.night.status === 'live'} class:warn={s.night.status === 'paused'}>{t(`status.${s.night.status}`)}</span>
          {#if s.night.tradingClosed}<span class="badge warn">{t('tv.trading_closed')}</span>{/if}
          {#if s.night.currentQuarter}<span>Q{s.night.currentQuarter}</span>{/if}
          <span class="clock">{clock(nightNow(s.night, now))}</span>
        {/if}
        <span class="dot" style="background:{connected ? 'var(--good)' : 'var(--bad)'}"></span>
        {#if !audioOn}<button onclick={enableAudio}>Enable audio</button>{/if}
      </div>
    </header>

    {#if !s?.night || s.night.status === 'archived'}
      <p class="center muted">Stand by. No night is in session.</p>
    {:else}
      <div class="headline mono">&gt; {headline}<span class="cursor">█</span></div>
      {#if s.vote?.open}
        <div class="poll">{t('tv.polls_open', { quarter: s.vote.quarter })}{pollLeft ? ` · ${pollLeft}` : ''}</div>
      {/if}

      <main>
        <section class="panel standings">
          <h2>{t('tv.standings')}</h2>
          <table>
            <tbody>
              {#each s.standings as r (r.playerId)}
                <tr>
                  <td class="rank">{r.rank}</td>
                  <td>{name(r.playerId)}</td>
                  <td class="mono muted">{ticker(r.playerId)}</td>
                  <td class="num mono">{goldTv(r.netWorthH)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if !s.standings.length}<p class="muted">Awaiting associates…</p>{/if}
        </section>

        <section class="right">
          <div class="panel">
            <h2>{t('tv.now_playing')}</h2>
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

          <div class="panel rotating">
            <div class="spread">
              <h2>
                {step.kind === 'schedule' ? t('tv.up_next') : step.kind === 'floor' || step.kind === 'table' ? t('tv.seating') : t(`tv.${step.kind}`)}{stepTable ? ` · ${stepTable.name}` : ''}
              </h2>
              <span class="small muted mono">{stepIdx + 1}/{steps.length}</span>
            </div>
            {#if step.kind === 'schedule'}
              {#each next as g (g.id)}
                <div class="spread small"><span>{g.name}</span><span class="muted mono">{timeOfDay(g.plannedStart)}</span></div>
              {:else}
                <p class="muted small">Nothing scheduled.</p>
              {/each}
            {:else if step.kind === 'market'}
              <table class="small">
                <tbody>
                  {#each s.market as m (m.id)}
                    {@const c = change(m.history, m.price)}
                    <tr>
                      <td class="mono">{m.ticker}</td>
                      <td><Sparkline values={m.history} /></td>
                      <td class="num mono">{m.price.toFixed(2)}</td>
                      <td class="num mono" class:up={c > 0} class:down={c < 0}>{c >= 0 ? '+' : ''}{(c * 100).toFixed(1)}%</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {:else if step.kind === 'floor'}
              <FloorPlan tables={s.tv?.seating ?? []} players={s.players} dots {gameName} />
            {:else if step.kind === 'table'}
              {#if stepTable}<TableView table={stepTable} players={s.players} game={gameName(stepTable.gameId)} />{/if}
            {:else}
              {#each (s.minter?.leaderboard ?? []).slice(0, 5) as r, i (r.playerId)}
                <div class="spread small"><span>{i + 1}. {name(r.playerId)}</span><span class="mono">{r.minted.toLocaleString()}</span></div>
              {:else}
                <p class="muted small">No NFTs minted yet.</p>
              {/each}
            {/if}
          </div>
        </section>
      </main>

      <footer class="crawl mono">
        <div class="track">
          {#each [0, 1] as k (k)}<span>{crawl.join('   ·   ')}   ·   </span>{/each}
        </div>
      </footer>
    {/if}
  </div>

  {#if paused && s?.night}
    <div class="intermission">
      <h1>{t('tv.intermission')}</h1>
      <p>{t('tv.intermission_body')}</p>
      {#if countdown}<p class="mono big">{countdown}</p>{/if}
      <div class="panel minters">
        <h2>{t('tv.minters')}</h2>
        {#each (s.minter?.leaderboard ?? []).slice(0, 5) as r, i (r.playerId)}
          <div class="spread"><span>{i + 1}. {name(r.playerId)}</span><span class="mono">{r.minted.toLocaleString()}</span></div>
        {:else}
          <p class="muted small">Open NFT Minter on your phone.</p>
        {/each}
      </div>
    </div>
  {/if}

  {#if s?.night?.status === 'ended' && s.finale}
    <Finale {s} now={serverNow} {replayFrom} />
  {/if}

  {#if banner}
    <div class="banner {banner.kind}">{banner.text}</div>
  {/if}
{/if}

<style>
  .boot {
    padding: 3rem;
    font-size: 1.4rem;
    line-height: 2;
  }
  .cursor {
    animation: blink 1s steps(1) infinite;
    margin-left: 0.2em;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .tv {
    min-height: 100vh;
    padding: 1rem 1.5rem 3.2rem;
    font-size: clamp(15px, 1.25vw, 24px);
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .brand {
    color: var(--accent);
    letter-spacing: 0.04em;
  }
  .clock {
    font-size: 1.3em;
  }
  .headline {
    padding: 0.4rem 0.8rem;
    border-left: 4px solid var(--accent);
    background: var(--panel);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .poll {
    padding: 0.5rem 0.8rem;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
    text-align: center;
  }
  main {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 1rem;
    flex: 1;
  }
  .right {
    display: flex;
    flex-direction: column;
    gap: 1rem;
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
  .rotating {
    min-height: 14em;
  }
  .up {
    color: var(--good);
  }
  .down {
    color: var(--bad);
  }
  .tiny {
    font-size: 0.7em;
  }
  .crawl {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 0.5rem 0;
    background: var(--panel);
    border-top: 1px solid var(--line);
    overflow: hidden;
    white-space: nowrap;
  }
  .track {
    display: inline-block;
    animation: crawl 60s linear infinite;
  }
  @keyframes crawl {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-50%);
    }
  }
  .intermission {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: clamp(16px, 1.4vw, 26px);
  }
  .intermission h1 {
    letter-spacing: 0.2em;
  }
  .big {
    font-size: 3em;
  }
  .minters {
    min-width: 24em;
  }
  .banner {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 2.6rem;
    z-index: 50;
    padding: 1.2rem 2rem;
    font-size: 2rem;
    font-weight: 700;
    background: var(--accent);
    color: var(--accent-ink);
  }
  .banner.exposed {
    background: var(--bad);
    color: #fff;
  }
  .banner.info {
    background: var(--panel);
    color: var(--ink, inherit);
    border-top: 3px solid var(--accent);
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
