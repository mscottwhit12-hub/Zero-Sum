<script lang="ts">
  /** The night at a glance: quarters (poll windows shaded), games as bars, and a "now" line. Night-clock minutes. */
  import { nightNow } from '@shared/socket';
  import { gameTag, plannedEnd } from '@shared/gameTime';
  import type { GameInfo, GmState } from '@shared/types';

  let { gs, now }: { gs: GmState | null; now: number } = $props();
  const night = $derived(gs?.night ?? null);
  const nowMin = $derived(night ? nightNow(night, now) / 60_000 : 0);
  /** Wall clock → night minute (assumes no further pauses, fine for planning). */
  const toMin = (t: number) => nowMin + (t - now) / 60_000;
  const span = $derived.by(() => {
    const len = night?.lengthMinutes ?? 60;
    let end = Math.max(len, nowMin);
    for (const g of gs?.games ?? []) {
      const e = g.status === 'final' && g.endedAt ? g.endedAt : plannedEnd(g);
      if (e != null) end = Math.max(end, toMin(e));
    }
    return Math.max(1, end);
  });
  const pct = (m: number) => `${Math.min(100, Math.max(0, (m / span) * 100))}%`;
  const wpct = (a: number, b: number) => `${Math.max(0.6, ((Math.min(b, span) - Math.max(0, a)) / span) * 100)}%`;

  type Bar = { g: GameInfo; a: number; b: number; lane: number };
  const bars = $derived.by((): Bar[] => {
    const raw = (gs?.games ?? [])
      .map((g) => {
        const s0 = g.startedAt ?? g.plannedStart;
        if (s0 == null) return null;
        const e0 = g.status === 'final' && g.endedAt ? g.endedAt : (plannedEnd(g) ?? s0 + 3_600_000);
        const e1 = g.status === 'active' ? Math.max(e0, now) : e0;
        return { g, a: toMin(s0), b: toMin(e1), lane: 0 };
      })
      .filter((x): x is Bar => x !== null)
      .sort((x, y) => x.a - y.a);
    const laneEnds: number[] = [];
    for (const r of raw) {
      let l = laneEnds.findIndex((e) => e <= r.a);
      if (l < 0) l = laneEnds.push(0) - 1;
      laneEnds[l] = r.b;
      r.lane = l;
    }
    return raw;
  });
  const lanes = $derived(Math.max(1, ...bars.map((b) => b.lane + 1)));
  const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
</script>

{#if night}
  <section class="panel">
    <div class="spread"><h3>Tonight</h3><span class="small muted mono">{hhmm(nowMin)} / {hhmm(night.lengthMinutes)}</span></div>
    <div class="tl" style="height:{22 + lanes * 22}px">
      {#each night.quarters as q (q.n)}
        <div class="q" style="left:{pct(q.startMin)};width:{wpct(q.startMin, q.endMin)}" title="Q{q.n}">
          <div class="win" style="width:{((q.windowEndMin - q.startMin) / Math.max(1, q.endMin - q.startMin)) * 100}%"></div>
          <span>Q{q.n}</span>
        </div>
      {/each}
      <div class="endline" style="left:{pct(night.lengthMinutes)}" title="Planned end"></div>
      {#each bars as b (b.g.id)}
        {@const tag = gameTag(b.g, now)}
        <div
          class="bar {b.g.status}"
          class:filibuster={tag === 'filibuster'}
          class:tardy={tag === 'tardy'}
          style="left:{pct(b.a)};width:{wpct(b.a, b.b)};top:{22 + b.lane * 22}px;{b.g.color ? `--c:${b.g.color}` : ''}"
          title={b.g.name}
        >
          {b.g.name}
        </div>
      {/each}
      <div class="nowline" style="left:{pct(nowMin)}" title="Now"></div>
    </div>
  </section>
{/if}

<style>
  .tl {
    position: relative;
    margin-top: 0.4rem;
    overflow: hidden;
  }
  .q {
    position: absolute;
    top: 0;
    height: 18px;
    border: 1px solid var(--line);
    border-radius: 3px;
    font-size: 0.7rem;
    color: var(--muted);
    overflow: hidden;
  }
  .q span {
    position: relative;
    padding-left: 3px;
  }
  .win {
    position: absolute;
    inset: 0 auto 0 0;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .bar {
    position: absolute;
    height: 18px;
    border-radius: 3px;
    padding: 0 4px;
    font-size: 0.72rem;
    line-height: 18px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: color-mix(in srgb, var(--c, var(--accent)) 30%, var(--panel));
    border: 1px solid var(--c, var(--accent));
    color: var(--text);
  }
  .bar.scheduled {
    background: transparent;
    border-style: dashed;
  }
  .bar.final {
    opacity: 0.55;
  }
  .bar.filibuster {
    border-color: var(--warn);
    border-width: 2px;
  }
  .bar.tardy {
    border-color: var(--bad);
  }
  .nowline,
  .endline {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--bad);
  }
  .endline {
    background: var(--muted);
    opacity: 0.6;
  }
</style>
