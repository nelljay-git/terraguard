import { defineConfig } from 'vite'
import type { ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Dev-only middleware: serve HTML responses with an explicit UTF-8 charset.
// Vite serves text/html without a charset parameter in this setup; the
// <meta charset="utf-8"> in index.html is the spec's fallback, but an explicit
// Content-Type parameter is stricter and survives proxies that strip meta.
function strictCharsetDev() {
  return {
    name: 'strict-charset',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((_req, res, next) => {
        const forceHtmlCharset = (value: unknown) =>
          typeof value === 'string' && /text\/html/i.test(value) && !/charset/i.test(value)
            ? `${value}; charset=utf-8`
            : value;

        const origSetHeader = res.setHeader.bind(res);
        res.setHeader = ((name: string, value: any) => {
          if (/^content-type$/i.test(name)) {
            return origSetHeader(name, forceHtmlCharset(value) as any);
          }
          return origSetHeader(name, value);
        }) as any;

        const origWriteHead = res.writeHead.bind(res);
        res.writeHead = ((...args: any[]) => {
          const headers = args[1];
          if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
            for (const key of Object.keys(headers)) {
              if (key.toLowerCase() === 'content-type') {
                (headers as any)[key] = forceHtmlCharset(headers[key]);
              }
            }
          }
          return (origWriteHead as any)(...args);
        }) as any;

        next();
      });
    },
  };
}

// Dev-only middleware that mirrors functions/api/tile.ts so map tiles load
// (and are CORS-clean for canvas captureStream) during `npm run dev`.
function tileDevProxy() {
  return {
    name: 'tile-dev-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/tile', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.end();
          return;
        }
        const url = new URL(req.url || '', 'http://localhost');
        const src = url.searchParams.get('src') || '';
        if (!/^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+$/.test(src)) {
          res.statusCode = 403;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end('Forbidden host');
          return;
        }
        try {
          const r = await fetch(src, { headers: { 'User-Agent': 'TerraGuard-TileProxy/1.0' } });
          if (!r.ok) {
            res.statusCode = 502;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end('Upstream error');
            return;
          }
          const buf = Buffer.from(await r.arrayBuffer());
          res.statusCode = 200;
          res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.end(buf);
        } catch {
          res.statusCode = 502;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end('Fetch failed');
        }
      });
    },
  };
}

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
    'import.meta.env.VITE_PHP_API_BASE': JSON.stringify(process.env.VITE_PHP_API_BASE || ''),
    'import.meta.env.VITE_PHP_API_BASE_BACKUP': JSON.stringify(process.env.VITE_PHP_API_BASE_BACKUP || ''),
  },
  plugins: [
    tileDevProxy(),
    strictCharsetDev(),
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
        // Don't let the SPA app-shell fallback intercept non-app files. Without
        // this, a navigation to /ads.txt or /robots.txt is served index.html by
        // the service worker instead of the real static file.
        navigateFallbackDenylist: [/^\/ads\.txt$/, /^\/robots\.txt$/, /^\/tiktok.*\.txt$/, /^\/google.*\.html$/, /^\/maps\//, /^\/bulletin\//],
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
      // Hub: /api/volcano?page=hub -> wovodat hub (used as fallback when PHP 404)
      // Detail (/api/volcano?detail=1&url=...) is handled server-side in production; in dev we bypass this proxy
      // and use the /bulletin direct proxy instead (see fetchVolcanoDetail).
      '/api/volcano': {
        target: 'https://wovodat.phivolcs.dost.gov.ph',
        changeOrigin: true,
        secure: false,
        bypass: (req) => {
          // Don't proxy detail requests through the hub proxy — let them fall through and be handled by direct /bulletin fallback
          if (req.url?.includes('detail=1')) return false as unknown as string;
          return null;
        },
        rewrite: () => {
          return '/bulletin/list-of-bulletin';
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      },
      // Direct bulletin detail proxy: /bulletin/activity-mvo?bid=... -> wovodat bulletin page (CORS bypass for fetch)
      // Navigation to /bulletin/... should NOT proxy to raw wovodat HTML — serve the SPA instead so the modal can handle it.
      '/bulletin': {
        target: 'https://wovodat.phivolcs.dost.gov.ph',
        changeOrigin: true,
        secure: false,
        bypass: (req) => {
          const accept = (req.headers as Record<string, string | undefined>)['accept'] || '';
          // Browser navigation has text/html; fetch/XHR has */* or application/json — only proxy the latter
          if (accept.includes('text/html') && !accept.includes('application/json')) {
            // Let Vite serve index.html (SPA) — the app will handle /bulletin via router/modal
            return '/index.html';
          }
          return null;
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      },
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
