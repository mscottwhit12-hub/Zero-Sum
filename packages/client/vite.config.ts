import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// One build, several entries (spec §24). All assets are bundled: no internet at runtime.
export default defineConfig({
  plugins: [svelte()],
  resolve: { alias: { '@copy': r('../../copy'), '@shared': r('./src/shared') } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: { index: r('index.html'), gm: r('gm.html'), display: r('display.html'), play: r('play.html') },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080', '/socket.io': { target: 'http://localhost:8080', ws: true } },
  },
});
