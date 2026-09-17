// Manual "Post Video" endpoint behind the owner-gated button on /details.
// Verifies the caller's Supabase login (must match ADMIN_EMAIL), then fires
// a repository_dispatch to the free video renderer (GitHub Actions +
// node-canvas + FFmpeg). The PAT never touches the browser. No magnitude
// gate here — a human explicitly asked for this video.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const DEFAULT_ADMIN = 'gianganwneljae@gmail.com';
// Public-by-design values (also in src/lib/supabase.ts); env overrides win.
const DEFAULT_SUPABASE_URL = 'https://qiszvooehbfjteyrfryk.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpc3p2b29laGJmanRleXJmcnlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3Njc5NTIsImV4cCI6MjEwMTM0Mzk1Mn0.mW_DHjAOqu99PlvrkAuc_VO4CQ-EilsJzZClLVaacio';
const DEFAULT_REPO = 'nelljay-git/terraguard';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function esc(v: unknown): string {
  return String(v ?? '').trim();
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
  if (isNaN(lat) || isNaN(lng)) {
    return json({ success: false, error: 'Missing/invalid latitude/longitude' }, 400);
  }

  // --- 3. Fire the renderer ---
  const dispatchToken = String(e.GH_DISPATCH_TOKEN ?? '').trim();
  const repo = String(e.GH_REPO ?? DEFAULT_REPO).trim();
  if (!dispatchToken || !repo.includes('/')) {
    return json({ success: false, error: 'Video trigger not configured (GH_DISPATCH_TOKEN)' }, 500);
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${dispatchToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TerraGuard-Pages/1.0',
      },
      body: JSON.stringify({
        event_type: 'quake-video',
        client_payload: {
          source: esc(body.source) || 'manual',
          latitude: String(body.latitude),
          longitude: String(body.longitude),
          magnitude: String(body.magnitude ?? ''),
          depth: String(body.depth ?? ''),
          place: esc(body.location).slice(0, 90),
          datetime: esc(body.datetime),
        },
      }),
    });
    if (r.status !== 204) {
      return json({ success: false, error: `Dispatch HTTP ${r.status}` }, 502);
    }
    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
}
