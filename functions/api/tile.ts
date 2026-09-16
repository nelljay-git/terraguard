// Same-origin proxy for map tiles (satellite only, no markers).
// Canvas needs CORS-clean images: tainted canvases break captureStream().
// Only Esri World Imagery tiles (the same map the app uses) are allowed;
// everything else gets 403.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ALLOW = /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+$/;

export async function onRequest(context: { request: Request }) {
  const { request } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const src = new URL(request.url).searchParams.get('src') || '';
  if (!ALLOW.test(src)) {
    return new Response('Forbidden host', { status: 403, headers: corsHeaders });
  }
  try {
    const r = await fetch(src, { headers: { 'User-Agent': 'TerraGuard-TileProxy/1.0' } });
    if (!r.ok) {
      return new Response('Upstream error', { status: 502, headers: corsHeaders });
    }
    const buf = await r.arrayBuffer();
    return new Response(buf, {
      headers: {
        'Content-Type': r.headers.get('content-type') || 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        ...corsHeaders,
      },
    });
  } catch {
    return new Response('Fetch failed', { status: 502, headers: corsHeaders });
  }
}
