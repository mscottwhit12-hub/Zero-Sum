<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '@shared/api';
  import { run } from '@shared/ui';
  import { describeEntry, NO_NAMES, type AuditEntry, type AuditNames } from '../auditText';
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
  const rows = $derived(entries.map((e) => ({ e, d: describeEntry(e, names) })));
</script>

<section class="panel">
  <div class="spread">
    <h2>Audit log</h2>
    <span class="row">
      <label class="row small"><input type="checkbox" bind:checked={computerSpeak} /> Computer speak</label>
      <button onclick={load}>Refresh</button>
    </span>
  </div>
  <div class="scroll-x">
    {#if computerSpeak}
      <table class="small">
        <thead><tr><th>Time</th><th>GM</th><th>Action</th><th>Entity</th><th></th></tr></thead>
        <tbody>
          {#each entries as e (e.id)}
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
          {#each rows as { e, d } (e.id)}
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
  .lines {
    margin: 2px 0 4px;
    padding-left: 18px;
  }
</style>
