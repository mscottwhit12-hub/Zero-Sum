<script lang="ts">
  import { patch } from '@shared/api';
  import { clock, gold } from '@shared/format';
  import { run } from '@shared/ui';
  import type { GmState, WhoAmI } from '@shared/types';
  import { playerName } from '../lib';

  let { gs, whoami }: { gs: GmState | null; whoami: WhoAmI } = $props();
  const master = $derived(whoami.role === 'master');
  const h = $derived(gs?.gm?.handicap ?? null);
  let busy = $state(false);
  async function act(fn: () => Promise<unknown>, ok?: string) {
    if (busy) return;
    busy = true;
    try {
      await run(fn, ok);
    } finally {
      busy = false;
    }
  }
  const setOffset = (playerId: number, offset: number) => act(() => patch(`/api/handicap/${playerId}`, { offset }));
  const toggleAuto = () => act(() => patch('/api/night/settings', { handicap: { autoEnabled: !h?.autoEnabled } }), h?.autoEnabled ? 'Auto handicap off' : 'Auto handicap on');
  const why = (r: Record<string, unknown> | null) => {
    if (!r) return '';
    if (r.auto === 'off') return 'auto off';
    if (r.by) return `set by ${r.by}`;
    const parts = [`worth ${(Number(r.netWorth) * 100).toFixed(0)}%`, `places ${(Number(r.placement) * 100).toFixed(0)}%`, `trend ${(Number(r.trajectory) * 100).toFixed(0)}%`];
    if (r.idle) parts.push('idle');
    if (r.teamAveraged) parts.push('team avg');
    if (!r.bottomHalf) parts.push('top half');
    return parts.join(' · ');
  };
</script>

{#if !master}
  <section class="panel"><p class="muted">Handicaps are for the Master GM.</p></section>
{:else if !h}
  <section class="panel"><p class="muted">No night running.</p></section>
{:else}
  <section class="panel">
    <div class="spread">
      <h2>Handicaps</h2>
      <button class:primary={!h.autoEnabled} disabled={busy} onclick={toggleAuto}>{h.autoEnabled ? 'Turn auto off' : 'Turn auto on'}</button>
    </div>
    <p class="small muted">
      Players never see this. Level 1 = no help. Auto (when on) re-checks every {h.intervalMinutes} min: top half stay at 1, the bottom half get 2–5.
      Your +/− sits on top of the auto level and the auto never removes it. Help arrives as anonymous gifts and tips; anything already given stays.
      {#if h.autoEnabled}Next check at {clock(h.nextEvalNms)}.{/if}
    </p>
    <div class="scroll-x">
      <table>
        <thead><tr><th>Player</th><th>Auto</th><th>Manual</th><th>Level</th><th>Why</th></tr></thead>
        <tbody>
          {#each h.players as p (p.playerId)}
            <tr>
              <td>{playerName(gs, p.playerId)}</td>
              <td class="mono">{p.auto}</td>
              <td>
                <span class="row">
                  <button aria-label="lower" disabled={busy || p.offset <= -4} onclick={() => setOffset(p.playerId, p.offset - 1)}>−</button>
                  <span class="mono">{p.offset > 0 ? '+' : ''}{p.offset}</span>
                  <button aria-label="raise" disabled={busy || p.offset >= 4} onclick={() => setOffset(p.playerId, p.offset + 1)}>+</button>
                </span>
              </td>
              <td class="mono"><strong>{p.effective}</strong></td>
              <td class="small muted">{why(p.reasons)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="panel">
    <h2>Log</h2>
    {#each h.log as e (e.id)}
      <div class="line small">
        <span class="mono">{clock(e.nightMs)}</span> · <strong>{playerName(gs, e.playerId)}</strong> · {e.trigger} · auto {e.auto}{e.offset ? ` ${e.offset > 0 ? '+' : ''}${e.offset}` : ''} → <strong>{e.effective}</strong>
        <span class="muted">· {why(e.reasons)}</span>{#if e.giftH} · gift {gold(e.giftH)}{/if}{#if e.tips.length} · tips: {e.tips.join(', ')}{/if}
      </div>
    {:else}
      <p class="muted small">No checks yet.</p>
    {/each}
  </section>
{/if}
