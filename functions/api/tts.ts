// Spoken intro-line proxy for video exports: ?text= -> MP3 audio.
// The browser can't fetch Google TTS directly (no CORS headers), so the
// export path plays it through here; the headless renderer calls Google
// directly. Keyless, ~200 chars/request, cached per text.

function googleTtsUrl(text: string): string {
  return `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(text.slice(0, 180))}`;
}

export async function onRequest(context: { request: Request }) {
  const { request } = context;
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }
  let text = '';
  try {
    text = (new URL(request.url).searchParams.get('text') || '').trim().slice(0, 180);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (!text) return new Response('Missing text', { status: 400 });
  try {
    const res = await fetch(googleTtsUrl(text), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        Referer: 'https://translate.google.com/',
      },
    });
    if (!res.ok || !res.body) {
      return new Response('TTS upstream failed', { status: 502 });
    }
    return new Response(res.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'TTS failed', { status: 502 });
  }
}
