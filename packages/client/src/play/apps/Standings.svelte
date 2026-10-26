<script lang="ts">
  import Avatar from '@shared/Avatar.svelte';
  import { gold } from '@shared/format';
  import type { PlayerState } from '@shared/types';
  let { s }: { s: PlayerState } = $props();
  const p = (id: number) => s.players.find((x) => x.id === id);
</script>

<div class="panel">
  {#each s.standings as r (r.playerId)}
    {@const pl = p(r.playerId)}
    <div class="spread line" class:me={r.playerId === s.me?.id}>
      <span class="row"><span class="rank mono">{r.rank}</span><Avatar name={pl?.displayName ?? '?'} color={pl?.color} src={pl?.avatarPath} size={28} />{pl?.displayName}</span>
      <span class="mono">{gold(r.netWorthH)}</span>
    </div>
  {/each}
</div>

<style>
  .line {
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--line);
  }
  .me {
    font-weight: 600;
  }
  .rank {
    width: 1.6rem;
    color: var(--muted);
  }
</style>
