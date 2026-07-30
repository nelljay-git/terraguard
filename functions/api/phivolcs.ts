// @ts-nocheck

type Earthquake = {
  datetime: string;
  latitude: string;
  longitude: string;
  depth: string;
  magnitude: string;
  location: string;
  link: string;
};

function extractEarthquakes(html: string): Earthquake[] {
  const earthquakes: Earthquake[] = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  let rowIndex = 0;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    if (rowIndex++ === 0) continue;

    const rowHtml = rowMatch[1];
    const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    }

    if (cells.length >= 6) {
      let link = '';
      const firstCell = rowHtml.match(/<td\b[^>]*>[\s\S]*?<a\b[^>]*href=(?:'|")([^'"]+)(?:'|")/i);
      if (firstCell) {
        link = firstCell[1];
      }
      if (link && !link.startsWith('http')) {
        link = link.replace(/\\/g, '/');
        link = new URL(link, 'https://earthquake.phivolcs.dost.gov.ph/').href;
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

const CACHE_TTL_MS = 60 * 1000;
type CacheEntry = { timestamp: number; payload: { success: true; count: number; data: Earthquake[] } };
const responseCache = new Map<string, CacheEntry>();

export async function onRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathQuery = url.searchParams.get('path') || '';
  const cacheKey = pathQuery || '__live__';

  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return new Response(JSON.stringify(cached.payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    });
  }

  const targetUrl = pathQuery
    ? `https://earthquake.phivolcs.dost.gov.ph/${pathQuery}`
    : 'https://earthquake.phivolcs.dost.gov.ph/';

  try {
    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
    });

    if (!response.ok) throw new Error(`PHIVOLCS responded with ${response.status}`);

    const html = await response.text();
    const earthquakes = extractEarthquakes(html);

    const payload = { success: true as const, count: earthquakes.length, data: earthquakes };
    responseCache.set(cacheKey, { timestamp: Date.now(), payload });

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const stale = responseCache.get(cacheKey);
    if (stale) {
      return new Response(JSON.stringify(stale.payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, count: 0, data: [], error: message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}