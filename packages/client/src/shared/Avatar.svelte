<script lang="ts">
  let { name, color = null, src = null, size = 36 }: { name: string; color?: string | null; src?: string | null; size?: number } = $props();
  const initials = $derived(name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase());
</script>

{#if src}
  <img {src} alt="" width={size} height={size} style="border-radius:50%;object-fit:cover" />
{:else}
  <span class="av" style="width:{size}px;height:{size}px;background:{color ?? 'var(--muted)'};font-size:{size * 0.4}px">{initials}</span>
{/if}

<style>
  .av {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: #fff;
    font-weight: 600;
  }
</style>
