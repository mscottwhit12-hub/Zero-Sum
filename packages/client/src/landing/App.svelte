<script lang="ts">
  import { t } from '@shared/copy';
</script>

<main>
  <h1>{t('landing.title')}</h1>
  <p class="muted">{t('brand.tagline')}</p>
  <nav class="stack">
    <a class="btn big" href="/play">{t('landing.player')}</a>
    <a class="btn big" href="/play#rejoin">{t('landing.rejoin')}</a>
    <a class="btn big" href="/display">{t('landing.tv')}</a>
    <a class="btn big" href="/gm">{t('landing.gm')}</a>
    <a class="btn big" href="/gm">{t('landing.sub')}</a>
  </nav>
</main>

<style>
  main {
    max-width: 380px;
    margin: 3rem auto;
    padding: 0 1rem;
  }
  nav a {
    display: block;
    text-align: center;
    text-decoration: none;
    padding: 0.8rem;
  }
</style>
