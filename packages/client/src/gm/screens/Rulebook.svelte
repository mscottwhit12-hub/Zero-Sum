<script lang="ts">
  import { onMount } from 'svelte';
  import { del, get, patch, post } from '@shared/api';
  import { markdown } from '@shared/markdown';
  import { run } from '@shared/ui';
  import type { RuleEntry, WhoAmI } from '@shared/types';

  let { whoami }: { whoami: WhoAmI } = $props();
  const master = $derived(whoami.role === 'master');
  let rules = $state<RuleEntry[]>([]);
  let q = $state('');
  let editing = $state<number | 'new' | null>(null);
  let form = $state({ title: '', gameName: '', body: '', link: '' });
  let preview = $state(false);

  const load = async () => (rules = (await get<{ rules: RuleEntry[] }>('/api/rules')).rules);
  onMount(load);
  const shown = $derived(rules.filter((r) => !q.trim() || [r.title, r.gameName ?? '', r.body].join(' ').toLowerCase().includes(q.trim().toLowerCase())));

  function edit(r: RuleEntry | null) {
    editing = r ? r.id : 'new';
    form = { title: r?.title ?? '', gameName: r?.gameName ?? '', body: r?.body ?? '', link: r?.link ?? '' };
    preview = false;
  }
  async function save(e: Event) {
    e.preventDefault();
    const ok = editing === 'new' ? await run(() => post('/api/rules', form), 'Entry added') : await run(() => patch(`/api/rules/${editing}`, form), 'Entry saved');
    if (ok) {
      editing = null;
      await load();
    }
  }
  async function remove(r: RuleEntry) {
    if (!confirm(`Delete "${r.title}"?`)) return;
    if (await run(() => del(`/api/rules/${r.id}`), 'Deleted')) await load();
  }
</script>

<section class="panel">
  <div class="spread">
    <h2>Rulebook</h2>
    {#if master}<button class="primary" onclick={() => edit(null)}>New entry</button>{/if}
  </div>
  <p class="small muted">Write your own summaries and link to PDFs you own. Never paste official rulebooks. Leave “Game” empty for a house rule. Link an entry to a library game from the Library screen.</p>
  <input type="search" placeholder="Search" bind:value={q} />
</section>

{#if editing != null}
  <form class="panel" onsubmit={save}>
    <h2>{editing === 'new' ? 'New entry' : 'Edit entry'}</h2>
    <div class="grid2">
      <label class="field"><span>Title</span><input bind:value={form.title} required maxlength="120" /></label>
      <label class="field"><span>Game (empty = house rule)</span><input bind:value={form.gameName} maxlength="80" /></label>
      <label class="field"><span>Link to full rules (http/https, optional)</span><input bind:value={form.link} placeholder="http://nas.local/rules/game.pdf" /></label>
    </div>
    <label class="field"><span>Summary (Markdown: # heading, - list, **bold**, [link](https://…))</span><textarea rows="10" bind:value={form.body}></textarea></label>
    <label class="row small"><input type="checkbox" bind:checked={preview} /> Preview</label>
    {#if preview}<div class="panel md">{@html markdown(form.body)}</div>{/if}
    <div class="actions">
      <button class="primary" type="submit">Save</button>
      <button type="button" onclick={() => (editing = null)}>Cancel</button>
    </div>
  </form>
{/if}

<section class="panel">
  {#each shown as r (r.id)}
    <div class="line">
      <div class="spread">
        <span><strong>{r.title}</strong> <span class="muted small">{r.gameName ?? 'House rule'}{r.games.length ? ` · linked: ${r.games.map((g) => g.name).join(', ')}` : ''}</span></span>
        {#if master}<span class="row"><button onclick={() => edit(r)}>Edit</button><button class="danger" onclick={() => remove(r)}>Delete</button></span>{/if}
      </div>
      <div class="small muted clip">{r.body.slice(0, 160)}{r.body.length > 160 ? '…' : ''}</div>
    </div>
  {:else}
    <p class="muted">No entries.</p>
  {/each}
</section>

<style>
  .md :global(p),
  .md :global(ul) {
    margin: 0.4rem 0;
  }
</style>
