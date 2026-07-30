const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CACHE_TTL_MS = 60_000;

interface Earthquake {
  datetime: string;
  latitude: string;
  longitude: string;
  depth: string;
  magnitude: string;
  location: string;
  link: string;
}

interface CacheEntry {
  timestamp: number;
  payload: { success: true; count: number; data: Earthquake[] };
}

const responseCache = new Map<string, CacheEntry>();

function extractEarthquakes(html: string, requestUrl: string): Earthquake[] {
  const earthquakes: Earthquake[] = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  let rowIndex = 0;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    if (rowIndex++ === 0) continue;
    const rowHtml = rowMatch[1];
    const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let link = '';
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      const cellHtml = cellMatch[1];
      if (cells.length === 0) {
        const linkMatch = /href=(?:'|")([^'"]+)(?:'|")/i.exec(cellHtml);
        if (linkMatch) link = linkMatch[1];
      }
      const value = cellHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      cells.push(value);
    }

    if (cells.length >= 6) {
      if (link && !link.startsWith('http')) {
        link = link.replace(/\\/g, '/');
        const urlObj = new URL(requestUrl);
        const baseUrl = urlObj.searchParams.get('path') || '';
        const phivolcsBase = baseUrl
          ? `https://earthquake.phivolcs.dost.gov.ph/${baseUrl}`
          : 'https://earthquake.phivolcs.dost.gov.ph/';
        try {
          link = new URL(link, phivolcsBase).href;
        } catch {
          link = phivolcsBase + link;
        }
      }
      earthquakes.push({
        datetime: cells[0] || '',
        latitude: cells[1] || '',
        longitude: cells[2] || '',
        depth: cells[3] || '',
        magnitude: cells[4] || '',
        location: cells[5] || '',
        link: link,
      });
    }
  }
  return earthquakes;
}

export async function onRequest(context: { request: Request }) {
  const { request } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const pathQuery = url.searchParams.get('path') || '';
  const cacheKey = pathQuery || '__live__';
  const cached = responseCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return new Response(JSON.stringify(cached.payload), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
    });
  }

  try {
    const targetUrl = pathQuery
      ? `https://earthquake.phivolcs.dost.gov.ph/${pathQuery}`
      : 'https://earthquake.phivolcs.dost.gov.ph/';

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!response.ok) throw new Error(`PHIVOLCS responded with ${response.status}`);

    const html = await response.text();
    const earthquakes = extractEarthquakes(html, request.url);
    const payload = { success: true as const, count: earthquakes.length, data: earthquakes };

    responseCache.set(cacheKey, { timestamp: Date.now(), payload });

    return new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
    });
  } catch (error) {
    const stale = responseCache.get(cacheKey);
    if (stale) {
      return new Response(JSON.stringify(stale.payload), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
      });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, count: 0, data: [], error: message }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
