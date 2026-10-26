<script lang="ts">
  import { patch } from '@shared/api';
  import { run } from '@shared/ui';
  import type { GmState, WhoAmI } from '@shared/types';
  let { gs, whoami }: { gs: GmState | null; whoami: WhoAmI } = $props();

  type Leaf = { path: string; value: unknown };
  const ENUMS: Record<string, string[]> = { 'scoring.tieRule': ['average', 'best', 'worst'], 'votes.weighting': ['equal', 'netWorth'] };

  function flatten(obj: unknown, prefix = ''): Leaf[] {
    if (obj && typeof obj === 'object' && !Array.isArray(obj))
      return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
    return [{ path: prefix, value: obj }];
  }
  const getAt = (obj: unknown, path: string) => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

  const resolved = $derived(gs?.gm?.settings.resolved ?? null);
  const overrides = $derived(gs?.gm?.settings.overrides ?? {});
  const leaves = $derived(resolved ? flatten(resolved) : []);
  const groups = $derived.by(() => {
    const m = new Map<string, Leaf[]>();
    for (const l of leaves) {
      const parts = l.path.split('.');
      const g = parts.length > 2 ? `${parts[0]} · ${parts[1]}` : parts[0]!;
      (m.get(g) ?? m.set(g, []).get(g)!).push(l);
    }
    return [...m];
  });

  let edits = $state<Record<string, string | boolean>>({});
  const label = (path: string) => path.split('.').slice(path.split('.').length > 2 ? 2 : 1).join(' ').replace(/([A-Z])/g, ' $1').toLowerCase();
  const shown = (l: Leaf) => (l.path in edits ? edits[l.path] : Array.isArray(l.value) ? (l.value as unknown[]).join(', ') : (l.value as string | boolean));
  const isOverridden = (path: string) => getAt(overrides, path) !== undefined;

  function parse(l: Leaf, raw: string | boolean): unknown {
    if (typeof l.value === 'boolean') return !!raw;
    if (typeof l.value === 'number') return Number(raw);
    if (Array.isArray(l.value)) return String(raw).split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
    return raw;
  }
  function setAt(target: Record<string, unknown>, path: string, value: unknown) {
    const parts = path.split('.');
    let o = target;
    for (const p of parts.slice(0, -1)) o = (o[p] ??= {}) as Record<string, unknown>;
    o[parts[parts.length - 1]!] = value;
  }
  async function save() {
    const body: Record<string, unknown> = {};
    for (const l of leaves) if (l.path in edits) setAt(body, l.path, parse(l, edits[l.path]!));
    if (await run(() => patch('/api/night/settings', body), 'Settings saved — totals re-scored')) edits = {};
  }
  async function resetField(path: string) {
    const body: Record<string, unknown> = {};
    setAt(body, path, null);
    if (await run(() => patch('/api/night/settings', body), 'Reset to default')) {
      const { [path]: _, ...rest } = edits;
      edits = rest;
    }
  }
</script>

{#if whoami.role !== 'master'}
  <p class="panel muted">Settings are Master GM only.</p>
{:else if !resolved}
  <p class="panel muted">Create a night first. Settings belong to a night.</p>
{:else}
  <div class="panel spread sticky">
    <span class="small muted">Every gameplay number. Changes apply live and re-score all totals. ● = changed from default.</span>
    <div class="row">
      <button disabled={!Object.keys(edits).length} onclick={() => (edits = {})}>Discard</button>
      <button class="primary" disabled={!Object.keys(edits).length} onclick={save}>Save {Object.keys(edits).length || ''}</button>
    </div>
  </div>
  <div class="grid2">
    {#each groups as [group, items] (group)}
      <section class="panel">
        <h3>{group}</h3>
        {#each items as l (l.path)}
          <div class="setting">
            <label for={l.path}>{isOverridden(l.path) ? '● ' : ''}{label(l.path)}</label>
            {#if ENUMS[l.path]}
              <select id={l.path} value={shown(l)} onchange={(e) => (edits[l.path] = (e.currentTarget as HTMLSelectElement).value)}>
                {#each ENUMS[l.path]! as o}<option value={o}>{o}</option>{/each}
              </select>
            {:else if typeof l.value === 'boolean'}
              <input id={l.path} type="checkbox" checked={!!shown(l)} onchange={(e) => (edits[l.path] = (e.currentTarget as HTMLInputElement).checked)} />
            {:else}
              <input id={l.path} class="mono" type={typeof l.value === 'number' ? 'number' : 'text'} step="any" value={shown(l)} oninput={(e) => (edits[l.path] = (e.currentTarget as HTMLInputElement).value)} />
            {/if}
            {#if isOverridden(l.path)}<button class="small" title="Reset to default" onclick={() => resetField(l.path)}>↺</button>{/if}
          </div>
        {/each}
      </section>
    {/each}
  </div>
{/if}

<style>
  .setting {
    display: grid;
    grid-template-columns: 1fr 110px 32px;
    gap: 0.4rem;
    align-items: center;
    margin-bottom: 0.3rem;
  }
  .setting label {
    font-size: 0.88rem;
  }
  .setting input:not([type='checkbox']),
  .setting select {
    width: 110px;
  }
  .setting button {
    min-height: 30px;
    padding: 0 0.4rem;
  }
  .sticky {
    position: sticky;
    top: 0;
    z-index: 5;
  }
</style>
