import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; CI sets BASE_PATH. Local dev stays at /.
  base: process.env.BASE_PATH ?? '/',
  server: {
    port: 5173,
    // The Go API (api/cmd/local) serves /api on :8787, mirroring CloudFront's /api/* routing.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
