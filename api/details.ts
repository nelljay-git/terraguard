// @ts-nocheck
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing or invalid URL parameter' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`PHIVOLCS responded with ${response.status}`);
    }

    const html = await response.text();
    const cleanText = html
      .replace(/&nbsp;/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const originMatch = /Origin\s*:\s*(.*?)\s*Magnitude/i.exec(cleanText);
    const origin = originMatch ? originMatch[1].trim() : 'Unknown';

    const reportedMatch = /Reported Intensities\s*:\s*(.*?)(?:Instrumental Intensities|This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
    let reported = reportedMatch ? reportedMatch[1].trim() : '';

    const instrumentalMatch = /Instrumental Intensities\s*:?\s*(.*?)(?:This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
    const instrumental = instrumentalMatch ? instrumentalMatch[1].trim() : '';

    const noteMatch = /(This is an aftershock.*?)(?:Expecting Damage|$)/i.exec(cleanText);
    const note = noteMatch ? noteMatch[1].trim() : '';

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
      const urlObj = new URL(url);
      mapUrl = urlObj.origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1) + mapUrl;
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).json({
      success: true,
      data: {
        origin,
        reportedIntensities: reported,
        instrumentalIntensities: instrumental,
        note,
        mapUrl
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Details API error:', message);
    return res.status(500).json({
      success: false,
      error: message
    });
  }
}
