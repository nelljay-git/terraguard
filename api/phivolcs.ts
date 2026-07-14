// @ts-nocheck
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

type Earthquake = {
  datetime: string;
  latitude: string;
  longitude: string;
  depth: string;
  magnitude: string;
  location: string;
  link: string;
};

function extractEarthquakes(html: string, req: any): Earthquake[] {
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
        if (linkMatch) {
          link = linkMatch[1];
        }
      }
      const value = cellHtml
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(value);
    }

    if (cells.length >= 6) {
      if (link && !link.startsWith('http')) {
        link = link.replace(/\\/g, '/');
        // Extract path to construct correct base URL for relative links
        const pathQuery = req?.query?.path || '';
        const baseUrl = pathQuery 
          ? `https://earthquake.phivolcs.dost.gov.ph/${pathQuery}`
          : 'https://earthquake.phivolcs.dost.gov.ph/';
        try {
          link = new URL(link, baseUrl).href;
        } catch {
          link = baseUrl + link;
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

// ---------------------------------------------------------------------------
// In-memory response cache
// ---------------------------------------------------------------------------
// We keep the last successful scrape result in memory (per requested path) so
// that repeated requests within a short window don't hammer the PHIVOLCS site.
//
// How it works:
//   1. Each cache entry stores the JSON payload and the timestamp it was made.
//   2. When a request comes in, we check for a fresh entry (< 60s old). If one
//      exists, we return it immediately without scraping again.
//   3. If the entry is missing or stale (>= 60s), we scrape PHIVOLCS, then
//      store the new result and its timestamp before returning it.
//   4. If scraping fails but we still have a cached entry (even a stale one),
//      we return that cached entry instead of surfacing an error.
//
// Note: this cache lives in the server process's memory, so it is shared across
// requests handled by the same instance and is cleared when the process restarts.
const CACHE_TTL_MS = 60 * 1000; // Cache lifetime: 60 seconds

type CacheEntry = {
  timestamp: number; // When this payload was scraped (ms since epoch)
  payload: { success: true; count: number; data: Earthquake[] };
};

// Keyed by the requested path so live data and archive pages cache separately.
const responseCache = new Map<string, CacheEntry>();

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const pathQuery = (req.query.path as string) || '';
  const cacheKey = pathQuery || '__live__';

  // Step 1: Serve from cache if we have a fresh (< 60s old) entry.
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(cached.payload);
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

    if (!response.ok) {
      throw new Error(`PHIVOLCS responded with ${response.status}`);
    }

    const html = await response.text();
    const earthquakes = extractEarthquakes(html, req);

    const payload = {
      success: true as const,
      count: earthquakes.length,
      data: earthquakes,
    };

    // Step 2: Scrape succeeded, so refresh the cache with the new result.
    responseCache.set(cacheKey, { timestamp: Date.now(), payload });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(payload);
  } catch (error) {
    // Step 3: Scrape failed. If we have any cached response (even stale),
    // return it instead of an error so the client still gets usable data.
    const stale = responseCache.get(cacheKey);
    if (stale) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(stale.payload);
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(200).json({
      success: false,
      count: 0,
      data: [],
      error: message,
    });
  }
}
