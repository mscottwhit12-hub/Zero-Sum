<script lang="ts">
  /** Simple tuning: plain dials with − / + (each a multiplier on the defaults). Applies at once and re-scores. */
  import { patch } from '@shared/api';
  import { run } from '@shared/ui';
  import { DIAL_GROUPS, STEPS, dialFactor, dialPatch, factorText, nearestStep, type Dial } from './tuning';

  let { resolved }: { resolved: unknown } = $props();
  let busy = $state<string | null>(null);
  async function step(d: Dial, by: number) {
    const lo = STEPS.findIndex((s) => s >= (d.minFactor ?? 0));
    const i = Math.min(STEPS.length - 1, Math.max(lo, nearestStep(dialFactor(d, resolved)) + by));
    busy = d.id;
    await run(() => patch('/api/night/settings', dialPatch(d, STEPS[i]!)), `${d.label}: ${factorText(STEPS[i]!)}`);
    busy = null;
  }
</script>

{#each DIAL_GROUPS as g (g.title)}
  <section class="panel tuning">
    <h3>{g.title}</h3>
    {#if g.help}<p class="small muted">{g.help}</p>{/if}
    {#each g.dials as d (d.id)}
      {@const f = dialFactor(d, resolved)}
      {@const i = nearestStep(f)}
      <div class="dial">
        <div class="dl">
          <b>{d.label}</b>
          <span class="small muted">{d.help}</span>
        </div>
        <div class="dc">
          <button aria-label="Less {d.label}" disabled={busy !== null || STEPS[i]! <= (d.minFactor ?? 0)} onclick={() => step(d, -1)}>−</button>
          <span class="meter" aria-hidden="true"><i style="width:{(Math.min(f, 3) / 3) * 100}%" class:changed={Math.abs(f - 1) > 0.001}></i><em style="left:{100 / 3}%"></em></span>
          <span class="mono val" aria-live="polite">{factorText(+f.toFixed(2))}</span>
          <button aria-label="More {d.label}" disabled={busy !== null || i === STEPS.length - 1} onclick={() => step(d, 1)}>+</button>
          {#if Math.abs(f - 1) > 0.001}<button class="small" title="Back to normal" disabled={busy !== null} onclick={() => run(() => patch('/api/night/settings', dialPatch(d, 1)), `${d.label}: normal`)}>↺</button>{/if}
        </div>
      </div>
    {/each}
  </section>
{/each}

<style>
  .dial {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem 1rem;
    padding: 0.55rem 0;
    border-top: 1px solid var(--line);
  }
  .dl {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 14rem;
  }
  .dc {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .dc > button {
    min-width: 44px;
    font-size: 1.2rem;
  }
  .meter {
    position: relative;
    width: 7rem;
    height: 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 12%, transparent);
    overflow: hidden;
  }
  .meter i {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--muted);
    border-radius: 999px;
  }
  .meter i.changed {
    background: var(--accent);
  }
  .meter em {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--text);
    opacity: 0.5;
  }
  .val {
    min-width: 6.5rem;
    text-align: center;
  }
  @media (max-width: 420px) {
    .meter {
      width: 4rem;
    }
    .val {
      min-width: 5rem;
    }
  }
</style>
