<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '@shared/api';
  import { t } from '@shared/copy';
  import { gold } from '@shared/format';
  import type { WhoAmI } from '@shared/types';

  let { whoami }: { whoami: WhoAmI } = $props();
  const master = $derived(whoami.role === 'master');
  interface NightItem {
    id: number;
    name: string;
    date: string;
    status: string;
    players: number;
    winners: string[];
    winnerGoldH: number | null;
  }
  let nights = $state<NightItem[]>([]);
  onMount(async () => (nights = (await get<{ nights: NightItem[] }>('/api/nights')).nights));
</script>

<section class="panel">
  <h2>Archive</h2>
  <p class="small muted">Every night is kept. Exports never include hidden mechanics.</p>
  <div class="scroll-x">
    <table>
      <thead><tr><th>Date</th><th>Night</th><th>Status</th><th>Players</th><th>Winner</th><th></th></tr></thead>
      <tbody>
        {#each nights as n (n.id)}
          <tr>
            <td class="mono small">{n.date}</td>
            <td>{n.name}</td>
            <td class="small">{t(`status.${n.status}`)}</td>
            <td class="small">{n.players}</td>
            <td class="small">{n.winners.join(' & ') || '—'}{n.winnerGoldH != null && n.winners.length ? ` · ${gold(n.winnerGoldH)}` : ''}</td>
            <td class="actions">
              {#if master}
                <a class="btn" href="/api/export/night.json?night={n.id}">JSON</a>
                <a class="btn" href="/api/export/standings.csv?night={n.id}">Standings</a>
                <a class="btn" href="/api/export/results.csv?night={n.id}">Results</a>
                <a class="btn" href="/api/export/trades.csv?night={n.id}">Trades</a>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if !nights.length}<p class="muted">No nights yet.</p>{/if}
</section>
