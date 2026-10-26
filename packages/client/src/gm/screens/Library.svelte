<script lang="ts">
  import { onMount } from 'svelte';
  import { del, get, patch, post } from '@shared/api';
  import { t } from '@shared/copy';
  import { run, toast } from '@shared/ui';
  import type { GmState, LibraryGame, RuleEntry, WhoAmI } from '@shared/types';
  let { whoami }: { gs: GmState | null; whoami: WhoAmI } = $props();
  const master = $derived(whoami.role === 'master');
  // Loaded directly so the library is manageable before any night exists.
  let games = $state<LibraryGame[]>([]);
  const load = async () => {
    const r = await run(() => get<{ games: LibraryGame[] }>('/api/library'));
    if (r) games = r.games;
  };
  let rules = $state<RuleEntry[]>([]);
  onMount(() => {
    load();
    get<{ rules: RuleEntry[] }>('/api/rules').then((r) => (rules = r.rules)).catch(() => {});
  });

  const blank = { name: '', minPlayers: 2, maxPlayers: 6, defaultDuration: 1, mode: 'competitive' as const, rerollsAllowed: false, color: '#888888', icon: '', soundTheme: '', ruleEntryId: '' };
  let form = $state<Omit<LibraryGame, 'id' | 'soundTheme' | 'ruleEntryId' | 'color' | 'icon'> & { color: string; icon: string; soundTheme: string; ruleEntryId: string }>({ ...blank });
  let editing = $state<number | null>(null);

  function edit(g: LibraryGame) {
    editing = g.id;
    form = { name: g.name, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers, defaultDuration: g.defaultDuration, mode: g.mode, rerollsAllowed: g.rerollsAllowed, color: g.color ?? '#888888', icon: g.icon ?? '', soundTheme: g.soundTheme ?? '', ruleEntryId: g.ruleEntryId == null ? '' : String(g.ruleEntryId) };
  }
  function reset() {
    editing = null;
    form = { ...blank };
  }
  async function save(e: Event) {
    e.preventDefault();
    const r = editing ? await run(() => patch(`/api/library/${editing}`, form), 'Saved') : await run(() => post('/api/library', form), 'Added');
    if (r) {
      reset();
      load();
    }
  }
  async function importFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    let pack: unknown;
    try {
      pack = JSON.parse(await file.text());
    } catch {
      return toast('That file is not valid JSON.', 'error');
    }
    const r = await run(() => post<{ added: number; updated: number }>('/api/library/import', pack));
    if (r) {
      toast(`Imported: ${r.added} added, ${r.updated} updated`);
      load();
    }
  }
</script>

{#if master}
  <form class="panel" onsubmit={save}>
    <h2>{editing ? 'Edit game' : 'Add a game'}</h2>
    <div class="grid2">
      <label class="field"><span>Name</span><input bind:value={form.name} required /></label>
      <label class="field"><span>Mode</span>
        <select bind:value={form.mode}>
          <option value="competitive">{t('modes.competitive')}</option>
          <option value="team">{t('modes.team')}</option>
          <option value="coop">{t('modes.coop')}</option>
        </select>
      </label>
      <label class="field"><span>Min players</span><input type="number" min="1" max="30" bind:value={form.minPlayers} /></label>
      <label class="field"><span>Max players</span><input type="number" min="1" max="30" bind:value={form.maxPlayers} /></label>
      <label class="field"><span>Default length (hours)</span><input type="number" step="any" min="0.1" max="8" bind:value={form.defaultDuration} /></label>
      <label class="field"><span>Colour</span><input type="color" bind:value={form.color} /></label>
      <label class="field"><span>Sound theme (ambient)</span><input bind:value={form.soundTheme} maxlength="40" placeholder="e.g. tavern" /></label>
      <label class="field"><span>Rulebook entry</span>
        <select bind:value={form.ruleEntryId}>
          <option value="">—</option>
          {#each rules as r (r.id)}<option value={String(r.id)}>{r.title}</option>{/each}
        </select>
      </label>
      <label class="field row"><input type="checkbox" bind:checked={form.rerollsAllowed} /> Re-rolls allowed by default</label>
    </div>
    <div class="row">
      <button class="primary" type="submit">{editing ? 'Save' : 'Add to library'}</button>
      {#if editing}<button type="button" onclick={reset}>Cancel</button>{/if}
    </div>
  </form>
{/if}

<section class="panel">
  <div class="spread">
    <h2>Game library</h2>
    <div class="row">
      <a class="btn" href="/api/library/export" download="game-pack.json">Export pack</a>
      {#if master}<label class="btn">Import pack<input type="file" accept="application/json,.json" hidden onchange={importFile} /></label>{/if}
    </div>
  </div>
  <div class="scroll-x">
    <table>
      <thead><tr><th></th><th>Name</th><th>Mode</th><th>Players</th><th>Length</th><th>Re-rolls</th><th></th></tr></thead>
      <tbody>
        {#each games as g (g.id)}
          <tr>
            <td><span class="dot" style="background:{g.color ?? 'var(--muted)'}"></span></td>
            <td>{g.name}</td>
            <td class="small">{t(`modes.${g.mode}`)}</td>
            <td class="small">{g.minPlayers}–{g.maxPlayers}</td>
            <td class="small mono">{g.defaultDuration} h</td>
            <td class="small">{g.rerollsAllowed ? 'Yes' : 'No'}</td>
            <td class="actions">
              {#if master}
                <button onclick={() => edit(g)}>Edit</button>
                <button class="danger" onclick={async () => confirm(`Delete ${g.name} from the library?`) && (await run(() => del(`/api/library/${g.id}`), 'Deleted')) && load()}>Delete</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if !games.length}<p class="muted">The library is empty.</p>{/if}
</section>
