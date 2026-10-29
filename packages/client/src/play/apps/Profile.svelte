<script lang="ts">
  import Avatar from '@shared/Avatar.svelte';
  import { copy } from '@shared/copy';
  import type { PlayerState } from '@shared/types';
  import { setDeviceToken } from '../device';
  let { s, onsignout }: { s: PlayerState; onsignout: () => void } = $props();
  const p = $derived(s.players.find((x) => x.id === s.me?.id));
  const achName = (type: string) => (copy as { achievements: Record<string, { name: string; text: string }> }).achievements[type] ?? { name: type, text: '' };
</script>

<div class="cd ctr">
  <Avatar name={p?.displayName ?? '?'} color={p?.color} src={p?.avatarPath} size={68} />
  <h3 style="margin:0.5rem 0 0">{p?.displayName}</h3>
  <p class="mono">{p?.ticker}</p>
</div>
<div class="cd">
  <h3>Achievements</h3>
  {#each s.me?.achievements ?? [] as a (a.type)}
    <div class="ln"><strong>{achName(a.type).name}</strong> <small class="muted">{achName(a.type).text}</small></div>
  {/each}
  {#if !s.me?.achievements.length}<p>None yet.</p>{/if}
</div>
<div class="cd">
  <p>This phone is signed in as you. To use another phone, choose “Return to my desk” on it and the GM will approve it.</p>
  <button class="danger" onclick={() => confirm('Sign this phone out? You can come straight back on this phone; another phone needs GM approval.') && (setDeviceToken(null), onsignout())}>Sign out this phone</button>
</div>
