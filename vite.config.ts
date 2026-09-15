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
    // NOT 'assets': public/assets/ already holds the landing page images, and
    // serving the bundles there shadows them (they 404).
    assetsDir: 'app',
    rollupOptions: {
      output: {
        // Dependencies change only when we upgrade them, while app code
        // changes every deploy. Keeping them apart means a deploy does not
        // re-download the framework someone already has cached.
        //
        // Matched by path, not by package name: the app imports
        // 'react-dom/client', and a bare 'react-dom' entry does not catch
        // that — react-dom then lands in the app chunk, which is most of its
        // weight.
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
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
