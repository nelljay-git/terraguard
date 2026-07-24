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
