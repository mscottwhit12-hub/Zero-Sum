<script lang="ts">
  import { post } from '@shared/api';
  import { run } from '@shared/ui';
  import type { GmState } from '@shared/types';
  import { activePlayers } from '../lib';

  let { gs }: { gs: GmState | null } = $props();
  const live = $derived(gs?.night?.status === 'live' || gs?.night?.status === 'paused');
  const latest = $derived(new Map((gs?.gm?.mood ?? []).map((m) => [m.playerId, m])));
  // Draft ratings; a reading is sent as soon as both rows are tapped (target ≤10 s per player).
  let draft = $state<Record<number, { mood?: number; self?: number }>>({});
  async function tap(playerId: number, key: 'mood' | 'self', v: number) {
    const d = { ...(draft[playerId] ?? {}), [key]: v };
    draft = { ...draft, [playerId]: d };
    if (d.mood && d.self) {
      const ok = await run(() => post('/api/mood', { playerId, mood: d.mood, selfAssessment: d.self }), 'Saved');
      if (ok) {
        const { [playerId]: _, ...rest } = draft;
        draft = rest;
      }
    }
  }
  const pct = (b: number) => `${b >= 0 ? '+' : '−'}${Math.abs(b * 100).toFixed(1)}%`;
</script>

<section class="panel">
  <h2>Mood round</h2>
  <p class="small muted">Two taps per player. Mood: gloomy → cheery. Self-assessment: how well they seem to feel they're doing. Impact is GM-only.</p>
</section>
{#if !live}<p class="muted panel">The night isn't running.</p>{/if}
{#each activePlayers(gs) as p (p.id)}
  {@const last = latest.get(p.id)}
  <div class="panel">
    <div class="spread">
      <strong>{p.displayName}</strong>
      <span class="small muted mono">{last ? `last ${last.mood}/${last.selfAssessment} · bias ${pct(last.bias)}` : 'no reading'}</span>
    </div>
    {#each [['mood', 'Mood'], ['self', 'Self']] as [key, label] (key)}
      <div class="row rate">
        <span class="small lbl">{label}</span>
        {#each [1, 2, 3, 4, 5] as v (v)}
          <button class="chip" disabled={!live} class:on={draft[p.id]?.[key as 'mood' | 'self'] === v} onclick={() => tap(p.id, key as 'mood' | 'self', v)}>{v}</button>
        {/each}
      </div>
    {/each}
  </div>
{/each}

<style>
  .rate {
    margin-top: 0.4rem;
    flex-wrap: nowrap;
  }
  .lbl {
    width: 3.2rem;
  }
  .rate .chip {
    flex: 1;
    min-width: 0;
    max-width: 64px;
    min-height: 44px;
  }
</style>
