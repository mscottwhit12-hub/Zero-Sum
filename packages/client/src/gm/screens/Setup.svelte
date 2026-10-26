<script lang="ts">
  import { post } from '@shared/api';
  import { run } from '@shared/ui';
  let { ondone }: { ondone: () => void } = $props();
  let name = $state('');
  let password = $state('');
  let confirm = $state('');
  let pin = $state('');
  let deviceType = $state<'phone' | 'laptop' | ''>('');
  let error = $state('');

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (password !== confirm) return (error = 'Passwords do not match.');
    if (!deviceType) return (error = 'Choose phone or laptop.');
    const r = await run(() => post('/api/setup', { name, password, pin, deviceType }));
    if (r) ondone();
  }
</script>

<main class="narrow">
  <h1>First-run setup</h1>
  <p class="muted">Create the Master GM. There are no default credentials.</p>
  <form class="panel" onsubmit={submit}>
    <label class="field"><span>GM name</span><input bind:value={name} autocomplete="username" required /></label>
    <label class="field"><span>Password (8+ characters)</span><input type="password" bind:value={password} autocomplete="new-password" required /></label>
    <label class="field"><span>Confirm password</span><input type="password" bind:value={confirm} autocomplete="new-password" required /></label>
    <label class="field"><span>Unlock PIN (4–8 digits)</span><input inputmode="numeric" bind:value={pin} required /></label>
    <div class="field">
      <span class="muted small">This device is a…</span>
      <div class="row">
        <button type="button" class="chip" class:on={deviceType === 'phone'} onclick={() => (deviceType = 'phone')}>Phone</button>
        <button type="button" class="chip" class:on={deviceType === 'laptop'} onclick={() => (deviceType = 'laptop')}>Laptop</button>
      </div>
    </div>
    {#if error}<p class="error">{error}</p>{/if}
    <button class="primary big" type="submit">Create Master GM</button>
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
