<script lang="ts">
  import { t } from '@shared/copy';
  import { nightNow } from '@shared/socket';
  import { run } from '@shared/ui';
  import Avatar from '@shared/Avatar.svelte';
  import type { PlayerState } from '@shared/types';
  import { dapi } from '../device';

  let { s, now }: { s: PlayerState; now: number } = $props();
  const vote = $derived(s.me?.vote ?? null);
  const active = $derived(s.players.filter((p) => !p.left));
  const left = $derived.by(() => {
    if (!vote?.open || vote.windowEndsNms == null) return null;
    const ms = Math.max(0, vote.windowEndsNms - nightNow(s.night, now));
    return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  });
  let busy = $state(false);
  async function pick(id: number) {
    busy = true;
    await run(() => dapi('POST', '/api/vote', { targetId: id }), t('phone.vote_saved'));
    busy = false;
  }
</script>

{#if !vote}
  <p class="muted">{t('phone.vote_closed')}</p>
{:else}
  <h3>{t('phone.vote_title', { quarter: vote.quarter })}</h3>
  <p class="small">{t('phone.vote_prompt')}</p>
  {#if vote.open}
    <p class="small muted mono">{t('phone.vote_closes', { time: left ?? '' })}</p>
  {:else}
    <p class="small muted">{t('phone.vote_closed')}</p>
  {/if}
  <div class="picks">
    {#each active as p (p.id)}
      <button class="pick" class:picked={vote.myTarget === p.id} disabled={!vote.open || busy} onclick={() => pick(p.id)}>
        <Avatar name={p.displayName} color={p.color} src={p.avatarPath} size={32} />
        <span class="grow">{p.displayName}</span>
        <span class="mono small muted">{p.ticker}</span>
        {#if vote.myTarget === p.id}<span>✓</span>{/if}
      </button>
    {/each}
  </div>
{/if}
