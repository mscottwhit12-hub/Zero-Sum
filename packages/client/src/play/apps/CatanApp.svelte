<script lang="ts">
  /**
   * Phone Catan app: only for players in a running Catan game. Everyone's points, settlements, cities and awards
   * (all public on a real table), and an optional log of your own builds and awards that the GM approves.
   * History shows only your own entries (Tate, Nov 5).
   */
  import { run } from '@shared/ui';
  import type { CatanAction, CatanBoardGame, PlayerState } from '@shared/types';
  import { dapi } from '../device';

  let { s }: { s: PlayerState } = $props();
  const games = $derived((s.me?.boardGames ?? []).filter((x): x is CatanBoardGame => x.board === 'catan'));
  let pickedGame = $state<number | null>(null);
  const g = $derived(games.find((x) => x.gameId === pickedGame) ?? games[0] ?? null);
  const nameOf = (id: number) => s.players.find((p) => p.id === id)?.displayName ?? '?';
  const meId = $derived(s.me?.id ?? -1);
  const rows = $derived(g ? [...g.players].sort((a, b) => b.points - a.points || b.cities - a.cities || b.settlements - a.settlements) : []);
  const me = $derived(g?.players.find((p) => p.id === meId) ?? null);

  const ACTIONS: { id: CatanAction; label: string; done: string }[] = [
    { id: 'settlement', label: 'I built a settlement', done: 'built a settlement' },
    { id: 'city', label: 'I upgraded to a city', done: 'upgraded to a city' },
    { id: 'longestRoad', label: 'I took Longest Road', done: 'took Longest Road' },
    { id: 'largestArmy', label: 'I took Largest Army', done: 'took Largest Army' },
  ];
  const doneText = (a: CatanAction) => ACTIONS.find((x) => x.id === a)?.done ?? a;
  const blocked = (a: CatanAction) => (a === 'city' && !!me && me.settlements < 1) || (a === 'longestRoad' && !!me?.longestRoad) || (a === 'largestArmy' && !!me?.largestArmy);

  let busy = $state(false);
  async function send(action: CatanAction) {
    if (!g || busy) return;
    busy = true;
    await run(async () => (await dapi('POST', `/api/games/${g.gameId}/claims`, { action }), true), 'Sent to the GM');
    busy = false;
  }
  const statusText = { pending: 'waiting for GM', approved: 'approved', rejected: 'rejected', void: 'game ended' } as const;
</script>

{#if !g}
  <p class="muted">No Catan game running.</p>
{:else}
  {#if games.length > 1}
    <div class="row">{#each games as x (x.gameId)}<button class="chip" class:on={x.gameId === g.gameId} onclick={() => (pickedGame = x.gameId)}>{x.name}</button>{/each}</div>
  {/if}
  <div class="cd">
    <h3>{g.name}: first to {g.target}</h3>
    {#each rows as r, i (r.id)}
      <div class="kv">
        <span>{i + 1}. {nameOf(r.id)}{r.id === meId ? ' (you)' : ''}{r.longestRoad ? ' · Longest Road' : ''}{r.largestArmy ? ' · Largest Army' : ''}</span>
        <b class="mono">{r.points} pts</b>
      </div>
      <p class="small muted mono catan-pieces">{r.settlements} settlement{r.settlements === 1 ? '' : 's'} · {r.cities} cit{r.cities === 1 ? 'y' : 'ies'}</p>
    {/each}
  </div>

  <div class="cd">
    <h3>Log what you did</h3>
    <p class="small">Optional. It saves the GM time; they approve it before it counts.</p>
    {#each ACTIONS as a (a.id)}
      <button class="big wide" disabled={busy || blocked(a.id)} onclick={() => send(a.id)}>{a.label}</button>
    {/each}
  </div>

  {#if g.myClaims.length}
    <div class="cd">
      <h3>Your entries</h3>
      {#each g.myClaims as c (c.id)}
        <div class="kv small"><span>You {doneText(c.payload.action)}</span><b>{statusText[c.status]}</b></div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .catan-pieces {
    margin: -0.2rem 0 0.4rem;
  }
  .wide {
    width: 100%;
    margin-top: 0.4rem;
  }
</style>
