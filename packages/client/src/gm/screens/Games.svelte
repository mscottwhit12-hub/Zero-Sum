<script lang="ts">
  import { patch, post } from '@shared/api';
  import { t } from '@shared/copy';
  import { hours, timeOfDay } from '@shared/format';
  import { run } from '@shared/ui';
  import type { GameInfo, GmState, WhoAmI } from '@shared/types';
  import { activePlayers, epochToTime, playerName, timeToEpoch } from '../lib';

  let { gs, whoami, onresult }: { gs: GmState | null; whoami: WhoAmI; onresult: (g: GameInfo, correction: boolean) => void } = $props();
  const master = $derived(whoami.role === 'master');
  const games = $derived(gs?.games ?? []);
  const library = $derived(gs?.gm?.library ?? []);

  // Schedule / edit form
  let editing = $state<number | null>(null);
  let libraryGameId = $state<string>('');
  let name = $state('');
  let mode = $state<'competitive' | 'team' | 'coop'>('competitive');
  let start = $state('');
  let duration = $state(1);
  let rerolls = $state(false);
  let picked = $state<number[]>([]);

  function pickLibrary(id: string) {
    libraryGameId = id;
    const g = library.find((x) => String(x.id) === id);
    if (g) {
      name = g.name;
      mode = g.mode;
      duration = g.defaultDuration;
      rerolls = g.rerollsAllowed;
    }
  }
  function edit(g: GameInfo) {
    editing = g.id;
    libraryGameId = '';
    name = g.name;
    mode = g.mode;
    start = epochToTime(g.plannedStart);
    duration = g.plannedDurationHours ?? 1;
    rerolls = g.rerollsAllowed;
    picked = g.participants.map((p) => p.playerId);
  }
  function reset() {
    editing = null;
    libraryGameId = '';
    name = '';
    mode = 'competitive';
    start = '';
    duration = 1;
    rerolls = false;
    picked = [];
  }
  async function save(e: Event) {
    e.preventDefault();
    const body = {
      libraryGameId: libraryGameId || undefined,
      name,
      mode,
      plannedStart: start ? timeToEpoch(start) : null,
      plannedDurationHours: Number(duration),
      rerollsAllowed: rerolls,
      participants: picked,
    };
    const r = editing ? await run(() => patch(`/api/games/${editing}`, body), 'Game updated') : await run(() => post('/api/games', body), 'Game scheduled');
    if (r) reset();
  }
  const toggle = (id: number) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const statusOrder = { active: 0, scheduled: 1, final: 2, cancelled: 3 } as const;
</script>

{#if master}
  <form class="panel" onsubmit={save}>
    <h2>{editing ? 'Edit game' : 'Schedule a game'}</h2>
    <div class="grid2">
      {#if !editing}
        <label class="field"><span>From library</span>
          <select value={libraryGameId} onchange={(e) => pickLibrary((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">— custom —</option>
            {#each library as g (g.id)}<option value={String(g.id)}>{g.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="field"><span>Name</span><input bind:value={name} required /></label>
      <label class="field"><span>Mode</span>
        <select bind:value={mode}>
          <option value="competitive">{t('modes.competitive')}</option>
          <option value="team">{t('modes.team')}</option>
          <option value="coop">{t('modes.coop')}</option>
        </select>
      </label>
      <label class="field"><span>Planned start (optional)</span><input type="time" bind:value={start} /></label>
      <label class="field"><span>Planned length (hours)</span><input type="number" step="any" min="0.1" max="8" bind:value={duration} /></label>
      <label class="field row"><input type="checkbox" bind:checked={rerolls} /> Re-rolls allowed</label>
    </div>
    <p class="small muted">Players (optional — can be set when the result is entered)</p>
    <div class="row">
      {#each activePlayers(gs) as p (p.id)}
        <button type="button" class="chip" class:on={picked.includes(p.id)} onclick={() => toggle(p.id)}>{p.displayName}</button>
      {/each}
      {#if !activePlayers(gs).length}<span class="muted small">No players have joined yet.</span>{/if}
    </div>
    <div class="row" style="margin-top:.8rem">
      <button class="primary" type="submit" disabled={!gs?.night}>{editing ? 'Save' : 'Schedule'}</button>
      {#if editing}<button type="button" onclick={reset}>Cancel edit</button>{/if}
    </div>
  </form>
{/if}

<section class="panel">
  <h2>Tonight's games</h2>
  <div class="scroll-x">
    <table>
      <thead><tr><th>Game</th><th>Status</th><th>Start</th><th>Length</th><th>Players</th><th></th></tr></thead>
      <tbody>
        {#each [...games].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]) as g (g.id)}
          <tr>
            <td>{g.name} <span class="muted small">{t(`modes.${g.mode}`)}</span></td>
            <td><span class="badge" class:live={g.status === 'active'}>{g.status}</span></td>
            <td class="small">{timeOfDay(g.startedAt ?? g.plannedStart)}</td>
            <td class="small mono">{hours(g.hours ?? g.plannedDurationHours)}</td>
            <td class="small">
              {#if g.status === 'final'}
                {g.participants.map((p) => `${p.dnf ? 'DNF' : (p.placement ?? '')} ${playerName(gs, p.playerId)}`).join(' · ')}
              {:else}
                {g.participants.map((p) => playerName(gs, p.playerId)).join(', ') || '—'}
              {/if}
            </td>
            <td class="actions">
              <div class="row" style="justify-content:flex-end">
                {#if g.status === 'scheduled'}
                  <button disabled={gs?.night?.status !== 'live'} onclick={() => run(() => post(`/api/games/${g.id}/start`), 'Started')}>Start</button>
                {/if}
                {#if g.status === 'scheduled' || g.status === 'active'}
                  <button class="primary" onclick={() => onresult(g, false)}>Result</button>
                  {#if master}<button onclick={() => edit(g)}>Edit</button>{/if}
                  {#if master}<button class="danger" onclick={() => confirm(`Cancel ${g.name}?`) && run(() => post(`/api/games/${g.id}/cancel`), 'Cancelled')}>Cancel</button>{/if}
                {/if}
                {#if g.status === 'final'}<button onclick={() => onresult(g, true)}>Correct</button>{/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if !games.length}<p class="muted">Nothing scheduled yet.</p>{/if}
</section>
