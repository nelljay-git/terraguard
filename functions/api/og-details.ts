// @ts-nocheck

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getSeverityLabel(magnitude: number) {
  if (magnitude < 3.0) return 'Minor';
  if (magnitude < 4.5) return 'Light';
  if (magnitude < 6.0) return 'Moderate';
  if (magnitude < 7.0) return 'Strong';
  if (magnitude < 8.0) return 'Major';
  return 'Great';
}

export async function onRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!id || typeof id !== 'string') {
    return new Response('Missing ID', { status: 400, headers: corsHeaders });
  }

  try {
    const pad = id.length % 4;
    const paddedId = pad ? id + '='.repeat(4 - pad) : id;
    const decodedStr = atob(paddedId);

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
    const allRows: Array<{ datetime: string; latitude: string; longitude: string; depth: string; magnitude: string; location: string }> = [];
    let fallbackDatetime: string | null = null;

    try {
      const pad2 = id.length % 4;
      const paddedId2 = pad2 ? id + '='.repeat(4 - pad2) : id;
      const decodedStr2 = atob(paddedId2);
      const dParts = decodedStr2.split('-');
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
        let rowMatch;

        while ((rowMatch = rowRegex.exec(html)) !== null) {
          const rowHtml = rowMatch[1];
          const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
          const cells: string[] = [];
          let cellMatch;

          while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
            cells.push(cellMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
          }

          if (cells.length >= 6) {
            const rowDatetime = cells[0];
            const rowLat = cells[1];
            const rowLng = cells[2];
            const rowDepth = cells[3];
            const rowMag = cells[4];
            const rowLoc = cells[5];

            allRows.push({ datetime: rowDatetime, latitude: rowLat, longitude: rowLng, depth: rowDepth, magnitude: rowMag, location: rowLoc });

            const rowId = btoa(`${rowDatetime}-${rowLat}-${rowLng}`).replace(/=/g, '');
            if (rowId === id) {
              earthquake = allRows[allRows.length - 1];
              break;
            }
          }
        }

        if (earthquake) break;
      } catch { /* continue to next URL */ }
    }

    if (!earthquake && fallbackDatetime) {
      earthquake = allRows.find(r => r.datetime.replace(/\s+/g, ' ').trim() === fallbackDatetime) || null;
    }

    const origin = url.origin;
    let title = 'TerraGuard - Earthquake Monitoring';
    let description = 'Real-time earthquake monitoring and alerts for the Philippines. Track seismic activity, view interactive maps, and stay informed with TerraGuard.';
    let imageUrl = `${origin}/pwa-512x512.png`;

    if (earthquake) {
      const mag = parseFloat(earthquake.magnitude);
      const severityLabel = getSeverityLabel(mag);
      title = `M${earthquake.magnitude} Earthquake - ${earthquake.location}`;
      description = `A magnitude ${earthquake.magnitude} (${severityLabel}) earthquake occurred at ${earthquake.location} on ${earthquake.datetime}. Depth: ${earthquake.depth} km. View details on TerraGuard.`;

      if (!isNaN(lat) && !isNaN(lng)) {
        imageUrl = `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=7&size=600,300&l=map&pt=${lng},${lat},pm2rdl`;
      }
    }

    const canonicalUrl = `${origin}/details/${id}`;
    const spaUrl = `${canonicalUrl}?_spa=1`;

    const ua = (request.headers.get('user-agent') || '').toLowerCase();
    const isBot = /bot|crawl|spider|slurp|facebookexternalhit|facebot|twitterbot|rogerbot|linkedinbot|embedly|quora|pinterest|slackbot|vkshare|discordbot|whatsapp|telegrambot|viber|outbrain|w3c_validator|redditbot|applebot|yandex|baiduspider|bingpreview|semrushbot|ahrefsbot|mj12bot|seznambot|duckduckbot|ia_archiver|mediapartners|google(?!chrome)/i.test(ua);

    if (!isBot) {
      return new Response(null, { status: 302, headers: { ...corsHeaders, 'Location': spaUrl, 'Cache-Control': 'no-cache' } });
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
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html', 'Cache-Control': 's-maxage=3600, stale-while-revalidate' },
    });
  } catch (err) {
    return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
  }
}