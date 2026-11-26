// Native-aware HTTP helper.
//
// PHIVOLCS and Google News do not send CORS headers, so a plain browser/WebView
// `fetch` is blocked. In a native Capacitor shell we route those requests through
// Capacitor's built-in CapacitorHttp plugin (part of @capacitor/core v4+), which
// performs the request at the native layer and bypasses CORS entirely.
//
// Hosts that DO send CORS headers (our own Pages functions and the PHP proxy)
// are fetched directly from the WebView first. That keeps the critical data
// path independent of the native plugin and avoids the old community HTTP
// plugin, which targets Capacitor 3 and is not reliable on Capacitor 8.
//
// The returned shape mirrors the parts of the Fetch API the rest of the code
// uses (ok, status, text(), json(), headers.get) so call sites stay unchanged.

import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const IS_NATIVE = Capacitor.isNativePlatform();

interface SimpleResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<any>;
  headers: { get: (name: string) => string | null };
}

const REQUEST_TIMEOUT_MS = 12000;

// Origins that send `Access-Control-Allow-Origin: *`, so a normal WebView fetch
// works and is both faster and more reliable than a native round-trip.
const CORS_FRIENDLY_HOSTS = new Set([
  'terraguard-ph.pages.dev',
  'trikefare.x10.mx',
  'terraguard-auto.page.gd',
]);

function isCorsFriendly(url: string): boolean {
  try {
    return CORS_FRIENDLY_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function fromFetch(url: string): Promise<SimpleResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal })
    .then((res) => ({
      ok: res.ok,
      status: res.status,
      text: () => res.text(),
      json: () => res.json(),
      headers: { get: (name: string) => res.headers.get(name) },
    }))
    .finally(() => clearTimeout(timer));
}

// CapacitorHttp auto-parses any application/json body into a JS object even
// when responseType is 'text'. Stringifying that object would yield
// "[object Object]" and break every res.json() caller — so keep the parsed
// value and rebuild valid JSON text from it.
function fromCapacitorHttp(res: {
  status: number;
  data: unknown;
  headers?: Record<string, unknown> | null;
}): SimpleResponse {
  const rawHeaders = (res.headers ?? {}) as Record<string, unknown>;
  const headerKey = Object.keys(rawHeaders).find((k) => k.toLowerCase() === 'content-type');
  const contentType = headerKey ? String(rawHeaders[headerKey] ?? '') : '';

  const raw = res.data;
  const parsedJson = raw !== null && typeof raw === 'object';
  const body = typeof raw === 'string'
    ? raw
    : parsedJson
      ? JSON.stringify(raw)
      : String(raw ?? '');

  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    text: async () => body,
    json: async () => (parsedJson ? raw : JSON.parse(body)),
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
  };
}

async function nativeHttpGetInternal(url: string): Promise<SimpleResponse> {
  if (IS_NATIVE) {
    // Prefer the WebView fetch for CORS-enabled hosts (our own API and PHP).
    if (isCorsFriendly(url)) {
      try {
        return await fromFetch(url);
      } catch (e) {
        console.warn('WebView fetch failed, trying native HTTP instead:', url, e);
      }
    }

    try {
      const res = await withTimeout(
        CapacitorHttp.get({
          url,
          headers: { 'User-Agent': 'TerraGuard/1.0', Accept: 'application/json, text/html, */*' },
          connectTimeout: 8000,
          readTimeout: 8000,
          responseType: 'text',
        }),
        REQUEST_TIMEOUT_MS,
        'CapacitorHttp',
      );
      return fromCapacitorHttp(res as { status: number; data: unknown; headers?: Record<string, unknown> });
    } catch (e) {
      // Last resort for hosts that happen to allow CORS but failed natively.
      console.warn('Native HTTP failed, using WebView fetch instead:', url, e);
    }
  }

  // Web / dev: standard fetch (Vite proxy handles cross-origin).
  return fromFetch(url);
}

export async function nativeHttpGet(url: string): Promise<SimpleResponse> {
  return nativeHttpGetInternal(url);
}

/**
 * Same as nativeHttpGet but fails over from the primary PHP host
 * (https://trikefare.x10.mx/terraguard) to the backup host
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
