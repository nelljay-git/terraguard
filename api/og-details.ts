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
            
            const rowId = Buffer.from(`${rowDatetime}-${rowLat}-${rowLng}`).toString('base64').replace(/=/g, '');
            
            if (rowId === id) {
              earthquake = {
                datetime: rowDatetime,
                latitude: rowLat,
                longitude: rowLng,
                depth: rowDepth,
                magnitude: rowMag,
                location: rowLoc
              };
              break;
            }
          }
        }
        
        if (earthquake) break;
      } catch (err) {
        // Continue to next URL
      }
    }
    
    // 3. Generate HTML
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
    
    // Fetch the actual React app index.html
    const appUrl = `https://${req.headers.host || 'terraguard.vercel.app'}/index.html`;
    let baseHtml = '';
    try {
      const htmlRes = await fetch(appUrl);
      if (htmlRes.ok) baseHtml = await htmlRes.text();
    } catch (e) {
      console.error('Failed to fetch base HTML', e);
    }
    
    const metaTags = `
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="https://${req.headers.host || 'terraguard.vercel.app'}/details/${id}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="600" />
    <meta property="og:image:height" content="300" />
    <meta property="og:site_name" content="TerraGuard" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
    `;

    let htmlResponse = baseHtml;
    if (baseHtml) {
      // Replace the <title> tag and everything up to the end of default OG tags
      htmlResponse = baseHtml.replace(/<title>.*?<\/title>/i, '');
      // Inject our new tags into the head
      htmlResponse = htmlResponse.replace('</head>', `${metaTags}\n</head>`);
    } else {
      // Fallback if index.html fetch fails
      htmlResponse = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${metaTags}
</head>
<body>
    <p>Redirecting to <a href="/details/${id}">TerraGuard Details</a>...</p>
    <script>window.location.replace('/details/${id}');</script>
</body>
</html>`;
    }

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).send(htmlResponse);
    
  } catch (err) {
    console.error('OG API Error:', err);
    return res.status(500).send('Internal Server Error');
  }
}
