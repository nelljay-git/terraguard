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
    const { Http } = await import('@capacitor-community/http');
    const res = await Http.get({
      url,
      headers: { 'User-Agent': 'TerraGuard/1.0' },
      connectTimeout: 8000,
      readTimeout: 8000,
      responseType: 'text',
    });

    const contentType = (res.headers?.['content-type'] as string) || '';
    const body = typeof res.data === 'string' ? res.data : String(res.data ?? '');

    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: async () => body,
      json: async () => JSON.parse(body),
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    };
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
