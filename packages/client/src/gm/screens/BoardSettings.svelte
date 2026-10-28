<script lang="ts">
  /** Settings for each installed game board (Master only). Blank = the board's default. */
  import { patch } from '@shared/api';
  import { run } from '@shared/ui';
  import type { GmState } from '@shared/types';
  import { BOARDS } from '../boards';

  let { gs, master }: { gs: GmState | null; master: boolean } = $props();
  const saved = $derived(gs?.gm?.boardSettings ?? {});
  let edits = $state<Record<string, string>>({});
  const k = (board: string, name: string) => `${board}.${name}`;

  async function save(board: string, name: string, min: number, max: number) {
    const raw = edits[k(board, name)];
    if (raw === undefined) return;
    const value = raw.trim() === '' ? null : Math.min(max, Math.max(min, Number(raw)));
    if (value !== null && !Number.isFinite(value)) return;
    const r = await run(() => patch(`/api/boards/${board}/settings`, { [name]: value }), 'Saved');
    if (r) {
      const { [k(board, name)]: _, ...rest } = edits;
      edits = rest;
    }
  }
</script>

{#each Object.entries(BOARDS) as [key, b] (key)}
  {#if b.def.settings && Object.keys(b.def.settings).length}
    <details class="panel">
      <summary><strong>Game board · {b.def.label}</strong></summary>
      <div class="grid">
        {#each Object.entries(b.def.settings) as [name, s] (name)}
          {@const cur = saved[key]?.[name]}
          <label class="small">
            <span>{s.label} <span class="muted">(default {s.default})</span></span>
            <input
              type="number"
              inputmode="decimal"
              min={s.min}
              max={s.max}
              step={s.step ?? 1}
              placeholder={String(s.default)}
              disabled={!master}
              value={edits[k(key, name)] ?? (cur ?? '')}
              oninput={(e) => (edits = { ...edits, [k(key, name)]: (e.currentTarget as HTMLInputElement).value })}
              onchange={() => save(key, name, s.min, s.max)}
            />
          </label>
        {/each}
      </div>
    </details>
  {/if}
{/each}

<style>
  .grid {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  label {
    display: grid;
    grid-template-columns: 1fr 6rem;
    gap: 0.5rem;
    align-items: center;
  }
</style>
