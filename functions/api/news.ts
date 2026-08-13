const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

const MAX_ITEMS = 20;

// Google News RSS 503s from Cloudflare datacenter IPs (Google anti-bot block),
// so Bing News is tried first and Google News is used as a fallback.
const SOURCES = [
  {
    name: 'Bing News',
    url: 'https://www.bing.com/news/search?q=' + encodeURIComponent('earthquake Philippines') + '&format=rss&mkt=en-PH',
  },
  {
    name: 'Google News',
    url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('earthquake location:Philippines') + '&hl=en-PH&gl=PH&ceid=PH:en',
  },
] as const;

interface NewsArticle {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

function parseItems(xml: string, source: string): NewsArticle[] {
  const items: NewsArticle[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const itemXml = itemMatch[1];

    const titleMatch = /<title><!\[CDATA\[([\s\S]*?)\]\]>|<title>([\s\S]*?)<\/title>/i.exec(itemXml);
    const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(itemXml);
    const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(itemXml);
    const sourceMatch =
      /<source\b[^>]*>([\s\S]*?)<\/source>|<News:Source\b[^>]*>([\s\S]*?)<\/News:Source>/i.exec(itemXml);

    const title = (titleMatch?.[1] || titleMatch?.[2] || '').trim();
    let link = (linkMatch?.[1] || '').trim();
    const pubDate = (pubDateMatch?.[1] || '').trim();
    const itemSource = (sourceMatch?.[1] || sourceMatch?.[2] || source).trim();

    if (title && link) {
      link = resolveLink(link);
      items.push({ title, link, pubDate, source: itemSource });
    }

    if (items.length >= MAX_ITEMS) break;
  }

  return items;
}

// Bing wraps article URLs in a bing.com/news/apiclick redirect; unwrap it to the
// real article URL so external links open on the publisher's site.
function resolveLink(link: string): string {
  if (!link.includes('bing.com/news/apiclick')) return link;
  try {
    // The RSS encodes the query string with &amp; entities, which would make the
    // url= param unreadable by URLSearchParams unless unescaped first.
    const u = new URL(link.replace(/&amp;/g, '&'));
    const target = u.searchParams.get('url');
    if (target) return decodeURIComponent(target);
  } catch {
    // keep the original link if it can't be parsed
  }
  return link;
}

export async function onRequest(context: { request: Request }) {
  const { request } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const jsonResponse = (payload: unknown, cacheControl: string) =>
    new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl, ...corsHeaders },
    });

  try {
    let lastError = '';

    for (const src of SOURCES) {
      try {
        const response = await fetch(src.url, { headers: { 'User-Agent': USER_AGENT } });
        if (!response.ok) {
          lastError = `${src.name} responded with ${response.status}`;
          continue;
        }

        const xml = await response.text();
        const items = parseItems(xml, src.name);

        if (items.length > 0) {
          return jsonResponse({ success: true, count: items.length, data: items }, 's-maxage=600, stale-while-revalidate=300');
        }
        lastError = `${src.name} returned no items`;
      } catch (error) {
        lastError = `${src.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    return jsonResponse({ success: false, count: 0, data: [], error: lastError }, 'no-store');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ success: false, count: 0, data: [], error: message }, 'no-store');
  }
}
