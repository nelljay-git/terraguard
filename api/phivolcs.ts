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

  try {
    const pathQuery = req.query.path as string;
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

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      count: earthquakes.length,
      data: earthquakes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(200).json({
      success: false,
      count: 0,
      data: [],
      error: message,
    });
  }
}
