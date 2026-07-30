export async function onRequest(request: Request): Promise<Response> {
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

  try {
    const query = encodeURIComponent('earthquake location:Philippines');
    const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-PH&gl=PH&ceid=PH:en`;

    const response = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
    });

    if (!response.ok) throw new Error(`Google News responded with ${response.status}`);

    const xml = await response.text();

    const items: Array<{ title: string; link: string; pubDate: string; source: string }> = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemRegex.exec(xml)) !== null) {
      const itemXml = itemMatch[1];
      const titleMatch = /<title><!\[CDATA\[([\s\S]*?)\]\]>|<title>([\s\S]*?)<\/title>/i.exec(itemXml);
      const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(itemXml);
      const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(itemXml);
      const sourceMatch = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(itemXml);

      const title = (titleMatch?.[1] || titleMatch?.[2] || '').trim();
      const link = (linkMatch?.[1] || '').trim();
      const pubDate = (pubDateMatch?.[1] || '').trim();
      const source = (sourceMatch?.[1] || '').trim();

      if (title && link) {
        items.push({ title, link, pubDate, source });
      }

      if (items.length >= 20) break;
    }

    return new Response(JSON.stringify({ success: true, count: items.length, data: items }), {
      status: 200,
      headers: { ...headers, 'Cache-Control': 's-maxage=600, stale-while-revalidate=300' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, count: 0, data: [], error: message }), { status: 200, headers });
  }
}