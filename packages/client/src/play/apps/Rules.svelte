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

<input class="s" type="search" placeholder="Search the rulebook" bind:value={q} />

{#if !q}
  <details>
    <summary>Tonight's numbers</summary>
    <p>Trade fee {Math.round(r.feeFrac * 100)}% · invest cap {gold(r.investCapH)} gold · lockout {r.lockoutMinutes} min · minimum trade {gold(r.minTradeH)} gold · end-of-night fee {Math.round(r.endSellProfitFeeFrac * 100)}% of profits.</p>
  </details>
{/if}

{#if rules == null}
  <p class="muted">Loading…</p>
{:else}
  {#each [['House rules', house], ['Games', games]] as [label, list] (label)}
    {#if (list as RuleEntry[]).length}
      <div class="lab">{label}</div>
      {#each list as RuleEntry[] as e (e.id)}
        <div class="entry">
          <button class="head" onclick={() => (open = open === e.id ? null : e.id)}>
            <strong>{e.title}</strong>
            {#if e.gameName && e.gameName !== e.title}<span class="muted small"> · {e.gameName}</span>{/if}
          </button>
          {#if open === e.id || q}
            <div class="body">{@html markdown(e.body)}</div>
            {#if e.link}<a class="small" href={e.link} target="_blank" rel="noopener noreferrer">Open the full rules ↗</a>{/if}
          {/if}
        </div>
      {/each}
    {/if}
  {/each}
  {#if !hits.length}<p class="muted">Nothing matches “{q}”.</p>{/if}
{/if}
