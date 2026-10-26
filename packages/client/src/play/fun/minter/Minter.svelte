<script lang="ts">
  /**
   * NFT Minter (spec §15.4): idle clicker, text and numbers only, fun only (no link to gold).
   * The server is authoritative; this view shows an optimistic local count between syncs.
   */
  import { onDestroy, onMount } from 'svelte';
  import { t } from '@shared/copy';
  import type { PublicState } from '@shared/types';
  import { dapi } from '../../device';

  interface Shop {
    id: string;
    name: string;
    rate: number;
    owned: number;
    cost: number;
    intermissionOnly: boolean;
    available: boolean;
  }
  interface View {
    minted: number;
    credits: number;
    ratePerSec: number;
    mult: number;
    paused: boolean;
    active: boolean;
    shop: Shop[];
    rejected?: string[];
  }

  let { s }: { s: PublicState } = $props();
  let v = $state<View | null>(null);
  let syncedAt = 0;
  let taps = 0;
  let buys: string[] = [];
  let now = $state(Date.now());
  let busy = false;

  async function sync() {
    if (busy) return;
    busy = true;
    const body = { taps, buys };
    taps = 0;
    buys = [];
    try {
      v = await dapi<View>('POST', '/api/minter/sync', body);
      syncedAt = Date.now();
      localTaps = 0;
    } catch {
      taps += body.taps; // retry next time
    } finally {
      busy = false;
    }
  }
  let localTaps = $state(0);
  const timer = setInterval(() => (now = Date.now()), 200);
  const syncTimer = setInterval(sync, 3000);
  onMount(sync);
  onDestroy(() => {
    clearInterval(timer);
    clearInterval(syncTimer);
    if (taps || buys.length) void sync();
  });

  const elapsed = $derived(v ? Math.max(0, (now - syncedAt) / 1000) : 0);
  const gained = $derived(v ? localTaps * v.mult + v.ratePerSec * elapsed : 0);
  const minted = $derived(Math.floor((v?.minted ?? 0) + gained));
  const credits = $derived(Math.floor((v?.credits ?? 0) + gained));
  function mint() {
    if (!v?.active) return;
    taps++;
    localTaps++;
  }
  function buy(id: string) {
    buys.push(id);
    void sync();
  }
  const fmt = (n: number) => n.toLocaleString();
  const name = (id: number) => s.players.find((p) => p.id === id)?.displayName ?? '?';
</script>

{#if !v}
  <p class="muted">{t('minter.loading')}</p>
{:else}
  <div class="center">
    <div class="small muted">{t('minter.minted')}</div>
    <div class="mono big">{fmt(minted)}</div>
    <div class="small mono">{fmt(credits)} {t('minter.credits')} · {v.ratePerSec.toFixed(1)}/s</div>
    {#if v.paused}<div class="small bonus">{t('minter.bonus', { mult: v.mult })}</div>{/if}
    <button class="mint primary" disabled={!v.active} onclick={mint}>{v.active ? t('minter.mint') : t('minter.closed')}</button>
  </div>

  <h3 class="small muted">{t('minter.shop')}</h3>
  {#each v.shop.filter((x) => x.available || x.owned) as x (x.id)}
    <div class="row line">
      <span class="grow">{x.name} <span class="muted small">×{x.owned}</span>{#if x.intermissionOnly}<span class="small bonus"> · {t('minter.exclusive')}</span>{/if}</span>
      <span class="small mono muted">+{x.rate}/s</span>
      <button disabled={!v.active || !x.available || credits < x.cost} onclick={() => buy(x.id)}>{fmt(x.cost)}</button>
    </div>
  {/each}

  <h3 class="small muted">{t('minter.leaderboard')}</h3>
  {#each (s.minter?.leaderboard ?? []).slice(0, 5) as r, i (r.playerId)}
    <div class="row line small"><span class="grow">{i + 1}. {name(r.playerId)}</span><span class="mono">{fmt(r.minted)}</span></div>
  {:else}
    <p class="muted small">{t('minter.nobody')}</p>
  {/each}
{/if}

<style>
  .center {
    text-align: center;
    margin-bottom: 1rem;
  }
  .big {
    font-size: 2.4rem;
  }
  .mint {
    margin-top: 0.8rem;
    width: 100%;
    min-height: 88px;
    font-size: 1.3rem;
    touch-action: manipulation;
    user-select: none;
  }
  .grow {
    flex: 1;
  }
  .line {
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--line);
    align-items: center;
  }
  .bonus {
    color: var(--accent);
  }
</style>
