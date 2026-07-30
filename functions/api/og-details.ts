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

export async function onRequest(context: { request: Request }) {
  const { request } = context;
  const url = new URL(request.url);
  const host = request.headers.get('host') || 'terraguard.vercel.app';

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const id = url.searchParams.get('id');
  if (!id) {
    return new Response('Missing ID', { status: 400 });
  }

  try {
    const decodedStr = decodeBase64(id);
    const parts = decodedStr.split('-');
    const lngStr = parts.pop() || '0';
    const latStr = parts.pop() || '0';
    const datetime = parts.join('-').trim();
    const lat = parseFloat(latStr.trim());
    const lng = parseFloat(lngStr.trim());

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

    const urlsToTry: string[] = [];
    if (targetYear === currentYear && targetMonthName === currentMonth) {
      urlsToTry.push('https://earthquake.phivolcs.dost.gov.ph/');
    }
    urlsToTry.push(`https://earthquake.phivolcs.dost.gov.ph/EQLatest-Monthly/${targetYear}/${targetYear}_${targetMonthName}.html`);

    const mIdx = MONTHS.indexOf(targetMonthName);
    const prevMonthIdx = mIdx === 0 ? 11 : mIdx - 1;
    const prevYear = mIdx === 0 ? targetYear - 1 : targetYear;
    urlsToTry.push(`https://earthquake.phivolcs.dost.gov.ph/EQLatest-Monthly/${prevYear}/${prevYear}_${MONTHS[prevMonthIdx]}.html`);

    let earthquake: { datetime: string; latitude: string; longitude: string; depth: string; magnitude: string; location: string } | null = null;

    const allRows: typeof earthquake[] = [];
    let fallbackDatetime: string | null = null;
    try {
      const dParts = decodedStr.split('-');
      if (dParts.length >= 3) {
        fallbackDatetime = dParts.slice(0, dParts.length - 2).join('-').replace(/\s+/g, ' ').trim();
      }
    } catch { /* ignore */ }

    for (const targetUrl of urlsToTry) {
      try {
        const response = await fetch(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        if (!response.ok) continue;

        const html = await response.text();
        const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch: RegExpExecArray | null;

        while ((rowMatch = rowRegex.exec(html)) !== null) {
          const rowHtml = rowMatch[1];
          const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
          const cells: string[] = [];
          let cellMatch: RegExpExecArray | null;

          while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
            cells.push(cellMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
          }

          if (cells.length >= 6) {
            const rowDatetime = cells[0];
            const rowLat = cells[1];
            const rowLng = cells[2];

            allRows.push({
              datetime: rowDatetime,
              latitude: rowLat,
              longitude: rowLng,
              depth: cells[3],
              magnitude: cells[4],
              location: cells[5],
            });

            const rowId = encodeBase64(`${rowDatetime}-${rowLat}-${rowLng}`);
            if (rowId === id) {
              earthquake = allRows[allRows.length - 1];
              break;
            }
          }
        }

        if (earthquake) break;
      } catch { /* continue */ }
    }

    if (!earthquake && fallbackDatetime) {
      earthquake = allRows.find(r => r.datetime.replace(/\s+/g, ' ').trim() === fallbackDatetime) || null;
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
        headers: { Location: spaUrl, 'Cache-Control': 'no-cache', ...corsHeaders },
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
        'Cache-Control': 's-maxage=3600, stale-while-revalidate',
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error('OG API Error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}
