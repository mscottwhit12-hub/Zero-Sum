<script lang="ts">
  /** The phone's leaderboard page: one swipe to the right of the home screen. Full screen, net worth, you highlighted. */
  import Avatar from '@shared/Avatar.svelte';
  import { gold } from '@shared/format';
  import { t } from '@shared/copy';
  import type { PlayerState } from '@shared/types';
  let { s }: { s: PlayerState } = $props();
  const p = (id: number) => s.players.find((x) => x.id === id);
</script>

<div class="lb">
  <h1>{t('phone.leaderboard')}</h1>
  <p class="muted small">{s.night?.name ?? ""}{s.me?.rank ? ` · you are ${s.me.rank} of ${s.standings.length}` : ''}</p>
  <div class="cd">
    {#each s.standings as r (r.playerId)}
      {@const pl = p(r.playerId)}
      <div class="sr" class:me={r.playerId === s.me?.id}>
        <span class="n">{r.rank}</span>
        <Avatar name={pl?.displayName ?? '?'} color={pl?.color} src={pl?.avatarPath} size={34} />
        <span class="nm">{pl?.displayName}</span>
        <span class="v">{gold(r.netWorthH)}</span>
      </div>
    {:else}
      <p class="muted">Nobody on the board yet.</p>
    {/each}
  </div>
</div>
