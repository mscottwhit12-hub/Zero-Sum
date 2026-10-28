<script lang="ts">
  import { onMount } from 'svelte';
  import { resolveSettings, scoreGame, type GameResult, type Settings } from '@gn/engine';
  import { get, post } from '@shared/api';
  import { gold, ordinal } from '@shared/format';
  import { run } from '@shared/ui';
  import type { GameInfo, GmState } from '@shared/types';
  import { activePlayers, playerName } from '../lib';

  let {
    gs,
    game,
    correction = false,
    prefill = null,
    onclose,
  }: { gs: GmState | null; game: GameInfo; correction?: boolean; prefill?: number[][] | null; onclose: () => void } = $props();

  // Step 1: participants → 2: placements / teams / win-loss → 3: duration → submit. Target ≤30 s.
  let step = $state(1);
  let picked = $state<number[]>(game.participants.map((p) => p.playerId));
  // competitive
  let places = $state<Record<number, number>>({});
  let dnf = $state<Record<number, boolean>>({});
  let tieNext = $state(false);
  // team
  let teamOf = $state<Record<number, string>>({});
  let teamPlace = $state<Record<string, number>>({});
  let teamTie = $state(false);
  // coop
  let coopWon = $state<boolean | null>(null);
  let hoursPlayed = $state<number>(game.hours ?? game.plannedDurationHours ?? 1);

  onMount(async () => {
    if (correction) {
      for (const p of game.participants) {
        if (p.dnf) dnf[p.playerId] = true;
        else if (p.placement != null) places[p.playerId] = p.placement;
        if (p.team) {
          teamOf[p.playerId] = p.team;
          if (p.placement != null) teamPlace[p.team] = p.placement;
        }
      }
      return;
    }
    // Finish order from the game's board: groups best first; a group of 2+ shares a place.
    if (prefill && game.mode === 'competitive') {
      let place = 1;
      const next: Record<number, number> = {};
      for (const g of prefill) {
        for (const id of g) if (picked.includes(id)) next[id] = place;
        place += g.length;
      }
      places = next;
    }
    const r = await run(() => get<{ suggestedHours: number }>(`/api/games/${game.id}/prefill`));
    if (r) hoursPlayed = r.suggestedHours;
  });

  const togglePick = (id: number) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  // Tap in finishing order. "Tie" makes the next tap share the previous place.
  function tapPlace(id: number) {
    if (dnf[id]) return;
    if (places[id] != null) {
      const { [id]: _, ...rest } = places;
      places = rest;
      return;
    }
    const used = Object.values(places);
    const last = used.length ? Math.max(...used) : 0;
    places = { ...places, [id]: tieNext && last > 0 ? last : used.length + 1 };
    tieNext = false;
  }
  const toggleDnf = (id: number) => {
    dnf = { ...dnf, [id]: !dnf[id] };
    if (dnf[id]) {
      const { [id]: _, ...rest } = places;
      places = rest;
    }
  };
  const teams = $derived([...new Set(picked.map((id) => teamOf[id]).filter(Boolean))].sort() as string[]);
  function tapTeam(team: string) {
    if (teamPlace[team] != null) {
      const { [team]: _, ...rest } = teamPlace;
      teamPlace = rest;
      return;
    }
    const used = Object.values(teamPlace);
    const last = used.length ? Math.max(...used) : 0;
    teamPlace = { ...teamPlace, [team]: teamTie && last > 0 ? last : used.length + 1 };
    teamTie = false;
  }

  const result = $derived.by((): GameResult => ({
    id: String(game.id),
    mode: game.mode,
    actualHours: Number(hoursPlayed),
    coopWon: game.mode === 'coop' ? coopWon : null,
    participants: picked.map((id) => ({
      playerId: String(id),
      dnf: !!dnf[id],
      team: game.mode === 'team' ? (teamOf[id] ?? null) : null,
      placement: game.mode === 'team' ? (teamOf[id] ? (teamPlace[teamOf[id]!] ?? null) : null) : game.mode === 'competitive' ? (places[id] ?? null) : null,
    })),
  }));
  const step2Done = $derived(
    game.mode === 'coop'
      ? coopWon !== null
      : game.mode === 'team'
        ? picked.every((id) => dnf[id] || (teamOf[id] && teamPlace[teamOf[id]!] != null))
        : picked.every((id) => dnf[id] || places[id] != null),
  );
  const settings = $derived(resolveSettings((gs?.gm?.settings.overrides ?? {}) as never) as Settings);
  const preview = $derived.by(() => {
    try {
      return scoreGame(result, settings).rows;
    } catch {
      return null;
    }
  });

  let submitting = $state(false);
  async function submit() {
    if (submitting) return;
    submitting = true;
    const body = {
      actualHours: Number(hoursPlayed),
      coopWon: game.mode === 'coop' ? coopWon : undefined,
      participants: result.participants.map((p) => ({ playerId: Number(p.playerId), placement: p.placement, dnf: p.dnf, team: p.team })),
    };
    const r = await run(() => post(`/api/games/${game.id}/${correction ? 'correct' : 'result'}`, body), correction ? 'Result corrected' : 'Result saved');
    submitting = false;
    if (r) onclose();
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="sheet panel" role="dialog" aria-label="Result wizard">
  <div class="spread">
    <h2>{correction ? 'Correct result' : 'Result'}: {game.name}</h2>
    <button onclick={onclose}>Close</button>
  </div>
  <p class="muted small">Step {step} of 3 · {game.mode}</p>

  {#if step === 1}
    <p>Who played?</p>
    <div class="row">
      {#each activePlayers(gs) as p (p.id)}
        <button class="chip" class:on={picked.includes(p.id)} onclick={() => togglePick(p.id)}>{p.displayName}</button>
      {/each}
    </div>
    <div class="row foot"><button class="primary big" disabled={!picked.length} onclick={() => (step = 2)}>Next</button></div>
  {:else if step === 2}
    {#if game.mode === 'coop'}
      <div class="row">
        <button class="chip big" class:on={coopWon === true} onclick={() => (coopWon = true)}>Win</button>
        <button class="chip big" class:on={coopWon === false} onclick={() => (coopWon = false)}>Loss</button>
      </div>
    {:else if game.mode === 'team'}
      <p class="small muted">Assign teams, then tap teams in finishing order.</p>
      {#each picked as id (id)}
        <div class="row line">
          <span class="name">{playerName(gs, id)}</span>
          {#each ['A', 'B', 'C', 'D'] as tm}
            <button class="chip" class:on={teamOf[id] === tm} onclick={() => (teamOf = { ...teamOf, [id]: tm })}>{tm}</button>
          {/each}
          <button class="chip" class:on={dnf[id]} onclick={() => toggleDnf(id)}>DNF</button>
        </div>
      {/each}
      <div class="row">
        {#each teams as tm}
          <button class="chip big" class:on={teamPlace[tm] != null} onclick={() => tapTeam(tm)}>Team {tm}{teamPlace[tm] != null ? ` · ${ordinal(teamPlace[tm]!)}` : ''}</button>
        {/each}
        <button class="chip" class:on={teamTie} onclick={() => (teamTie = !teamTie)}>Tie next</button>
      </div>
    {:else}
      <p class="small muted">Tap players in finishing order. Tap again to undo.</p>
      {#each picked as id (id)}
        <div class="row line">
          <button class="chip big name" class:on={places[id] != null} onclick={() => tapPlace(id)}>
            {places[id] != null ? `${ordinal(places[id]!)} · ` : ''}{playerName(gs, id)}
          </button>
          <button class="chip" class:on={dnf[id]} onclick={() => toggleDnf(id)}>DNF</button>
        </div>
      {/each}
      <div class="row">
        <button class="chip" class:on={tieNext} onclick={() => (tieNext = !tieNext)}>Next tap ties previous</button>
        <button onclick={() => ((places = {}), (dnf = {}))}>Reset</button>
      </div>
    {/if}
    <div class="row foot">
      <button onclick={() => (step = 1)}>Back</button>
      <button class="primary big" disabled={!step2Done} onclick={() => (step = 3)}>Next</button>
    </div>
  {:else}
    <label class="field"><span>Actual hours played (pause excluded)</span><input type="number" step="any" min="0.05" max="12" bind:value={hoursPlayed} /></label>
    {#if preview}
      <table class="small">
        <tbody>
          {#each [...preview].sort((a, b) => b.goldH - a.goldH) as r (r.playerId)}
            <tr><td>{playerName(gs, Number(r.playerId))}</td><td class="num">+{gold(r.goldH)} gold</td></tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="error">Check the result: something is missing.</p>
    {/if}
    <div class="row foot">
      <button onclick={() => (step = 2)}>Back</button>
      <button class="primary big" disabled={!preview || submitting} onclick={submit}>{correction ? 'Save correction' : 'Submit result'}</button>
    </div>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.4);
    z-index: 50;
  }
  .sheet {
    position: fixed;
    z-index: 51;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(96vw, 560px);
    max-height: 92vh;
    overflow: auto;
  }
  .foot {
    margin-top: 1rem;
    justify-content: flex-end;
  }
  .line {
    margin-bottom: 0.35rem;
  }
  .name {
    min-width: 9rem;
  }
</style>
