<script lang="ts">
  import { patch, post } from '@shared/api';
  import { gold, signedGold } from '@shared/format';
  import { run } from '@shared/ui';
  import type { GmState, WhoAmI } from '@shared/types';
  let { gs, whoami }: { gs: GmState | null; whoami: WhoAmI } = $props();
  const master = $derived(whoami.role === 'master');
  const rows = $derived(
    (gs?.players ?? []).map((p) => ({
      p,
      l: gs?.gm?.ledger.find((x) => x.playerId === p.id),
      s: gs?.standings.find((x) => x.playerId === p.id),
      h: gs?.gm?.hours[p.id] ?? 0,
    })).sort((a, b) => (a.s?.rank ?? 99) - (b.s?.rank ?? 99)),
  );
  const leave = (id: number, left: boolean) =>
    (!left || confirm('Mark this player as left? Their stock stays listed and drifts down.')) && run(() => post(`/api/players/${id}/leave`, { left }), left ? 'Marked as left' : 'Welcome back');
  const retick = (id: number, current: string) => {
    const t = prompt('New ticker (3–4 letters)', current);
    if (t && t !== current) run(() => patch(`/api/players/${id}`, { ticker: t }), 'Ticker updated');
  };
  let who = $state('');
  let amount = $state<number | ''>('');
  let reason = $state('');
  async function adjust(e: Event) {
    e.preventDefault();
    const r = await run(() => post('/api/night/adjustments', { playerId: Number(who), gold: Number(amount), reason }), 'Adjustment saved');
    if (r) {
      amount = '';
      reason = '';
    }
  }
</script>

<section class="panel">
  <h2>Players</h2>
  <div class="scroll-x">
    <table>
      <thead>
        <tr>
          <th>#</th><th>Player</th><th>Ticker</th><th class="num">Net worth</th><th class="num">Gold</th>
          <th class="num">Stake</th><th class="num">Games</th><th class="num">Adj.</th><th class="num">Bounties</th><th class="num">Achiev.</th><th class="num">Trading</th><th class="num">Hours</th>{#if master}<th></th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each rows as { p, l, s, h } (p.id)}
          <tr class:muted={p.left}>
            <td>{s?.rank ?? '—'}</td>
            <td>{p.displayName}{p.left ? ' (left)' : ''}</td>
            <td class="mono">{p.ticker}</td>
            <td class="num">{gold(s?.netWorthH)}</td>
            <td class="num">{gold(l?.cashH)}</td>
            <td class="num">{gold(l?.stakeH)}</td>
            <td class="num">{gold(l?.resultsH)}</td>
            <td class="num">{gold(l?.adjustmentsH)}</td>
            <td class="num">{gold(l?.bountiesH)}</td>
            <td class="num">{gold(l?.achievementsH)}</td>
            <td class="num">{l ? signedGold(l.tradeFlowH) : '—'}</td>
            <td class="num">{h.toFixed(2)}</td>
            {#if master}
              <td class="actions">
                <button onclick={() => retick(p.id, p.ticker)}>Ticker</button>
                <button onclick={() => leave(p.id, !p.left)}>{p.left ? 'Back' : 'Left'}</button>
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if !rows.length}<p class="muted">No players yet. Players join from their phones once joins are open.</p>{/if}
</section>

{#if master && rows.length}
  <form class="panel" onsubmit={adjust}>
    <h2>Manual adjustment</h2>
    <div class="row">
      <label><span>Player</span>
        <select bind:value={who} required>
          <option value="" disabled>Choose…</option>
          {#each rows as { p } (p.id)}<option value={String(p.id)}>{p.displayName}</option>{/each}
        </select>
      </label>
      <label><span>Gold (±)</span><input type="number" step="any" bind:value={amount} required /></label>
      <label style="flex:1"><span>Reason (required)</span><input bind:value={reason} required style="width:100%" /></label>
      <button class="primary" type="submit">Apply</button>
    </div>
  </form>
{/if}
