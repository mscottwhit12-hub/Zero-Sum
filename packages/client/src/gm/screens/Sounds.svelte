<script lang="ts">
  import { del, post } from '@shared/api';
  import { run } from '@shared/ui';
  import type { GmState, WhoAmI } from '@shared/types';

  let { gs, whoami }: { gs: GmState | null; whoami: WhoAmI } = $props();
  const master = $derived(whoami.role === 'master');
  const sounds = $derived(gs?.gm?.sounds ?? []);
  const CUES = [
    ['final_round', 'Final round'],
    ['intermission', 'Intermission'],
    ['achievement', 'Achievement'],
    ['night_end', 'Night end'],
    ['collapse', 'Collapse'],
  ] as const;
  const cueFile = (c: string) => sounds.find((x) => x.kind === 'cue' && x.theme === c);

  let name = $state('');
  let kind = $state<'soundboard' | 'cue' | 'ambient'>('soundboard');
  let theme = $state('');
  let file = $state<File | null>(null);
  async function upload(e: Event) {
    e.preventDefault();
    if (!file) return;
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file!);
    });
    const ok = await run(() => post('/api/sounds', { name: name || file!.name.replace(/\.\w+$/, ''), kind, theme, data }), 'Uploaded');
    if (ok) {
      name = '';
      theme = '';
      file = null;
      (e.target as HTMLFormElement).reset();
    }
  }
  const play = (body: unknown) => run(() => post('/api/sounds/play', body));
</script>

<section class="panel">
  <h2>Soundboard</h2>
  <p class="small muted">Plays on the TV. The TV needs “Enable audio” clicked once. Cues without an uploaded file play a placeholder tone.</p>
  <h3 class="small muted">Cues</h3>
  <div class="row">
    {#each CUES as [id, label] (id)}<button class="big" onclick={() => play({ cue: id })}>{label}{cueFile(id) ? '' : ' (tone)'}</button>{/each}
  </div>
  <h3 class="small muted">Board</h3>
  <div class="row">
    {#each sounds.filter((x) => x.kind === 'soundboard') as x (x.id)}<button class="big" onclick={() => play({ soundId: x.id })}>{x.name}</button>{:else}<span class="muted small">Upload sounds below.</span>{/each}
  </div>
  <h3 class="small muted">Ambient</h3>
  <div class="row small">
    <span>{gs?.gm?.ambient.off ? 'Off for tonight' : gs?.gm?.ambient.current ? `Playing: ${gs.gm.ambient.current.theme}` : 'Nothing playing (needs an active game whose library sound theme has an ambient file)'}</span>
    <button onclick={() => play({ ambient: gs?.gm?.ambient.off ? 'on' : 'off' })}>{gs?.gm?.ambient.off ? 'Turn ambient on' : 'Turn ambient off'}</button>
  </div>
</section>

{#if master}
  <form class="panel" onsubmit={upload}>
    <h2>Upload a sound</h2>
    <p class="small muted">Local files only (MP3, OGG, WAV, M4A; up to 8 MB). Stored on this server.</p>
    <div class="grid2">
      <label class="field"><span>File</span><input type="file" accept="audio/*" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} required /></label>
      <label class="field"><span>Name</span><input bind:value={name} maxlength="60" /></label>
      <label class="field"><span>Kind</span>
        <select bind:value={kind}>
          <option value="soundboard">Soundboard button</option>
          <option value="cue">Cue</option>
          <option value="ambient">Ambient loop</option>
        </select>
      </label>
      {#if kind === 'cue'}
        <label class="field"><span>Cue</span>
          <select bind:value={theme} required>
            <option value="">—</option>
            {#each CUES as [id, label] (id)}<option value={id}>{label}</option>{/each}
          </select>
        </label>
      {:else if kind === 'ambient'}
        <label class="field"><span>Theme (matches a library game's sound theme)</span><input bind:value={theme} required maxlength="40" /></label>
      {/if}
    </div>
    <div class="actions"><button class="primary" type="submit" disabled={!file}>Upload</button></div>
  </form>

  <section class="panel">
    <h2>Library</h2>
    {#each sounds as x (x.id)}
      <div class="spread line">
        <span>{x.name} <span class="muted small">{x.kind}{x.theme ? ` · ${x.theme}` : ''}</span></span>
        <span class="row"><audio controls preload="none" src={x.url}></audio><button class="danger" onclick={() => confirm(`Delete ${x.name}?`) && run(() => del(`/api/sounds/${x.id}`))}>Delete</button></span>
      </div>
    {:else}
      <p class="muted">No sounds uploaded.</p>
    {/each}
  </section>
{/if}
