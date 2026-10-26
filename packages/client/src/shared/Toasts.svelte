<script lang="ts">
  import { toasts } from './ui';
</script>

<div class="toasts" aria-live="polite">
  {#each $toasts as t (t.id)}
    <div class="toast {t.kind}">{t.text}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: 76px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    z-index: 100;
    width: min(92vw, 420px);
  }
  .toast {
    background: var(--text);
    color: var(--bg);
    padding: 0.55rem 0.8rem;
    border-radius: var(--radius);
    font-size: 0.9rem;
  }
  .toast.error {
    background: var(--bad);
    color: #fff;
  }
</style>
