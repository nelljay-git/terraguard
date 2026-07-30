const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context: { request: Request }) {
  const { request } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return new Response(JSON.stringify({ success: false, error: 'Missing URL parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!response.ok) throw new Error(`PHIVOLCS responded with ${response.status}`);

    const html = await response.text();
    const cleanText = html
      .replace(/&nbsp;/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

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
      const urlObj = new URL(targetUrl);
      mapUrl = urlObj.origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1) + mapUrl;
    }

    return new Response(JSON.stringify({
      success: true,
      data: { origin, reportedIntensities: reported, instrumentalIntensities: instrumental, note, mapUrl },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=3600, stale-while-revalidate',
        ...corsHeaders,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
