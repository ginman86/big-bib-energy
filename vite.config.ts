import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; CI sets BASE_PATH. Local dev stays at /.
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5173 },
});
