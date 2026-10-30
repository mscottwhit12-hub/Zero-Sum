<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '@shared/api';
  import { run } from '@shared/ui';
  import { describeEntry, NO_NAMES, type AuditEntry, type AuditNames } from '../auditText';
  import { factsOf, passes, ruleLabel, TYPES, type Rule, type RuleKind } from '../auditFilter';
  let entries = $state<AuditEntry[]>([]);
  let names = $state<AuditNames>(NO_NAMES);
  let open = $state<number | null>(null);
  /** Off: plain sentences. On: the log exactly as stored (action codes, entities, raw JSON). */
  let computerSpeak = $state(false);
  const SHOWN = 6;
  const load = async () => {
    const r = await run(() => get<{ entries: AuditEntry[]; names?: AuditNames }>('/api/gm/audit?limit=300'));
    if (r) {
      entries = r.entries;
      names = r.names ?? NO_NAMES;
    }
  };
  onMount(load);
  const rows = $derived(entries.map((e) => ({ e, d: describeEntry(e, names), f: factsOf(e, names) })));

  // Filters: hide (or show only) the entries about a game, player, GM, kind of event, or some text.
  let rules = $state<Rule[]>([]);
  let mode = $state<Rule['mode']>('hide');
  let kind = $state<RuleKind>('game');
  let value = $state('');
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  const options = $derived<Record<RuleKind, string[]>>({
    game: uniq(rows.flatMap((r) => r.f.games)),
    player: uniq(rows.flatMap((r) => r.f.players)),
    gm: uniq(rows.map((r) => r.f.gm)),
    type: [...TYPES],
    text: [],
  });
  const shown = $derived(rows.filter((r) => passes(rules, r.f)));
  const addRule = () => {
    const v = value.trim();
    if (!v || rules.some((r) => r.mode === mode && r.kind === kind && r.value === v)) return;
    rules = [...rules, { mode, kind, value: v }];
    value = '';
  };
  const pickKind = (k: RuleKind) => {
    kind = k;
    value = '';
  };
</script>

<section class="panel">
  <div class="spread">
    <h2>Audit log</h2>
    <span class="row">
      <label class="row small"><input type="checkbox" bind:checked={computerSpeak} /> Computer speak</label>
      <button onclick={load}>Refresh</button>
    </span>
  </div>
  <form class="row filters" onsubmit={(ev) => (ev.preventDefault(), addRule())}>
    <select bind:value={mode} aria-label="Hide or show only">
      <option value="hide">Hide</option>
      <option value="only">Show only</option>
    </select>
    <select value={kind} onchange={(ev) => pickKind((ev.currentTarget as HTMLSelectElement).value as RuleKind)} aria-label="Filter by">
      <option value="game">game</option>
      <option value="player">player</option>
      <option value="gm">GM</option>
      <option value="type">type of event</option>
      <option value="text">text containing</option>
    </select>
    {#if kind === 'text'}
      <input placeholder="e.g. territories" bind:value aria-label="Filter value" />
    {:else}
      <select bind:value aria-label="Filter value">
        <option value="">— pick —</option>
        {#each options[kind] as o (o)}<option value={o}>{o}</option>{/each}
      </select>
    {/if}
    <button class="primary" type="submit" disabled={!value.trim()}>Add filter</button>
  </form>
  {#if rules.length}
    <div class="row chips">
      {#each rules as r, i (i)}
        <span class="badge">{ruleLabel(r)} <button class="x" aria-label="Remove filter" onclick={() => (rules = rules.filter((_, j) => j !== i))}>×</button></span>
      {/each}
      <button onclick={() => (rules = [])}>Clear filters</button>
      <span class="small muted">Showing {shown.length} of {rows.length}</span>
    </div>
  {/if}
  <div class="scroll-x">
    {#if computerSpeak}
      <table class="small">
        <thead><tr><th>Time</th><th>GM</th><th>Action</th><th>Entity</th><th></th></tr></thead>
        <tbody>
          {#each shown as { e } (e.id)}
            <tr>
              <td class="mono">{new Date(e.createdAt).toLocaleTimeString()}</td>
              <td>{e.gmName ?? 'system'}</td>
              <td class="mono">{e.action}</td>
              <td>{e.entity}{e.entityId ? ` #${e.entityId}` : ''}</td>
              <td class="actions">{#if e.before || e.after}<button onclick={() => (open = open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Details'}</button>{/if}</td>
            </tr>
            {#if open === e.id}
              <tr><td colspan="5"><pre class="mono small">{e.before ? `before: ${e.before}\n` : ''}{e.after ? `after: ${e.after}` : ''}</pre></td></tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {:else}
      <table class="small">
        <thead><tr><th>Time</th><th>What happened</th></tr></thead>
        <tbody>
          {#each shown as { e, d } (e.id)}
            <tr>
              <td class="mono">{new Date(e.createdAt).toLocaleTimeString()}</td>
              <td>
                {d.text}
                {#if d.lines.length}
                  <ul class="muted lines">
                    {#each open === e.id ? d.lines : d.lines.slice(0, SHOWN) as l}<li>{l}</li>{/each}
                  </ul>
                  {#if d.lines.length > SHOWN}<button onclick={() => (open = open === e.id ? null : e.id)}>{open === e.id ? 'Show less' : `Show all ${d.lines.length}`}</button>{/if}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</section>

<style>
  pre {
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
  .filters,
  .chips {
    margin: 8px 0;
    flex-wrap: wrap;
  }
  .x {
    border: 0;
    background: none;
    padding: 0 2px;
    cursor: pointer;
  }
  .lines {
    margin: 2px 0 4px;
    padding-left: 18px;
  }
</style>
