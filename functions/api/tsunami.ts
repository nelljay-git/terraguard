// Cloudflare Pages proxy for the PHIVOLCS-TSUNAMI scraper.
//
// tsunami.phivolcs.dost.gov.ph blocks datacenter IPs, so the scraping itself
// stays on the shared PHP hosts. Pages Functions give the APK a CORS-enabled,
// reliably reachable URL instead of depending on the phone reaching the free
// hosting directly.
//
// Upstream: https://trikefare.x10.mx/terraguard/api/tsunami.php
//   ?page=events
//   ?page=archive&year=2023
//   ?detail=1&url=<advisory url>
// Backup:  https://terraguard-auto.page.gd/terraguard/api/tsunami.php

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PHP_HOSTS = [
  'https://trikefare.x10.mx/terraguard/api/tsunami.php',
  'https://terraguard-auto.page.gd/terraguard/api/tsunami.php',
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
    // The backup host serves its SPA index.html at HTTP 200; never forward HTML.
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
  const page = (params.get('page') || 'events').toLowerCase().trim();
  const year = params.get('year') || '';

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
  } else if (page === 'archive') {
    if (!year) {
      return jsonResponse({ success: false, count: 0, data: [], error: 'Missing year for archive request' }, 'no-store', 400);
    }
    query.set('page', 'archive');
    query.set('year', year);
  } else {
    query.set('page', 'events');
  }

  let lastError = 'All tsunami upstreams failed';

  for (const host of PHP_HOSTS) {
    const result = await fetchUpstream(`${host}?${query.toString()}`);
    if (result.ok && result.payload) {
      return jsonResponse(result.payload, 's-maxage=600, stale-while-revalidate=1200');
    }
    lastError = result.error || lastError;
  }

  return jsonResponse(
    { success: false, count: 0, data: [], error: lastError },
    'no-store',
  );
}
