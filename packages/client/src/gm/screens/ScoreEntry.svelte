<script lang="ts">
  import { post } from '@shared/api';
  import { t } from '@shared/copy';
  import { run } from '@shared/ui';
  import type { GameInfo, GmState } from '@shared/types';
  import { playerName } from '../lib';

  let { gs, g }: { gs: GmState | null; g: GameInfo } = $props();
  const ids = $derived(g.participants.length ? g.participants.map((p) => p.playerId) : (gs?.players.filter((p) => !p.left).map((p) => p.id) ?? []));
  /** Local edits; anything not edited shows the saved score. */
  let draft = $state<Record<number, string>>({});
  const shown = (id: number) => draft[id] ?? (g.scores[id] != null ? String(g.scores[id]) : '');
  const dirty = $derived(ids.some((id) => draft[id] !== undefined && draft[id] !== (g.scores[id] != null ? String(g.scores[id]) : '')));
  const bump = (id: number, d: number) => (draft[id] = String((Number(shown(id)) || 0) + d));

  async function save() {
    const scores = ids.filter((id) => draft[id] !== undefined && draft[id] !== '').map((id) => ({ playerId: id, score: Number(draft[id]) }));
    if (!scores.length) return;
    const r = await run(() => post(`/api/games/${g.id}/scores`, { scores }), 'Scores saved');
    if (r) draft = {};
  }
</script>

<p class="small muted">{g.leadLabel ?? t('lead.score')} · {g.leadMode === 'low' ? 'lowest leads' : 'highest leads'}</p>
<div class="scores">
  {#each ids as id (id)}
    <div class="srow">
      <span class="who">{g.leaderId === id ? '♛ ' : ''}{playerName(gs, id)}</span>
      <button class="step" onclick={() => bump(id, -1)} aria-label="minus one">−</button>
      <input class="mono" type="number" inputmode="decimal" step="any" value={shown(id)} oninput={(e) => (draft[id] = (e.currentTarget as HTMLInputElement).value)} />
      <button class="step" onclick={() => bump(id, 1)} aria-label="plus one">+</button>
    </div>
  {/each}
</div>
<div class="row" style="margin-top:.4rem"><button class="primary" disabled={!dirty} onclick={save}>Save scores</button></div>

<style>
  .scores { display: grid; gap: 0.3rem; }
  .srow { display: grid; grid-template-columns: 1fr auto 4.5rem auto; gap: 0.3rem; align-items: center; }
  .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .step { min-width: 2.4rem; }
  input { width: 100%; text-align: center; }
</style>
