<script lang="ts">
  /** Phone Risk app: only for players in a running Risk game. Live standings, and an optional battle log the GM approves. */
  import { run } from '@shared/ui';
  import type { PlayerState } from '@shared/types';
  import { dapi } from '../device';

  let { s }: { s: PlayerState } = $props();
  const games = $derived(s.me?.boardGames ?? []);
  let pickedGame = $state<number | null>(null);
  const g = $derived(games.find((x) => x.gameId === pickedGame) ?? games[0] ?? null);
  const nameOf = (id: number) => s.players.find((p) => p.id === id)?.displayName ?? '?';
  const meId = $derived(s.me?.id ?? -1);
  const rows = $derived(g ? [...g.players].sort((a, b) => Number(a.out) - Number(b.out) || b.territories - a.territories || b.armies - a.armies) : []);
  const amOut = $derived(!!g?.players.find((p) => p.id === meId)?.out);

  let defender = $state<number | null>(null);
  let territories = $state<number | ''>(1);
  let myLoss = $state<number | ''>('');
  let theirLoss = $state<number | ''>('');
  let rounds = $state<number | ''>('');
  let busy = $state(false);
  const opt = (v: number | '') => (v === '' ? null : Number(v));
  async function send() {
    if (!g || defender == null || territories === '') return;
    busy = true;
    const ok = await run(
      async () => (await dapi('POST', `/api/games/${g.gameId}/claims`, { defenderId: defender, territories: Number(territories), attackerLosses: opt(myLoss), defenderLosses: opt(theirLoss), rounds: opt(rounds) }), true),
      'Sent to the GM',
    );
    busy = false;
    if (ok) {
      defender = null;
      territories = 1;
      myLoss = theirLoss = rounds = '';
    }
  }
  const statusText = { pending: 'waiting for GM', approved: 'approved', rejected: 'rejected', void: 'game ended' } as const;
</script>

{#if !g}
  <p class="muted">No Risk game running.</p>
{:else}
  {#if games.length > 1}
    <div class="row">{#each games as x (x.gameId)}<button class="chip" class:on={x.gameId === g.gameId} onclick={() => (pickedGame = x.gameId)}>{x.name}</button>{/each}</div>
  {/if}
  <div class="cd">
    <h3>{g.name}: standings</h3>
    {#each rows as r, i (r.id)}
      <div class="kv" class:muted={r.out}>
        <span>{r.out ? '✕' : i + 1}. {nameOf(r.id)}{r.id === meId ? ' (you)' : ''}</span>
        <b class="mono">{r.out ? 'out' : `${r.territories} terr · ${r.armies} armies`}</b>
      </div>
    {/each}
  </div>

  {#if !amOut}
    <div class="cd">
      <h3>Log a battle you attacked in</h3>
      <p class="small">Optional. It saves the GM time; they approve it before it counts.</p>
      <label class="field"><span>Who you attacked</span>
        <select bind:value={defender}>
          <option value={null}>Choose…</option>
          {#each g.players.filter((p) => p.id !== meId && !p.out) as p (p.id)}<option value={p.id}>{nameOf(p.id)}</option>{/each}
        </select>
      </label>
      <label class="field"><span>Territories you took</span><input type="number" inputmode="numeric" min="0" bind:value={territories} /></label>
      <details>
        <summary class="small">Casualties and rounds (optional)</summary>
        <label class="field"><span>Armies you lost</span><input type="number" inputmode="numeric" min="0" bind:value={myLoss} /></label>
        <label class="field"><span>Armies they lost</span><input type="number" inputmode="numeric" min="0" bind:value={theirLoss} /></label>
        <label class="field"><span>Rounds fought</span><input type="number" inputmode="numeric" min="0" bind:value={rounds} /></label>
      </details>
      <button class="primary big" disabled={busy || defender == null || territories === ''} onclick={send}>Send to GM</button>
    </div>
  {/if}

  {#if g.myClaims.length}
    <div class="cd">
      <h3>Your battles</h3>
      {#each g.myClaims as c (c.id)}
        <div class="kv small"><span>vs {nameOf(c.payload.defenderId)}: took {c.payload.territories}</span><b>{statusText[c.status]}</b></div>
      {/each}
    </div>
  {/if}
{/if}
