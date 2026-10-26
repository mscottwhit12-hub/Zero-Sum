<script lang="ts">
  import { onDestroy } from 'svelte';
  import { post } from '@shared/api';
  import { t } from '@shared/copy';
  import { clock, gold, hours, timeOfDay } from '@shared/format';
  import { nightNow } from '@shared/socket';
  import { run } from '@shared/ui';
  import type { GameInfo, GmState, WhoAmI } from '@shared/types';
  import { playerName } from '../lib';

  let { gs, whoami, onresult }: { gs: GmState | null; whoami: WhoAmI; onresult: (g: GameInfo) => void } = $props();
  const master = $derived(whoami.role === 'master');
  const night = $derived(gs?.night && gs.night.status !== 'archived' ? gs.night : null);
  let now = $state(Date.now());
  const timer = setInterval(() => (now = Date.now()), 1000);
  onDestroy(() => clearInterval(timer));

  const active = $derived((gs?.games ?? []).filter((g) => g.status === 'active'));
  const upcoming = $derived((gs?.games ?? []).filter((g) => g.status === 'scheduled'));
  const quarterLabel = $derived.by(() => {
    if (!night) return '';
    if (night.currentQuarter) return `Q${night.currentQuarter} of ${night.quarters.length}`;
    const min = nightNow(night, now) / 60000;
    return min < (night.quarters[0]?.startMin ?? 0) ? 'Before Q1' : 'After last quarter';
  });

  // New night form
  let nName = $state('Game Night');
  let nLength = $state(300);

  const act = (path: string, ok: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    return run(() => post(`/api/night/${path}`), ok);
  };
  const tap = (g: GameInfo, playerId: number) => run(() => post(`/api/games/${g.id}/leader`, { playerId }));
  const start = (g: GameInfo) => run(() => post(`/api/games/${g.id}/start`), `${g.name} started`);
</script>

{#if !night}
  <section class="panel">
    <h2>No night yet</h2>
    {#if master}
      <form class="row" onsubmit={(e) => (e.preventDefault(), run(() => post('/api/nights', { name: nName, lengthMinutes: Number(nLength) }), 'Night created'))}>
        <label><span>Name</span><input bind:value={nName} /></label>
        <label><span>Length (minutes)</span><input type="number" min="30" max="1440" bind:value={nLength} /></label>
        <button class="primary" type="submit">Create night</button>
      </form>
    {:else}
      <p class="muted">Waiting for the Master GM to create tonight's night.</p>
    {/if}
  </section>
{:else}
  <section class="panel">
    <div class="spread">
      <div>
        <h2>{night.name}</h2>
        <div class="row small">
          <span class="badge" class:live={night.status === 'live'} class:warn={night.status === 'paused'}>{t(`status.${night.status}`)}</span>
          {#if night.tradingClosed}<span class="badge warn">Trading closed</span>{/if}
          <span class="mono">{clock(nightNow(night, now))}</span>
          <span class="muted">/ {Math.floor(night.lengthMinutes / 60)}h{String(night.lengthMinutes % 60).padStart(2, '0')}</span>
          <span class="muted">· {quarterLabel}</span>
          <span class="muted">· {gs?.players.length ?? 0} players</span>
        </div>
      </div>
      {#if master}
        <div class="row">
          {#if night.status === 'setup'}<button class="primary" onclick={() => act('open-joins', 'Joins open')}>Open joins</button>{/if}
          {#if night.status === 'joins_open'}<button class="primary" disabled={!gs?.players.length} onclick={() => act('start', 'Night is live')}>Start night</button>{/if}
          {#if night.status === 'live'}<button onclick={() => act('pause', 'Paused')}>Pause</button>{/if}
          {#if night.status === 'paused'}<button class="primary" onclick={() => act('resume', 'Resumed')}>Resume</button>{/if}
          {#if (night.status === 'live' || night.status === 'paused') && !night.tradingClosed}
            <button onclick={() => act('close-trading', 'Trading closed', 'Close trading for the rest of the night?')}>Close trading</button>
          {/if}
          {#if night.status === 'live' || night.status === 'paused'}
            <button class="danger" onclick={() => act('end', 'Night ended', 'End the night? Holdings auto-sell and the market collapses.')}>End night</button>
          {/if}
          {#if night.status === 'ended'}<button onclick={() => act('archive', 'Archived', 'Archive this night? You can then create a new one.')}>Archive</button>{/if}
        </div>
      {/if}
    </div>
  </section>

  <section>
    <h2>Active games</h2>
    {#if !active.length}<p class="muted panel">No games running.</p>{/if}
    <div class="grid2">
      {#each active as g (g.id)}
        <div class="panel">
          <div class="spread">
            <strong>{g.name}</strong>
            <span class="muted small mono">{hours(g.hours)}{g.plannedDurationHours ? ` / ${hours(g.plannedDurationHours)}` : ''}</span>
          </div>
          <p class="small muted">Tap the current leader</p>
          <div class="row">
            {#each g.participants as p (p.playerId)}
              <button class="chip" class:on={g.leaderId === p.playerId} onclick={() => tap(g, p.playerId)}>
                {g.leaderId === p.playerId ? '♛ ' : ''}{playerName(gs, p.playerId)}
              </button>
            {/each}
            {#if !g.participants.length}
              {#each gs?.players.filter((p) => !p.left) ?? [] as p (p.id)}
                <button class="chip" class:on={g.leaderId === p.id} onclick={() => tap(g, p.id)}>{playerName(gs, p.id)}</button>
              {/each}
            {/if}
          </div>
          <div class="row" style="margin-top:.6rem">
            <button class="primary big" onclick={() => onresult(g)}>Enter result</button>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="panel">
    <h2>Up next</h2>
    {#if !upcoming.length}<p class="muted">Nothing scheduled.</p>{/if}
    <table>
      <tbody>
        {#each upcoming as g (g.id)}
          <tr>
            <td>{g.name}</td>
            <td class="muted small">{timeOfDay(g.plannedStart)}</td>
            <td class="muted small">{g.participants.map((p) => playerName(gs, p.playerId)).join(', ') || 'No players yet'}</td>
            <td class="actions">
              <button disabled={night.status !== 'live'} onclick={() => start(g)}>Start</button>
              <button onclick={() => onresult(g)}>Result</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="panel">
    <h2>Standings</h2>
    <table>
      <thead><tr><th>#</th><th>Player</th><th class="num">Net worth</th></tr></thead>
      <tbody>
        {#each (gs?.standings ?? []).slice(0, 8) as s (s.playerId)}
          <tr><td>{s.rank}</td><td>{playerName(gs, s.playerId)}</td><td class="num">{gold(s.netWorthH)}</td></tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}
