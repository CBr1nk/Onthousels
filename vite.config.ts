import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const paper = '#eceeea'
const year = 60 * 60 * 24 * 365
// GitHub Pages serves the app from a subpath, not the domain root.
const base = '/Onthousels/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // Ask before swapping in a new version, so it never reloads mid-sentence.
      registerType: 'prompt',
      // The icons are already precached by globPatterns below.
      includeManifestIcons: false,
      manifest: {
        name: 'Onthousels',
        short_name: 'Onthousels',
        description: 'A quiet notes app: notes on tracing paper over a drafting grid.',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: paper,
        background_color: paper,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The whole app shell, including the lazily loaded editor, so it opens offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: `${base}index.html`,
        // Notes data never goes through the service worker; the app keeps its own copy.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: year },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
