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
    return new Response(JSON.stringify({ success: false, error: 'Missing or invalid URL parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const m = /^(.+)_B(\d+)(F)?\.html$/i.exec(targetUrl);
  if (!m) {
    return new Response(JSON.stringify({ success: true, data: [] }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const prefix = m[1];
  const build = (n: number, final: boolean) => `${prefix}_B${n}${final ? 'F' : ''}.html`;

  const exists = async (candidate: string): Promise<boolean> => {
    try {
      const r = await fetch(candidate, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
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
    const [plain, final] = await Promise.all([exists(build(n, false)), exists(build(n, true))]);
    if (!plain && !final) break;
    if (plain) results.push({ no: n, final: false, url: build(n, false) });
    if (final) results.push({ no: n, final: true, url: build(n, true) });
  }

  return new Response(JSON.stringify({ success: true, data: results }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate',
      ...corsHeaders,
    },
  });
}
