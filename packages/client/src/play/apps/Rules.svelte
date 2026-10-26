<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '@shared/api';
  import { gold } from '@shared/format';
  import { markdown } from '@shared/markdown';
  import type { PlayerState, RuleEntry } from '@shared/types';
  let { s }: { s: PlayerState } = $props();
  const r = $derived(s.night!.rules);

  let rules = $state<RuleEntry[] | null>(null);
  let q = $state('');
  let open = $state<number | null>(null);
  onMount(async () => {
    rules = (await get<{ rules: RuleEntry[] }>('/api/rules').catch(() => ({ rules: [] }))).rules;
  });
  const hits = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const list = rules ?? [];
    if (!needle) return list;
    return list.filter((e) => [e.title, e.gameName ?? '', e.body, ...e.games.map((g) => g.name)].join(' ').toLowerCase().includes(needle));
  });
  const house = $derived(hits.filter((e) => !e.gameName));
  const games = $derived(hits.filter((e) => e.gameName));
</script>

<input type="search" placeholder="Search the rulebook" bind:value={q} style="width:100%" />

{#if !q}
  <details class="panel small">
    <summary><strong>Tonight's numbers</strong></summary>
    <p>Trade fee {Math.round(r.feeFrac * 100)}% · invest cap {gold(r.investCapH)} gold · lockout {r.lockoutMinutes} min · minimum trade {gold(r.minTradeH)} gold · end-of-night fee {Math.round(r.endSellProfitFeeFrac * 100)}% of profits.</p>
  </details>
{/if}

{#if rules == null}
  <p class="muted">Loading…</p>
{:else}
  {#each [['House rules', house], ['Games', games]] as [label, list] (label)}
    {#if (list as RuleEntry[]).length}
      <h3 class="small muted">{label}</h3>
      {#each list as RuleEntry[] as e (e.id)}
        <div class="panel entry">
          <button class="head" onclick={() => (open = open === e.id ? null : e.id)}>
            <strong>{e.title}</strong>
            {#if e.gameName && e.gameName !== e.title}<span class="muted small"> · {e.gameName}</span>{/if}
          </button>
          {#if open === e.id || q}
            <div class="body small">{@html markdown(e.body)}</div>
            {#if e.link}<a class="small" href={e.link} target="_blank" rel="noopener noreferrer">Open the full rules ↗</a>{/if}
          {/if}
        </div>
      {/each}
    {/if}
  {/each}
  {#if !hits.length}<p class="muted">Nothing matches “{q}”.</p>{/if}
{/if}

<style>
  .entry {
    padding: 0.5rem 0.7rem;
  }
  .head {
    all: unset;
    display: block;
    width: 100%;
    cursor: pointer;
  }
  .body :global(p),
  .body :global(ul) {
    margin: 0.4rem 0;
  }
  .body :global(h4) {
    margin: 0.6rem 0 0.2rem;
  }
</style>
