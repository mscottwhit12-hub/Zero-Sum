<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { copy, t } from '@shared/copy';
  import { gold } from '@shared/format';
  import { connectLive, type Live } from '@shared/socket';
  import Toasts from '@shared/Toasts.svelte';
  import { toast } from '@shared/ui';
  import { signedGold } from '@shared/format';
  import type { PlayerState } from '@shared/types';
  import Feed from './apps/Feed.svelte';
  import Market from './apps/Market.svelte';
  import Messages from './apps/Messages.svelte';
  import Chat from './apps/Chat.svelte';
  import Profile from './apps/Profile.svelte';
  import Rules from './apps/Rules.svelte';
  import Standings from './apps/Standings.svelte';
  import Wallet from './apps/Wallet.svelte';
  import Vote from './apps/Vote.svelte';
  import { FUN_APPS } from './fun';
  import { dapi, deviceToken, pendingToken, setDeviceToken, setPendingToken, store } from './device';
  import Join from './Join.svelte';
  import Statement from './Statement.svelte';
  import './phone.css';
  import { feedText } from '@shared/feedText';
  import { dockfx, setOrigin, zoom } from './zoom';

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
    { id: 'vote', icon: '☎' },
    { id: 'wallet', icon: '◎' },
    { id: 'market', icon: '↗' },
    { id: 'standings', icon: '≡' },
    { id: 'messages', icon: '✉' },
    { id: 'chat', icon: '❝' },
    { id: 'feed', icon: '☰' },
    { id: 'rules', icon: '§' },
    { id: 'profile', icon: '☺' },
    ...FUN_APPS.map((f) => ({ id: f.id, icon: f.icon })),
  ];
  const funApp = (id: string | null) => FUN_APPS.find((f) => f.id === id) ?? null;
  let lockApp = $state<string | null>(null);

  let routedAs: string | null = null;
  function route() {
    stopPoll();
    const tok = deviceToken();
    // A different account (or none) on this phone: start on the home screen, never inside the last account's app.
    if (tok !== routedAs) {
      app = null;
      routedAs = tok;
    }
    if (tok) {
      phase = 'phone';
      connect();
    } else if (pendingToken()) {
      phase = 'waiting';
      startPoll();
    } else phase = 'join';
  }
  // Another tab on this browser signed in as someone else: identity is per browser, so follow it rather than mix
  // two accounts in one tab (e.g. a Minter syncing taps under the wrong player).
  function onStorage(e: StorageEvent) {
    if (e.key === 'gn_device' && e.newValue !== routedAs) location.reload();
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
      'night:update': (d) => {
        const x = d as { tradingClosed?: boolean };
        if (x.tradingClosed && s?.night && !s.night.tradingClosed && s.night.status !== 'ended')
          toast(t('phone.trading_closed_toast', { fee: Math.round(s.night.rules.endSellProfitFeeFrac * 100) }));
      },
      // The GM archived this night: this phone's identity is gone. Back to the join screen.
      'night:archived': () => {
        setDeviceToken(null);
        setPendingToken(null);
        live?.close();
        route();
      },
      'chat:message': (d) => window.dispatchEvent(new CustomEvent('gn:chat', { detail: d })),
      'vote:bounty': (d) => toast(t('phone.vote_bounty', { gold: signedGold((d as { goldH: number }).goldH) })),
      'espionage:result': (d) => toast((d as { success: boolean }).success ? t('phone.espionage_success') : t('phone.espionage_fail'), (d as { success: boolean }).success ? 'ok' : 'error'),
      'achievement:new': (d) => {
        const a = d as { playerId: number; type: string };
        if (a.playerId === s?.me?.id) toast(t('phone.achievement_new', { achievement: t(`achievements.${a.type}.name`) }));
      },
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

  onMount(() => {
    window.addEventListener('storage', onStorage);
    void boot();
  });
  onDestroy(() => {
    window.removeEventListener('storage', onStorage);
    live?.close();
    unsub.forEach((u) => u());
    stopPoll();
    clearInterval(clockTimer);
  });

  // ---- badges (no banners, red counts only) + vibration on new items
  let feedSeen = $state(Number(store.get('gn_feed_seen') ?? 0));
  const unreadMessages = $derived(
    (s?.me?.messages.filter((m) => !m.read).length ?? 0) +
      (s?.me?.challenges.filter((c) => c.status === 'sent').length ?? 0) +
      (s?.me?.tips?.filter((x) => !x.read).length ?? 0) +
      (s?.me?.gifts?.filter((x) => !x.read).length ?? 0),
  );
  const vote = $derived(s?.me?.vote ?? null);
  const voteOpen = $derived(!!vote?.open && s?.night?.status === 'live');
  const voteBadge = $derived(voteOpen && vote?.myTarget == null ? 1 : 0);
  const apps = $derived(APPS.filter((a) => a.id !== 'vote' || voteOpen));
  // Theme layout only: the four dock apps; everything else (Vote only while a poll is open) goes on the grid.
  const DOCK = ['chat', 'market', 'messages', 'feed'];
  const dockApps = $derived(DOCK.map((id) => apps.find((a) => a.id === id)).filter((a): a is (typeof APPS)[number] => !!a));
  const gridApps = $derived(apps.filter((a) => !DOCK.includes(a.id)));
  const latest = $derived(s?.feed?.[0] ? feedText(s.feed[0], s.players) : 'Quiet so far.');
  // Incoming call: once per quarter until answered or declined (decline = snooze; the badge stays).
  let callDone = $state(store.get('gn_call_done') ?? '');
  const callKey = $derived(vote && s?.night ? `${s.night.id}:${vote.quarter}` : '');
  const ringing = $derived(voteOpen && vote != null && vote.myTarget == null && callDone !== callKey && app !== 'vote');
  function endCall(answer: boolean) {
    callDone = callKey;
    store.set('gn_call_done', callDone);
    if (answer) openApp('vote');
  }
  $effect(() => {
    if (!ringing) return;
    navigator.vibrate?.([400, 200, 400, 200, 400]);
    const h = setInterval(() => navigator.vibrate?.([400, 200, 400]), 3000);
    return () => clearInterval(h);
  });
  $effect(() => {
    if (app === 'vote' && !voteOpen && vote == null) app = null;
  });
  const unseenFeed = $derived((s?.feed ?? []).filter((f) => f.id > feedSeen).length);
  const chatUnread = $derived(s?.me?.chatUnread ?? 0);
  const badges = $derived<Record<string, number>>({ messages: unreadMessages, chat: chatUnread, feed: unseenFeed, vote: voteBadge });
  let lastTotal = -1;
  $effect(() => {
    const total = unreadMessages + chatUnread + unseenFeed + voteBadge;
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

  const locked = $derived(s?.night?.status === 'paused' ? 'paused' : s?.night?.status === 'ended' && !s.night.recapDone ? 'ended' : null);
  const statementReady = $derived(s?.night?.status === 'ended' && !!s.night.recapDone);
  const countdown = $derived.by(() => {
    const until = s?.night?.pauseUntil;
    if (!until) return null;
    const ms = Math.max(0, until - now);
    return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  });
  const timeStr = $derived(new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
</script>

{#snippet tile(a: { id: string; icon: string })}
  <button class="app a-{a.id}" onclick={(e) => { setOrigin(e); openApp(a.id); }}>
    <div class="ic">{a.icon}</div>
    {#if badges[a.id]}<i class="nb">{badges[a.id]}</i>{/if}
    {t(`phone.apps.${a.id}`)}
  </button>
{/snippet}

<div class="phone">
  <Toasts />
  <div class="rotate">{t('phone.rotate')}</div>

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
    <header class="sb">
      <span>{timeStr}</span>
      <span class="r">
        {#if s?.me}<span class="gold">{gold(s.me.cashH)} gold</span>{/if}
        <span class="sig" class:off={!connected} aria-label={connected ? 'connected' : 'offline'}><i style="height:4px"></i><i style="height:7px"></i><i style="height:10px"></i></span>
      </span>
    </header>

    <div class="stage">
      {#if !s}
        <p class="center pad muted">Connecting…</p>
      {:else if !s.night || !s.me}
        <p class="center pad muted">No session in progress.</p>
      {:else if statementReady}
        <div class="view final"><Statement /></div>
      {:else if locked === 'paused' && funApp(lockApp)}
        {@const F = funApp(lockApp)!.component}
        <div class="view">
          <div class="appbar lockbar">
            <button onclick={() => (lockApp = null)}>‹ {t('minter.lock_close')}</button>
            <span class="small muted mono">{countdown ?? ''}</span>
          </div>
          <div class="list appbody"><F {s} /></div>
        </div>
      {:else if locked}
        <!-- Lock screen: pause (spec §15.3) / collapse stand-by. Inputs frozen. -->
        <div class="view lock">
          <div class="clock">{timeStr}</div>
          <h2>{locked === 'paused' ? t('phone.paused_title') : t('phone.ended_title')}</h2>
          <p>{locked === 'paused' ? t('phone.paused_body') : t('phone.ended_body')}</p>
          {#if locked === 'paused' && countdown}<p class="cd2">{countdown}</p>{/if}
          {#if locked === 'paused'}
            {#each FUN_APPS.filter((f) => f.onLockScreen) as f (f.id)}
              <button class="primary" onclick={() => (lockApp = f.id)}>{t('minter.lock_open')}</button>
            {/each}
          {/if}
        </div>
      {:else if ringing && vote}
        <!-- Full-screen incoming call (spec §9 / §15.2). -->
        <div class="view call">
          <div class="small muted">{t('phone.call_title')}</div>
          <div class="who">{t('phone.call_from')}</div>
          <div class="muted">{t('phone.call_body', { quarter: vote.quarter })}</div>
          <div class="btns">
            <button class="rb d" onclick={() => endCall(false)}>{t('phone.call_decline')}</button>
            <button class="rb a" onclick={() => endCall(true)}>{t('phone.call_accept')}</button>
          </div>
        </div>
      {:else if app}
        <div class="view" in:zoom={{ kind: 'app' }} out:zoom={{ kind: 'app' }}>
          <div class="appbar">
            <button onclick={() => (app = null)}>‹ Home</button>
            <strong>{t(`phone.apps.${app}`)}</strong>
          </div>
          <div class="list appbody">
            {#if app === 'vote'}<Vote {s} {now} />
            {:else if app === 'wallet'}<Wallet {s} />
            {:else if app === 'market'}<Market {s} />
            {:else if app === 'standings'}<Standings {s} />
            {:else if app === 'messages'}<Messages {s} />
            {:else if app === 'chat'}<Chat {s} />
            {:else if app === 'feed'}<Feed {s} />
            {:else if app === 'rules'}<Rules {s} />
            {:else if app === 'profile'}<Profile {s} onsignout={() => { live?.close(); route(); }} />
            {:else if funApp(app)}
              {@const F = funApp(app)!.component}
              <F {s} />
            {/if}
          </div>
        </div>
      {:else}
        <div class="view home" in:zoom={{ kind: 'home' }} out:zoom={{ kind: 'home' }}>
          <div class="wd bond">
            <span class="stamp">Approved*<small>*subject to audit</small></span>
            {#if s.players.find((p) => p.id === s?.me?.id)?.left}<p class="notice">{t('phone.left_notice')}</p>{/if}
            <span class="tag">{s.night.name}</span><br />
            <span class="line-st" class:down={!connected}>● {connected ? 'line secured' : 'line down'}</span>
            <div class="nw">
              <div class="big">{gold(s.me.netWorthH)}</div>
              <div class="m">net worth<br />· rank {s.me.rank ?? '—'}</div>
            </div>
          </div>
          <div class="feed"><i>&gt;</i> {latest}<span class="cur">_</span></div>
          <div class="grid">
            {#each gridApps as a (a.id)}{@render tile(a)}{/each}
          </div>
          <div class="brand"><b>{t('brand.company')}</b>{t('brand.tagline')}</div>
        </div>
        <div class="dock" in:dockfx out:dockfx>
          {#each dockApps as a (a.id)}{@render tile(a)}{/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
