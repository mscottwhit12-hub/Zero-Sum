<script lang="ts">
  import { ApiError, api, del, patch, post } from '@shared/api';
  import { t } from '@shared/copy';
  import { run, toast } from '@shared/ui';
  import type { AudioSettings, GmState, RuleKey, SoundInfo, WhoAmI } from '@shared/types';

  let { gs, whoami }: { gs: GmState | null; whoami: WhoAmI } = $props();
  const master = $derived(whoami.role === 'master');
  const sounds = $derived(gs?.gm?.sounds ?? []);
  const music = $derived(gs?.gm?.music ?? null);
  const audio = $derived<AudioSettings | null>(gs?.gm?.audio ?? null);
  const tracks = $derived(sounds.filter((x) => x.kind === 'ambient'));
  const CUES = [
    ['final_round', 'Final round'],
    ['intermission', 'Intermission'],
    ['achievement', 'Achievement'],
    ['night_end', 'Night end'],
    ['collapse', 'Collapse'],
  ] as const;
  const RULES: RuleKey[] = ['setup', 'joins_open', 'live', 'final_round', 'paused', 'ended'];
  const cueFile = (c: string) => sounds.find((x) => x.kind === 'cue' && x.theme === c);

  // ---- music: pick tags (all of them must match), then play
  const allTags = $derived(
    [...tracks.flatMap((x) => x.tags).reduce((m, tag) => m.set(tag, (m.get(tag) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
  let picked = $state<string[]>([]);
  const matching = $derived(picked.length ? tracks.filter((x) => picked.every((p) => x.tags.includes(p))).length : 0);
  // A picked tag that no longer exists (its track was deleted) can't be un-picked, so drop it.
  $effect(() => {
    const have = new Set(allTags.map((x) => x[0]));
    if (picked.some((p) => !have.has(p))) picked = picked.filter((p) => have.has(p));
  });
  const toggle = (tag: string) => (picked = picked.includes(tag) ? picked.filter((x) => x !== tag) : [...picked, tag]);
  const music$ = (body: unknown) => run(() => post('/api/music', body));
  const status = $derived.by(() => {
    const m = music;
    if (!m) return '';
    if (m.mode === 'off') return t('gm.music.mode_off');
    if (m.mode === 'manual') return m.matching ? t('gm.music.mode_manual', { tag: m.tag ?? '' }) : t('gm.music.mode_manual_none', { tag: m.tag ?? '' });
    if (m.source === 'game') return t('gm.music.mode_auto_game', { tag: m.tag ?? '' });
    if (m.source === 'rule') return t('gm.music.mode_auto_rule', { tag: m.tag ?? '' });
    return t('gm.music.mode_auto_none');
  });

  // ---- audio settings (Master). A rejected value puts the old one back in the box.
  async function setAudio(e: Event, body: Record<string, unknown>, current: string | number) {
    const el = e.currentTarget as HTMLInputElement;
    const ok = await run(() => api('PUT', '/api/audio/settings', body));
    if (!ok) el.value = String(current);
  }
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  const saveTags = (e: Event, x: SoundInfo) => {
    const el = e.currentTarget as HTMLInputElement;
    return run(() => patch(`/api/sounds/${x.id}`, { tags: el.value }), t('gm.music.saved')).then((ok) => {
      if (!ok) el.value = x.tags.join(', ');
    });
  };

  // ---- upload
  let name = $state('');
  let kind = $state<'soundboard' | 'cue' | 'ambient'>('soundboard');
  let theme = $state('');
  let tagsText = $state('');
  let credit = $state('');
  let sourceUrl = $state('');
  let license = $state('');
  let file = $state<File | null>(null);
  /** Upload progress 0–1 while sending; null when idle. */
  let progress = $state<number | null>(null);
  /** Send with upload progress (fetch can't report it). Errors become ApiError like the rest of the app. */
  function sendWithProgress(url: string, body: string | File, contentType: string, onProgress: (f: number) => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', url);
      x.withCredentials = true;
      x.setRequestHeader('content-type', contentType);
      x.upload.onprogress = (ev) => ev.lengthComputable && onProgress(ev.loaded / ev.total);
      x.onload = () => {
        const data = (() => {
          try {
            return x.responseText ? JSON.parse(x.responseText) : {};
          } catch {
            return {};
          }
        })();
        if (x.status >= 200 && x.status < 300) resolve(data);
        else reject(new ApiError(x.status, data.error ?? 'error', data.message ?? data.error ?? x.statusText));
      };
      x.onerror = () => reject(new ApiError(0, 'network', 'Upload failed. Check the connection and try again.'));
      x.send(body);
    });
  }
  const MAX_MB = 30;
  /** Same limit as the server's PACK_MAX_MB. */
  const PACK_MAX_MB = 200;
  const MIME: Record<string, string> = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', flac: 'audio/flac' };
  async function upload(e: Event) {
    e.preventDefault();
    if (!file) return toast('Choose a sound file first.', 'error');
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    const mime = MIME[ext];
    if (!mime) return toast('Upload an MP3, OGG, WAV, M4A or FLAC file.', 'error');
    if (file.size > MAX_MB * 1024 * 1024) return toast(`That file is ${(file.size / 1048576).toFixed(1)} MB. Sound files must be under ${MAX_MB} MB.`, 'error');
    progress = 0;
    let data: string;
    try {
      data = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file!);
      });
    } catch {
      progress = null;
      return toast('Could not read that file. Try again or pick another.', 'error');
    }
    // Browsers report odd or empty types for some audio (FLAC especially): label it by its extension.
    data = `data:${mime};base64,${data.slice(data.indexOf(',') + 1)}`;
    const body = JSON.stringify({ name: name || file!.name.replace(/\.\w+$/, ''), kind, theme, tags: tagsText, credit, sourceUrl, license, data });
    const ok = await run(() => sendWithProgress('/api/sounds', body, 'application/json', (f) => (progress = f)), 'Uploaded');
    progress = null;
    if (ok) {
      name = theme = tagsText = credit = sourceUrl = license = '';
      file = null;
      (e.target as HTMLFormElement).reset();
    }
  }

  // ---- sound pack (a zip with manifest.json)
  let pack = $state<File | null>(null);
  let packProgress = $state<number | null>(null);
  async function importPack(e: Event) {
    e.preventDefault();
    if (!pack) return;
    if (!/\.zip$/i.test(pack.name)) return toast(t('gm.music.pack_not_zip'), 'error');
    if (pack.size > PACK_MAX_MB * 1024 * 1024) return toast(t('gm.music.pack_too_big', { mb: (pack.size / 1048576).toFixed(0), max: PACK_MAX_MB }), 'error');
    packProgress = 0;
    const r = await run(() => sendWithProgress('/api/sounds/pack', pack!, 'application/zip', (f) => (packProgress = f)));
    packProgress = null;
    if (r) {
      const x = r as { added: number; skipped: string[] };
      toast(t('gm.music.pack_done', { added: x.added, skipped: x.skipped.length }));
      pack = null;
      (e.target as HTMLFormElement).reset();
    }
  }

  const play = (body: unknown) => run(() => post('/api/sounds/play', body));
  const credited = $derived(sounds.filter((x) => x.credit));
</script>

<section class="panel">
  <h2>{t('gm.music.title')}</h2>
  <p class="small muted">{t('gm.music.tv_note')}{master ? '' : ` ${t('gm.music.master_only')}`}</p>
  <div class="np" role="status" aria-live="polite">
    <b>{t('gm.music.now_playing')}:</b>
    {#if music?.now}
      {music.now.name} <span class="muted small">{music.now.tags.join(' · ')}</span>
    {:else}
      <span class="muted">{t('gm.music.nothing')}</span>
    {/if}
  </div>
  <p class="small">{status}</p>
  <div class="row">
    <button class="big" class:on={music?.mode === 'auto'} aria-pressed={music?.mode === 'auto'} disabled={!master} onclick={() => music$({ mode: 'auto' })}>{t('gm.music.auto')}</button>
    <button class="big" disabled={!master || !music?.matching} onclick={() => music$({ skip: true })}>{t('gm.music.skip')}</button>
    <button class="big" class:on={music?.repeat} aria-pressed={!!music?.repeat} disabled={!master} onclick={() => music$({ repeat: !music?.repeat })}>{t('gm.music.repeat')}</button>
    <button class="big" class:on={music?.mode === 'off'} aria-pressed={music?.mode === 'off'} disabled={!master} onclick={() => music$({ mode: 'off' })}>{t('gm.music.stop')}</button>
  </div>
  {#if music && music.mode !== 'off' && music.matching > 0 && !music.now}
    <p class="small muted">{t('gm.music.waiting_tv')}</p>
  {/if}
  {#if audio}
    {#if audio.volume === 0}<p class="small" style="color:var(--warn)" role="alert">{t('gm.music.volume_zero')}</p>{/if}
    <label class="field"><span>{t('gm.music.volume')}: {audio.volume}%</span>
      <input type="range" min="0" max="100" step="5" value={audio.volume} disabled={!master} onchange={(e) => setAudio(e, { volume: num(e) }, audio.volume)} />
    </label>
  {/if}

  <h3 class="small muted">{t('gm.music.tags_title')}</h3>
  <p class="small muted">{t('gm.music.tags_hint')}</p>
  <div class="row" role="group" aria-label={t('gm.music.tags_title')}>
    {#each allTags as [tag, n] (tag)}
      <button class="chip" class:on={picked.includes(tag)} aria-pressed={picked.includes(tag)} disabled={!master} onclick={() => toggle(tag)}>{tag} <span class="muted small">{n}</span></button>
    {:else}
      <span class="muted small">{t('gm.music.tags_none')}</span>
    {/each}
  </div>
  {#if allTags.length}
    <div class="row small">
      <span aria-live="polite">{matching === 1 ? t('gm.music.matching_one') : t('gm.music.matching', { n: matching })}</span>
      <button class="primary" disabled={!master || !matching} onclick={() => music$({ mode: 'manual', tags: picked })}>{t('gm.music.play_tags')}</button>
    </div>
  {/if}
</section>

<section class="panel">
  <h2>Soundboard</h2>
  <p class="small muted">Plays on the TV. The TV needs “Enable audio” clicked once. Cues without an uploaded file play a placeholder tone. Music dips while these play.</p>
  <h3 class="small muted">Cues</h3>
  <div class="row">
    {#each CUES as [id, label] (id)}<button class="big" onclick={() => play({ cue: id })}>{label}{cueFile(id) ? '' : ' (tone)'}</button>{/each}
  </div>
  <h3 class="small muted">Board</h3>
  <div class="row">
    {#each sounds.filter((x) => x.kind === 'soundboard') as x (x.id)}<button class="big" onclick={() => play({ soundId: x.id })}>{x.name}</button>{:else}<span class="muted small">Upload sounds below.</span>{/each}
  </div>
</section>

{#if master}
  <form class="panel" onsubmit={upload}>
    <h2>Upload a sound</h2>
    <p class="small muted">Local files only (MP3, OGG, WAV, M4A, FLAC; up to 30 MB). Stored on this server.</p>
    <div class="grid2">
      <label class="field"><span>File</span><input type="file" accept="audio/*" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} required /></label>
      <label class="field"><span>Name</span><input bind:value={name} maxlength="60" /></label>
      <label class="field"><span>Kind</span>
        <select bind:value={kind}>
          <option value="soundboard">Soundboard button</option>
          <option value="cue">Cue</option>
          <option value="ambient">{t('gm.music.kind_music')}</option>
        </select>
      </label>
      {#if kind === 'cue'}
        <label class="field"><span>Cue</span>
          <select bind:value={theme} required>
            <option value="">—</option>
            {#each CUES as [id, label] (id)}<option value={id}>{label}</option>{/each}
          </select>
        </label>
      {:else}
        <label class="field"><span>{t('gm.music.tags_label')}</span><input bind:value={tagsText} required={kind === 'ambient'} placeholder="ambient, soundscape" /></label>
      {/if}
      <label class="field"><span>{t('gm.music.credit_label')}</span><input bind:value={credit} maxlength="300" /></label>
      <label class="field"><span>{t('gm.music.source_label')}</span><input bind:value={sourceUrl} maxlength="300" placeholder="https://" /></label>
      <label class="field"><span>{t('gm.music.license_label')}</span><input bind:value={license} maxlength="120" /></label>
    </div>
    {#if kind === 'ambient'}<p class="small muted">{t('gm.music.tags_upload_hint')}</p>{/if}
    {#if progress !== null}
      <div class="upbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
        <i style="width:{Math.round(progress * 100)}%"></i>
      </div>
      <p class="small muted">{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : 'Saving on the server…'}</p>
    {/if}
    <div class="actions"><button class="primary" type="submit" disabled={!file || progress !== null}>Upload</button></div>
  </form>

  <form class="panel" onsubmit={importPack}>
    <h2>{t('gm.music.pack_title')}</h2>
    <p class="small muted">{t('gm.music.pack_hint')}</p>
    <label class="field"><span>Pack (.zip)</span><input type="file" accept=".zip,application/zip" onchange={(e) => (pack = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} required /></label>
    {#if packProgress !== null}
      <div class="upbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(packProgress * 100)}>
        <i style="width:{Math.round(packProgress * 100)}%"></i>
      </div>
      <p class="small muted">{packProgress < 1 ? `Uploading… ${Math.round(packProgress * 100)}%` : 'Importing on the server…'}</p>
    {/if}
    <div class="actions"><button class="primary" type="submit" disabled={!pack || packProgress !== null}>{t('gm.music.pack_button')}</button></div>
  </form>

  {#if audio}
    <section class="panel">
      <h2>{t('gm.music.settings_title')}</h2>
      <div class="grid2">
        <label class="field"><span>{t('gm.music.crossfade')}</span><input type="number" min="0" max="15" step="0.5" value={audio.crossfadeSeconds} onchange={(e) => setAudio(e, { crossfadeSeconds: num(e) }, audio.crossfadeSeconds)} /></label>
        <label class="field"><span>{t('gm.music.duck')}</span><input type="number" min="0" max="100" step="5" value={audio.duckPercent} onchange={(e) => setAudio(e, { duckPercent: num(e) }, audio.duckPercent)} /></label>
        <label class="field"><span>{t('gm.music.duck_release')}</span><input type="number" min="0" max="10" step="0.5" value={audio.duckReleaseSeconds} onchange={(e) => setAudio(e, { duckReleaseSeconds: num(e) }, audio.duckReleaseSeconds)} /></label>
      </div>
      <h3 class="small muted">{t('gm.music.rules_title')}</h3>
      <p class="small muted">{t('gm.music.rules_hint')}</p>
      <div class="grid2">
        {#each RULES as k (k)}
          <label class="field"><span>{t(`gm.music.rule_${k}`)}</span><input value={audio.rules[k]} maxlength="24" onchange={(e) => setAudio(e, { rules: { [k]: (e.currentTarget as HTMLInputElement).value } }, audio.rules[k])} /></label>
        {/each}
      </div>
    </section>
  {/if}

  <section class="panel">
    <h2>Library</h2>
    {#each sounds as x (x.id)}
      <div class="spread line">
        <span>{x.name} <span class="muted small">{x.kind === 'ambient' ? t('gm.music.kind_music') : x.kind}{x.kind === 'cue' && x.theme ? ` · ${x.theme}` : ''}</span></span>
        <span class="row">
          {#if x.kind !== 'cue'}
            <input class="tagsin" aria-label={t('gm.music.tags_label')} value={x.tags.join(', ')} onchange={(e) => saveTags(e, x)} />
          {/if}
          <audio controls preload="none" src={x.url}></audio>
          <button class="danger" onclick={() => confirm(`Delete ${x.name}?${music?.now?.id === x.id ? ' It is playing now.' : ''}`) && run(() => del(`/api/sounds/${x.id}`))}>Delete</button>
        </span>
      </div>
    {:else}
      <p class="muted">No sounds uploaded.</p>
    {/each}
  </section>
{/if}

<section class="panel">
  <h2>{t('gm.music.credits_title')}</h2>
  {#each credited as x (x.id)}
    <p class="small">
      <b>{x.name}</b>:<br /><span class="cr">{x.credit}</span>
      {#if x.license}<span class="muted"> · {x.license}</span>{/if}
      {#if x.sourceUrl}<a href={x.sourceUrl} target="_blank" rel="noreferrer noopener"> {x.sourceUrl}</a>{/if}
    </p>
  {:else}
    <p class="muted small">{t('gm.music.credits_empty')}</p>
  {/each}
</section>

<style>
  .upbar { height: 8px; border-radius: 4px; background: var(--line); overflow: hidden; margin-top: 0.5rem; }
  .upbar i { display: block; height: 100%; background: var(--accent); transition: width 0.15s; }
  .np { margin: 0.4rem 0; font-size: 1.05rem; }
  button.big.on { box-shadow: inset 0 0 0 2px var(--accent); }
  /* the track count inside a picked tag chip must stay readable on the accent colour */
  button.chip.on :global(.muted) { color: inherit; opacity: 0.85; }
  .tagsin { width: 14rem; max-width: 100%; }
  .cr { white-space: pre-line; }
</style>
