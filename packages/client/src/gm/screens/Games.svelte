<script lang="ts">
  import { patch, post } from '@shared/api';
  import { t } from '@shared/copy';
  import { hours, timeOfDay } from '@shared/format';
  import { run } from '@shared/ui';
  import type { GameInfo, GmState, WhoAmI } from '@shared/types';
  import { activePlayers, confirmStart, doubleBooked, epochToTime, pastNightEnd, playerName, timeToEpoch } from '../lib';
  import { gameClock, gameTag } from '@shared/gameTime';
  import { onDestroy } from 'svelte';
  import ScheduleTimeline from './ScheduleTimeline.svelte';

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
  let tableId = $state('');
  let picked = $state<number[]>([]);
  let leadMode = $state<'high' | 'low' | 'manual'>('high');
  let leadLabel = $state('');
  /** Set by the library game (pack): shown, not editable here. */
  let leadFixed = $state(false);

  function pickLibrary(id: string) {
    libraryGameId = id;
    const g = library.find((x) => String(x.id) === id);
    if (g) {
      name = g.name;
      mode = g.mode;
      duration = g.defaultDuration;
      rerolls = g.rerollsAllowed;
      leadFixed = !!g.leadMode;
      leadMode = g.leadMode ?? 'high';
      leadLabel = g.leadLabel ?? '';
    } else leadFixed = false;
  }
  function edit(g: GameInfo) {
    editing = g.id;
    libraryGameId = '';
    name = g.name;
    mode = g.mode;
    start = epochToTime(g.plannedStart);
    duration = g.plannedDurationHours ?? 1;
    rerolls = g.rerollsAllowed;
    tableId = g.tableId == null ? '' : String(g.tableId);
    picked = g.participants.map((p) => p.playerId);
    leadMode = g.leadMode;
    leadLabel = g.leadLabel ?? '';
    leadFixed = g.leadFixed || g.status !== 'scheduled';
  }
  function reset() {
    editing = null;
    libraryGameId = '';
    name = '';
    mode = 'competitive';
    start = '';
    duration = 1;
    rerolls = false;
    tableId = '';
    picked = [];
    leadMode = 'high';
    leadLabel = '';
    leadFixed = false;
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
      tableId: tableId || null,
      participants: picked,
      ...(leadFixed ? {} : { leadMode, leadLabel }),
    };
    const late = pastNightEnd(gs, body.plannedStart, body.plannedDurationHours);
    const clash = [...doubleBooked(gs, body.plannedStart, body.plannedDurationHours, picked, editing ?? undefined), ...(late ? [late] : [])];
    if (clash.length && !confirm(`${clash.join('\n')}\n\nSchedule anyway?`)) return;
    const r = editing ? await run(() => patch(`/api/games/${editing}`, body), 'Game updated') : await run(() => post('/api/games', body), 'Game scheduled');
    if (r) reset();
  }
  const toggle = (id: number) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const statusOrder = { active: 0, scheduled: 1, final: 2, cancelled: 3 } as const;
  let now = $state(Date.now());
  const tick = setInterval(() => (now = Date.now()), 15_000);
  onDestroy(() => clearInterval(tick));
  const startGame = (g: GameInfo) => confirmStart(gs, g) && run(() => post(`/api/games/${g.id}/start`), 'Started');
</script>

<ScheduleTimeline {gs} editable={master} />

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
      <label class="field"><span>Table (optional)</span>
        <select bind:value={tableId}>
          <option value="">—</option>
          {#each gs?.gm?.seating ?? [] as tb (tb.id)}<option value={String(tb.id)}>{tb.name}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>Who's leading</span>
        <select bind:value={leadMode} disabled={leadFixed}>
          <option value="high">{t('lead.high')}</option>
          <option value="low">{t('lead.low')}</option>
          <option value="manual">{t('lead.manual')}</option>
        </select>
      </label>
      {#if leadMode !== 'manual'}<label class="field"><span>Score name</span><input bind:value={leadLabel} maxlength="24" placeholder={t('lead.score')} disabled={leadFixed} /></label>{/if}
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
      <thead><tr><th>Game</th><th>Status</th><th>Time</th><th>Length</th><th>Players</th><th></th></tr></thead>
      <tbody>
        {#each [...games].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]) as g (g.id)}
          <tr>
            <td>{g.name} <span class="muted small">{t(`modes.${g.mode}`)}</span></td>
            <td>
              <span class="badge" class:live={g.status === 'active'}>{g.status}</span>
              {#if gameTag(g, now) === 'filibuster'}<span class="badge warn">Filibuster</span>{:else if gameTag(g, now) === 'tardy'}<span class="badge bad">Tardy</span>{/if}
            </td>
            <td class="small">{gameClock(g, now) || timeOfDay(g.startedAt ?? g.plannedStart)}</td>
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
                  <button disabled={gs?.night?.status !== 'live'} onclick={() => startGame(g)}>Start</button>
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

{#each games.filter((g) => g.status === 'active' && g.rerollsAllowed) as g (g.id)}
  <section class="panel">
    <h2>Re-rolls · {g.name}</h2>
    <p class="small muted">Tap when a player spends a re-roll.</p>
    <div class="row">
      {#each g.participants.length ? g.participants.map((p) => p.playerId) : activePlayers(gs).map((p) => p.id) as id (id)}
        {@const left = gs?.gm?.rerolls[id] ?? 0}
        <button class="big" disabled={left <= 0} onclick={() => run(() => post('/api/rerolls', { gameId: g.id, playerId: id }), `Re-roll logged for ${playerName(gs, id)}`)}>
          {playerName(gs, id)} <span class="muted small">({left} left)</span>
        </button>
      {/each}
    </div>
  </section>
{/each}
