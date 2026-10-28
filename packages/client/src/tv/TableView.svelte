<script lang="ts">
  /**
   * TV close-up of one table: the table at its real shape, scaled up, with big avatars and first names
   * around it (seat order matches the floor plan). Read-only.
   */
  import Avatar from '@shared/Avatar.svelte';
  import { clamp, seatPoints } from '@shared/seating';
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
    <div class="tbl" style="width:{tw}px;height:{th}px;font-size:{Math.round(clamp(th * 0.2, 16, S * 0.6))}px">
      <strong>{table.name}</strong>
      <span class="muted cnt">{table.assignments.length}/{table.seats}{game ? ` · ${game}` : ''}</span>
    </div>
    {#each seatPoints(table.seats, tw, th, S, 6) as p (p.seat)}
      {@const pid = table.assignments.find((a) => a.seat === p.seat)?.playerId ?? null}
      {@const pl = pid == null ? null : (byId.get(pid) ?? null)}
      {@const top = p.y < -th / 2}
      <div class="seat" class:empty={!pl} style="left:{W / 2 + p.x}px;top:{H / 2 + p.y}px;width:{S}px;height:{S}px">
        {#if pl}
          <Avatar name={pl.displayName} color={pl.color} src={pl.avatarPath} size={S} />
          <span class="lbl" class:above={top} style="font-size:{fs}px;max-width:{Math.round(S * 2.6)}px">{first(pl.displayName)}</span>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .tv-table {
    position: relative;
    width: 100%;
    overflow: hidden;
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
    border-radius: 8px;
    background: var(--panel);
    overflow: hidden;
    line-height: 1.2;
    padding: 0 6px;
  }
  .tbl strong,
  .cnt {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cnt {
    font-size: 0.7em;
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
    margin-top: 2px;
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
    margin: 0 0 2px;
  }
</style>
