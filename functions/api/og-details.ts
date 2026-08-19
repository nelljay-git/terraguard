const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getSeverityLabel(magnitude: number) {
  if (magnitude < 3.0) return 'Minor';
  if (magnitude < 4.5) return 'Light';
  if (magnitude < 6.0) return 'Moderate';
  if (magnitude < 7.0) return 'Strong';
  if (magnitude < 8.0) return 'Major';
  return 'Great';
}

function decodeBase64(str: string): string {
  const pad = str.length % 4;
  const padded = pad ? str + '='.repeat(4 - pad) : str;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, '');
}

// PHIVOLCS scraping is offloaded to the PHP endpoint (unlimited shared hosting)
// instead of being scraped directly here on Cloudflare. Direct scraping would
// bill every link-preview/crawl as a Cloudflare Pages Function invocation and
// fetch PHIVOLCS on every request. The PHP host does the scraping.
const PHP_PHIVOLCS_DEFAULT = 'https://trikefare.x10.mx/terraguard/phivolcs.php';

function phpPhivolcsUrl(base: string, path?: string): string {
  if (!path) return base;
  return `${base}?path=${encodeURIComponent(path)}`;
}

// Fallback parser for when the endpoint returns raw PHIVOLCS HTML instead of JSON.
function extractRowsFromHtml(html: string): OgRow[] {
  const rows: OgRow[] = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    }
    if (cells.length >= 6) {
      rows.push({
        datetime: cells[0],
        latitude: cells[1],
        longitude: cells[2],
        depth: cells[3],
        magnitude: cells[4],
        location: cells[5],
      });
    }
  }
  return rows;
}

interface OgRow {
  datetime: string;
  latitude: string;
  longitude: string;
  depth: string;
  magnitude: string;
  location: string;
}

// PHIVOLCS tables and bulletins vary in format ("14 August 2026 - 07:53 AM",
// "13 Jun 2026 - 10:05:46 AM", etc.), so parse leniently to let revised event
// times still be compared as timestamps.
function parseDateTime(s: string): number | null {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*-\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s.trim());
  if (!m) return null;
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthIdx = monthNames.indexOf(m[2].slice(0, 3).toLowerCase());
  if (monthIdx === -1) return null;
  let hour = parseInt(m[4], 10);
  const ap = (m[7] || '').toUpperCase();
  if (ap === 'PM' && hour < 12) hour += 12;
  if (ap === 'AM' && hour === 12) hour = 0;
  const d = new Date(parseInt(m[3], 10), monthIdx, parseInt(m[1], 10), hour, parseInt(m[5], 10), m[6] ? parseInt(m[6], 10) : 0);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// PHIVOLCS frequently revises event data: the origin time can shift by a minute
// or more, and the coordinates are refined too. When exact ID and datetime-string
// matches fail, match on the parsed time within a small tolerance, using
// coordinates only as a coarse rejector (a couple of degrees) plus a tiebreaker,
// preferring the closest candidate. Mirrors the client fallback in Details.tsx.
function fuzzyMatchRows(
  rows: OgRow[],
  datetimeStr: string,
  targetLat: number,
  targetLng: number
): OgRow | null {
  const targetTime = parseDateTime(datetimeStr);
  if (targetTime == null) return null;
  const TIME_TOLERANCE_MIN = 5;
  const COORD_TOLERANCE_DEG = 5.0;

  let best: OgRow | null = null;
  let bestScore = Infinity;
  for (const r of rows) {
    const t = parseDateTime(r.datetime);
    if (t == null) continue;
    const timeDiffMin = Math.abs(t - targetTime) / 60000;
    if (timeDiffMin > TIME_TOLERANCE_MIN) continue;

    const lat = parseFloat(r.latitude);
    const lng = parseFloat(r.longitude);
    if (!isNaN(targetLat) && !isNaN(targetLng) && !isNaN(lat) && !isNaN(lng)) {
      if (Math.abs(lat - targetLat) > COORD_TOLERANCE_DEG || Math.abs(lng - targetLng) > COORD_TOLERANCE_DEG) continue;
    }

    const latDiff = isNaN(lat) || isNaN(targetLat) ? 0 : Math.abs(lat - targetLat);
    const lngDiff = isNaN(lng) || isNaN(targetLng) ? 0 : Math.abs(lng - targetLng);
    const score = timeDiffMin * 2 + latDiff + lngDiff;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

export async function onRequest(context: { request: Request; env?: Record<string, unknown> }) {
  const { request, env } = context;
  const url = new URL(request.url);
  const host = request.headers.get('host') || 'terraguard.vercel.app';
  const phpBase = (typeof env?.PHP_API_BASE === 'string' ? env.PHP_API_BASE : undefined) || PHP_PHIVOLCS_DEFAULT;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const id = url.searchParams.get('id');
  if (!id) {
    return new Response('Missing ID', { status: 400 });
  }

  try {
    const decodedStr = decodeBase64(id);
    // Slug format is "DATETIME-LAT-LNG". Longitudes can be negative, which
    // turns the separator into "--" and would confuse a plain split().
    const parts = /^(.*?)-(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/.exec(decodedStr.trim());
    const latStr = parts ? parts[2] : '0';
    const lngStr = parts ? parts[3] : '0';
    const datetime = parts ? parts[1].trim() : decodedStr;
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    let targetYear = new Date().getFullYear();
    let targetMonthName = MONTHS[new Date().getMonth()];

    const match = datetime.match(/(\d+)\s+([A-Za-z]+)\s+(\d{4})/);
    if (match) {
      targetYear = parseInt(match[3], 10);
      const mIdx = MONTHS.findIndex(m => m.toLowerCase() === match[2].toLowerCase());
      if (mIdx !== -1) targetMonthName = MONTHS[mIdx];
    }

    const currentYear = new Date().getFullYear();
    const currentMonth = MONTHS[new Date().getMonth()];

    // Route PHIVOLCS scraping through the PHP endpoint (the link), not Cloudflare.
    // This keeps the PHIVOLCS fetch off Cloudflare's function-invocation quota.
    const urlsToTry: string[] = [];
    if (targetYear === currentYear && targetMonthName === currentMonth) {
      urlsToTry.push(phpPhivolcsUrl(phpBase));
    }
    urlsToTry.push(phpPhivolcsUrl(phpBase, `EQLatest-Monthly/${targetYear}/${targetYear}_${targetMonthName}.html`));

    const mIdx = MONTHS.indexOf(targetMonthName);
    const prevMonthIdx = mIdx === 0 ? 11 : mIdx - 1;
    const prevYear = mIdx === 0 ? targetYear - 1 : targetYear;
    urlsToTry.push(phpPhivolcsUrl(phpBase, `EQLatest-Monthly/${prevYear}/${prevYear}_${MONTHS[prevMonthIdx]}.html`));

    let earthquake: { datetime: string; latitude: string; longitude: string; depth: string; magnitude: string; location: string } | null = null;

    const allRows: typeof earthquake[] = [];
    let fallbackDatetime: string | null = null;
    try {
      const dParts = /^(.*?)-(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/.exec(decodedStr.trim());
      if (dParts) {
        fallbackDatetime = dParts[1].replace(/\s+/g, ' ').trim();
      }
    } catch { /* ignore */ }

    for (const targetUrl of urlsToTry) {
      try {
        const response = await fetch(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        if (!response.ok) continue;

        const contentType = response.headers.get('content-type') || '';
        let rows: OgRow[] = [];
        if (contentType.includes('application/json')) {
          const json = (await response.json()) as { data?: OgRow[] };
          rows = json.data ?? [];
        } else {
          // Endpoint returned raw PHIVOLCS HTML; parse it as a fallback.
          rows = extractRowsFromHtml(await response.text());
        }

        for (const r of rows) {
          allRows.push(r);
          const rowId = encodeBase64(`${r.datetime}-${r.latitude}-${r.longitude}`);
          if (rowId === id) {
            earthquake = r;
            break;
          }
        }

        if (earthquake) break;
      } catch { /* continue */ }
    }

    if (!earthquake && fallbackDatetime) {
      earthquake = allRows.find(r => r.datetime.replace(/\s+/g, ' ').trim() === fallbackDatetime) || null;
    }

    if (!earthquake && fallbackDatetime) {
      earthquake = fuzzyMatchRows(allRows, fallbackDatetime, lat, lng);
    }

    let title = 'TerraGuard - Earthquake Monitoring';
    let description = 'Real-time earthquake monitoring and alerts for the Philippines. Track seismic activity, view interactive maps, and stay informed with TerraGuard.';
    let imageUrl = `https://${host}/pwa-512x512.png`;

    if (earthquake) {
      const mag = parseFloat(earthquake.magnitude);
      const severityLabel = getSeverityLabel(mag);
      title = `M${earthquake.magnitude} Earthquake – ${earthquake.location}`;
      description = `A magnitude ${earthquake.magnitude} (${severityLabel}) earthquake occurred at ${earthquake.location} on ${earthquake.datetime}. Depth: ${earthquake.depth} km. View details on TerraGuard.`;

      if (!isNaN(lat) && !isNaN(lng)) {
        imageUrl = `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=7&size=600,300&l=map&pt=${lng},${lat},pm2rdl`;
      }
    }

    const canonicalUrl = `https://${host}/details/${id}`;
    const spaUrl = `${canonicalUrl}?_spa=1`;

    const ua = (request.headers.get('user-agent') || '').toLowerCase();
    const isBot = /bot|crawl|spider|slurp|facebookexternalhit|facebot|twitterbot|rogerbot|linkedinbot|embedly|quora|pinterest|slackbot|vkshare|discordbot|whatsapp|telegrambot|viber|outbrain|w3c_validator|redditbot|applebot|yandex|baiduspider|bingpreview|semrushbot|ahrefsbot|mj12bot|seznambot|duckduckbot|ia_archiver|mediapartners|google(?!chrome)/i.test(ua);

    if (!isBot) {
      return new Response(null, {
        status: 302,
        headers: { Location: spaUrl, 'Cache-Control': 's-maxage=300, stale-while-revalidate=86400', ...corsHeaders },
      });
    }

    const htmlResponse = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="600" />
    <meta property="og:image:height" content="300" />
    <meta property="og:site_name" content="TerraGuard" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
</head>
<body>
    <p>${title}</p>
    <p>${description}</p>
</body>
</html>`;

    return new Response(htmlResponse, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error('OG API Error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}
