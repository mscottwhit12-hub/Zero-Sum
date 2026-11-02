<script lang="ts">
  import { patch, post } from '@shared/api';
  import { feedText } from '@shared/feedText';
  import Sparkline from '@shared/Sparkline.svelte';
  import TickCountdown from '@shared/TickCountdown.svelte';
  import { run } from '@shared/ui';
  import type { GmState, WhoAmI } from '@shared/types';

  let { gs, whoami }: { gs: GmState | null; whoami: WhoAmI } = $props();
  const master = $derived(whoami.role === 'master');
  const stock = $derived(new Map((gs?.gm?.stocks ?? []).map((s) => [s.securityId, s])));
  let draft = $state<Record<string, number | ''>>({});
  const setOffset = (id: string, v: number) => run(() => patch(`/api/securities/${encodeURIComponent(id)}/offset`, { offset: v }), 'Offset saved');
  const halt = (m: { id: string; ticker: string }) =>
    confirm(`Halt trading in ${m.ticker}?\n\nEvery open position in it (shares and shorts) is closed now at the current price with no fee, the price freezes, and nobody can trade it. An alert goes to the TV and phones. Holders are told.`) &&
    run(() => post(`/api/securities/${encodeURIComponent(m.id)}/halt`), `${m.ticker} halted`);
  const relist = (m: { id: string; ticker: string }) =>
    confirm(`Relist ${m.ticker}? Trading and price moves resume. Positions closed by the halt stay closed.`) && run(() => post(`/api/securities/${encodeURIComponent(m.id)}/relist`), `${m.ticker} relisted`);
  const kingfalls = $derived((gs?.gm?.feed ?? []).filter((f) => f.message === 'feed.kingfall'));
  const pct = (b: number) => `${b >= 0 ? '+' : '−'}${Math.abs(b * 100).toFixed(1)}%`;
</script>

<section class="panel">
  <div class="spread"><h2>Market</h2><TickCountdown night={gs?.night} /></div>
  <p class="small muted">Offsets (Master, player stocks only) shift fair value in band units (±0.50 max) until cleared. Players never see them.</p>
  <div class="scroll-x">
    <table>
      <thead><tr><th>Ticker</th><th>Kind</th><th>Price</th><th></th><th>Mood</th><th>Offset</th><th>Trading</th></tr></thead>
      <tbody>
        {#each gs?.market ?? [] as m (m.id)}
          {@const x = stock.get(m.id)}
          <tr>
            <td class="mono">{m.ticker}</td>
            <td class="small muted">{m.kind}</td>
            <td class="mono">{m.price.toFixed(2)}</td>
            <td><Sparkline values={m.history} /></td>
            <td class="small mono">{x ? pct(x.moodTerm) : ''}</td>
            <td>
              {#if x}
                {#if master}
                  <span class="row">
                    <input type="number" step="0.01" min="-0.5" max="0.5" style="width:80px" placeholder={x.gmOffset.toFixed(2)} bind:value={draft[m.id]} />
                    <button disabled={draft[m.id] === '' || draft[m.id] == null} onclick={() => setOffset(m.id, Number(draft[m.id]))}>Set</button>
                    {#if x.gmOffset}<button onclick={() => setOffset(m.id, 0)}>Clear</button>{/if}
                  </span>
                {:else}
                  <span class="mono small">{x.gmOffset.toFixed(2)}</span>
                {/if}
              {/if}
            </td>
            <td>
              {#if m.halted}
                <span class="small bad">Halted</span> <button onclick={() => relist(m)}>Relist</button>
              {:else}
                <button class="danger" onclick={() => halt(m)}>Halt…</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<section class="panel">
  <h2>Index (hidden from players)</h2>
  <p class="small muted">Base = average player stock. Grows while games run, by gold earned per player; dips when a game starts and gets it back when it ends.</p>
  {#if gs?.gm?.indexTerms}
    {@const it = gs.gm.indexTerms}
    <div class="row small mono">
      <span>Growth +{it.growth.toFixed(2)}</span>
      <span>Running-game dips −{it.drop.toFixed(2)}</span>
      <span>Net {it.extra >= 0 ? '+' : '−'}{Math.abs(it.extra).toFixed(2)}</span>
    </div>
  {/if}
</section>

<section class="panel">
  <h2>Kingfall</h2>
  <p class="small muted">Displaced long-reigning leaders. Each spikes crypto (never announced).</p>
  {#each kingfalls as f (f.id)}
    <div class="line small">{new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {feedText(f, gs?.players ?? [])}</div>
  {:else}
    <p class="muted small">None yet.</p>
  {/each}
</section>
