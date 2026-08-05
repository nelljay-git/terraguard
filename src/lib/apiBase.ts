// Centralized API base URL resolver.
//
// The web app proxies PHIVOLCS / Google News through server-side functions:
//   - dev:  Vite dev proxy (/api/*)
//   - prod: Vercel serverless functions (/api/*)
//
// NOTE: the native (Capacitor) app does NOT use this. It scrapes PHIVOLCS and
// Google News directly via @capacitor-community/http (CORS-free at the native
// layer) — see src/lib/nativeHttp.ts and the IS_NATIVE branches in api/*.ts.
//
// VITE_API_BASE (injected by vite.config.ts) is still used purely as the native
// build signal: when set, the VitePWA service worker is disabled so it can't
// intercept fetches inside the WebView. It is also the fallback for any web
// prod calls that still target the Vercel host.
//
// When empty (dev), callers keep using the relative /api/* paths handled by the
// local Vite proxy.

const RAW = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '';

// Normalize to "https://host" without a trailing slash.
export const API_BASE: string = RAW.replace(/\/+$/, '').replace(/\/api\/?$/, '');

/** Prefix a relative /api/* path with the configured backend host. */
export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

// ---------------------------------------------------------------------------
// PHIVOLCS scraper target — optional PHP endpoint
// ---------------------------------------------------------------------------
// The live PHIVOLCS index (+ monthly archive) requests are normally served by
// the in-repo /api/phivolcs functions (Vercel / CloudFlare Pages). CloudFlare's
// free tier only allows 100,000 function-invocations/day, and the 30s live-feed
// polling exhausted it. Routing the PHIVOLCS list through this PHP endpoint
// (hosted on unlimited-bandwidth shared hosting) bypasses that quota entirely.
//
// Toggle:  VITE_USE_PHP_PHIVOLCS_API=true  (default)  -> use the PHP endpoint
//          VITE_USE_PHP_PHIVOLCS_API=false            -> fall back to /api/phivolcs
// Override base: VITE_PHP_API_BASE=<origin>/api (trailing slash trimmed).
//
// IMPORTANT: an `http://` origin is blocked as mixed content on an `https://`
// site. Serve the PHP endpoint over HTTPS and switch VITE_PHP_API_BASE to the
// https:// origin, or set the toggle to false, if the endpoint is unreachable.
export const usePhpApi = !/^(false|0)$/i.test(
  (import.meta.env?.VITE_USE_PHP_PHIVOLCS_API as string | undefined) ?? 'true',
);

const PHP_API_BASE: string = (
  (import.meta.env?.VITE_PHP_API_BASE as string | undefined) ??
  'https://trikefare.x10.mx/api'
).replace(/\/+$/, '');

function phpApi(pathWithName: string): string {
  return `${PHP_API_BASE}/${pathWithName}`;
}

/** Live index URL. When the PHP API switch is off, falls back to /api/phivolcs. */
export function phivolcsListUrl(): string {
  return usePhpApi ? phpApi('phivolcs.php') : apiUrl('/api/phivolcs');
}

/**
 * Monthly-archive URL for `path`
 * (e.g. "EQLatest-Monthly/2026/2026_January.html").
 * The PHP scraper takes the same path via ?path= ; the in-repo functions use
 * /api/phivolcs?path=...
 */
export function phivolcsArchiveUrl(path: string): string {
  const qs = encodeURIComponent(path);
  return usePhpApi
    ? `${phpApi('phivolcs.php')}?path=${qs}`
    : apiUrl(`/api/phivolcs?path=${qs}`);
}

/** Detail URL for the PHP endpoint (when PHP API is used). */
export function phivolcsDetailUrl(url: string): string {
  const qs = encodeURIComponent(url);
  return `${phpApi('phivolcs.php')}?detail=1&url=${qs}`;
}
