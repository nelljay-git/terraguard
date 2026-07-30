export async function onRequest(request: Request): Promise<Response> {
  return new Response(
    JSON.stringify({ ok: true, path: '/api/test', timestamp: Date.now(), type: 'functions-working' }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}