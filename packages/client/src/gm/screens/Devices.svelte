<script lang="ts">
  import { onMount } from 'svelte';
  import { del, get, post } from '@shared/api';
  import { run } from '@shared/ui';
  import type { WhoAmI } from '@shared/types';
  let { whoami, onlogout, ondevice }: { whoami: WhoAmI; onlogout: () => void; ondevice: (d: 'phone' | 'laptop') => void } = $props();

  type Session = { id: number; deviceType: string; paused: boolean; lastSeen: number; current: boolean };
  type Gm = { id: number; name: string; role: string; active: number };
  let sessions = $state<Session[]>([]);
  let gms = $state<Gm[]>([]);
  const load = async () => {
    const s = await run(() => get<{ sessions: Session[] }>('/api/gm/sessions'));
    if (s) sessions = s.sessions;
    const g = await run(() => get<{ gms: Gm[] }>('/api/gm/gms'));
    if (g) gms = g.gms;
  };
  onMount(load);

  const setPaused = async (id: number, paused: boolean) => {
    if (await run(() => post(`/api/gm/sessions/${id}/${paused ? 'pause' : 'resume'}`), paused ? 'Device paused' : 'Device resumed')) load();
  };
  const setType = async (d: 'phone' | 'laptop') => {
    if (await run(() => post('/api/gm/device-type', { deviceType: d }))) ondevice(d);
  };
  let subName = $state('');
  let subPass = $state('');
  let subPin = $state('');
  async function addSub(e: Event) {
    e.preventDefault();
    if (await run(() => post('/api/gm/gms', { name: subName, password: subPass, pin: subPin }), 'Sub GM created')) {
      subName = subPass = subPin = '';
      load();
    }
  }
</script>

<section class="panel">
  <h2>This device</h2>
  <div class="row">
    <span class="muted">Layout:</span>
    <button class="chip" class:on={whoami.deviceType === 'phone'} onclick={() => setType('phone')}>Phone</button>
    <button class="chip" class:on={whoami.deviceType === 'laptop'} onclick={() => setType('laptop')}>Laptop</button>
    <button class="danger" onclick={async () => (await run(() => post('/api/gm/logout'))) && onlogout()}>Sign out</button>
  </div>
</section>

<section class="panel">
  <h2>My signed-in devices</h2>
  <p class="small muted">Pause a device (e.g. the laptop) from here. A paused device shows standings only until resumed or unlocked with your PIN.</p>
  <table>
    <tbody>
      {#each sessions as s (s.id)}
        <tr>
          <td>{s.deviceType}{s.current ? ' (this one)' : ''}</td>
          <td class="small muted">last seen {new Date(s.lastSeen).toLocaleTimeString()}</td>
          <td>{#if s.paused}<span class="badge warn">paused</span>{/if}</td>
          <td class="actions">
            {#if !s.current}
              {#if s.paused}<button class="primary" onclick={() => setPaused(s.id, false)}>Resume device</button>
              {:else}<button onclick={() => setPaused(s.id, true)}>Pause device</button>{/if}
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

{#if whoami.role === 'master'}
  <section class="panel">
    <h2>GMs</h2>
    <table>
      <tbody>
        {#each gms as g (g.id)}
          <tr class:muted={!g.active}>
            <td>{g.name}</td>
            <td class="small">{g.role === 'master' ? 'Master' : 'Sub GM'}{g.active ? '' : ' (removed)'}</td>
            <td class="actions">{#if g.role === 'sub' && g.active}<button class="danger" onclick={async () => confirm(`Remove ${g.name}?`) && (await run(() => del(`/api/gm/gms/${g.id}`), 'Removed')) && load()}>Remove</button>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <form class="row" onsubmit={addSub} style="margin-top:.6rem">
      <label><span>Name</span><input bind:value={subName} required /></label>
      <label><span>Password (8+)</span><input type="password" bind:value={subPass} required autocomplete="new-password" /></label>
      <label><span>PIN</span><input inputmode="numeric" bind:value={subPin} required /></label>
      <button class="primary" type="submit">Add Sub GM</button>
    </form>
  </section>
{/if}
