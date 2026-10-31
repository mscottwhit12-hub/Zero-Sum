<script lang="ts">
  import { post } from '@shared/api';
  import { run } from '@shared/ui';
  import type { GmChallenge, GmState, RewardType } from '@shared/types';
  import { activePlayers, playerName } from '../lib';

  let { gs }: { gs: GmState | null } = $props();
  const live = $derived(gs?.night?.status === 'live' || gs?.night?.status === 'paused');
  const defaultGold = $derived(((gs?.gm?.settings.resolved as { espionage?: { goldReward: number } } | undefined)?.espionage?.goldReward) ?? 3);

  let playerId = $state<string>('');
  let text = $state('');
  let rewardType = $state<RewardType>('gold');
  let rewardGold = $state<number | ''>('');
  let rewardText = $state('');
  let rewardTier = $state<'common' | 'rarer' | 'rarest'>('common');
  let rewardTap = $state<'any' | 'pair'>('any');
  const REWARDS: { id: RewardType; label: string }[] = [
    { id: 'gold', label: 'Gold' },
    { id: 'reroll', label: 'Re-roll' },
    { id: 'peek', label: 'Peek' },
    { id: 'dead_clue', label: 'Dead-stock clue' },
    { id: 'hint', label: 'Mechanic tip' },
    { id: 'wiretap', label: 'Wiretap' },
    { id: 'minter_boost', label: 'NFT Minter ×10 for 5 min' },
    { id: 'custom', label: 'Custom' },
  ];
  async function assign(e: Event) {
    e.preventDefault();
    const reward = rewardType === 'gold' ? { type: 'gold', gold: rewardGold === '' ? undefined : Number(rewardGold) } : rewardType === 'custom' ? { type: 'custom', text: rewardText } : rewardType === 'hint' ? { type: 'hint', tier: rewardTier } : rewardType === 'wiretap' ? { type: 'wiretap', mode: rewardTap } : { type: rewardType };
    const r = await run(() => post('/api/challenges', { playerId: Number(playerId), text, reward }), 'Memo sent');
    if (r) {
      text = '';
      playerId = '';
    }
  }
  let reassignTo = $state<Record<number, string>>({});
  const rewardLabel = (c: GmChallenge) =>
    c.reward.type === 'gold' ? `${c.reward.gold} gold` : c.reward.type === 'custom' ? `Custom: ${c.reward.text}` : c.reward.type === 'hint' ? `Mechanic tip (${c.reward.tier ?? 'common'})` : REWARDS.find((r) => r.id === c.reward.type)?.label;
  const STATUS: Record<string, string> = { sent: 'Sent', read: 'Read', accepted: 'Accepted', rejected: 'Rejected', succeeded: 'Success', failed: 'Failed', reassigned: 'Reassigned' };
  const list = $derived(gs?.gm?.challenges ?? []);
</script>

<form class="panel" onsubmit={assign}>
  <h2>Assign a covert challenge</h2>
  <p class="small muted">The TV announces an anonymous memo. Only the agent sees the text.</p>
  <div class="grid2">
    <label class="field"><span>Agent</span>
      <select bind:value={playerId} required>
        <option value="">—</option>
        {#each activePlayers(gs) as p (p.id)}<option value={String(p.id)}>{p.displayName}</option>{/each}
      </select>
    </label>
    <label class="field"><span>Reward</span>
      <select bind:value={rewardType}>
        {#each REWARDS as r (r.id)}<option value={r.id}>{r.label}</option>{/each}
      </select>
    </label>
    {#if rewardType === 'gold'}
      <label class="field"><span>Gold</span><input type="number" step="any" min="0.01" max="100" placeholder={String(defaultGold)} bind:value={rewardGold} /></label>
    {:else if rewardType === 'hint'}
      <label class="field"><span>Tip tier</span>
        <select bind:value={rewardTier}><option value="common">Common</option><option value="rarer">Rarer</option><option value="rarest">Rarest</option></select>
      </label>
    {:else if rewardType === 'wiretap'}
      <label class="field"><span>Wiretap</span>
        <select bind:value={rewardTap}>
          <option value="any">One random message from any chat</option>
          <option value="pair">One random message between two players they pick (stronger)</option>
        </select>
      </label>
    {:else if rewardType === 'custom'}
      <label class="field"><span>Custom reward (granted by hand)</span><input maxlength="200" bind:value={rewardText} required /></label>
    {/if}
  </div>
  <label class="field"><span>Challenge</span><textarea rows="3" maxlength="500" bind:value={text} required></textarea></label>
  <div class="actions"><button class="primary" type="submit" disabled={!live}>Send memo</button></div>
</form>

<section class="panel">
  <h2>Challenges</h2>
  {#each list as c (c.id)}
    <div class="line">
      <div class="spread">
        <strong>{playerName(gs, c.playerId)}</strong>
        <span class="badge" class:live={c.status === 'accepted'} class:warn={c.status === 'rejected'}>{STATUS[c.status]}</span>
      </div>
      <div class="small">{c.text}</div>
      <div class="small muted">{rewardLabel(c)}{c.reassignedFrom ? ' · reassigned' : ''}</div>
      {#if c.status === 'accepted'}
        <div class="actions">
          <button class="primary" onclick={() => run(() => post(`/api/challenges/${c.id}/resolve`, { success: true }), 'Marked success')}>Success</button>
          <button class="danger" onclick={() => confirm(`Mark failed? ${playerName(gs, c.playerId)} will be exposed on the TV.`) && run(() => post(`/api/challenges/${c.id}/resolve`, { success: false }), 'Marked failed')}>Fail</button>
        </div>
      {:else if c.status === 'rejected'}
        <div class="actions">
          <select bind:value={reassignTo[c.id]}>
            <option value="">Reassign to…</option>
            {#each activePlayers(gs).filter((p) => p.id !== c.playerId) as p (p.id)}<option value={String(p.id)}>{p.displayName}</option>{/each}
          </select>
          <button disabled={!reassignTo[c.id]} onclick={() => run(() => post(`/api/challenges/${c.id}/reassign`, { playerId: Number(reassignTo[c.id]) }), 'Reassigned')}>Reassign</button>
        </div>
      {/if}
    </div>
  {:else}
    <p class="muted">No challenges yet.</p>
  {/each}
</section>
