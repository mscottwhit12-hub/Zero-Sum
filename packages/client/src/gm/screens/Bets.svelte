<script lang="ts">
  /** GM view of every bet tonight, with a void button for any open or live one. */
  import { post } from '@shared/api';
  import { gold } from '@shared/format';
  import { run } from '@shared/ui';
  import { betClaim, betGame, betOdds, betOutcome } from '@shared/betText';
  import type { GmState } from '@shared/types';
  let { gs }: { gs: GmState | null } = $props();
  const bets = $derived(gs?.gm?.bets ?? []);
  const name = (id: number | null) => gs?.players.find((p) => p.id === id)?.displayName ?? '?';
  const live = $derived(bets.filter((b) => b.status === 'open' || b.status === 'accepted'));
  const done = $derived(bets.filter((b) => b.status !== 'open' && b.status !== 'accepted'));
  const cfg = $derived((gs?.gm?.settings.resolved as { betting?: { enabled: boolean; maxStake: number; ticketMaxStake: number } } | undefined)?.betting);
  async function voidIt(id: number) {
    const reason = prompt('Why is this bet being called off? (optional)') ?? null;
    if (reason === null) return;
    await run(() => post(`/api/bets/${id}/void`, { reason }), 'Bet called off; stakes returned');
  }
</script>

<section class="panel">
  <h2>Bets</h2>
  <p class="small muted">
    Players bet gold against each other on how a game ends. Each side can lose at most {cfg?.maxStake ?? 5} gold ({cfg?.ticketMaxStake ?? 10} with a High Roller ticket); change that, or switch betting off, in Settings under “betting”. Bets pay out by themselves when you record a game’s result; a tie or a cancelled game returns both stakes.
  </p>
  {#if !live.length}<p class="muted">No open or live bets.</p>{/if}
  {#each live as b (b.id)}
    <div class="line spread">
      <span>
        <b>{betClaim(b, gs?.players ?? [])}</b> · {betGame(b, gs?.games ?? [])} · {betOdds(b)}
        <span class="small muted"><br />{b.status === 'open' ? `Open: ${name(b.offererId)} risks ${gold(b.stakeH)} to win ${gold(b.winH)}${b.targetId ? ` (for ${name(b.targetId)})` : ''}` : `Live: ${name(b.offererId)} ${gold(b.stakeH)} vs ${name(b.takerId)} ${gold(b.winH)}`}{b.ticket ? ' · High Roller' : ''}</span>
      </span>
      <button class="danger" onclick={() => voidIt(b.id)}>Void</button>
    </div>
  {/each}
</section>

{#if done.length}
  <section class="panel">
    <h3>Finished</h3>
    {#each done as b (b.id)}
      <div class="line small">
        {betClaim(b, gs?.players ?? [])} · {betGame(b, gs?.games ?? [])} · {betOdds(b)} · {name(b.offererId)} vs {name(b.takerId)}: <span class="muted">{betOutcome(b, gs?.players ?? []) || b.status}</span>
      </div>
    {/each}
  </section>
{/if}
