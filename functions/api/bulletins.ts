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

  const m = /^(.+)_B(\d+)(F)?\.html$/i.exec(eventUrl);
  if (!m) {
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200, headers });
  }

  const prefix = m[1];
  const build = (n: number, final: boolean) => `${prefix}_B${n}${final ? 'F' : ''}.html`;

  const exists = async (candidate: string): Promise<boolean> => {
    try {
      const r = await fetch(candidate, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
      });
      if (!r.ok) return false;
      const html = await r.text();
      return /EARTHQUAKE INFORMATION/i.test(html);
    } catch {
      return false;
    }
  };

  const results: { no: number; final: boolean; url: string }[] = [];
  for (let n = 1; n <= 30; n++) {
    const [plain, last] = await Promise.all([exists(build(n, false)), exists(build(n, true))]);
    if (!plain && !last) break;
    if (plain) results.push({ no: n, final: false, url: build(n, false) });
    if (last) results.push({ no: n, final: true, url: build(n, true) });
  }

  return new Response(JSON.stringify({ success: true, data: results }), {
    status: 200,
    headers: { ...headers, 'Cache-Control': 's-maxage=3600, stale-while-revalidate' },
  });
}