// Manual "Post to Facebook" endpoint for the gated button on /details.
// The Page access token MUST NOT ship to browsers, so the browser only
// sends the quake + its Supabase login token; everything secret stays here.
//
// Auth: the caller's Supabase access token is validated against the Auth
// API (anon key is public by design), then the token owner's email must
// match ADMIN_EMAIL (defaults to the site owner). Non-admins get 403 and
// the endpoint can never be abused to post as the Page.
//
// Required Pages env: FB_PAGE_ID, FB_USER_ACCESS_TOKEN, FB_APP_SECRET.
// Optional: ADMIN_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const FB_GRAPH_VERSION = 'v21.0';
const DEFAULT_ADMIN = 'gianganwneljae@gmail.com';
// Public-by-design values (also in src/lib/supabase.ts); env overrides win.
const DEFAULT_SUPABASE_URL = 'https://qiszvooehbfjteyrfryk.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpc3p2b29laGJmanRleXJmcnlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3Njc5NTIsImV4cCI6MjEwMTM0Mzk1Mn0.mW_DHjAOqu99PlvrkAuc_VO4CQ-EilsJzZClLVaacio';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function esc(s: unknown): string {
  return String(s ?? '').trim();
}

function magPrefix(mag: number): string {
  if (isNaN(mag)) return '';
  if (mag >= 7) return '‼️MAJOR‼️ ';
  if (mag >= 6) return '🟥 ';
  if (mag >= 5) return '🟧 ';
  if (mag >= 4) return '🟨 ';
  if (mag >= 3) return '🟦 ';
  return '🟩 ';
}

function sourceTag(source: string): string {
  const s = source.toLowerCase();
  if (s === 'usgs') return 'USGS';
  if (s === 'emsc') return 'EMSC';
  return 'PHIVOLCS';
}

// Split a Details-page datetime into display parts. PHIVOLCS strings are
// PHT wall time ("14 September 2026 - 05:22 PM"); USGS/EMSC normalized
// strings are UTC ("14 September 2026 - 09:22:15 UTC").
function displayParts(datetime: string, source: string): { date: string; time: string } {
  const raw = esc(datetime);
  if (sourceTag(source) === 'PHIVOLCS') {
    const m = /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*-\s*(\d{1,2}:\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(raw);
    if (!m) return { date: raw, time: '' };
    const ap = (m[3] || '').toUpperCase();
    return { date: m[1].trim(), time: `${m[2]}${ap ? ` ${ap}` : ''} PHT`.trim() };
  }
  const m = /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*-\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(raw);
  if (!m) return { date: raw, time: '' };
  let h = parseInt(m[2], 10);
  const ap = (m[4] || '').toUpperCase();
  if (ap) return { date: m[1].trim(), time: `${h}:${m[3]} ${ap} UTC` };
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { date: m[1].trim(), time: `${h}:${m[3]} ${ampm} UTC` };
}

function hashtags(location: string, tag: string): string {
  const base = ['#Earthquake', `#${tag}`, '#TerraGuard', '#EarthquakeReport', '#SeismicActivity', '#StaySafe'];
  if (/philipp/i.test(location)) {
    return [...base, '#Philippines', '#EarthquakePH', '#Lindol', '#TerraGuardPH'].join(' ');
  }
  return [...base, '#BreakingNews', '#NaturalDisaster'].join(' ');
}

async function resolvePageToken(env: Record<string, unknown>, appSecretProof: (t: string) => Promise<string | null>): Promise<string | null> {
  const userToken = String(env.FB_USER_ACCESS_TOKEN ?? '').trim();
  const pageId = String(env.FB_PAGE_ID ?? '').trim();
  if (!userToken || !pageId) return null;
  try {
    const url = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/me/accounts`);
    url.searchParams.set('access_token', userToken);
    url.searchParams.set('fields', 'id,name,access_token');
    url.searchParams.set('limit', '50');
    const proof = await appSecretProof(userToken);
    if (proof) url.searchParams.set('appsecret_proof', proof);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id: string | number; access_token?: string }> };
    const match = (data?.data ?? []).find((p) => String(p.id) === String(pageId));
    return match?.access_token ? String(match.access_token) : null;
  } catch {
    return null;
  }
}

export async function onRequest(context: { request: Request; env?: Record<string, unknown> }) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  const e: Record<string, unknown> = env ?? {};

  // --- 1. Authenticate + authorize the caller ---
  const adminEmail = String(e.ADMIN_EMAIL ?? DEFAULT_ADMIN).toLowerCase();
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json({ success: false, error: 'Missing login token' }, 401);
  const supabaseUrl = String(e.SUPABASE_URL ?? DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const anonKey = String(e.SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY);
  const getCallerEmail = async (): Promise<string | null> => {
    try {
      const me = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      });
      if (!me.ok) return null;
      const meJson = (await me.json()) as { email?: string };
      return String(meJson?.email ?? '').toLowerCase() || null;
    } catch {
      return null;
    }
  };
  const callerEmail = await getCallerEmail();
  if (!callerEmail) {
    return json({ success: false, error: 'Invalid login token' }, 401);
  }
  if (callerEmail !== adminEmail) {
    return json({ success: false, error: 'Not authorized' }, 403);
  }

  // --- 2. Validate the quake payload ---
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const lat = parseFloat(String(body.latitude ?? ''));
  const lng = parseFloat(String(body.longitude ?? ''));
  const mag = parseFloat(String(body.magnitude ?? ''));
  const place = esc(body.location) || `${body.latitude ?? ''}, ${body.longitude ?? ''}`;
  const depth = esc(body.depth) || '?';
  const tag = sourceTag(esc(body.source));
  const pageUrl = esc(body.pageUrl);
  const sourceLink = esc(body.sourceLink);
  if (!place || !pageUrl) return json({ success: false, error: 'Missing location/pageUrl' }, 400);

  const { date, time } = displayParts(esc(body.datetime), tag);
  const timeBare = time.replace(/\s*(UTC|PHT|UST)\s*$/i, '').trim();
  const lines = [
    `${magPrefix(mag)}JUST IN: A Magnitude: ${esc(body.magnitude) || '?'} struck near ${place} on ${date}${timeBare ? ` - ${timeBare}` : ''}`,
    ``,
    `Magnitude: ${esc(body.magnitude) || '?'}`,
    `Location: ${place}`,
    `Date & Time: ${date}${timeBare ? ` - ${timeBare}` : ''}`,
    `Depth: ${depth} km`,
  ];
  if (!isNaN(lat) && !isNaN(lng)) {
    lines.push(`Coordinates: ${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E`);
  }
  lines.push(
    ``,
    `Earthquake Info: ${pageUrl}`,
    `Please take note that this is not the final report. pleminary information`,
    ``,
    `Source: ${tag}${sourceLink ? `\nBulletin: ${sourceLink}` : ''}`,
    ``,
    `Join our discord for discussions: https://discord.gg/tdGrvnvehP`,
    ``,
    hashtags(place, tag),
  );
  const message = lines.join('\n');

  // --- 3. Post to Facebook (designed card photo, /feed fallback) ---
  const pageId = String(e.FB_PAGE_ID ?? '').trim();
  const userToken = String(e.FB_USER_ACCESS_TOKEN ?? '').trim();
  const appSecret = String(e.FB_APP_SECRET ?? '').trim();
  if (!pageId || !userToken) {
    return json({ success: false, error: 'Facebook is not configured (FB_PAGE_ID / FB_USER_ACCESS_TOKEN)' }, 500);
  }
  const cryptoSubtle = crypto?.subtle;
  const proofFor = async (t: string): Promise<string | null> => {
    try {
      if (!t || !appSecret || !cryptoSubtle) return null;
      const key = await cryptoSubtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await cryptoSubtle.sign('HMAC', key, new TextEncoder().encode(t));
      return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;
    }
  };
  let pageToken = await resolvePageToken(e, proofFor);
  if (!pageToken) pageToken = userToken;
  const proof = await proofFor(pageToken);
  const withProof = (p: Record<string, string>) => (proof ? { ...p, appsecret_proof: proof } : p);

  const hasCoords = !isNaN(lat) && !isNaN(lng);
  const cardParams = hasCoords
    ? new URLSearchParams({
        lat: String(body.latitude),
        lng: String(body.longitude),
        mag: String(body.magnitude ?? ''),
        place: place.slice(0, 90),
        date,
        time,
        depth: String(body.depth ?? ''),
        source: tag,
      }).toString()
    : '';
  const cardUrl =
    hasCoords && cardParams ? `https://trikefare.x10.mx/terraguard/api/quake-card.php?${cardParams}` : null;
  if (cardUrl) {
    try {
      const warm = await fetch(cardUrl, { headers: { 'User-Agent': 'TerraGuard-FB-Warmup/1.0' } });
      if (warm.ok) {
        const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withProof({ access_token: pageToken, caption: message, url: cardUrl })),
        });
        const data = (await res.json().catch(() => ({}))) as { post_id?: string; id?: string; error?: { message?: string } };
        if (res.ok && (data.post_id || data.id)) {
          return json({ success: true, id: data.post_id ?? data.id });
        }
      }
    } catch {
      /* fall through to /feed */
    }
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withProof({ access_token: pageToken, message, link: pageUrl })),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !data?.id) {
      return json({ success: false, error: data?.error?.message ?? `Facebook HTTP ${res.status}` }, 502);
    }
    return json({ success: true, id: data.id });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
}
