<script lang="ts">
  import { onMount } from 'svelte';
  import { get, post } from '@shared/api';
  import { t } from '@shared/copy';
  import { run, toast, errorText } from '@shared/ui';
  import { phoneId, prepareAvatar, setDeviceToken, setPendingToken } from './device';

  let { ondone, rejoin: startRejoin = false }: { ondone: () => void; rejoin?: boolean } = $props();
  type Info = { nightName: string | null; status: string | null; mode: 'join' | 'late' | 'closed'; players: { id: number; displayName: string }[] };
  let info = $state<Info | null>(null);
  let rejoin = $state(false);
  let name = $state('');
  let ticker = $state('');
  let tickerTouched = $state(false);
  let color = $state('#4c6ef5');
  let avatar = $state<string | null>(null);
  let busy = $state(false);
  const COLORS = ['#4c6ef5', '#2f9e44', '#e8590c', '#ae3ec9', '#1098ad', '#c92a2a', '#5c940d', '#495057'];

  onMount(() => {
    rejoin = startRejoin;
    const load = async () => {
      try {
        info = await get<Info>('/api/join');
      } catch {
        /* offline: keep the last info, try again shortly */
      }
    };
    load();
    // The GM may open joins (or start the night) while this screen is up: keep it current.
    const h = setInterval(load, 4000);
    return () => clearInterval(h);
  });
  $effect(() => {
    if (!tickerTouched) ticker = name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
  });

  async function pickPhoto(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      avatar = await prepareAvatar(f);
    } catch (err) {
      avatar = null;
      toast(t('phone.photo_failed'), 'error');
    }
  }
  async function submit(e: Event) {
    e.preventDefault();
    busy = true;
    const r = await run(() => post<{ deviceToken: string; pending: boolean }>('/api/join', { displayName: name, ticker, color, avatarData: avatar, phoneId: phoneId() }));
    busy = false;
    if (!r) return;
    if (r.pending) setPendingToken(r.deviceToken);
    else setDeviceToken(r.deviceToken);
    ondone();
  }
  async function requestRejoin(playerId: number) {
    const r = await run(() => post<{ deviceToken: string; approved: boolean }>('/api/join/rejoin', { playerId, phoneId: phoneId() }));
    if (r) {
      // Same phone the player joined on: straight back in. Otherwise wait for a GM.
      if (r.approved) setDeviceToken(r.deviceToken);
      else setPendingToken(r.deviceToken);
      ondone();
    }
  }
</script>

<div class="screen">
  {#if !info}
    <p class="muted">Connecting…</p>
  {:else if rejoin}
    <h1>{t('phone.rejoin_title')}</h1>
    <p class="muted small">{t('phone.rejoin_body')}</p>
    <div class="stack">
      {#each info.players as p (p.id)}
        <button class="big" onclick={() => requestRejoin(p.id)}>{p.displayName}</button>
      {/each}
      {#if !info.players.length}<p class="muted">Nobody to rejoin yet.</p>{/if}
    </div>
    <p><button onclick={() => (rejoin = false)}>Back</button></p>
  {:else if info.mode === 'closed'}
    <h1>{t('brand.company')}</h1>
    <p class="muted">{t('phone.closed')}</p>
    {#if info.players.length}<button onclick={() => (rejoin = true)}>{t('landing.rejoin')}</button>{/if}
  {:else}
    <h1>{info.mode === 'join' ? t('phone.join_title') : t('phone.join_late')}</h1>
    {#if info.nightName}<p class="muted small">{info.nightName}</p>{/if}
    <form onsubmit={submit}>
      <label class="field"><span>Display name</span><input bind:value={name} maxlength="24" required autocomplete="nickname" /></label>
      <label class="field"><span>Ticker (3–4 letters)</span><input bind:value={ticker} oninput={() => (tickerTouched = true)} maxlength="4" required class="mono" style="text-transform:uppercase" /></label>
      <div class="field">
        <span class="muted small">Colour</span>
        <div class="row">
          {#each COLORS as c}
            <button type="button" class="swatch" class:on={color === c} style="background:{c}" aria-label="colour {c}" onclick={() => (color = c)}></button>
          {/each}
        </div>
      </div>
      <label class="field"><span>Photo (optional)</span><input type="file" accept="image/*" onchange={pickPhoto} /></label>
      {#if avatar}<img src={avatar} alt="" width="64" height="64" style="border-radius:50%;object-fit:cover" />{/if}
      <button class="primary big" type="submit" disabled={busy || !name || ticker.length < 3}>{info.mode === 'join' ? 'Join' : 'Request to join'}</button>
    </form>
    {#if info.mode === 'late' && info.players.length}
      <p class="small"><button onclick={() => (rejoin = true)}>Already playing? {t('landing.rejoin')}</button></p>
    {/if}
  {/if}
</div>

<style>
  .screen {
    padding: 1.2rem;
  }
  input {
    width: 100%;
  }
  .swatch {
    width: 34px;
    height: 34px;
    min-height: 34px;
    border-radius: 50%;
    padding: 0;
    border: 2px solid transparent;
  }
  .swatch.on {
    border-color: var(--text);
  }
  form button[type='submit'] {
    width: 100%;
    margin-top: 0.5rem;
  }
  .stack button {
    width: 100%;
  }
</style>
