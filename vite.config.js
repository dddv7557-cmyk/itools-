import { defineConfig } from 'vite-plus';
import react from '@vitejs/plugin-react';
import { serviceWorkerPlugin } from './scripts/sw-plugin.mjs';

// base: './' — относительные пути, чтобы сборка работала и в корне домена,
// и в подпапке (например, https://<user>.github.io/itools/).
export default defineConfig({
  base: './',
  plugins: [react(), serviceWorkerPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
});
