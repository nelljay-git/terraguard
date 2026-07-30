export async function onRequest(request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    ok: true,
    message: 'Cloudflare Functions are working',
    timestamp: Date.now(),
    method: request.method,
    url: request.url,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}