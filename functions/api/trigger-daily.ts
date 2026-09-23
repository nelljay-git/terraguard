// Manual "Trigger Daily Earth Report" behind the owner-gated button on Dashboard.
// Verifies caller's Supabase login (must match ADMIN_EMAIL), then triggers
// the daily-earth-report workflow (workflow_dispatch). PAT never touches browser.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const DEFAULT_ADMIN = 'gianganwneljae@gmail.com';
const DEFAULT_SUPABASE_URL = 'https://qiszvooehbfjteyrfryk.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpc3p2b29laGJmanRleXJmcnlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3Njc5NTIsImV4cCI6MjEwMTM0Mzk1Mn0.mW_DHjAOqu99PlvrkAuc_VO4CQ-EilsJzZClLVaacio';
const DEFAULT_REPO = 'nelljay-git/terraguard';
const WORKFLOW_FILE = 'daily-earth-report.yml';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

export async function onRequest(context: { request: Request; env?: Record<string, unknown> }) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  const e: Record<string, unknown> = env ?? {};

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
  if (!callerEmail) return json({ success: false, error: 'Invalid login token' }, 401);
  if (callerEmail !== adminEmail) return json({ success: false, error: 'Not authorized' }, 403);

  const dispatchToken = String(e.GH_DISPATCH_TOKEN ?? '').trim();
  const repo = String(e.GH_REPO ?? DEFAULT_REPO).trim();
  if (!dispatchToken || !repo.includes('/')) {
    return json({ success: false, error: 'Trigger not configured (GH_DISPATCH_TOKEN)' }, 500);
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${dispatchToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TerraGuard-Pages/1.0',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (r.status !== 204) {
      const t = await r.text().catch(() => '');
      return json({ success: false, error: `GitHub HTTP ${r.status}: ${t.slice(0,300)}` }, 502);
    }
    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
}
