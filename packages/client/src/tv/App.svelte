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
  import { MusicPlayer } from './music';
  import Finale from './Finale.svelte';
  import './tv.css';
  import TickCountdown from '@shared/TickCountdown.svelte';

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
  // Music (tag pools, shuffle, crossfade, ducking) lives in ./music.ts; it reports each track it starts so the GM console can show it.
  const music = new MusicPlayer((trackId) => live.socket.emit('music:now', { trackId }));
  function enableAudio() {
    actx = new AudioContext();
    audioOn = true;
    music.enable();
  }
  function playSound(d: { cue?: string; url?: string | null }) {
    if (!audioOn) return;
    if (d.url) {
      const a = new Audio(d.url);
      const endDuck = music.duckWhile(a);
      void a.play().catch(endDuck); // a sound that never starts must not leave the music ducked
    } else if (d.cue && actx) {
      music.duckFor(2500);
      cueTone(actx, d.cue);
    }
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
      else if (f.id > lastFeedId && (f.message === 'feed.stock_halted' || f.message === 'feed.stock_relisted')) pushBanner(feedText(f, s!.players, { tv: true }), f.message === 'feed.stock_halted' ? 'breaking' : 'info');
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

  // Music: the server picks the tag pool; the player shuffles, crossfades and ducks. Silent until "Enable audio".
  $effect(() => music.update(s?.tv?.music ?? null));
  $effect(() => () => music.destroy());
</script>

<div class="tvroot">

{#if booting}
  <div class="boot mono">
    {#each BOOT.slice(0, bootLine + 1) as line}<div>{line}</div>{/each}
    <span class="cursor">█</span>
  </div>
{:else}
  <div class="tv">
    <header class="spread hd">
      <div class="row">
        <strong class="brand">{t('brand.tv')}</strong>
        {#if s?.night}<span class="muted">{s.night.name}</span>{/if}
      </div>
      <div class="row mono">
        {#if s?.night}
          <span class="badge" class:live={s.night.status === 'live'} class:warn={s.night.status === 'paused'}>{t(`status.${s.night.status}`)}</span>
          {#if s.night.tradingClosed}<span class="badge warn">{t('tv.trading_closed')}</span>{/if}
          <TickCountdown night={s.night} />
          {#if s.night.currentQuarter}<span class="qb">Q{s.night.currentQuarter}</span>{/if}
          <span class="clock">{clock(nightNow(s.night, now))}</span>
        {/if}
        <span class="dot" style="background:{connected ? 'var(--good)' : 'var(--bad)'}"></span>
        {#if !audioOn}<button onclick={enableAudio}>Enable audio</button>{/if}
      </div>
    </header>

    {#if !s?.night || s.night.status === 'archived'}
      <p class="center muted">Stand by. No night is in session.</p>
    {:else}
      <div class="headline mono"><i>&gt;</i> {headline}<span class="cursor">█</span></div>
      {#if s.vote?.open}
        <div class="poll">{t('tv.polls_open', { quarter: s.vote.quarter })}{pollLeft ? ` · ${pollLeft}` : ''}</div>
      {/if}

      <main class:tall={step.kind === 'floor' || step.kind === 'table' || step.kind === 'market'} class:fullh={step.kind === 'floor' || step.kind === 'table' || (step.kind === 'market' && !!s.vote?.open)}>
        <section class="panel standings n">
          <h2>{t('tv.standings')}</h2>
          <table style="--n:{Math.max(1, s.standings.length)}">
            <tbody>
              {#each s.standings as r (r.playerId)}
                {@const pc = s.players.find((p) => p.id === r.playerId)?.color}
                <tr class:lead={r.rank === 1}>
                  <td class="rank">{r.rank}</td>
                  <td class="avc"><span class="av" style="background:{pc ?? 'var(--navy-hi)'}">{name(r.playerId).split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()}</span></td>
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
          <div class="panel e" class:compact={active.length > 2 || !!s.vote?.open || (step.kind === 'schedule' && next.length > 3)}>
            <h2>{t('tv.now_playing')}</h2>
            {#each active as g (g.id)}
              <div class="game">
                <i class="gic" style="--c:{g.color ?? '#27507a'}">{g.name.slice(0, 1)}</i>
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
              <span class="tag small muted mono">{stepIdx + 1}/{steps.length}</span>
            </div>
            {#key stepIdx}
              {#if step.kind === 'schedule'}
                <div class="rbody schedule" style="--n:{Math.max(1, next.length)}">
                  {#each next as g (g.id)}
                    <div class="spread small"><span>{g.name}</span><span class="muted mono">{timeOfDay(g.plannedStart)}</span></div>
                  {:else}
                    <p class="muted small">Nothing scheduled.</p>
                  {/each}
                </div>
              {:else if step.kind === 'market'}
                {@const cols = s.market.length > 12 ? 2 : 1}
                <div class="rbody market">
                  <table class="small" class:two={cols === 2} style="--cols:{cols};--rows:{Math.max(1, Math.ceil(s.market.length / cols))}">
                    <tbody>
                      {#each s.market as m (m.id)}
                        {@const c = change(m.history, m.price)}
                        <tr class:dead={m.kind === 'dead'}>
                          <td class="mono"><span class="tk" data-k={m.kind}>{m.ticker}</span></td>
                          <td><Sparkline values={m.history} /></td>
                          <td class="num mono">{m.price.toFixed(2)}</td>
                          <td class="num mono" class:up={c > 0} class:down={c < 0}><span class="chg">{c > 0 ? '▲ +' : c < 0 ? '▼ ' : '■ '}{(c * 100).toFixed(1)}%</span></td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {:else if step.kind === 'floor'}
                <div class="rbody floor">
                  <div class="fit"><FloorPlan tables={s.tv?.seating ?? []} players={s.players} dots /></div>
                </div>
              {:else if step.kind === 'table'}
                <div class="rbody table">
                  <div class="fit">{#if stepTable}<TableView table={stepTable} players={s.players} game={gameName(stepTable.gameId)} />{/if}</div>
                </div>
              {:else}
                {@const top = (s.minter?.leaderboard ?? []).slice(0, 5)}
                <div class="rbody mint" style="--n:{Math.max(1, top.length)}">
                  {#each top as r, i (r.playerId)}
                    <div class="spread small"><span><i class="rk">{i + 1}</i>{name(r.playerId)}</span><span class="mono">{r.minted.toLocaleString()}</span></div>
                  {:else}
                    <p class="muted small">No NFTs minted yet.</p>
                  {/each}
                </div>
              {/if}
            {/key}
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
</div>
