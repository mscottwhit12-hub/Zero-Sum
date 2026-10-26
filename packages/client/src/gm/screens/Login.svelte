<script lang="ts">
  import { post } from '@shared/api';
  import { run } from '@shared/ui';
  import { t } from '@shared/copy';
  let { ondone }: { ondone: () => void } = $props();
  let name = $state('');
  let password = $state('');
  // Device type is always asked, never detected (spec §16).
  let deviceType = $state<'phone' | 'laptop' | ''>('');
  let error = $state('');

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (!deviceType) return (error = 'Phone or laptop?');
    const r = await run(() => post('/api/gm/login', { name, password, deviceType }));
    if (r) ondone();
  }
</script>

<main class="narrow">
  <h1>{t('brand.gm')}</h1>
  <form class="panel" onsubmit={submit}>
    <label class="field"><span>GM name</span><input bind:value={name} autocomplete="username" required /></label>
    <label class="field"><span>Password</span><input type="password" bind:value={password} autocomplete="current-password" required /></label>
    <div class="field">
      <span class="muted small">Phone or laptop?</span>
      <div class="row">
        <button type="button" class="chip big" class:on={deviceType === 'phone'} onclick={() => (deviceType = 'phone')}>Phone</button>
        <button type="button" class="chip big" class:on={deviceType === 'laptop'} onclick={() => (deviceType = 'laptop')}>Laptop</button>
      </div>
    </div>
    {#if error}<p class="error">{error}</p>{/if}
    <button class="primary big" type="submit">Sign in</button>
  </form>
</main>

<style>
  .narrow {
    max-width: 420px;
    margin: 2rem auto;
    padding: 0 1rem;
  }
  input {
    width: 100%;
  }
</style>
