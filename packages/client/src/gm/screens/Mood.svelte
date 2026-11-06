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
  // Current sizes from the night's settings (defaults if not loaded).
  const S = $derived((gs?.gm?.settings?.resolved ?? {}) as { mood?: { moodMax?: number; jitterMax?: number }; market?: { noise?: { base?: number } } });
  const base = $derived(S.market?.noise?.base ?? 0.3);
  const jmax = $derived(S.mood?.jitterMax ?? 3);
  const push = $derived(Math.round((S.mood?.moodMax ?? 0.1) * 100));
  const money = (g: number) => `±${g.toFixed(2)}`;
  const ROWS = [
    ['mood', 'GM reported mood'],
    ['self', 'Reported mood'],
  ] as const;
</script>

<section class="panel">
  <h2>Mood round</h2>
  <p class="small muted">Two taps per player; it saves when both rows are tapped. Only GMs see the effect.</p>
  <dl class="guide">
    <dt>GM reported mood</dt>
    <dd>How upset they look to you. <b>1</b> very upset … <b>5</b> calm. Sets how much their stock jitters: 1 = up to {money(jmax)} gold, 5 = just the background {money(base)}.</dd>
    <dt>Reported mood</dt>
    <dd>How well they feel they're doing tonight. <b>1</b> losing badly … <b>5</b> winning. Pushes their price down or up, up to {push}% of its range.</dd>
  </dl>
  <p class="small muted">Both fade back to normal over time.</p>
</section>
{#if !live}<p class="muted panel">The night isn't running.</p>{/if}
{#each activePlayers(gs) as p (p.id)}
  {@const last = latest.get(p.id)}
  <div class="panel">
    <div class="spread">
      <strong>{p.displayName}</strong>
      <span class="small muted mono">{last ? `last ${last.mood}/${last.selfAssessment} · jitter ${money(last.jitter ?? base)} · push ${pct(last.bias)}` : 'no reading'}</span>
    </div>
    {#each ROWS as [key, label] (key)}
      <span class="small lbl">{label}</span>
      <div class="row rate">
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
    display: block;
    margin-top: 0.5rem;
  }
  .rate {
    margin-top: 0.2rem !important;
  }
  .guide {
    margin: 0.5rem 0 0;
  }
  .guide dt {
    font-weight: 700;
    margin-top: 0.4rem;
  }
  .guide dd {
    margin: 0.1rem 0 0;
    font-size: 0.9rem;
  }
  .rate .chip {
    flex: 1;
    min-width: 0;
    max-width: 64px;
    min-height: 44px;
  }
</style>
