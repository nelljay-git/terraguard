// Password reset via EmailJS-only OTP flow (Cloudflare Pages Functions).
//
// Supabase's built-in recovery email is rate-limited (2/hr), so we never call
// `resetPasswordForEmail`. Instead:
//   1. Client POSTs { action: "request", email } -> we mint a 6-char OTP
//      (stored hashed in public.password_resets) and email it to the user via
//      EmailJS's REST API. The OTP never touches the client bundle.
//   2. User types the OTP + a new password; client POSTs
//      { action: "reset", email, otp, password } -> we verify the hash and
//      update the password using the service-role key.
//
// Env vars (Cloudflare Pages -> Settings -> Environment variables):
//   SUPABASE_SERVICE_ROLE_KEY (required)
//   SUPABASE_URL (optional; falls back to the project URL below)

import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SUPABASE_URL_FALLBACK = 'https://qiszvooehbfjteyrfryk.supabase.co';

const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';
const EMAILJS_SERVICE_ID = 'service_7atkk9h';
const EMAILJS_TEMPLATE_ID = 'template_0bslren';
const EMAILJS_PUBLIC_KEY = 'QKx5bvjgbqcL3FGtZ';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function makeOtp(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function getAdminClient(env: Record<string, string | undefined>) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  return createClient(env.SUPABASE_URL ?? SUPABASE_URL_FALLBACK, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function sendOtpEmail(toEmail: string, otp: string): Promise<void> {
  const toName = toEmail.split('@')[0] ?? 'there';
  const res = await fetch(EMAILJS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: { to_email: toEmail, to_name: toName, otp },
    }),
  });
  if (!res.ok) {
    throw new Error(`EmailJS send failed (${res.status}).`);
  }
}

async function requestOtp(
  env: Record<string, string | undefined>,
  email: string
): Promise<{ success: boolean }> {
  const supabase = getAdminClient(env);
  const normalizedEmail = email.trim().toLowerCase();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  // Don't reveal whether the email exists.
  if (!profile) return { success: true };

  await supabase.rpc('cleanup_password_resets');

  // One active OTP at a time: expire any outstanding ones for this user.
  await supabase
    .from('password_resets')
    .update({ expires_at: new Date(0).toISOString() })
    .eq('user_id', profile.id)
    .is('used_at', null);

  const otp = makeOtp();
  const { error } = await supabase.from('password_resets').insert({
    user_id: profile.id,
    token_hash: await sha256(otp),
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });
  if (error) throw new Error('Database error while creating the reset code.');

  await sendOtpEmail(normalizedEmail, otp);

  return { success: true };
}

async function resetPassword(
  env: Record<string, string | undefined>,
  email: string,
  otp: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getAdminClient(env);
  const normalizedEmail = email.trim().toLowerCase();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (!profile) {
    return { success: false, error: 'This reset code is invalid or expired.' };
  }

  const { data: row } = await supabase
    .from('password_resets')
    .select('id, token_hash, expires_at, used_at, attempts')
    .eq('user_id', profile.id)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row || row.attempts >= OTP_MAX_ATTEMPTS) {
    return { success: false, error: 'This reset code is invalid or expired. Request a new one.' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { success: false, error: 'This reset code has expired. Request a new one.' };
  }
  if ((await sha256(otp)) !== row.token_hash) {
    const attempts = row.attempts + 1;
    await supabase.from('password_resets').update({ attempts }).eq('id', row.id);
    return {
      success: false,
      error: 'That code is not correct. Please try again.',
    };
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(profile.id, {
    password,
  });
  if (updateError) {
    throw new Error('Could not update the password. Please try again.');
  }

  await supabase
    .from('password_resets')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id);

  return { success: true };
}

export async function onRequest(context: {
  request: Request;
  env: Record<string, string | undefined>;
}) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  if (request.method !== 'POST') {
    return json(405, { success: false, error: 'Method not allowed' });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { success: false, error: 'Invalid request body.' });
  }

  try {
    const { action, email, otp, password } = body;

    if (action === 'request') {
      if (typeof email !== 'string' || !email.includes('@')) {
        return json(400, { success: false, error: 'Enter a valid email address.' });
      }
      const result = await requestOtp(env, email);
      return json(200, result);
    }

    if (action === 'reset') {
      if (typeof email !== 'string' || !email.includes('@')) {
        return json(400, { success: false, error: 'Enter a valid email address.' });
      }
      if (typeof otp !== 'string' || otp.length < 4) {
        return json(400, { success: false, error: 'Enter the code you received.' });
      }
      if (typeof password !== 'string' || password.length < 6) {
        return json(400, {
          success: false,
          error: 'Your new password needs to be at least 6 characters.',
        });
      }
      const result = await resetPassword(env, email, otp, password);
      return json(result.success ? 200 : 400, result);
    }

    return json(400, { success: false, error: 'Unknown action.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    console.error('reset-password error:', message);
    return json(500, { success: false, error: message });
  }
}
