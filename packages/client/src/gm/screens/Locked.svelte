<script lang="ts">
  import { post } from '@shared/api';
  import { run } from '@shared/ui';
  import { gold } from '@shared/format';
  import type { GmState } from '@shared/types';
  import { playerName } from '../lib';
  let { gs, onunlock }: { gs: GmState | null; onunlock: () => void } = $props();
  let pin = $state('');

  async function unlock(e: Event) {
    e.preventDefault();
    if (await run(() => post('/api/gm/unlock', { pin }))) {
      pin = '';
      onunlock();
    }
  }
</script>

<!-- Remotely paused GM device: TV-style standings + PIN unlock (spec §16). -->
<main class="wrap">
  <div class="spread">
    <h1>Standings</h1>
    <span class="badge warn">Device paused</span>
  </div>
  <div class="panel">
    <table>
      <thead><tr><th>#</th><th>Player</th><th class="num">Net worth</th></tr></thead>
      <tbody>
        {#each gs?.standings ?? [] as s (s.playerId)}
          <tr><td>{s.rank}</td><td>{playerName(gs, s.playerId)}</td><td class="num">{gold(s.netWorthH)}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
  <form class="panel row" onsubmit={unlock}>
    <input inputmode="numeric" placeholder="PIN" bind:value={pin} />
    <button class="primary" type="submit">Unlock</button>
    <span class="muted small">Or tap “Resume device” on your phone.</span>
  </form>
</main>

<style>
  .wrap {
    max-width: 720px;
    margin: 1.5rem auto;
    padding: 0 1rem;
  }
</style>
