<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ApiError, get } from '@shared/api';
  import { t } from '@shared/copy';
  import { connectLive, type Live } from '@shared/socket';
  import Toasts from '@shared/Toasts.svelte';
  import { toast } from '@shared/ui';
  import type { GameInfo, GmState, WhoAmI } from '@shared/types';
  import Audit from './screens/Audit.svelte';
  import Dashboard from './screens/Dashboard.svelte';
  import Devices from './screens/Devices.svelte';
  import Games from './screens/Games.svelte';
  import Library from './screens/Library.svelte';
  import Locked from './screens/Locked.svelte';
  import Login from './screens/Login.svelte';
  import Players from './screens/Players.svelte';
  import ResultWizard from './screens/ResultWizard.svelte';
  import Settings from './screens/Settings.svelte';
  import Setup from './screens/Setup.svelte';
  import Mood from './screens/Mood.svelte';
  import Espionage from './screens/Espionage.svelte';
  import Notify from './screens/Notify.svelte';
  import Market from './screens/Market.svelte';
  import Rulebook from './screens/Rulebook.svelte';
  import Seating from './screens/Seating.svelte';
  import Sounds from './screens/Sounds.svelte';
  import Archive from './screens/Archive.svelte';
  import JoinQr from './screens/JoinQr.svelte';
  import Handicaps from './screens/Handicaps.svelte';

  type Phase = 'loading' | 'setup' | 'login' | 'ready';
  let phase = $state<Phase>('loading');
  let whoami = $state<WhoAmI | null>(null);
  let live = $state<Live<GmState> | null>(null);
  let gmState = $state<GmState | null>(null);
  let connected = $state(false);
  let unsub: (() => void)[] = [];

  const ROUTES = [
    { id: 'dashboard', label: 'Dashboard', field: true },
    { id: 'games', label: 'Games', field: true },
    { id: 'mood', label: 'Mood', field: true },
    { id: 'espionage', label: 'Espionage', field: true },
    { id: 'notify', label: 'Messages', field: true },
    { id: 'players', label: 'Players', field: true },
    { id: 'market', label: 'Market', field: false },
    { id: 'handicaps', label: 'Handicaps', field: false },
    { id: 'seating', label: 'Seating', field: false },
    { id: 'sounds', label: 'Soundboard', field: false },
    { id: 'rules', label: 'Rulebook', field: false },
    { id: 'qr', label: 'Join QR', field: false },
    { id: 'archive', label: 'Archive & exports', field: false },
    { id: 'library', label: 'Library', field: false },
    { id: 'settings', label: 'Settings', field: false },
    { id: 'devices', label: 'Devices & GMs', field: false },
    { id: 'audit', label: 'Audit log', field: false },
  ] as const;
  type Route = (typeof ROUTES)[number]['id'];
  /** Phone bottom bar: the first four field actions; everything else under More. */
  const BAR = ROUTES.filter((r) => r.field).slice(0, 4);
  const readRoute = (): Route => {
    const h = location.hash.replace(/^#\/?/, '') as Route;
    return ROUTES.some((r) => r.id === h) ? h : 'dashboard';
  };
  let route = $state<Route>(readRoute());
  let moreOpen = $state(false);
  const go = (r: Route) => {
    location.hash = `/${r}`;
    moreOpen = false;
  };

  let wizard = $state<{ game: GameInfo; correction: boolean } | null>(null);

  async function boot() {
    phase = 'loading';
    try {
      const s = await get<{ needsSetup: boolean }>('/api/setup/status');
      if (s.needsSetup) return (phase = 'setup');
      const me = await get<{ gm: WhoAmI }>('/api/gm/me');
      whoami = me.gm;
      phase = 'ready';
      connect();
    } catch (e) {
      phase = e instanceof ApiError && e.status === 401 ? 'login' : 'login';
    }
  }

  function connect() {
    live?.close();
    unsub.forEach((u) => u());
    live = connectLive<GmState>('gm', {}, {
      'device:approval': (d) => {
        const x = d as { kind: string; displayName: string };
        toast(`${x.kind === 'rejoin' ? 'Rejoin' : 'Late join'} request: ${x.displayName}`);
        navigator.vibrate?.(80);
      },
      'gm:device_pause': async () => {
        const me = await get<{ gm: WhoAmI }>('/api/gm/me').catch(() => null);
        if (me) whoami = me.gm;
        connect(); // fresh snapshot for the new view
      },
      connect_error: (err) => {
        if ((err as Error).message === 'unauthorized') {
          live?.close();
          phase = 'login';
        }
      },
    });
    unsub = [live.state.subscribe((s) => (gmState = s)), live.connected.subscribe((c) => (connected = c))];
  }

  onMount(() => {
    boot();
    const onHash = () => (route = readRoute());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  });
  onDestroy(() => {
    live?.close();
    unsub.forEach((u) => u());
  });

  const layout = $derived(whoami?.deviceType ?? 'laptop');
  const openWizard = (game: GameInfo, correction = false) => (wizard = { game, correction });
</script>

<Toasts />

{#if phase === 'loading'}
  <p class="muted center">Loading…</p>
{:else if phase === 'setup'}
  <Setup ondone={boot} />
{:else if phase === 'login'}
  <Login ondone={boot} />
{:else if whoami?.paused}
  <Locked gs={gmState} onunlock={boot} />
{:else if whoami}
  <div class="shell {layout}">
    <header class="top spread">
      <strong>{t('brand.gm')}</strong>
      <span class="row small muted">
        <span class="dot" style="background:{connected ? 'var(--good)' : 'var(--bad)'}"></span>
        {whoami.name} · {whoami.role === 'master' ? 'Master' : 'Sub GM'}
      </span>
    </header>

    {#if layout === 'laptop'}
      <nav class="side">
        {#each ROUTES as r (r.id)}
          <button class:on={route === r.id} onclick={() => go(r.id)}>{r.label}</button>
        {/each}
      </nav>
    {/if}

    <main class="content">
      {#if route === 'dashboard'}<Dashboard gs={gmState} {whoami} onresult={(g) => openWizard(g)} />
      {:else if route === 'games'}<Games gs={gmState} {whoami} onresult={openWizard} />
      {:else if route === 'players'}<Players gs={gmState} {whoami} />
      {:else if route === 'mood'}<Mood gs={gmState} />
      {:else if route === 'espionage'}<Espionage gs={gmState} />
      {:else if route === 'notify'}<Notify gs={gmState} />
      {:else if route === 'market'}<Market gs={gmState} {whoami} />
      {:else if route === 'handicaps'}<Handicaps gs={gmState} {whoami} />
      {:else if route === 'seating'}<Seating gs={gmState} {whoami} />
      {:else if route === 'sounds'}<Sounds gs={gmState} {whoami} />
      {:else if route === 'rules'}<Rulebook {whoami} />
      {:else if route === 'qr'}<JoinQr gs={gmState} />
      {:else if route === 'archive'}<Archive {whoami} />
      {:else if route === 'library'}<Library gs={gmState} {whoami} />
      {:else if route === 'settings'}<Settings gs={gmState} {whoami} />
      {:else if route === 'devices'}<Devices {whoami} onlogout={() => { live?.close(); phase = 'login'; }} ondevice={(d) => whoami && (whoami = { ...whoami, deviceType: d })} />
      {:else if route === 'audit'}<Audit />
      {/if}
    </main>

    {#if layout === 'phone'}
      <!-- Field actions first on the phone (spec §16). -->
      <nav class="bottom">
        {#each BAR as r (r.id)}
          <button class:on={route === r.id} onclick={() => go(r.id)}>{r.label}</button>
        {/each}
        <button class:on={moreOpen || !BAR.some((r) => r.id === route)} onclick={() => (moreOpen = !moreOpen)}>More</button>
      </nav>
      {#if moreOpen}
        <div class="more panel">
          {#each ROUTES.filter((r) => !BAR.some((x) => x.id === r.id)) as r (r.id)}
            <button class="big" onclick={() => go(r.id)}>{r.label}</button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  {#if wizard}
    <ResultWizard gs={gmState} game={wizard.game} correction={wizard.correction} onclose={() => (wizard = null)} />
  {/if}
{/if}

<style>
  .center {
    text-align: center;
    margin-top: 3rem;
  }
  .shell.laptop {
    display: grid;
    grid-template-columns: 190px 1fr;
    grid-template-rows: auto 1fr;
    min-height: 100vh;
  }
  .top {
    grid-column: 1 / -1;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.8rem;
    border-right: 1px solid var(--line);
  }
  .side button {
    text-align: left;
    border-color: transparent;
    background: transparent;
  }
  .side button.on,
  .bottom button.on {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .content {
    padding: 1rem;
    max-width: 1100px;
    width: 100%;
  }
  .shell.phone .content {
    padding: 0.75rem 0.75rem 84px;
  }
  .bottom {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    background: var(--panel);
    border-top: 1px solid var(--line);
    padding: 0.4rem;
    gap: 0.3rem;
    padding-bottom: max(0.4rem, env(safe-area-inset-bottom));
  }
  .bottom button {
    min-height: 48px;
    border-color: transparent;
  }
  .more {
    position: fixed;
    bottom: 70px;
    right: 0.5rem;
    left: 0.5rem;
    display: grid;
    gap: 0.4rem;
    z-index: 20;
  }
</style>
