// @ts-nocheck

export async function onRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const eventUrl = url.searchParams.get('url');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405, headers });
  }

  if (!eventUrl || typeof eventUrl !== 'string') {
    return new Response(JSON.stringify({ success: false, error: 'Missing or invalid URL parameter' }), { status: 400, headers });
  }

  try {
    const response = await fetch(eventUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
    });

    if (!response.ok) throw new Error(`PHIVOLCS responded with ${response.status}`);

    const html = await response.text();
    const cleanText = html.replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const originMatch = /Origin\s*:\s*(.*?)\s*Magnitude/i.exec(cleanText);
    const origin = originMatch ? originMatch[1].trim() : 'Unknown';

    const reportedMatch = /Reported Intensities\s*:\s*(.*?)(?:Instrumental Intensities|This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
    let reported = reportedMatch ? reportedMatch[1].replace(/^[a-zA-Z0-9_.\s]+Intensity/i, 'Intensity').trim() : '';

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
      const eventUrlObj = new URL(eventUrl);
      mapUrl = eventUrlObj.origin + eventUrlObj.pathname.substring(0, eventUrlObj.pathname.lastIndexOf('/') + 1) + mapUrl;
    }

    return new Response(JSON.stringify({
      success: true,
      data: { origin, reportedIntensities: reported, instrumentalIntensities: instrumental, note, mapUrl },
    }), { status: 200, headers: { ...headers, 'Cache-Control': 's-maxage=3600, stale-while-revalidate' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), { status: 500, headers });
  }
}