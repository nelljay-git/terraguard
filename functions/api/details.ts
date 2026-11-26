const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const EDGE_TTL_MS = 3600 * 1000;
// v2 busts cached payloads that predate the per-bulletin event parameters.
const EDGE_CACHE_HOST = 'https://terraguard-edge-cache-v2.invalid';
const EDGE_CACHE_KEY_HEADER = 'x-terraguard-cached-at';

interface DetailsPayload {
  success: true;
  data: {
    origin: string;
    reportedIntensities: string;
    instrumentalIntensities: string;
    note: string;
    mapUrl: string;
    tsunami: string;
    bulletinDatetime?: string;
    bulletinLocation?: string;
    bulletinLatitude?: string;
    bulletinLongitude?: string;
    bulletinDepth?: string;
    bulletinMagnitude?: string;
  };
}

function edgeCacheUrl(targetUrl: string): URL {
  const u = new URL(`${EDGE_CACHE_HOST}/api/details`);
  u.searchParams.set('url', targetUrl);
  return u;
}

async function edgeGet(targetUrl: string): Promise<DetailsPayload | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cached = await caches.default.match(edgeCacheUrl(targetUrl));
    if (!cached) return null;
    const cachedAt = Number(cached.headers.get(EDGE_CACHE_KEY_HEADER) || 0);
    if (!cachedAt || Date.now() - cachedAt >= EDGE_TTL_MS) return null;
    return (await cached.json()) as DetailsPayload;
  } catch {
    return null;
  }
}

async function edgePut(targetUrl: string, payload: DetailsPayload): Promise<void> {
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
    return new Response(JSON.stringify({ success: false, error: 'Missing URL parameter' }), {
      status: 400,
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

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!response.ok) throw new Error(`PHIVOLCS responded with ${response.status}`);

    const html = await response.text();
    const cleanText = html
      .replace(/&nbsp;/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const originMatch = /Origin\s*:\s*(.*?)\s*Magnitude/i.exec(cleanText);
    const origin = originMatch ? originMatch[1].trim() : 'Unknown';

    // PHIVOLCS revises these parameters with each information bulletin.
    const datetimeMatch = /Date\/Time\s*:\s*(.*?)\s+Location\s*:/i.exec(cleanText);
    const bulletinDatetime = datetimeMatch ? datetimeMatch[1].trim() : '';
    const locationMatch = /Location\s*:\s*(.*?)\s+Depth of Focus/i.exec(cleanText);
    const bulletinLocation = locationMatch ? locationMatch[1].trim() : '';
    const coordMatch = /([\d.]+)\s*[\u00b0?]\s*([NS])\s*,\s*([\d.]+)\s*[\u00b0?]\s*([EW])/i.exec(bulletinLocation);
    const bulletinLatitude = coordMatch ? `${coordMatch[1]}${coordMatch[2].toUpperCase()}` : '';
    const bulletinLongitude = coordMatch ? `${coordMatch[3]}${coordMatch[4].toUpperCase()}` : '';
    const depthMatch = /Depth of Focus \(Km\)\s*:\s*([\d.]+)/i.exec(cleanText);
    const bulletinDepth = depthMatch ? depthMatch[1].trim() : '';
    const magMatch = /Magnitude\s*:\s*([A-Za-z]{0,3})\s*([\d.]+)/i.exec(cleanText);
    const bulletinMagnitude = magMatch ? magMatch[2].trim() : '';

    const reportedMatch = /Reported Intensities\s*:\s*(.*?)(?:Instrumental Intensities|This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
    const reported = reportedMatch ? reportedMatch[1].replace(/^[a-zA-Z0-9_.\s]+Intensity/i, 'Intensity').trim() : '';

    const instrumentalMatch = /Instrumental Intensities\s*:?\s*(.*?)(?:This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
    const instrumental = instrumentalMatch ? instrumentalMatch[1].trim() : '';

    const noteMatch = /(This is an aftershock.*?)(?:Expecting Damage|$)/i.exec(cleanText);
    const note = noteMatch ? noteMatch[1].trim() : '';

    const tsunamiMatch = /TSUNAMI\s+INFORMATION\s*:\s*(.*?)(?:Reported Intensities|Instrumental Intensities|This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
    const tsunami = tsunamiMatch ? tsunamiMatch[1].trim() : '';

    const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    let imgMatch;
    let mapUrl = '';
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      const src = imgMatch[1].trim();
      if (!src.toLowerCase().includes('logo') && !src.toLowerCase().includes('header')) {
        mapUrl = src;
        break;
      }
    }

    if (mapUrl && !mapUrl.startsWith('http')) {
      const urlObj = new URL(targetUrl);
      mapUrl = urlObj.origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1) + mapUrl;
    }

    const payload: DetailsPayload = {
      success: true,
      data: {
        origin,
        reportedIntensities: reported,
        instrumentalIntensities: instrumental,
        note,
        mapUrl,
        tsunami,
        bulletinDatetime,
        bulletinLocation: bulletinLocation.includes(' - ')
          ? bulletinLocation.slice(bulletinLocation.indexOf(' - ') + 3).trim()
          : bulletinLocation,
        bulletinLatitude,
        bulletinLongitude,
        bulletinDepth,
        bulletinMagnitude,
      },
    };
    await edgePut(targetUrl, payload);

    return new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=3600, stale-while-revalidate',
        ...corsHeaders,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
