<script lang="ts">
  /** Phone Bets app: offer a bet on a game, take someone's offer, see live bets and results. Gold only, player against player. */
  import { dapi } from '../device';
  import { gold } from '@shared/format';
  import { run } from '@shared/ui';
  import { betClaim, betGame, betOdds, betOutcome } from '@shared/betText';
  import type { PlayerState } from '@shared/types';
  let { s }: { s: PlayerState } = $props();
  const me = $derived(s.me!);
  const bets = $derived(me.bets);
  const name = (id: number | null) => s.players.find((p) => p.id === id)?.displayName ?? '?';
  const open = $derived(bets.list.filter((b) => b.status === 'open'));
  const live = $derived(bets.list.filter((b) => b.status === 'accepted'));
  const done = $derived(bets.list.filter((b) => !['open', 'accepted'].includes(b.status)).slice(0, 8));
  const games = $derived(s.games.filter((g) => g.status === 'scheduled' || g.status === 'active'));
  const people = $derived(s.players.filter((p) => !p.left));

  let gameId = $state('');
  let kind = $state('win');
  let subjectId = $state('');
  let a = $state(1);
  let b = $state(1);
  let stake = $state(1);
  let targetId = $state('');
  let useTicket = $state(false);
  const game = $derived(games.find((g) => String(g.id) === gameId) ?? null);
  // Start on the first open game and on yourself; keep the choice valid as games open and close.
  $effect(() => {
    if (!games.some((g) => String(g.id) === gameId)) gameId = games[0] ? String(games[0].id) : '';
  });
  $effect(() => {
    if (!subjectId) subjectId = String(me.id);
  });
  const win = $derived(Math.round((stake * 100 * a) / b) / 100);
  const worst = $derived(Math.max(stake, win));
  const limit = $derived(bets.limitH / 100);
  const over = $derived(worst > limit);
  const tooBig = $derived(worst > (useTicket ? bets.ticketLimitH / 100 : limit));
  const odds = Array.from({ length: 10 }, (_, i) => i + 1);

  async function offer(e: Event) {
    e.preventDefault();
    if (!game) return;
    const r = await run(
      () =>
        dapi('POST', '/api/me/bets', {
          gameId: game.id,
          kind: kind === 'win' ? 'win' : 'place',
          topN: kind === 'win' ? undefined : Number(kind),
          subjectId: Number(subjectId || me.id),
          oddsA: a,
          oddsB: b,
          stake,
          targetId: targetId ? Number(targetId) : undefined,
          ticket: over && useTicket,
        }),
      'Offer posted',
    );
    if (r) useTicket = false;
  }
</script>

{#if !bets.enabled}
  <div class="cd"><p>Betting is closed tonight.</p></div>
{:else}
  <div class="cd">
    <p>Bet gold against another associate on how a game ends. Most you can have at risk on one bet: <b>{gold(bets.limitH)}</b>.
      {#if bets.tickets}<span class="tag">{bets.tickets} High Roller ticket{bets.tickets === 1 ? '' : 's'}: one bet up to {gold(bets.ticketLimitH)}</span>{/if}</p>
  </div>

  {#if open.length}
    <div class="cd">
      <h3>Open offers</h3>
      {#each open as o (o.id)}
        <div class="bet">
          <div><b>{betClaim(o, s.players)}</b> · {betGame(o, s.games)}</div>
          <div class="muted small">{name(o.offererId)} offers {betOdds(o)}: risks {gold(o.stakeH)} to win {gold(o.winH)}{o.targetId ? ` · for ${name(o.targetId)}` : ''}{o.ticket ? ' · High Roller' : ''}</div>
          {#if o.offererId === me.id}
            <button onclick={() => run(() => dapi('POST', `/api/me/bets/${o.id}/cancel`), 'Withdrawn')}>Withdraw</button>
          {:else}
            <button class="primary" disabled={me.cashH < o.winH} onclick={() => run(() => dapi('POST', `/api/me/bets/${o.id}/accept`), 'Bet on')}>Take it: risk {gold(o.winH)} to win {gold(o.stakeH)}</button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if live.length}
    <div class="cd">
      <h3>Live bets</h3>
      {#each live as o (o.id)}
        <div class="bet">
          <div><b>{betClaim(o, s.players)}</b> · {betGame(o, s.games)}</div>
          <div class="muted small">{name(o.offererId)} {gold(o.stakeH)} vs {name(o.takerId)} {gold(o.winH)} · {betOdds(o)}</div>
        </div>
      {/each}
    </div>
  {/if}

  <div class="cd">
    <h3>Offer a bet</h3>
    {#if !games.length}
      <p>No game to bet on right now.</p>
    {:else}
      <form onsubmit={offer}>
        <label class="field"><span>Game</span>
          <select bind:value={gameId}>{#each games as g (g.id)}<option value={String(g.id)}>{g.name}{g.status === 'active' ? ' (running)' : ''}</option>{/each}</select>
        </label>
        <label class="field"><span>Player</span>
          <select bind:value={subjectId}>{#each people as p (p.id)}<option value={String(p.id)}>{p.displayName}{p.id === me.id ? ' (you)' : ''}</option>{/each}</select>
        </label>
        <label class="field"><span>Bet that they…</span>
          <select bind:value={kind}>
            <option value="win">win</option>
            {#if game?.mode !== 'coop'}{#each [2, 3, 4, 5] as n}<option value={String(n)}>finish in the top {n}</option>{/each}{/if}
          </select>
        </label>
        <div class="row">
          <label class="field"><span>You win</span><select bind:value={a}>{#each odds as o}<option value={o}>{o}</option>{/each}</select></label>
          <label class="field"><span>for every</span><select bind:value={b}>{#each odds as o}<option value={o}>{o}</option>{/each}</select></label>
          <label class="field"><span>you risk</span><input type="number" min="0.1" step="0.1" bind:value={stake} /></label>
        </div>
        <label class="field"><span>Offer it to</span>
          <select bind:value={targetId}><option value="">Anyone</option>{#each people.filter((p) => p.id !== me.id) as p (p.id)}<option value={String(p.id)}>{p.displayName}</option>{/each}</select>
        </label>
        <p class="small muted">Odds {a} to {b}: you risk {gold(Math.round(stake * 100))} to win {gold(Math.round(win * 100))}. The other side risks {gold(Math.round(win * 100))}. A tie returns both stakes.</p>
        {#if over}
          {#if bets.tickets}
            <label class="small"><input type="checkbox" bind:checked={useTicket} /> Use a High Roller ticket (limit {gold(bets.ticketLimitH)})</label>
          {:else}
            <p class="error">That puts {gold(Math.round(worst * 100))} at risk; the limit is {gold(bets.limitH)}.</p>
          {/if}
        {/if}
        <button class="primary" type="submit" disabled={tooBig || (over && !useTicket) || stake <= 0 || me.cashH < stake * 100}>Post offer</button>
      </form>
    {/if}
  </div>

  {#if done.length}
    <div class="cd">
      <h3>Results</h3>
      {#each done as o (o.id)}
        <div class="bet">
          <div>{betClaim(o, s.players)} · {betGame(o, s.games)}</div>
          <div class="muted small">{betOutcome(o, s.players)}</div>
        </div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .bet { padding: 0.55rem 0; border-bottom: 1px solid var(--line); }
  .bet:last-child { border-bottom: 0; }
  .bet button { margin-top: 0.4rem; width: 100%; }
  .row { display: flex; gap: 0.5rem; }
  .row .field { flex: 1; min-width: 0; }
</style>
