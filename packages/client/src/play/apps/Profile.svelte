<script lang="ts">
  import Avatar from '@shared/Avatar.svelte';
  import { copy } from '@shared/copy';
  import type { PlayerState } from '@shared/types';
  import { setDeviceToken } from '../device';
  let { s, onsignout }: { s: PlayerState; onsignout: () => void } = $props();
  const p = $derived(s.players.find((x) => x.id === s.me?.id));
  const achName = (type: string) => (copy as { achievements: Record<string, { name: string; text: string }> }).achievements[type] ?? { name: type, text: '' };
</script>

<div class="panel center">
  <Avatar name={p?.displayName ?? '?'} color={p?.color} src={p?.avatarPath} size={72} />
  <h2>{p?.displayName}</h2>
  <span class="mono muted">{p?.ticker}</span>
</div>
<div class="panel">
  <h3>Achievements</h3>
  {#each s.me?.achievements ?? [] as a (a.type)}
    <div class="line"><strong>{achName(a.type).name}</strong> <span class="small muted">{achName(a.type).text}</span></div>
  {/each}
  {#if !s.me?.achievements.length}<p class="muted small">None yet.</p>{/if}
</div>
<div class="panel small">
  <p class="muted">This phone is signed in as you. To use another phone, choose “Return to my desk” on it and the GM will approve it.</p>
  <button class="danger" onclick={() => confirm('Sign this phone out? You can come straight back on this phone; another phone needs GM approval.') && (setDeviceToken(null), onsignout())}>Sign out this phone</button>
</div>

<style>
  .center {
    text-align: center;
  }
  .line {
    padding: 0.3rem 0;
  }
</style>
