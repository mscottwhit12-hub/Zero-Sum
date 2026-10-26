<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { copy, t } from '@shared/copy';
  import { gold } from '@shared/format';
  import { connectLive, type Live } from '@shared/socket';
  import Toasts from '@shared/Toasts.svelte';
  import type { Me, PlayerState } from '@shared/types';
  import Feed from './apps/Feed.svelte';
  import Market from './apps/Market.svelte';
  import Messages from './apps/Messages.svelte';
  import Profile from './apps/Profile.svelte';
  import Rules from './apps/Rules.svelte';
  import Standings from './apps/Standings.svelte';
  import Wallet from './apps/Wallet.svelte';
  import { dapi, deviceToken, pendingToken, setDeviceToken, setPendingToken, store } from './device';
  import Join from './Join.svelte';

  type Phase = 'boot' | 'join' | 'waiting' | 'phone';
  let phase = $state<Phase>('boot');
  let bootLine = $state(0);
  let denied = $state(false);
  let live: Live<PlayerState> | null = null;
  let s = $state<PlayerState | null>(null);
  let connected = $state(false);
  let unsub: (() => void)[] = [];
  let app = $state<string | null>(null);
  let now = $state(Date.now());
  const clockTimer = setInterval(() => (now = Date.now()), 1000);
  let poll: ReturnType<typeof setInterval> | null = null;

  const BOOT: string[] = (copy as { phone: { boot: string[] } }).phone.boot;
  const APPS = [
    { id: 'wallet', icon: '◎' },
    { id: 'market', icon: '↗' },
    { id: 'standings', icon: '≡' },
    { id: 'messages', icon: '✉' },
    { id: 'feed', icon: '☰' },
    { id: 'rules', icon: '§' },
    { id: 'profile', icon: '☺' },
  ] as const;

  function route() {
    stopPoll();
    if (deviceToken()) {
      phase = 'phone';
      connect();
    } else if (pendingToken()) {
      phase = 'waiting';
      startPoll();
    } else phase = 'join';
  }

  async function boot() {
    let booted = false;
    try {
      booted = sessionStorage.getItem('gn_booted') === '1';
      sessionStorage.setItem('gn_booted', '1');
    } catch {
      /* ignore */
    }
    if (!booted) for (bootLine = 0; bootLine < BOOT.length; bootLine++) await new Promise((r) => setTimeout(r, 380));
    route();
  }

  function connect() {
    live?.close();
    unsub.forEach((u) => u());
    live = connectLive<PlayerState>('player', { deviceToken: deviceToken() }, {
      'player:update': (me) => s && (s = { ...s, me: me as Me }),
      connect_error: (e) => {
        if ((e as Error).message === 'unknown_device') {
          live?.close();
          setDeviceToken(null);
          route();
        }
      },
    });
    unsub = [live.state.subscribe((v) => (s = v)), live.connected.subscribe((c) => (connected = c))];
  }

  function startPoll() {
    const check = async () => {
      const r = await dapi<{ status: string }>('GET', '/api/join/status', undefined, pendingToken()).catch(() => null);
      if (r?.status === 'approved') {
        setDeviceToken(pendingToken());
        setPendingToken(null);
        route();
      } else if (r?.status === 'denied' || r?.status === 'unknown') {
        setPendingToken(null);
        denied = r.status === 'denied';
        route();
      }
    };
    check();
    poll = setInterval(check, 2000);
  }
  const stopPoll = () => poll && (clearInterval(poll), (poll = null));

  onMount(boot);
  onDestroy(() => {
    live?.close();
    unsub.forEach((u) => u());
    stopPoll();
    clearInterval(clockTimer);
  });

  // ---- badges (no banners, red counts only) + vibration on new items
  let feedSeen = $state(Number(store.get('gn_feed_seen') ?? 0));
  const unreadMessages = $derived(s?.me?.messages.filter((m) => !m.read).length ?? 0);
  const unseenFeed = $derived((s?.feed ?? []).filter((f) => f.id > feedSeen).length);
  const badges = $derived<Record<string, number>>({ messages: unreadMessages, feed: unseenFeed });
  let lastTotal = -1;
  $effect(() => {
    const total = unreadMessages + unseenFeed;
    if (lastTotal >= 0 && total > lastTotal) navigator.vibrate?.(60);
    lastTotal = total;
  });
  function openApp(id: string) {
    app = id;
    if (id === 'feed') markFeedSeen();
  }
  function markFeedSeen() {
    feedSeen = Math.max(feedSeen, ...(s?.feed ?? []).map((f) => f.id), 0);
    store.set('gn_feed_seen', String(feedSeen));
  }
  $effect(() => {
    if (app === 'feed' && unseenFeed) markFeedSeen();
  });

  const locked = $derived(s?.night?.status === 'paused' ? 'paused' : s?.night?.status === 'ended' ? 'ended' : null);
  const countdown = $derived.by(() => {
    const until = s?.night?.pauseUntil;
    if (!until) return null;
    const ms = Math.max(0, until - now);
    return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  });
  const timeStr = $derived(new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
</script>

<Toasts />
<div class="rotate">{t('phone.rotate')}</div>

<div class="device">
  {#if phase === 'boot'}
    <div class="boot mono">
      {#each BOOT.slice(0, bootLine + 1) as line}<div>{line}</div>{/each}
    </div>
  {:else if phase === 'join'}
    {#if denied}<p class="error pad">{t('phone.denied')}</p>{/if}
    <Join ondone={route} rejoin={location.hash === '#rejoin'} />
  {:else if phase === 'waiting'}
    <div class="center pad">
      <p>{t('phone.waiting')}</p>
      <button onclick={() => (setPendingToken(null), route())}>Cancel</button>
    </div>
  {:else}
    <header class="status mono small">
      <span>{timeStr}</span>
      <span>{#if s?.me}{gold(s.me.cashH)} gold{/if}</span>
      <span class="dot" style="background:{connected ? 'var(--good)' : 'var(--bad)'}"></span>
    </header>

    {#if !s}
      <p class="center pad muted">Connecting…</p>
    {:else if !s.night || !s.me}
      <p class="center pad muted">No session in progress.</p>
    {:else if locked}
      <!-- Lock screen: pause (spec §15.3) / collapse stand-by. Inputs frozen. -->
      <div class="lock">
        <div class="lock-time mono">{timeStr}</div>
        <h2>{locked === 'paused' ? t('phone.paused_title') : t('phone.ended_title')}</h2>
        <p class="muted">{locked === 'paused' ? t('phone.paused_body') : t('phone.ended_body')}</p>
        {#if locked === 'paused' && countdown}<p class="mono countdown">{countdown}</p>{/if}
      </div>
    {:else if app}
      <div class="appbar spread">
        <button onclick={() => (app = null)}>‹ Home</button>
        <strong>{t(`phone.apps.${app}`)}</strong>
        <span style="width:60px"></span>
      </div>
      <div class="appbody">
        {#if app === 'wallet'}<Wallet {s} />
        {:else if app === 'market'}<Market {s} />
        {:else if app === 'standings'}<Standings {s} />
        {:else if app === 'messages'}<Messages {s} />
        {:else if app === 'feed'}<Feed {s} />
        {:else if app === 'rules'}<Rules {s} />
        {:else if app === 'profile'}<Profile {s} onsignout={() => { live?.close(); route(); }} />
        {/if}
      </div>
    {:else}
      <div class="home">
        <div class="wall">
          <div class="muted small">{s.night.name}</div>
          <div class="mono hero">{gold(s.me.netWorthH)}</div>
          <div class="muted small">net worth · rank {s.me.rank ?? '—'}</div>
        </div>
        <div class="grid">
          {#each APPS as a (a.id)}
            <button class="icon" onclick={() => openApp(a.id)}>
              <span class="glyph">{a.icon}</span>
              {#if badges[a.id]}<span class="badge-count">{badges[a.id]}</span>{/if}
              <span class="label">{t(`phone.apps.${a.id}`)}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .device {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  /* Desktop: centered phone frame. */
  @media (min-width: 700px) and (pointer: fine) {
    :global(html),
    :global(body) {
      background: #2a2826;
      min-height: 100%;
    }
    :global(body) {
      padding: 3vh 0;
    }
    .device {
      width: 390px;
      height: 800px;
      min-height: 0;
      margin: 0 auto;
      border: 10px solid #111;
      border-radius: 36px;
      overflow: auto;
    }
  }
  /* Phone held sideways: ask to rotate (vertical only). */
  .rotate {
    display: none;
  }
  @media (orientation: landscape) and (max-height: 500px) and (pointer: coarse) {
    .rotate {
      display: flex;
      position: fixed;
      inset: 0;
      z-index: 200;
      background: var(--bg);
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 2rem;
    }
  }
  .pad {
    padding: 1.2rem;
  }
  .center {
    text-align: center;
  }
  .boot {
    padding: 1.5rem 1rem;
    font-size: 0.85rem;
    line-height: 1.8;
  }
  .status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.35rem 0.9rem;
    border-bottom: 1px solid var(--line);
  }
  .home {
    padding: 1rem;
  }
  .wall {
    text-align: center;
    margin: 1.2rem 0 1.6rem;
  }
  .hero {
    font-size: 2.2rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem 0.5rem;
  }
  .icon {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    border: none;
    background: transparent;
    padding: 0;
  }
  .glyph {
    width: 58px;
    height: 58px;
    border-radius: 14px;
    background: var(--panel);
    border: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
  }
  .label {
    font-size: 0.72rem;
  }
  .badge-count {
    position: absolute;
    top: -6px;
    right: 6px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 10px;
    background: #e03131;
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .appbar {
    padding: 0.5rem 0.7rem;
    border-bottom: 1px solid var(--line);
  }
  .appbody {
    padding: 0.8rem;
  }
  .lock {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2rem;
  }
  .lock-time {
    font-size: 3rem;
  }
  .countdown {
    font-size: 1.6rem;
  }
</style>
