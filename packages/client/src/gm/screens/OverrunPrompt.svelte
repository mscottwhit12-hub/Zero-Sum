<script lang="ts">
  /** "Running over" (Master, on every GM screen): the night's end has arrived with a game still running. */
  import { post } from '@shared/api';
  import { run } from '@shared/ui';
  import type { GmState } from '@shared/types';
  let { gs }: { gs: GmState | null } = $props();
  const offer = $derived(gs?.gm?.prompts.overrun ?? null);
  let busy = $state(false);
  async function answer(accept: boolean) {
    if (!offer || busy) return;
    busy = true;
    await run(() => post('/api/night/overrun', { gameId: offer.gameId, accept }), accept ? `Night pushed back ${offer.extendMinutes} min` : undefined);
    busy = false;
  }
</script>

{#if offer}
  <div class="overrun panel" role="alertdialog" aria-label="Running over">
    <strong>Heads up: you're running over.</strong>
    <span>{offer.name} is still going. Push the night back {offer.extendMinutes} minutes?</span>
    <div class="row">
      <button class="primary" disabled={busy} onclick={() => answer(true)}>Yes, +{offer.extendMinutes} min</button>
      <button disabled={busy} onclick={() => answer(false)}>No, we're going over</button>
    </div>
  </div>
{/if}

<style>
  .overrun {
    position: sticky;
    top: 0;
    z-index: 20;
    display: grid;
    gap: 0.4rem;
    border: 2px solid var(--warn);
    margin-bottom: 0.75rem;
  }
</style>
