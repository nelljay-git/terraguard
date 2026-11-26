// Centralized API base URL resolver.
//
// The web app proxies PHIVOLCS / Google News through server-side functions:
//   - dev:  Vite dev proxy (/api/*)
//   - prod: Vercel serverless functions (/api/*)
//
// NOTE: the native (Capacitor) app routes PHIVOLCS / Google News requests
// through CapacitorHttp (CORS-free at the native layer) and prefers the
// deployed Pages Functions — see src/lib/nativeHttp.ts and the IS_NATIVE
// branches in api/*.ts.
//
// VITE_API_BASE (injected by vite.config.ts) is still used purely as the native
// build signal: when set, the VitePWA service worker is disabled so it can't
// intercept fetches inside the WebView. It is also the fallback for any web
// prod calls that still target the Vercel host.
//
// When empty (dev), callers keep using the relative /api/* paths handled by the
// local Vite proxy.

import { Capacitor } from '@capacitor/core';

const RAW = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '';

// The APK loads its assets from https://localhost, so a relative /api/* path
// resolves to the WebView's own origin and never reaches the backend. Point
// native builds at the deployed Pages Functions explicitly.
export const NATIVE_API_ORIGIN = 'https://terraguard-ph.pages.dev';

const NORMALIZED_RAW = RAW.replace(/\/+$/, '').replace(/\/api\/?$/, '');

// Normalize to "https://host" without a trailing slash.
export const API_BASE: string = NORMALIZED_RAW || (Capacitor.isNativePlatform() ? NATIVE_API_ORIGIN : '');

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
// Override base: VITE_PHP_API_BASE=<origin>/terraguard (trailing slash trimmed).
// Backup base:  VITE_PHP_API_BASE_BACKUP=<origin>/terraguard — tried automatically
// when the primary answers with a 5xx (e.g. hosting 503) or is unreachable.
//
// NOTE: the backup host is a separate provider (InfinityFree), so an
// account-level outage on the primary doesn't take both down.
export const usePhpApi = !/^(false|0)$/i.test(
  (import.meta.env?.VITE_USE_PHP_PHIVOLCS_API as string | undefined) ?? 'true',
);

export const PHP_API_PRIMARY: string = (
  (import.meta.env?.VITE_PHP_API_BASE as string | undefined)?.trim() ||
  'https://trikefare.x10.mx/terraguard'
).replace(/\/+$/, '');

export const PHP_API_BACKUP: string = (
  (import.meta.env?.VITE_PHP_API_BASE_BACKUP as string | undefined)?.trim() ||
  'https://terraguard-auto.page.gd/terraguard'
).replace(/\/+$/, '');

function phpApi(pathWithName: string): string {
  return `${PHP_API_PRIMARY}/${pathWithName}`;
}

/**
 * All candidate URLs for a PHP path: primary first, then the backup host.
 */
export function phpApiCandidates(pathWithName: string): string[] {
  const primary = `${PHP_API_PRIMARY}/${pathWithName}`;
  const backup = `${PHP_API_BACKUP}/${pathWithName}`;
  return backup !== primary ? [primary, backup] : [primary];
}

/**
 * Expand a fully-built PHP URL into its primary+backup candidates by swapping
 * the base origin. Non-PHP URLs are returned unchanged.
 */
export function expandPhpFailoverUrls(url: string): string[] {
  const bases = [PHP_API_PRIMARY, PHP_API_BACKUP];
  const match = bases.find((b) => b && url.startsWith(b));
  if (!match) return [url];
  const suffix = url.slice(match.length);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of [PHP_API_PRIMARY, PHP_API_BACKUP]) {
    if (!b) continue;
    const candidate = `${b}${suffix}`;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

function shouldFailoverStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * fetch() that transparently fails over from the primary PHP host to the
 * backup host on network errors or retryable HTTP statuses (5xx, incl. 503).
 * Returns the first OK response; if every candidate fails with a retryable
 * status, the last response is returned so callers can surface the status.
 */
export async function fetchPhpWithFailover(url: string, init?: RequestInit): Promise<Response> {
  const candidates = expandPhpFailoverUrls(url);
  let lastError: unknown = null;
  let lastResponse: Response | null = null;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, init);
      if (res.ok) return res;
      if (shouldFailoverStatus(res.status) && candidate !== candidates[candidates.length - 1]) {
        console.warn(`PHP ${res.status} from ${candidate}, trying backup…`);
        lastResponse = res;
        continue;
      }
      return res;
    } catch (e) {
      console.warn(`PHP fetch failed for ${candidate}, trying backup…`, e);
      lastError = e;
      continue;
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError ?? new Error('All PHP hosts unreachable');
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

/**
 * Bulletin-sequence probe URL. When PHP API is used, the probing happens on the
 * PHP host (so it doesn't bill Cloudflare Pages Function invocations); otherwise
 * it falls back to the in-repo /api/bulletins function.
 */
export function phivolcsBulletinsUrl(url: string): string {
  const qs = encodeURIComponent(url);
  return usePhpApi
    ? `${phpApi('phivolcs.php')}?bulletins=1&url=${qs}`
    : apiUrl(`/api/bulletins?url=${qs}`);
}

export function volcanoListUrl(): string {
  return usePhpApi ? phpApi('api/volcano.php?page=hub') : apiUrl('/api/volcano?page=hub');
}
export function volcanoDetailUrl(url: string): string {
  const qs = encodeURIComponent(url);
  return usePhpApi ? phpApi(`api/volcano.php?detail=1&url=${qs}`) : apiUrl(`/api/volcano?detail=1&url=${qs}`);
}

// ---------------------------------------------------------------------------
// PHIVOLCS-TSUNAMI bulletins.
// ---------------------------------------------------------------------------
// tsunami.phivolcs.dost.gov.ph blocks datacenter IPs, so the scraping itself
// stays on the shared PHP hosts. The in-repo Pages function
// (functions/api/tsunami.ts) proxies those hosts with CORS headers, which gives
// the APK a reachable URL when mobile networks can't reach the free hosting
// directly. These helpers return the PHP URLs; the client prefers the Pages
// proxy on native and falls back to these.
export function tsunamiEventsUrl(): string {
  return `${PHP_API_PRIMARY}/api/tsunami.php?page=events`;
}

export function tsunamiArchiveUrl(year: number): string {
  return `${PHP_API_PRIMARY}/api/tsunami.php?page=archive&year=${year}`;
}

export function tsunamiDetailUrl(url: string): string {
  return `${PHP_API_PRIMARY}/api/tsunami.php?detail=1&url=${encodeURIComponent(url)}`;
}
