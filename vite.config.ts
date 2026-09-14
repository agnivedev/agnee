import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Frontend build. Source lives in web/, output goes to dist/ which Fastify
// serves ahead of the legacy public/ directory (see src/server.js).
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'web/src') },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Dev server proxies the API to the Fastify app so cookies and SSE behave
    // exactly as they do in production.
    proxy: {
      '/v1': { target: 'http://localhost:4100', changeOrigin: true },
      '/health': { target: 'http://localhost:4100' },
      '/brand': { target: 'http://localhost:4100' },
    },
  },
});
