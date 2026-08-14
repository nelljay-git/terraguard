// @ts-nocheck
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getSeverityLabel(magnitude: number) {
  if (magnitude < 3.0) return 'Minor';
  if (magnitude < 4.5) return 'Light';
  if (magnitude < 6.0) return 'Moderate';
  if (magnitude < 7.0) return 'Strong';
  if (magnitude < 8.0) return 'Major';
  return 'Great';
}

// PHIVOLCS tables and bulletins vary in format ("14 August 2026 - 07:53 AM",
// "13 Jun 2026 - 10:05:46 AM", etc.), so parse leniently to let revised event
// times still be compared as timestamps.
function parseDateTime(s) {
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
function fuzzyMatchRows(rows, datetimeStr, targetLat, targetLng) {
  const targetTime = parseDateTime(datetimeStr);
  if (targetTime == null) return null;
  const TIME_TOLERANCE_MIN = 5;
  const COORD_TOLERANCE_DEG = 5.0;

  let best = null;
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

export default async function handler(req: any, res: any) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).send('Missing ID');
  }

  try {
    // 1. Decode ID
    const pad = id.length % 4;
    const paddedId = pad ? id + '='.repeat(4 - pad) : id;
    const decodedStr = Buffer.from(paddedId, 'base64').toString('utf-8');

    // Robust parsing (lat and lng are always the last two parts)
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

    // 2. Determine URLs to fetch
    const currentYear = new Date().getFullYear();
    const currentMonth = MONTHS[new Date().getMonth()];

    const urlsToTry = [];
    if (targetYear === currentYear && targetMonthName === currentMonth) {
      urlsToTry.push('https://earthquake.phivolcs.dost.gov.ph/');
    }
    urlsToTry.push(`https://earthquake.phivolcs.dost.gov.ph/EQLatest-Monthly/${targetYear}/${targetYear}_${targetMonthName}.html`);

    // Fallback previous month just in case
    const mIdx = MONTHS.indexOf(targetMonthName);
    const prevMonthIdx = mIdx === 0 ? 11 : mIdx - 1;
    const prevYear = mIdx === 0 ? targetYear - 1 : targetYear;
    urlsToTry.push(`https://earthquake.phivolcs.dost.gov.ph/EQLatest-Monthly/${prevYear}/${prevYear}_${MONTHS[prevMonthIdx]}.html`);

    let earthquake = null;

    // Collect all rows first so we can fall back to datetime matching if the
    // exact ID no longer matches (PHIVOLCS may revise coordinate data).
    const allRows = [];
    let fallbackDatetime = null;
    try {
      const pad = id.length % 4;
      const paddedId = pad ? id + '='.repeat(4 - pad) : id;
      const decodedStr = Buffer.from(paddedId, 'base64').toString('utf-8');
      const dParts = decodedStr.split('-');
      if (dParts.length >= 3) {
        fallbackDatetime = dParts.slice(0, dParts.length - 2).join('-').replace(/\s+/g, ' ').trim();
      }
    } catch { /* ignore */ }

    for (const targetUrl of urlsToTry) {
      try {
        const response = await fetch(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 5000
        });

        if (!response.ok) continue;

        const html = await response.text();
        const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch;

        while ((rowMatch = rowRegex.exec(html)) !== null) {
          const rowHtml = rowMatch[1];
          const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
          const cells = [];
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

            allRows.push({
              datetime: rowDatetime,
              latitude: rowLat,
              longitude: rowLng,
              depth: rowDepth,
              magnitude: rowMag,
              location: rowLoc
            });

            const rowId = Buffer.from(`${rowDatetime}-${rowLat}-${rowLng}`).toString('base64').replace(/=/g, '');

            if (rowId === id) {
              earthquake = allRows[allRows.length - 1];
              break;
            }
          }
        }

        if (earthquake) break;
      } catch (err) {
        // Continue to next URL
      }
    }

    // Fallback: match by the stable datetime portion of the original ID so
    // shared links keep working even after PHIVOLCS revises the event data.
    if (!earthquake && fallbackDatetime) {
      earthquake = allRows.find(r => r.datetime.replace(/\s+/g, ' ').trim() === fallbackDatetime) || null;
    }

    // PHIVOLCS also revises the origin time (sometimes by a minute or more), so
    // fall back to fuzzy time + coordinate matching.
    if (!earthquake && fallbackDatetime) {
      earthquake = fuzzyMatchRows(allRows, fallbackDatetime, lat, lng);
    }

    // 3. Build meta content
    let title = 'TerraGuard - Earthquake Monitoring';
    let description = 'Real-time earthquake monitoring and alerts for the Philippines. Track seismic activity, view interactive maps, and stay informed with TerraGuard.';
    let imageUrl = `https://${req.headers.host || 'terraguard.vercel.app'}/pwa-512x512.png`;

    if (earthquake) {
      const mag = parseFloat(earthquake.magnitude);
      const severityLabel = getSeverityLabel(mag);
      title = `M${earthquake.magnitude} Earthquake – ${earthquake.location}`;
      description = `A magnitude ${earthquake.magnitude} (${severityLabel}) earthquake occurred at ${earthquake.location} on ${earthquake.datetime}. Depth: ${earthquake.depth} km. View details on TerraGuard.`;

      if (!isNaN(lat) && !isNaN(lng)) {
        imageUrl = `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=7&size=600,300&l=map&pt=${lng},${lat},pm2rdl`;
      }
    }

    const canonicalUrl = `https://${req.headers.host || 'terraguard.vercel.app'}/details/${id}`;
    const spaUrl = `${canonicalUrl}?_spa=1`;

    // 4. Detect crawlers vs human browsers
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    const isBot = /bot|crawl|spider|slurp|facebookexternalhit|facebot|twitterbot|rogerbot|linkedinbot|embedly|quora|pinterest|slackbot|vkshare|discordbot|whatsapp|telegrambot|viber|outbrain|w3c_validator|redditbot|applebot|yandex|baiduspider|bingpreview|semrushbot|ahrefsbot|mj12bot|seznambot|duckduckbot|ia_archiver|mediapartners|google(?!chrome)/i.test(ua);

    // For human browsers: instant invisible 302 redirect (no flash, no raw URL)
    if (!isBot) {
      res.setHeader('Location', spaUrl);
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(302).end();
    }

    // For bots/crawlers: serve the full OG HTML
    const htmlResponse = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <meta name="description" content="${description}" />

    <!-- Open Graph -->
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="600" />
    <meta property="og:image:height" content="300" />
    <meta property="og:site_name" content="TerraGuard" />

    <!-- Twitter -->
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

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).send(htmlResponse);

  } catch (err) {
    console.error('OG API Error:', err);
    return res.status(500).send('Internal Server Error');
  }
}
