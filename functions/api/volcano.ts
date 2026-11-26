// Cloudflare Pages proxy for the volcano scraper.
//
// The APK cannot scrape WOVODAT directly (CORS + flaky mobile networks) and the
// free PHP hosts are frequently unreachable from phones. Pages Functions are
// reachable everywhere and send CORS headers, so the native app calls this
// endpoint first and the PHP host stays as a fallback.
//
// Upstream: https://trikefare.x10.mx/terraguard/api/volcano.php
//   ?page=hub
//   ?detail=1&url=<wovodat bulletin url>
// Backup:  https://terraguard-auto.page.gd/terraguard/api/volcano.php

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PHP_HOSTS = [
  'https://trikefare.x10.mx/terraguard/api/volcano.php',
  'https://terraguard-auto.page.gd/terraguard/api/volcano.php',
];

const UPSTREAM_TIMEOUT_MS = 15_000;

interface UpstreamResult {
  ok: boolean;
  status: number;
  payload: unknown;
  error: string;
}

async function fetchUpstream(url: string): Promise<UpstreamResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TerraGuard/1.0',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type') || '';
    // A broken host (e.g. the InfinityFree backup) answers with its SPA
    // index.html at HTTP 200. Treat any HTML as a failed upstream rather than
    // forwarding it to the app.
    if (!contentType.includes('application/json')) {
      return { ok: false, status: res.status, payload: null, error: `Upstream returned ${contentType || 'unknown content type'}` };
    }

    const payload = await res.json();
    return { ok: res.ok, status: res.status, payload, error: res.ok ? '' : `Upstream HTTP ${res.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, status: 502, payload: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest(context: { request: Request }) {
  const { request } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, count: 0, data: [], error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const params = new URL(request.url).searchParams;
  const isDetail = params.get('detail') === '1' || params.get('detail') === 'true';
  const detailUrl = params.get('url') || '';
  const page = (params.get('page') || 'hub').toLowerCase().trim();

  const jsonResponse = (payload: unknown, cacheControl: string, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl, ...corsHeaders },
    });

  const query = new URLSearchParams();
  if (isDetail) {
    if (!detailUrl) {
      return jsonResponse({ success: false, count: 0, data: [], error: 'Missing url for detail request' }, 'no-store', 400);
    }
    query.set('detail', '1');
    query.set('url', detailUrl);
  } else {
    query.set('page', page);
  }

  let lastError = 'All volcano upstreams failed';

  for (const host of PHP_HOSTS) {
    const result = await fetchUpstream(`${host}?${query.toString()}`);
    if (result.ok && result.payload) {
      return jsonResponse(
        result.payload,
        isDetail ? 's-maxage=300, stale-while-revalidate=600' : 's-maxage=60, stale-while-revalidate=300',
      );
    }
    lastError = result.error || lastError;
  }

  return jsonResponse(
    { success: false, count: 0, data: [], error: lastError },
    'no-store',
  );
}
