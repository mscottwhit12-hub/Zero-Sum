<script lang="ts">
  /**
   * TV close-up of one table: the table at its real shape, scaled up, with big avatars and first names
   * around it (seat order matches the floor plan). Read-only.
   */
  import { propKind } from '@gn/engine';
  import PropSprite from '@shared/PropSprite.svelte';
  import Avatar from '@shared/Avatar.svelte';
  import { clamp, relaxSeats, seatFractions, seatPoints } from '@shared/seating';
  import type { PlayerInfo, SeatingTable } from '@shared/types';

  let { table, players, game = '' }: { table: SeatingTable; players: PlayerInfo[]; game?: string } = $props();

  let W = $state(0);
  const H = $derived(W / 1.5);
  const S = $derived(Math.round(clamp(W * 0.085, 36, 76)));
  const fs = $derived(Math.round(S * 0.36));
  // Room around the table for a seat icon plus its name (names sit above top seats, below the rest).
  const mx = $derived(S * 1.9);
  const my = $derived(S + fs * 1.4 + 8);
  const fit = $derived.by(() => {
    const aspect = table.w / table.h;
    const maxW = Math.max(40, W - 2 * mx);
    const maxH = Math.max(30, H - 2 * my);
    const tw = Math.min(maxW, maxH * aspect);
    return { tw, th: tw / aspect };
  });
  const byId = $derived(new Map(players.map((p) => [p.id, p])));
  const first = (n: string) => n.split(/\s+/)[0] ?? n;
</script>

<div class="tv-table" bind:clientWidth={W} style="height:{H}px">
  {#if W > 0}
    {@const tw = fit.tw}
    {@const th = fit.th}
    {@const room = Math.round((W - tw) / 2 - S - 12)}
    {@const rel = table.seatPos ? relaxSeats(seatFractions(table.seats, table.seatPos), (S + 6) / (2 * (tw + th))) : null}
    {@const pts = seatPoints(table.seats, tw, th, S, 6, rel)}
    {@const fr = seatFractions(table.seats, rel)}
    {@const sideSeat = (p: { x: number }) => p.x < -tw / 2 || p.x > tw / 2}
    {@const crowded = room < 150 && pts.some((p) => sideSeat(p) && pts.some((q) => q.seat !== p.seat && sideSeat(q) && Math.abs(q.x - p.x) < S * 0.4 && Math.abs(q.y - p.y) < S + 56))}
    {@const mode = room >= 150 ? 'out' : crowded ? 'in' : 'low'}
    <div class="tbl" class:hasprops={!!table.props?.length} style="width:{tw}px;height:{th}px;font-size:{Math.round(clamp(th * 0.2, 16, S * 0.6))}px;padding:0 {mode === 'in' ? Math.round(tw * 0.3) : 6}px">
      <!-- props: under the name, in the table's own frame (the close-up is never turned) -->
      {#each table.props ?? [] as pr (pr.id)}
        {@const k = propKind(pr.kind)}
        {#if k}<div class="prop" style="left:{tw / 2 + pr.x * tw}px;top:{th / 2 + pr.y * th}px;width:{pr.w * tw}px;height:{(pr.w * tw) / k.aspect}px;transform:translate(-50%, -50%) rotate({pr.rotation}deg)"><PropSprite kind={pr.kind} /></div>{/if}
      {/each}
      <strong>{table.name}</strong>
      <span class="muted cnt">{table.assignments.length}/{table.seats}{game ? ` · ${game}` : ''}</span>
    </div>
    <!-- seats where the GM dragged them, nudged apart if the bigger icons here would touch -->
    {#each seatPoints(table.seats, tw, th, S, 6, table.seatPos ? relaxSeats(seatFractions(table.seats, table.seatPos), (S + 6) / (2 * (tw + th))) : null) as p (p.seat)}
      {@const pid = table.assignments.find((a) => a.seat === p.seat)?.playerId ?? null}
      {@const pl = pid == null ? null : (byId.get(pid) ?? null)}
      {@const top = p.y < -th / 2}
      {@const side = p.x < -tw / 2 ? (mode === 'out' ? 'lo' : mode === 'low' ? 'lb' : 'l') : p.x > tw / 2 ? (mode === 'out' ? 'ro' : mode === 'low' ? 'rb' : 'r') : ''}
      {@const rank = fr.filter((v) => v < (fr[p.seat - 1] ?? 0)).length}
      {@const crowd = pts.some((q) => q.seat !== p.seat && Math.abs(q.y - p.y) < S * 0.4 && Math.abs(q.x - p.x) < S * 2.4)}
      <div class="seat" class:empty={!pl} style="left:{W / 2 + p.x}px;top:{H / 2 + p.y}px;width:{S}px;height:{S}px">
        {#if pl}
          <Avatar name={pl.displayName} color={pl.color} src={pl.avatarPath} size={S} />
          <span class="lbl" class:l={side === 'l'} class:r={side === 'r'} class:lo={side === 'lo'} class:ro={side === 'ro'} class:lb={side === 'lb'} class:rb={side === 'rb'} class:above={top && !side} style="font-size:max(1.4rem,{fs}px);max-width:{mode === 'out' && side ? room : mode === 'low' && side ? Math.round((W - tw) / 2 - 6) : side ? Math.max(40, Math.round(tw * 0.3) - 16) : crowd ? 2 * S + 4 : 192}px;--st:{crowd && !side ? rank % 2 : 0}">{first(pl.displayName)}</span>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .tbl .prop {
    position: absolute;
    z-index: 0;
    pointer-events: none;
  }
  .tbl > strong,
  .tbl > .cnt {
    position: relative;
    z-index: 1;
  }
  /* on a table with props, the label sits on a dark pill so it reads over the pictures */
  .tbl.hasprops > strong,
  .tbl.hasprops > .cnt {
    background: #000a;
    padding: 0 0.45em;
    border-radius: 0.5em;
  }
  .tv-table {
    position: relative;
    width: 100%;
    overflow: visible;
  }
  .tbl {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--panel);
    box-shadow: inset 0 0 0 3px var(--panel), inset 0 0 0 4px #c9a24a30;
    overflow: hidden;
    line-height: 1.2;
    padding: 0 6px;
  }
  .tbl strong {
    font-family: var(--serif);
    font-weight: 400;
  }
  .cnt {
    font-family: var(--mono);
  }
  .tbl strong,
  .cnt {
    max-width: 100%;
    text-align: center;
  }
  .tbl strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cnt {
    font-size: max(1.1rem, 0.7em);
  }
  .seat {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    line-height: 0;
  }
  .seat.empty {
    border: 2px dashed var(--muted);
  }
  .lbl {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: calc(2px + var(--st, 0) * 2.2rem);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
    font-weight: 600;
  }
  .lbl.above {
    top: auto;
    bottom: 100%;
    margin: 0 0 calc(2px + var(--st, 0) * 2.2rem);
  }
  /* Seats on the left/right edges: the name sits just inside the table edge, next to the seat, so it never
     lands on a neighbouring seat or outside the panel. */
  .lbl.lb,
  .lbl.rb {
    margin-top: 2px;
    transform: none;
  }
  .lbl.lb {
    left: auto;
    right: 0;
  }
  .lbl.rb {
    left: 0;
  }
  .lbl.l,
  .lbl.r,
  .lbl.lo,
  .lbl.ro {
    top: 50%;
    margin: 0;
    transform: translateY(-50%);
  }
  .lbl.l {
    left: calc(100% + 12px);
  }
  .lbl.r {
    left: auto;
    right: calc(100% + 12px);
  }
  /* Narrow table: there is room outside the seat, so the name sits beside it, away from the table. */
  .lbl.lo {
    left: auto;
    right: calc(100% + 6px);
  }
  .lbl.ro {
    left: calc(100% + 6px);
  }
</style>
