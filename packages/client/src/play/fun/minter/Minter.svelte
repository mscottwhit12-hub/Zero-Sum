<script lang="ts">
  /**
   * NFT Minter (spec §15.4): Adventure Capitalist–style, fun only (no link to gold).
   * Tap a business to run one cycle; managers run it nonstop. The server is authoritative and runs on the night
   * clock, so it keeps going with the app closed and stops while paused. This view animates between syncs.
   */
  import { onDestroy, onMount } from 'svelte';
  import { t } from '@shared/copy';
  import type { PublicState } from '@shared/types';
  import { dapi, deviceToken } from '../../device';

  interface Biz {
    id: string;
    name: string;
    owned: number;
    cost: number;
    time: number;
    payout: number;
    progress: number | null;
    nextMilestone: number | null;
    managed: boolean;
    managerCost: number;
  }
  interface Upgrade {
    id: string;
    name: string;
    cost: number;
    target: string;
    mult: number;
    bought: boolean;
    available: boolean;
  }
  interface View {
    minted: number;
    credits: number;
    ratePerSec: number;
    boostLeft: number;
    boostMult: number;
    paused: boolean;
    active: boolean;
    shop: Biz[];
    upgrades: Upgrade[];
    investors: { have: number; claimable: number; bonusPct: number; perInvestorPct: number };
    rebrands: number;
    rejected?: string[];
  }

  let { s }: { s: PublicState } = $props();
  let v = $state<View | null>(null);
  let syncedAt = $state(0);
  let buys: string[] = [];
  let now = $state(Date.now());
  let busy = false;
  /** Optimistic local starts (business id → ms) until the server confirms. */
  let started = $state<Record<string, number>>({});

  /** The account this Minter opened as: it never syncs under any other. */
  const token = deviceToken();
  async function sync() {
    if (busy || !token || deviceToken() !== token) return;
    busy = true;
    const body = { buys };
    buys = [];
    try {
      v = await dapi<View>('POST', '/api/minter/sync', body, token);
      syncedAt = Date.now();
      started = {};
    } catch {
      buys = [...body.buys, ...buys]; // retry next time
    } finally {
      busy = false;
    }
    if (buys.length) void sync();
  }
  const timer = setInterval(() => (now = Date.now()), 100);
  const syncTimer = setInterval(sync, 3000);
  onMount(sync);
  onDestroy(() => {
    clearInterval(timer);
    clearInterval(syncTimer);
    if (buys.length) void sync();
  });

  const elapsed = $derived(v && v.active ? Math.max(0, (now - syncedAt) / 1000) : 0);
  const boostLeft = $derived(v ? Math.max(0, v.boostLeft - elapsed) : 0);
  // Managed businesses pay continuously between syncs; tapped cycles land on the next sync.
  const gained = $derived(v ? v.ratePerSec * (elapsed + Math.min(elapsed, v.boostLeft) * (v.boostMult - 1)) : 0);
  const minted = $derived(Math.floor((v?.minted ?? 0) + gained));
  const credits = $derived(Math.floor((v?.credits ?? 0) + gained));

  /** Cycle fill 0..1 right now, or null when idle. */
  function fill(b: Biz): number | null {
    if (!b.owned) return null;
    if (started[b.id] != null) return Math.min(1, (now - started[b.id]!) / 1000 / b.time);
    if (b.managed) return (((((b.progress ?? 0) * b.time + elapsed) % b.time) + b.time) % b.time) / b.time;
    if (b.progress == null) return null;
    return Math.min(1, b.progress + elapsed / b.time);
  }
  // A tapped cycle that just filled: fetch the payout now rather than at the next 3 s sync.
  $effect(() => {
    if (v?.active && now - syncedAt > 400 && v.shop.some((b) => !b.managed && fill(b) === 1)) void sync();
  });

  function run(b: Biz) {
    if (!v?.active || !b.owned || b.managed || fill(b) != null) return;
    started = { ...started, [b.id]: Date.now() };
    buys.push(`run:${b.id}`);
    void sync();
  }
  function buy(id: string) {
    buys.push(id);
    void sync();
  }
  function rebrand() {
    if (confirm(t('minter.rebrand_confirm'))) buy('rebrand');
  }
  const short = (n: number) =>
    n >= 1e12 ? `${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : Math.floor(n).toLocaleString();
  const rate = (n: number) => (n >= 100 ? short(n) : n.toFixed(1));
  const secs = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}m ${Math.round(n % 60)}s` : n >= 1 ? `${+n.toFixed(1)}s` : `${+n.toFixed(2)}s`);
  const clock = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
  const fmt = (n: number) => n.toLocaleString();
  const name = (id: number) => s.players.find((p) => p.id === id)?.displayName ?? '?';
</script>

{#if !v}
  <p class="muted">{t('minter.loading')}</p>
{:else}
  <div class="ctr">
    <p class="muted">{t('minter.credits_label')}</p>
    <div class="z">{short(credits)}</div>
    <p class="mono small muted">{t('minter.minted_small', { n: fmt(minted) })}</p>
    {#if v.ratePerSec}<p class="mono small">{t('minter.per_sec', { rate: rate(v.ratePerSec) })}</p>{/if}
    {#if boostLeft > 0}<p class="small bonus">{t('minter.boost', { mult: v.boostMult, left: clock(boostLeft) })}</p>{/if}
    {#if v.investors.have}<p class="small bonus">{t('minter.investors', { n: v.investors.have, pct: v.investors.bonusPct })}</p>{/if}
    {#if !v.active}<p class="small bonus">{t('minter.paused_note')}</p>{/if}
  </div>

  <div class="lab">{t('minter.shop')}</div>
  <p class="small muted">{t('minter.managers_hint')}</p>
  {#each v.shop as b (b.id)}
    {@const f = fill(b)}
    <div class="gen">
      <div class="hw">
        {#if b.owned}
          <button class="biz" disabled={!v.active || b.managed || f != null} onclick={() => run(b)} aria-label="{t('minter.run')} {b.name}">
            <i style="width:{(f ?? 0) * 100}%"></i>
            <b>{b.name} <span class="mono">×{b.owned}</span></b>
            <small class="mono">{b.managed || f != null ? t('minter.running') : t('minter.run')}</small>
          </button>
          <button disabled={!v.active || credits < b.cost} onclick={() => buy(b.id)} aria-label="{t('minter.buy')} {b.name}">{short(b.cost)}</button>
        {:else}
          <span class="grow">{b.name}</span>
          <button disabled={!v.active || credits < b.cost} onclick={() => buy(b.id)}>{t('minter.unlock')} · {short(b.cost)}</button>
        {/if}
      </div>
      <div class="more">
        <span class="mono">{t('minter.cycle', { payout: short(b.payout), time: secs(b.time) })}</span>
        {#if b.owned}
          {#if b.managed}
            <span class="badge live">{t('minter.managed')}</span>
          {:else}
            <button disabled={!v.active || credits < b.managerCost} onclick={() => buy(`mgr:${b.id}`)}>{t('minter.hire')} · {short(b.managerCost)}</button>
          {/if}
          {#if b.nextMilestone}
            <span class="ms" title="Milestone">
              <i style="width:{Math.min(100, (b.owned / b.nextMilestone) * 100)}%"></i>
              <b>{t('minter.milestone', { owned: b.owned, next: b.nextMilestone })}</b>
            </span>
          {/if}
        {/if}
      </div>
    </div>
  {/each}

  {#if v.upgrades.some((u) => u.available && !u.bought)}
    <div class="lab">{t('minter.upgrades')}</div>
    {#each v.upgrades.filter((u) => u.available && !u.bought) as u (u.id)}
      <div class="upg">
        <span class="grow">{u.name} <span class="muted small">×{u.mult} payout</span></span>
        <button disabled={!v.active || credits < u.cost} onclick={() => buy(`up:${u.id}`)}>{short(u.cost)}</button>
      </div>
    {/each}
  {/if}

  <div class="lab">{t('minter.rebrand')}</div>
  <p class="small muted">{t('minter.rebrand_body', { pct: v.investors.perInvestorPct })}</p>
  {#if v.investors.claimable > 0}
    <button class="wide" disabled={!v.active} onclick={rebrand}>{t('minter.rebrand_button', { n: v.investors.claimable })}</button>
  {:else}
    <p class="small muted">{t('minter.rebrand_none')}</p>
  {/if}

  <div class="lab">{t('minter.leaderboard')}</div>
  {#each (s.minter?.leaderboard ?? []).slice(0, 5) as r, i (r.playerId)}
    <div class="upg small"><span class="grow">{i + 1}. {name(r.playerId)}</span><span class="mono">{fmt(r.minted)}</span></div>
  {:else}
    <p class="muted small">{t('minter.nobody')}</p>
  {/each}
{/if}

<style>
  .hw .biz {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 48px;
    text-align: left;
    overflow: hidden;
    padding: 0.4rem 0.6rem;
  }
  .hw .biz i {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--forest-hi);
    border: 0;
    padding: 0;
    min-width: 0;
    border-radius: 0;
  }
  .hw .biz b,
  .hw .biz small {
    position: relative;
    font-weight: 400;
  }
  .hw .biz small {
    margin-left: auto;
    color: var(--muted);
  }
</style>
