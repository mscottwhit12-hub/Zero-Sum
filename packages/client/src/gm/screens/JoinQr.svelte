<script lang="ts">
  /** Printable join sheet (spec §17.3 night controls): QR → the player join page on this server. */
  import QRCode from 'qrcode';
  import { t } from '@shared/copy';
  import type { GmState } from '@shared/types';

  let { gs }: { gs: GmState | null } = $props();
  // GMs often open the console via localhost; let them type the LAN address players will use.
  let url = $state(`${location.protocol}//${location.host}/`);
  let svg = $state('');
  $effect(() => {
    const u = url;
    QRCode.toString(u, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((x) => (svg = x))
      .catch(() => (svg = ''));
  });
  const local = $derived(/\/\/(localhost|127\.)/.test(url));
</script>

<section class="panel noprint">
  <h2>Join QR</h2>
  <label class="field"><span>Address players will open (your server's LAN address)</span><input bind:value={url} /></label>
  {#if local}<p class="small error">“localhost” only works on this machine. Use the server's LAN IP, e.g. http://192.168.1.20:8080/</p>{/if}
  <div class="actions"><button class="primary" onclick={() => print()}>Print</button></div>
</section>

<div class="sheet">
  <h1>{t('brand.company')}</h1>
  <p>{gs?.night?.name ?? ''}</p>
  <div class="qr">{@html svg}</div>
  <p class="mono url">{url}</p>
  <p class="small">{t('landing.player')} — scan with your phone camera. Same Wi-Fi as the host.</p>
</div>

<style>
  .sheet {
    text-align: center;
    padding: 1rem;
  }
  .qr {
    width: min(70vw, 360px);
    margin: 1rem auto;
    background: #fff;
    padding: 8px;
  }
  .qr :global(svg) {
    width: 100%;
    height: auto;
    display: block;
  }
  .url {
    font-size: 1.2rem;
  }
  @media print {
    :global(.side),
    :global(.top),
    :global(.bottom),
    .noprint {
      display: none !important;
    }
    :global(body) {
      background: #fff !important;
      color: #000 !important;
    }
  }
</style>
