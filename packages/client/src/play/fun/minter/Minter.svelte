<script lang="ts">
  /**
   * NFT Minter (spec §15.4): idle clicker, text and numbers only, fun only (no link to gold).
   * The server is authoritative; this view shows an optimistic local count between syncs.
   */
  import { onDestroy, onMount } from 'svelte';
  import { t } from '@shared/copy';
  import type { PublicState } from '@shared/types';
  import { dapi, deviceToken } from '../../device';

  interface Shop {
    id: string;
    name: string;
    rate: number;
    owned: number;
    cost: number;
    output: number;
    nextMilestone: number | null;
    managed: boolean;
    managerCost: number;
    intermissionOnly: boolean;
    available: boolean;
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
    tapValue: number;
    mult: number;
    paused: boolean;
    active: boolean;
    shop: Shop[];
    upgrades: Upgrade[];
    investors: { have: number; claimable: number; bonusPct: number; perInvestorPct: number };
    rebrands: number;
    rejected?: string[];
  }

  let { s }: { s: PublicState } = $props();
  let v = $state<View | null>(null);
  let syncedAt = 0;
  let taps = 0;
  let buys: string[] = [];
  let now = $state(Date.now());
  let busy = false;

  /** The account this Minter opened as: it never syncs under any other. */
  const token = deviceToken();
  async function sync() {
    if (busy || !token || deviceToken() !== token) return;
    busy = true;
    const body = { taps, buys };
    taps = 0;
    buys = [];
    try {
      v = await dapi<View>('POST', '/api/minter/sync', body, token);
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
  // Between syncs (every 3 s while open) everything mints at the full rate.
  const gained = $derived(v ? localTaps * v.tapValue + v.ratePerSec * elapsed : 0);
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
  function rebrand() {
    if (confirm(t('minter.rebrand_confirm'))) buy('rebrand');
  }
  const short = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : Math.floor(n).toLocaleString());
  const rate = (n: number) => (n >= 100 ? short(n) : n.toFixed(1));
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
    <p class="mono small">{t('minter.per_sec', { rate: rate(v.ratePerSec) })} · {t('minter.per_tap', { n: rate(v.tapValue) })}</p>
    {#if v.investors.have}<p class="small bonus">{t('minter.investors', { n: v.investors.have, pct: v.investors.bonusPct })}</p>{/if}
    {#if v.paused}<p class="small bonus">{t('minter.bonus', { mult: v.mult })}</p>{/if}
    <button class="mint" disabled={!v.active} onclick={mint}>{v.active ? t('minter.mint') : t('minter.closed')}</button>
  </div>

  <div class="lab">{t('minter.shop')}</div>
  <p class="small muted">{t('minter.managers_hint')}</p>
  {#each v.shop.filter((x) => x.available || x.owned) as x (x.id)}
    <div class="gen">
      <div class="hw">
        <span>
          {x.name} <span class="mono muted">×{x.owned}</span>
          {#if x.intermissionOnly}<span class="small bonus"> · {t('minter.exclusive')}</span>{/if}
        </span>
        <span class="c">{x.owned ? t('minter.per_sec', { rate: rate(x.output) }) : `+${x.rate}/s each`}</span>
        <button disabled={!v.active || !x.available || credits < x.cost} onclick={() => buy(x.id)}>{short(x.cost)}</button>
      </div>
      {#if x.owned || x.nextMilestone}
        <div class="more">
          {#if x.owned}
            {#if x.managed}
              <span class="badge live">{t('minter.managed')}</span>
            {:else}
              <button disabled={!v.active || credits < x.managerCost} onclick={() => buy(`mgr:${x.id}`)}>{t('minter.hire')} · {short(x.managerCost)}</button>
            {/if}
          {/if}
          {#if x.nextMilestone}
            <span class="ms" title="Milestone">
              <i style="width:{Math.min(100, (x.owned / x.nextMilestone) * 100)}%"></i>
              <b>{t('minter.milestone', { owned: x.owned, next: x.nextMilestone })}</b>
            </span>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  {#if v.upgrades.some((u) => u.available && !u.bought)}
    <div class="lab">{t('minter.upgrades')}</div>
    {#each v.upgrades.filter((u) => u.available && !u.bought) as u (u.id)}
      <div class="upg">
        <span class="grow">{u.name} <span class="muted small">×{u.mult} {u.target === 'tap' ? 'taps' : 'output'}</span></span>
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
