export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const query = encodeURIComponent('earthquake location:Philippines');
    const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-PH&gl=PH&ceid=PH:en`;

    const response = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Google News responded with ${response.status}`);
    }

    const xml = await response.text();

    // Parse RSS items from XML using regex (no DOM in serverless)
    const items: Array<{
      title: string;
      link: string;
      pubDate: string;
      source: string;
    }> = [];

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

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
    return res.status(200).json({
      success: true,
      count: items.length,
      data: items,
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
