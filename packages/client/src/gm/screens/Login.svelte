<script lang="ts">
  import { post } from '@shared/api';
  import { run } from '@shared/ui';
  import { t } from '@shared/copy';
  import { detectDeviceType } from '../lib';
  let { ondone }: { ondone: () => void } = $props();
  let name = $state('');
  let password = $state('');
  let error = $state('');

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    // A name and a password: nothing else is asked or checked. The screen layout is detected, not chosen.
    const r = await run(() => post('/api/gm/login', { name, password, deviceType: detectDeviceType() }));
    if (r) ondone();
  }
</script>

<main class="narrow">
  <h1>{t('brand.gm')}</h1>
  <form class="panel" onsubmit={submit}>
    <label class="field"><span>GM name</span><input bind:value={name} autocomplete="username" required /></label>
    <label class="field"><span>Password</span><input type="password" bind:value={password} autocomplete="current-password" required /></label>
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
