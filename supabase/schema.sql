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

-- Replies: comments can nest under a parent comment (one level deep on this page).
alter table public.comments add column if not exists parent_id uuid references public.comments (id) on delete cascade;
create index if not exists comments_parent_idx on public.comments (eq_id, parent_id);

-- Admin can manually pin comments so they float to the top of the list.
alter table public.comments add column if not exists pinned boolean not null default false;

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
-- Error messages include the exact remaining wait so clients can show a timer.
create or replace function public.check_comment_rate_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  cnt_minute int;
  cnt_hour int;
  last_ts timestamptz;
  oldest_ts timestamptz;
  wait_seconds int;
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
    select min(created_at) into oldest_ts
      from public.rate_events
     where user_id = new.user_id
       and event_type = 'comment'
       and created_at > now() - interval '1 minute';
    wait_seconds := greatest(1, ceil(extract(epoch from (oldest_ts + interval '1 minute' - now())))::int);
    raise exception 'You are commenting too fast. Please wait % seconds.', wait_seconds;
  end if;

  if cnt_hour >= 15 then
    select min(created_at) into oldest_ts
      from public.rate_events
     where user_id = new.user_id
       and event_type = 'comment'
       and created_at > now() - interval '1 hour';
    wait_seconds := greatest(1, ceil(extract(epoch from (oldest_ts + interval '1 hour' - now())))::int);
    raise exception 'Comment limit reached for this hour. Please try again in % minutes.', ceil(wait_seconds / 60.0)::int;
  end if;

  select max(created_at) into last_ts
    from public.comments
   where user_id = new.user_id;

  if last_ts is not null and (now() - last_ts) < interval '10 seconds' then
    wait_seconds := greatest(1, ceil(10 - extract(epoch from now() - last_ts))::int);
    raise exception 'Please wait % seconds before commenting again.', wait_seconds;
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

-- Top-level comments with a live verified flag (joined from profiles at read
-- time so the badge always reflects the current flag). Replies (parent_id not
-- null) are fetched separately via get_comment_replies. The return signature
-- changed, so the old function is dropped first.
drop function if exists public.get_comments(text);
create or replace function public.get_comments(p_eq_id text)
returns table (
  id uuid,
  user_id uuid,
  eq_id text,
  content text,
  author text,
  created_at timestamptz,
  verified boolean,
  avatar_url text,
  parent_id uuid,
  reply_count bigint,
  pinned boolean
)
language sql
security definer set search_path = public
as $$
  select c.id, c.user_id, c.eq_id, c.content, c.author, c.created_at,
         coalesce(p.verified, false) as verified,
         p.avatar_url,
         c.parent_id,
         (select count(*) from public.comments ch where ch.parent_id = c.id)::bigint as reply_count,
         c.pinned
    from public.comments c
    left join public.profiles p on p.id = c.user_id
   where c.eq_id = p_eq_id
     and c.parent_id is null
   order by c.pinned desc, c.created_at desc;
$$;

-- Direct replies to a set of parent comments (oldest first, thread order).
drop function if exists public.get_comment_replies(text, uuid[]);
create or replace function public.get_comment_replies(p_eq_id text, p_parent_ids uuid[])
returns table (
  id uuid,
  user_id uuid,
  eq_id text,
  content text,
  author text,
  created_at timestamptz,
  verified boolean,
  avatar_url text,
  parent_id uuid,
  reply_count bigint,
  pinned boolean
)
language sql
security definer set search_path = public
as $$
  select c.id, c.user_id, c.eq_id, c.content, c.author, c.created_at,
         coalesce(p.verified, false) as verified,
         p.avatar_url,
         c.parent_id,
         (select count(*) from public.comments ch where ch.parent_id = c.id)::bigint as reply_count,
         c.pinned
    from public.comments c
    left join public.profiles p on p.id = c.user_id
   where c.eq_id = p_eq_id
     and c.parent_id = any(p_parent_ids)
   order by c.created_at asc;
$$;

-- Ancestor chain (root -> ... -> target) for a comment/reply, used to deep-link
-- to a nested reply from a notification.
create or replace function public.get_comment_path(p_eq_id text, p_comment_id uuid)
returns table (path uuid[])
language sql
stable
as $$
  with recursive chain as (
    select c.id, c.parent_id, 1 as depth
      from public.comments c
     where c.id = p_comment_id and c.eq_id = p_eq_id
    union all
    select c.id, c.parent_id, ch.depth + 1
      from public.comments c
      join chain ch on c.id = ch.parent_id
  )
  select array(select id from chain order by depth desc);
$$;

-- RPC: admin toggles whether a comment is pinned (pinned comments float to the
-- top). Only the admin may do this (enforced inside the function). The author
-- is notified the first time their comment gets pinned.
create or replace function public.toggle_comment_pin(p_comment_id uuid)
returns table (pinned boolean)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_eq_id text;
begin
  if not exists (select 1 from public.profiles where id = v_uid and email = 'gianganwneljae@gmail.com') then
    raise exception 'Only the administrator can pin comments.';
  end if;

  select c.user_id, c.eq_id into v_author, v_eq_id
    from public.comments c
   where c.id = p_comment_id;

  update public.comments
     set pinned = not pinned
   where id = p_comment_id;

  if (select pinned from public.comments where id = p_comment_id)
     and v_author is not null and v_author <> v_uid then
    insert into public.notifications (user_id, actor_id, type, eq_id, details_comment_id)
    values (v_author, v_uid, 'comment_pin', v_eq_id, p_comment_id);
  end if;

  return query
    select pinned from public.comments where id = p_comment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Profile photos (verified users only)
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;

-- Server-side enforcement: only verified users may set an avatar URL.
create or replace function public.protect_avatar_url()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.avatar_url is distinct from old.avatar_url and not old.verified then
    raise exception 'Only verified users can set a profile photo.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_avatar_url_trg on public.profiles;
create trigger protect_avatar_url_trg
  before update on public.profiles
  for each row execute procedure public.protect_avatar_url();

-- -----------------------------------------------------------------------------
-- Theme preference ('dark' | 'light' | 'system')
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists theme text not null default 'system';

-- -----------------------------------------------------------------------------
-- Preferred earthquake data source ('phivolcs' | 'usgs'). Defaults to PHIVOLCS.
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists preferred_api text not null default 'phivolcs';

-- Constrain the value to the two supported sources.
alter table public.profiles drop constraint if exists profiles_preferred_api_check;
alter table public.profiles
  add constraint profiles_preferred_api_check
  check (preferred_api in ('phivolcs', 'usgs'));

-- Grant existing rows the default (no-op for brand-new profiles, but covers
-- profiles created before this migration).
update public.profiles set preferred_api = 'phivolcs' where preferred_api is null;
