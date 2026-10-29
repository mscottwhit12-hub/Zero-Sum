<script lang="ts">
  import Avatar from '@shared/Avatar.svelte';
  import { gold } from '@shared/format';
  import type { PlayerState } from '@shared/types';
  let { s }: { s: PlayerState } = $props();
  const p = (id: number) => s.players.find((x) => x.id === id);
</script>

<div class="cd">
  {#each s.standings as r (r.playerId)}
    {@const pl = p(r.playerId)}
    <div class="sr" class:me={r.playerId === s.me?.id}>
      <span class="n">{r.rank}</span>
      <Avatar name={pl?.displayName ?? '?'} color={pl?.color} src={pl?.avatarPath} size={30} />
      <span class="nm">{pl?.displayName}</span>
      <span class="v">{gold(r.netWorthH)}</span>
    </div>
  {/each}
</div>
