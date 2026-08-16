import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/

// A set VITE_API_BASE signals a native (Capacitor) build: the WebView
// points at the deployed Vercel app for /api/*, and the PWA service
// worker is disabled (it would intercept/break API fetches inside the WebView).
const IS_NATIVE = !!process.env.VITE_API_BASE;

export default defineConfig({
  // Base API URL for the serverless proxy (Vercel /api/* functions).
  // In the native (Capacitor) build this points at the deployed Vercel app so
  // the WebView can reach the same proxy that the web app uses in production.
  // Empty in dev → the Vite dev proxy (/api/*) is used instead.
  define: {
    'import.meta.env.VITE_API_BASE': JSON.stringify(process.env.VITE_API_BASE || ''),
  },
  plugins: [
    react(),
    VitePWA({
      // Disable the service worker entirely for native builds — it must not
      // register inside the Capacitor WebView (would intercept /api/* fetches).
      disable: IS_NATIVE,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'logo.png'],
      manifest: {
        name: 'TerraGuard - Earthquake Monitoring',
        short_name: 'TerraGuard',
        description: 'Real-time earthquake monitoring and alerts for the Philippines',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        categories: ['weather', 'utilities', 'news'],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/earthquake\.phivolcs\.dost\.gov\.ph\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'phivolcs-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 30, // 30 minutes
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  server: {
    proxy: {
      '/api/phivolcs': {
        target: 'https://earthquake.phivolcs.dost.gov.ph',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/phivolcs/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      },
      '/api/news': {
        target: 'https://news.google.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => {
          const isGlobal = /[?&]global=1\b/.test(path);
          const q = isGlobal ? 'earthquake' : 'earthquake location:Philippines';
          return `/rss/search?q=${encodeURIComponent(q)}&hl=en-PH&gl=PH&ceid=PH:en`;
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }
    }
  }
})
