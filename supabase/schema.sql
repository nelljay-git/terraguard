-- =============================================================================
-- TerraGuard - Supabase schema
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL -> New query)
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Profiles (mirrors auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  username text,
  created_at timestamptz not null default now()
);

-- Auto-create a profile whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, username)
  values (new.id, new.email, split_part(new.email, '@', 1));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Stars (favorited earthquakes). eq_id is the /details/:id slug (base64 of
-- "datetime-lat-lng"). We snapshot the earthquake fields so the Stars page can
-- render without re-fetching PHIVOLCS history.
-- -----------------------------------------------------------------------------
create table if not exists public.stars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  eq_id text not null,
  datetime text,
  latitude text,
  longitude text,
  depth text,
  magnitude text,
  location text,
  created_at timestamptz not null default now(),
  unique (user_id, eq_id)
);

create index if not exists stars_user_idx on public.stars (user_id);
create index if not exists stars_eq_idx on public.stars (eq_id);

-- -----------------------------------------------------------------------------
-- Likes on events
-- -----------------------------------------------------------------------------
create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  eq_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, eq_id)
);

create index if not exists likes_user_idx on public.likes (user_id);
create index if not exists likes_eq_idx on public.likes (eq_id);

-- -----------------------------------------------------------------------------
-- Comments on events
-- -----------------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  eq_id text not null,
  content text not null check (char_length(content) between 1 and 500),
  author text,
  created_at timestamptz not null default now()
);

create index if not exists comments_eq_idx on public.comments (eq_id, created_at desc);

-- Stamp the author display name from the profile automatically (server-side,
-- so clients cannot spoof it)
create or replace function public.set_comment_author()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  pname text;
begin
  select coalesce(username, split_part(email, '@', 1))
    into pname
    from public.profiles
   where id = new.user_id;
  new.author := coalesce(pname, 'user');
  return new;
end;
$$;

drop trigger if exists set_comment_author_trg on public.comments;
create trigger set_comment_author_trg
  before insert on public.comments
  for each row execute procedure public.set_comment_author();

-- -----------------------------------------------------------------------------
-- Rate limiting (server-side anti-spam).
--
-- Clients only talk to PostgREST, so a BEFORE INSERT trigger is the enforcement
-- point. The functions below run as `security definer` (bypass RLS) and write to
-- an internal table clients can never read.
-- -----------------------------------------------------------------------------
create table if not exists public.rate_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_events_user_idx
  on public.rate_events (user_id, event_type, created_at desc);

alter table public.rate_events enable row level security;

-- Purge a user's stale events on every write to keep the table bounded.
create or replace function public.prune_rate_events(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.rate_events
   where user_id = p_user_id
     and created_at < now() - interval '1 day';
end;
$$;

-- Comments: max 3 per minute, max 15 per hour, and min 10s between comments.
create or replace function public.check_comment_rate_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  cnt_minute int;
  cnt_hour int;
  last_ts timestamptz;
begin
  perform public.prune_rate_events(new.user_id);

  select count(*) into cnt_minute
    from public.rate_events
   where user_id = new.user_id
     and event_type = 'comment'
     and created_at > now() - interval '1 minute';

  select count(*) into cnt_hour
    from public.rate_events
   where user_id = new.user_id
     and event_type = 'comment'
     and created_at > now() - interval '1 hour';

  if cnt_minute >= 3 then
    raise exception 'You are commenting too fast. Please wait a minute.';
  end if;

  if cnt_hour >= 15 then
    raise exception 'Comment limit reached for this hour. Please try again later.';
  end if;

  select max(created_at) into last_ts
    from public.comments
   where user_id = new.user_id;

  if last_ts is not null and (now() - last_ts) < interval '10 seconds' then
    raise exception 'Please wait a few seconds before commenting again.';
  end if;

  insert into public.rate_events (user_id, event_type) values (new.user_id, 'comment');
  return new;
end;
$$;

drop trigger if exists enforce_comment_rate_limit_trg on public.comments;
create trigger enforce_comment_rate_limit_trg
  before insert on public.comments
  for each row execute procedure public.check_comment_rate_limit();

-- Star/like toggles: idempotent (unique user_id+eq_id), but block scripted
-- rapid insert cycling with a generous per-minute cap.
create or replace function public.check_toggle_rate_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  cnt int;
  event text := TG_ARGV[0];
begin
  perform public.prune_rate_events(new.user_id);

  select count(*) into cnt
    from public.rate_events
   where user_id = new.user_id
     and event_type = event
     and created_at > now() - interval '1 minute';

  if cnt >= 10 then
    raise exception 'Rate limit exceeded. Please try again later.';
  end if;

  insert into public.rate_events (user_id, event_type) values (new.user_id, event);
  return new;
end;
$$;

drop trigger if exists enforce_like_rate_limit_trg on public.likes;
create trigger enforce_like_rate_limit_trg
  before insert on public.likes
  for each row execute procedure public.check_toggle_rate_limit('like');

drop trigger if exists enforce_star_rate_limit_trg on public.stars;
create trigger enforce_star_rate_limit_trg
  before insert on public.stars
  for each row execute procedure public.check_toggle_rate_limit('star');

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.stars enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;

drop policy if exists "profiles are viewable by everyone" on public.profiles;
create policy "profiles are viewable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "stars are viewable by everyone" on public.stars;
create policy "stars are viewable by everyone"
  on public.stars for select
  using (true);

drop policy if exists "users can insert own star" on public.stars;
create policy "users can insert own star"
  on public.stars for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can delete own star" on public.stars;
create policy "users can delete own star"
  on public.stars for delete
  using (auth.uid() = user_id);

drop policy if exists "likes are viewable by everyone" on public.likes;
create policy "likes are viewable by everyone"
  on public.likes for select
  using (true);

drop policy if exists "users can insert own like" on public.likes;
create policy "users can insert own like"
  on public.likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can delete own like" on public.likes;
create policy "users can delete own like"
  on public.likes for delete
  using (auth.uid() = user_id);

drop policy if exists "comments are viewable by everyone" on public.comments;
create policy "comments are viewable by everyone"
  on public.comments for select
  using (true);

drop policy if exists "users can insert own comment" on public.comments;
create policy "users can insert own comment"
  on public.comments for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update own comment" on public.comments;
create policy "users can update own comment"
  on public.comments for update
  using (auth.uid() = user_id);

drop policy if exists "users can delete own comment" on public.comments;
create policy "users can delete own comment"
  on public.comments for delete
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Optional: realtime for comments (enable after table creation if desired)
-- -----------------------------------------------------------------------------
-- alter publication supabase_realtime add table public.comments;

-- -----------------------------------------------------------------------------
-- Comment likes
-- -----------------------------------------------------------------------------
create table if not exists public.comment_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  comment_id uuid not null references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, comment_id)
);

create index if not exists comment_likes_user_idx on public.comment_likes (user_id);
create index if not exists comment_likes_comment_idx on public.comment_likes (comment_id);

alter table public.comment_likes enable row level security;

drop policy if exists "comment likes are viewable by everyone" on public.comment_likes;
create policy "comment likes are viewable by everyone"
  on public.comment_likes for select
  using (true);

drop policy if exists "users can insert own comment like" on public.comment_likes;
create policy "users can insert own comment like"
  on public.comment_likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can delete own comment like" on public.comment_likes;
create policy "users can delete own comment like"
  on public.comment_likes for delete
  using (auth.uid() = user_id);

-- Rate limit for comment likes (reuses the toggle limiter)
drop trigger if exists enforce_comment_like_rate_limit_trg on public.comment_likes;
create trigger enforce_comment_like_rate_limit_trg
  before insert on public.comment_likes
  for each row execute procedure public.check_toggle_rate_limit('comment_like');

-- Per-comment like counts + whether the current user liked them, for one event.
create or replace function public.get_comment_likes(p_eq_id text)
returns table (comment_id uuid, like_count bigint, liked boolean)
language sql
security definer set search_path = public
as $$
  select cl.comment_id,
         count(*) as like_count,
         coalesce(bool_or(cl.user_id = auth.uid()), false) as liked
    from public.comment_likes cl
    join public.comments c on c.id = cl.comment_id
   where c.eq_id = p_eq_id
   group by cl.comment_id;
$$;

-- -----------------------------------------------------------------------------
-- Username changes: at most once every 60 days.
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists username_changed_at timestamptz;

-- Server-side enforcement: block the UPDATE (raise exception) if the username
-- changes within 60 days of the last change, stamp the change timestamp, and
-- sync the new name onto all of the user's existing comments.
create or replace function public.protect_username_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.username is distinct from old.username then
    if old.username_changed_at is not null
       and now() - old.username_changed_at < interval '60 days' then
      raise exception 'Username can only be changed once every 60 days.';
    end if;
    new.username_changed_at := now();

    update public.comments
       set author = coalesce(new.username, split_part(new.email, '@', 1))
     where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_username_change_trg on public.profiles;
create trigger protect_username_change_trg
  before update on public.profiles
  for each row execute procedure public.protect_username_change();

-- -----------------------------------------------------------------------------
-- Verified users. Flag is set manually by the project owner, e.g.:
--   update public.profiles set verified = true where email = 'me@example.com';
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists verified boolean not null default false;

-- Comments with a live verified flag (joined from profiles at read time so the
-- badge always reflects the current flag, independent of the author snapshot).
create or replace function public.get_comments(p_eq_id text)
returns table (
  id uuid,
  user_id uuid,
  eq_id text,
  content text,
  author text,
  created_at timestamptz,
  verified boolean
)
language sql
security definer set search_path = public
as $$
  select c.id, c.user_id, c.eq_id, c.content, c.author, c.created_at,
         coalesce(p.verified, false) as verified
    from public.comments c
    left join public.profiles p on p.id = c.user_id
   where c.eq_id = p_eq_id
   order by c.created_at desc;
$$;
