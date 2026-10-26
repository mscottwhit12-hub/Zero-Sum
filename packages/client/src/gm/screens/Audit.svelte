<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '@shared/api';
  import { run } from '@shared/ui';
  type Entry = { id: number; gmName: string | null; action: string; entity: string; entityId: string | null; before: string | null; after: string | null; createdAt: number };
  let entries = $state<Entry[]>([]);
  let open = $state<number | null>(null);
  const load = async () => {
    const r = await run(() => get<{ entries: Entry[] }>('/api/gm/audit?limit=300'));
    if (r) entries = r.entries;
  };
  onMount(load);
</script>

<section class="panel">
  <div class="spread"><h2>Audit log</h2><button onclick={load}>Refresh</button></div>
  <div class="scroll-x">
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
  </div>
</section>

<style>
  pre {
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
</style>
