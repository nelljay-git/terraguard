const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_BULLETIN_PROBES = 8;
const EDGE_TTL_MS = 3600 * 1000;
const EDGE_CACHE_HOST = 'https://terraguard-edge-cache.invalid';
const EDGE_CACHE_KEY_HEADER = 'x-terraguard-cached-at';

interface Bulletin { no: number; final: boolean; url: string; }
interface BulletinsPayload { success: true; data: Bulletin[]; }

function edgeCacheUrl(targetUrl: string): URL {
  const u = new URL(`${EDGE_CACHE_HOST}/api/bulletins`);
  u.searchParams.set('url', targetUrl);
  return u;
}

async function edgeGet(targetUrl: string): Promise<BulletinsPayload | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cached = await caches.default.match(edgeCacheUrl(targetUrl));
    if (!cached) return null;
    const cachedAt = Number(cached.headers.get(EDGE_CACHE_KEY_HEADER) || 0);
    if (!cachedAt || Date.now() - cachedAt >= EDGE_TTL_MS) return null;
    return (await cached.json()) as BulletinsPayload;
  } catch {
    return null;
  }
}

async function edgePut(targetUrl: string, payload: BulletinsPayload): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const res = new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=3600',
        [EDGE_CACHE_KEY_HEADER]: String(Date.now()),
      },
    });
    await caches.default.put(edgeCacheUrl(targetUrl), res);
  } catch {
    // Best-effort: failing to write the edge cache must not break the response.
  }
}

export async function onRequest(context: { request: Request }) {
  const { request } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return new Response(JSON.stringify({ success: false, error: 'Missing or invalid URL parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const m = /^(.+)_B(\d+)(F)?\.html$/i.exec(targetUrl);
  if (!m) {
    return new Response(JSON.stringify({ success: true, data: [] }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const cachedEdge = await edgeGet(targetUrl);
  if (cachedEdge) {
    return new Response(JSON.stringify(cachedEdge), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=3600, stale-while-revalidate',
        ...corsHeaders,
      },
    });
  }

  const prefix = m[1];
  const build = (n: number, final: boolean) => `${prefix}_B${n}${final ? 'F' : ''}.html`;

  const exists = async (candidate: string): Promise<boolean> => {
    try {
      const r = await fetch(candidate, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });
      if (!r.ok) return false;
      const html = await r.text();
      return /EARTHQUAKE INFORMATION/i.test(html);
    } catch {
      return false;
    }
  };

  const results: Bulletin[] = [];
  for (let n = 1; n <= MAX_BULLETIN_PROBES; n++) {
    const [plain, final] = await Promise.all([exists(build(n, false)), exists(build(n, true))]);
    if (!plain && !final) break;
    if (plain) results.push({ no: n, final: false, url: build(n, false) });
    if (final) results.push({ no: n, final: true, url: build(n, true) });
  }

  const payload: BulletinsPayload = { success: true, data: results };
  await edgePut(targetUrl, payload);

  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate',
      ...corsHeaders,
    },
  });
}
