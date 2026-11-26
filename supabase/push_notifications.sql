-- =============================================================================
-- TerraGuard — Push notifications (FCM) schema.
--
-- Run once in the Supabase SQL editor (Dashboard -> SQL -> New query).
-- New tables: fcm_tokens (device registrations + per-device prefs),
-- processed_quakes (monitor dedup/decision store), notification_log (audit).
--
-- The Cloudflare monitor worker (worker-webhook) uses the anon key via PostgREST
-- (RLS is permissive — tokens are ephemeral device-registrations). The web app
-- writes tokens/prefs via PostgREST with the anon key. Nothing private here.
-- =============================================================================

create table if not exists public.fcm_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,                     -- FCM token; unique per device install
  user_id uuid references auth.users (id) on delete cascade,
  platform text not null default 'android',
  app_version text,
  os_version text,
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen timestamptz,
  last_error text
);

-- RLS: permissive (the token itself is the bearer; rows hold no private data).
-- NOTE: Postgres has no CREATE POLICY IF NOT EXISTS — drop first, then create,
-- so this file stays re-runnable.
alter table public.fcm_tokens enable row level security;
drop policy if exists "fcm_tokens: anyone may select" on public.fcm_tokens;
create policy "fcm_tokens: anyone may select"
  on public.fcm_tokens for select using (true);
drop policy if exists "fcm_tokens: anyone may insert" on public.fcm_tokens;
create policy "fcm_tokens: anyone may insert"
  on public.fcm_tokens for insert with check (true);
drop policy if exists "fcm_tokens: anyone may update" on public.fcm_tokens;
create policy "fcm_tokens: anyone may update"
  on public.fcm_tokens for update using (true) with check (true);
drop policy if exists "fcm_tokens: anyone may delete" on public.fcm_tokens;
create policy "fcm_tokens: anyone may delete"
  on public.fcm_tokens for delete using (true);

-- The monitor's dedup/decision store — one row per distinct event.
-- event_key is the stable event identity ("<source>:<datetime>|<lat>|<lng>" for
-- PHIVOLCS; "<source>:<native id>" for USGS/EMSC). correlation_key points at the
-- representative event when a new source event correlates with an existing one.
create table if not exists public.processed_quakes (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  source text not null,
  datetime text not null,
  latitude numeric(6,4) not null,                 -- -90..90
  longitude numeric(7,4) not null,                -- -180..180
  depth numeric not null,
  magnitude numeric not null,
  location text not null,
  correlation_key text not null,
  update_count int not null default 0,
  first_seen timestamptz not null default now(),
  seen_at timestamptz not null default now()
);

create index if not exists processed_quakes_space_idx
  on public.processed_quakes (latitude, longitude);

-- Delivery audit trail — one row per notification send attempt.
-- token_id is nullable + ON DELETE SET NULL so pruning a dead device keeps
-- the history of what was attempted (cascade would erase the evidence).
create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  token_id uuid references public.fcm_tokens (id) on delete set null,
  event_key text not null,
  category text not null,                          -- 'new' | 'significant' | 'nearby' | 'update'
  payload jsonb not null,
  sent_at timestamptz not null default now(),
  fcm_status text not null,                        -- 'sent' | 'error'
  error text
);

create index if not exists notification_log_token_idx
  on public.notification_log (token_id, sent_at desc);

-- Migration for databases created before the ON DELETE SET NULL change above.
alter table public.notification_log alter column token_id drop not null;
alter table public.notification_log drop constraint if exists notification_log_token_id_fkey;
alter table public.notification_log
  add constraint notification_log_token_id_fkey
  foreign key (token_id) references public.fcm_tokens (id) on delete set null;

-- Row Level Security for tables the worker writes (service-role/anon usage).
alter table public.processed_quakes enable row level security;
drop policy if exists "processed_quakes: worker access" on public.processed_quakes;
create policy "processed_quakes: worker access"
  on public.processed_quakes for select using (true);
drop policy if exists "processed_quakes: insert" on public.processed_quakes;
create policy "processed_quakes: insert"
  on public.processed_quakes for insert with check (true);
drop policy if exists "processed_quakes: update" on public.processed_quakes;
create policy "processed_quakes: update"
  on public.processed_quakes for update using (true) with check (true);
drop policy if exists "processed_quakes: delete" on public.processed_quakes;
create policy "processed_quakes: delete"
  on public.processed_quakes for delete using (true);
alter table public.notification_log enable row level security;
drop policy if exists "notification_log: insert" on public.notification_log;
create policy "notification_log: insert"
  on public.notification_log for insert with check (true);
