export async function onRequest(request: Request): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const res = await fetch('https://earthquake.phivolcs.dost.gov.ph/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    const text = await res.text();
    return new Response(JSON.stringify({
      fetchStatus: res.status,
      fetchOk: res.ok,
      contentType: res.headers.get('content-type'),
      bodyLength: text.length,
      sample: text.substring(0, 500),
    }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({
      fetchStatus: 'error',
      error: e instanceof Error ? e.message : String(e),
    }), { status: 500, headers });
  }
}