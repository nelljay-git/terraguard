// Native-aware HTTP helper.
//
// PHIVOLCS and Google News do not send CORS headers, so a plain browser/WebView
// `fetch` is blocked. In a native Capacitor shell we route the request through
// @capacitor-community/http, which performs the request at the native layer and
// bypasses CORS entirely. On the web (and in dev) we fall back to the normal
// `fetch` + local Vite proxy.
//
// The returned shape mirrors the parts of the Fetch API the rest of the code
// uses (ok, status, text(), headers.get) so call sites stay unchanged.

import { Capacitor } from '@capacitor/core';

export const IS_NATIVE = Capacitor.isNativePlatform();

interface SimpleResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<any>;
  headers: { get: (name: string) => string | null };
}

// On native, PHIVOLCS URLs are hit directly (no server-side proxy needed).
// In dev/the web app, the Vite proxy (/api/phivolcs) and relative paths handle it.
export async function nativeHttpGet(url: string): Promise<SimpleResponse> {
  if (IS_NATIVE) {
    try {
      const { Http } = await import('@capacitor-community/http');
      const res = await Http.get({
        url,
        headers: { 'User-Agent': 'TerraGuard/1.0' },
        connectTimeout: 8000,
        readTimeout: 8000,
        responseType: 'text',
      });

      const rawHeaders = (res.headers ?? {}) as Record<string, unknown>;
      const headerKey = Object.keys(rawHeaders).find((k) => k.toLowerCase() === 'content-type');
      // OkHttp/Capacitor preserves the server's header casing ("Content-Type"),
      // whereas the Fetch API lowercases it. Read it case-insensitively or the
      // JSON response is mistaken for HTML and parses to zero quakes.
      const contentType = headerKey ? String(rawHeaders[headerKey] ?? '') : '';
      const body = typeof res.data === 'string' ? res.data : String(res.data ?? '');

      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        text: async () => body,
        json: async () => JSON.parse(body),
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
      };
    } catch (e) {
      // The native plugin can fail on some Android builds. CORS-enabled hosts
      // (the PHP proxy, USGS, EMSC) work fine with a plain WebView fetch.
      console.warn('Capacitor HTTP failed, using WebView fetch instead:', e);
      const res = await fetch(url);
      return {
        ok: res.ok,
        status: res.status,
        text: () => res.text(),
        json: () => res.json(),
        headers: { get: (name: string) => res.headers.get(name) },
      };
    }
  }

  // Web / dev: standard fetch (Vite proxy handles cross-origin).
  const res = await fetch(url);
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
    json: () => res.json(),
    headers: { get: (name: string) => res.headers.get(name) },
  };
}

/**
 * Same as nativeHttpGet but fails over from the primary PHP host
 * (https://trikefare.x10.mx/terraguard) to the http-only backup host
 * (https://terraguard-auto.page.gd/terraguard) on network errors or 5xx/404.
 * Non-PHP URLs behave exactly like nativeHttpGet.
 */
export async function nativeHttpGetWithPhpFailover(url: string): Promise<SimpleResponse> {
  const { expandPhpFailoverUrls } = await import('./apiBase');
  const candidates = expandPhpFailoverUrls(url);
  if (candidates.length <= 1) return nativeHttpGet(url);
  let lastError: unknown = null;
  let lastResponse: SimpleResponse | null = null;
  for (const candidate of candidates) {
    try {
      const res = await nativeHttpGet(candidate);
      if (res.ok) return res;
      const retryable = res.status === 404 || res.status === 408 || res.status === 429 || (res.status >= 500 && res.status <= 599);
      if (retryable && candidate !== candidates[candidates.length - 1]) {
        console.warn(`PHP ${res.status} from ${candidate}, trying backup…`);
        lastResponse = res;
        continue;
      }
      return res;
    } catch (e) {
      console.warn(`PHP request failed for ${candidate}, trying backup…`, e);
      lastError = e;
      continue;
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError ?? new Error('All PHP hosts unreachable');
}
