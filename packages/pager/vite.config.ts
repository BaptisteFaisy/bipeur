import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const r = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Base path of the build. `/` when the Central serves the pager itself (one
 * process, one URL — BIP-N-09), `/bipeur/` for GitHub Pages, which serves every
 * repository under its own prefix. Everything absolute in the app is derived
 * from it, so the same source deploys to both.
 */
const BASE = process.env.PAGER_BASE ?? '/';
const withBase = (path: string): string => `${BASE.replace(/\/$/, '')}${path}`;

/** Where the pager finds its Central. Empty means "same origin". */
const CENTRAL_URL = process.env.PAGER_CENTRAL_URL ?? '';

/**
 * The pager is a static PWA: no server, no account, everything stays in the
 * browser except the pages themselves. In production the Central serves
 * `packages/pager/dist` so a deployment is one process and one file (BIP-N-09).
 */
export default defineConfig({
  base: BASE,
  define: {
    // Read at runtime first (see src/api/central-url.ts); this is the build-time
    // default baked into the bundle for deployments with no query parameter.
    __CENTRAL_URL__: JSON.stringify(CENTRAL_URL),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      // The generated worker and the notification layer live under the base.
      registerType: 'autoUpdate',
      manifest: {
        name: 'Beeper — pager for agents',
        short_name: 'Beeper',
        description: 'One line, one code, one tap: approve or refuse what your agents are about to do.',
        theme_color: '#12100e',
        background_color: '#12100e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/v1\//],
        // BIP-F-19: the notification layer (push, action buttons).
        importScripts: [withBase('/sw-notify.js')],
      },
    }),
  ],
  resolve: {
    alias: [
      { find: '@bipeur/core/node', replacement: r('../core/src/node.ts') },
      { find: '@bipeur/core', replacement: r('../core/src/index.ts') },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': { target: 'http://127.0.0.1:8787', ws: true },
      '/healthz': { target: 'http://127.0.0.1:8787' },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
