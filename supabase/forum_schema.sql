-- =============================================================================
-- TerraGuard - Community Forum schema
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL -> New query)
-- Idempotent: safe to re-run.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Admin helper. The single forum administrator is identified by email so the
-- role survives account renames. Used by RLS policies below (runs as definer
-- to bypass the caller's restricted view of auth.users).
-- -----------------------------------------------------------------------------
create or replace function public.is_forum_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
      from auth.users
     where id = auth.uid()
       and email = 'gianganwneljae@gmail.com'
  );
$$;

-- -----------------------------------------------------------------------------
-- Forum posts. Only the admin can create/edit/pin/delete these (enforced by RLS).
-- -----------------------------------------------------------------------------
create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 300),
  content text not null check (char_length(content) between 1 and 10000),
  author text,
  pinned boolean not null default false,
  closed boolean not null default false,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz
);

-- Upgrade existing installs: allow the admin to attach an image to a post.
alter table public.forum_posts add column if not exists image_url text;

-- Upgrade existing installs: allow the admin to close a post (no new comments).
alter table public.forum_posts add column if not exists closed boolean not null default false;

create index if not exists forum_posts_created_idx on public.forum_posts (created_at desc);
create index if not exists forum_posts_pinned_idx on public.forum_posts (pinned desc, created_at desc);

-- Stamp the author display name from the profile server-side (no client spoofing).
create or replace function public.set_forum_post_author()
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
   where id = new.author_id;
  new.author := coalesce(pname, 'user');
  return new;
end;
$$;

drop trigger if exists set_forum_post_author_trg on public.forum_posts;
create trigger set_forum_post_author_trg
  before insert on public.forum_posts
  for each row execute procedure public.set_forum_post_author();

-- Cleanup dependent rows when a post is removed.
create or replace function public.forum_post_delete_cleanup()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.forum_reactions where target_type = 'post' and target_id = old.id;
  delete from public.forum_bookmarks where post_id = old.id;
  delete from public.notifications where post_id = old.id;
  return old;
end;
$$;

drop trigger if exists forum_post_delete_cleanup_trg on public.forum_posts;
create trigger forum_post_delete_cleanup_trg
  after delete on public.forum_posts
  for each row execute procedure public.forum_post_delete_cleanup();

-- -----------------------------------------------------------------------------
-- Forum comments / replies. parent_id enables unlimited nested threads.
-- -----------------------------------------------------------------------------
create table if not exists public.forum_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.forum_posts (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.forum_comments (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  author text,
  pinned boolean not null default false,
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists forum_comments_post_idx on public.forum_comments (post_id, created_at desc);
create index if not exists forum_comments_parent_idx on public.forum_comments (post_id, parent_id);

-- Upgrade existing installs: allow admin to pin comments.
alter table public.forum_comments add column if not exists pinned boolean not null default false;

-- Upgrade existing installs: allow admin to close comments (no new replies).
alter table public.forum_comments add column if not exists closed boolean not null default false;

-- Upgrade existing installs: allow the admin to attach an image to a comment.
alter table public.forum_comments add column if not exists image_url text;

create or replace function public.set_forum_comment_author()
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
   where id = new.author_id;
  new.author := coalesce(pname, 'user');
  return new;
end;
$$;

drop trigger if exists set_forum_comment_author_trg on public.forum_comments;
create trigger set_forum_comment_author_trg
  before insert on public.forum_comments
  for each row execute procedure public.set_forum_comment_author();

-- Notify the parent comment's author when someone replies (skip self-replies).
create or replace function public.forum_reply_notification()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient uuid;
begin
  if new.parent_id is not null then
    select author_id into v_recipient from public.forum_comments where id = new.parent_id;
    if v_recipient is not null and v_recipient <> new.author_id then
      insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
      values (v_recipient, new.author_id, 'reply', new.post_id, new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists forum_reply_notification_trg on public.forum_comments;
create trigger forum_reply_notification_trg
  after insert on public.forum_comments
  for each row execute procedure public.forum_reply_notification();

-- Cleanup reactions + notifications tied to a removed comment (fires per row so
-- it also covers the subtree deleted by the parent_id cascade).
create or replace function public.forum_comment_delete_cleanup()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.forum_reactions where target_type = 'comment' and target_id = old.id;
  delete from public.notifications where comment_id = old.id;
  return old;
end;
$$;

drop trigger if exists forum_comment_delete_cleanup_trg on public.forum_comments;
create trigger forum_comment_delete_cleanup_trg
  after delete on public.forum_comments
  for each row execute procedure public.forum_comment_delete_cleanup();

-- Rate limit forum comments (reuses the existing rate_events table).
create or replace function public.check_forum_comment_rate_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  cnt_minute int;
  cnt_hour int;
begin
  perform public.prune_rate_events(new.author_id);

  select count(*) into cnt_minute
    from public.rate_events
   where user_id = new.author_id
     and event_type = 'forum_comment'
     and created_at > now() - interval '1 minute';

  select count(*) into cnt_hour
    from public.rate_events
   where user_id = new.author_id
     and event_type = 'forum_comment'
     and created_at > now() - interval '1 hour';

  if cnt_minute >= 3 then
    raise exception 'You are commenting too fast. Please wait a minute.';
  end if;

  if cnt_hour >= 15 then
    raise exception 'Comment limit reached for this hour. Please try again later.';
  end if;

  insert into public.rate_events (user_id, event_type) values (new.author_id, 'forum_comment');
  return new;
end;
$$;

drop trigger if exists enforce_forum_comment_rate_limit_trg on public.forum_comments;
create trigger enforce_forum_comment_rate_limit_trg
  before insert on public.forum_comments
  for each row execute procedure public.check_forum_comment_rate_limit();

-- -----------------------------------------------------------------------------
-- Reactions: like / helpful / interesting on posts AND comments (polymorphic).
-- One user can give each distinct reaction once.
-- -----------------------------------------------------------------------------
create table if not exists public.forum_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id uuid not null,
  reaction text not null check (reaction in ('like', 'helpful', 'interesting')),
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id, reaction)
);

create index if not exists forum_reactions_target_idx on public.forum_reactions (target_type, target_id);
create index if not exists forum_reactions_user_idx on public.forum_reactions (user_id);

-- Notify the target author when someone reacts to their post/comment.
create or replace function public.forum_reaction_notification()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient uuid;
  v_post_id uuid;
begin
  if new.target_type = 'post' then
    select author_id, id into v_recipient, v_post_id from public.forum_posts where id = new.target_id;
  else
    select author_id, post_id into v_recipient, v_post_id from public.forum_comments where id = new.target_id;
  end if;

  if v_recipient is not null and v_recipient <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
    values (v_recipient, new.user_id, 'reaction', v_post_id,
            case when new.target_type = 'comment' then new.target_id else null end);
  end if;
  return new;
end;
$$;

drop trigger if exists forum_reaction_notification_trg on public.forum_reactions;
create trigger forum_reaction_notification_trg
  after insert on public.forum_reactions
  for each row execute procedure public.forum_reaction_notification();

-- Notify the comment author when someone likes their comment on the /details page.
create or replace function public.comment_like_notification()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient uuid;
  v_eq_id text;
begin
  select c.user_id, c.eq_id into v_recipient, v_eq_id
    from public.comments c
   where c.id = new.comment_id;

  if v_recipient is not null and v_recipient <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, eq_id, details_comment_id)
    values (v_recipient, new.user_id, 'comment_like', v_eq_id, new.comment_id);
  end if;
  return new;
end;
$$;

drop trigger if exists comment_like_notification_trg on public.comment_likes;
create trigger comment_like_notification_trg
  after insert on public.comment_likes
  for each row execute procedure public.comment_like_notification();

-- Notify the parent comment's author when someone replies to their comment on
-- the /details page. Nested replies notify their own direct parent.
create or replace function public.comment_reply_notification()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_parent_author uuid;
  v_eq_id text;
begin
  if new.parent_id is null then
    return new;
  end if;

  select c.user_id, c.eq_id into v_parent_author, v_eq_id
    from public.comments c
   where c.id = new.parent_id;

  if v_parent_author is not null and v_parent_author <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, eq_id, details_comment_id)
    values (v_parent_author, new.user_id, 'reply', v_eq_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists comment_reply_notification_trg on public.comments;
create trigger comment_reply_notification_trg
  after insert on public.comments
  for each row execute procedure public.comment_reply_notification();

-- -----------------------------------------------------------------------------
-- Bookmarks (save posts for later).
-- -----------------------------------------------------------------------------
create table if not exists public.forum_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid not null references public.forum_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);

create index if not exists forum_bookmarks_user_idx on public.forum_bookmarks (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Notifications.
-- -----------------------------------------------------------------------------
-- Upgrade path for installs that already created the table under the old
-- "forum_notifications" name: rename it so the notification system is generic.
alter table if exists public.forum_notifications rename to notifications;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  type text not null check (type in ('reply', 'reaction', 'comment_like', 'comment_pin')),
  post_id uuid references public.forum_posts (id) on delete cascade,
  comment_id uuid references public.forum_comments (id) on delete cascade,
  eq_id text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

drop index if exists public.forum_notifications_user_idx;
create index if not exists notifications_user_idx
  on public.notifications (user_id, read, created_at desc);

-- Upgrade existing installs: add the eq_id column + widen the type check.
alter table public.notifications add column if not exists eq_id text;
alter table public.notifications add column if not exists details_comment_id uuid;
alter table public.notifications drop constraint if exists forum_notifications_type_check;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('reply', 'reaction', 'comment_like', 'comment_pin'));

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.forum_posts enable row level security;
alter table public.forum_comments enable row level security;
alter table public.forum_reactions enable row level security;
alter table public.forum_bookmarks enable row level security;
alter table public.notifications enable row level security;

-- Posts: everyone reads; only the admin writes.
drop policy if exists "forum posts are viewable by everyone" on public.forum_posts;
create policy "forum posts are viewable by everyone"
  on public.forum_posts for select
  using (true);

drop policy if exists "admin can insert forum posts" on public.forum_posts;
create policy "admin can insert forum posts"
  on public.forum_posts for insert
  with check (public.is_forum_admin());

drop policy if exists "admin can update forum posts" on public.forum_posts;
create policy "admin can update forum posts"
  on public.forum_posts for update
  using (public.is_forum_admin());

drop policy if exists "admin can delete forum posts" on public.forum_posts;
create policy "admin can delete forum posts"
  on public.forum_posts for delete
  using (public.is_forum_admin());

-- Comments: everyone reads; authors edit/delete their own; admin moderates all.
drop policy if exists "forum comments are viewable by everyone" on public.forum_comments;
create policy "forum comments are viewable by everyone"
  on public.forum_comments for select
  using (true);

drop policy if exists "users can insert own forum comment" on public.forum_comments;
create policy "users can insert own forum comment"
  on public.forum_comments for insert
  with check (
    auth.uid() = author_id
    and (image_url is null or public.is_forum_admin())
    and (
      public.is_forum_admin()
      or (
        not exists (
          select 1 from public.forum_posts p where p.id = post_id and p.closed
        )
        and (
          parent_id is null
          or not exists (
            with recursive ancestors as (
              select c.id, c.parent_id, c.closed
                from public.forum_comments c
               where c.id = parent_id
              union all
              select c.id, c.parent_id, c.closed
                from public.forum_comments c
                join ancestors a on c.id = a.parent_id
            )
            select 1 from ancestors where closed
          )
        )
      )
    )
  );

drop policy if exists "users can update own forum comment" on public.forum_comments;
create policy "users can update own forum comment"
  on public.forum_comments for update
  using (auth.uid() = author_id or public.is_forum_admin())
  with check (
    (auth.uid() = author_id or public.is_forum_admin())
    and (image_url is null or public.is_forum_admin())
  );

drop policy if exists "users can delete own forum comment" on public.forum_comments;
create policy "users can delete own forum comment"
  on public.forum_comments for delete
  using (auth.uid() = author_id or public.is_forum_admin());

-- Reactions: everyone reads; users toggle their own.
drop policy if exists "forum reactions are viewable by everyone" on public.forum_reactions;
create policy "forum reactions are viewable by everyone"
  on public.forum_reactions for select
  using (true);

drop policy if exists "users can insert own forum reaction" on public.forum_reactions;
create policy "users can insert own forum reaction"
  on public.forum_reactions for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can delete own forum reaction" on public.forum_reactions;
create policy "users can delete own forum reaction"
  on public.forum_reactions for delete
  using (auth.uid() = user_id);

-- Bookmarks: everyone reads; users toggle their own.
drop policy if exists "forum bookmarks are viewable by everyone" on public.forum_bookmarks;
create policy "forum bookmarks are viewable by everyone"
  on public.forum_bookmarks for select
  using (true);

drop policy if exists "users can insert own forum bookmark" on public.forum_bookmarks;
create policy "users can insert own forum bookmark"
  on public.forum_bookmarks for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can delete own forum bookmark" on public.forum_bookmarks;
create policy "users can delete own forum bookmark"
  on public.forum_bookmarks for delete
  using (auth.uid() = user_id);

-- Notifications: users only see/mark their own.
drop policy if exists "users can read own notifications" on public.notifications;
drop policy if exists "users can read own forum notifications" on public.notifications;
create policy "users can read own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

drop policy if exists "users can update own notifications" on public.notifications;
drop policy if exists "users can update own forum notifications" on public.notifications;
create policy "users can update own notifications"
  on public.notifications for update
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- RPC: posts listing with counts, search + filtering + pagination.
-- Reaction/bookmark state is resolved server-side from the caller's JWT
-- (auth.uid()) so clients can never inspect another user's state.
-- -----------------------------------------------------------------------------
drop function if exists public.get_forum_posts(text, text, int, int);
create or replace function public.get_forum_posts(
  p_filter text default 'newest',
  p_search text default '',
  p_page int default 0,
  p_page_size int default 20
)
returns table (
  id uuid,
  author_id uuid,
  title text,
  content text,
  author text,
  pinned boolean,
  closed boolean,
  created_at timestamptz,
  updated_at timestamptz,
  edited_at timestamptz,
  like_count bigint,
  helpful_count bigint,
  interesting_count bigint,
  comment_count bigint,
  my_reaction text,
  bookmarked boolean,
  verified boolean,
  avatar_url text,
  image_url text
)
language sql
stable
as $$
  select
    p.id,
    p.author_id,
    p.title,
    p.content,
    p.author,
    p.pinned,
    p.closed,
    p.created_at,
    p.updated_at,
    p.edited_at,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'post' and r.target_id = p.id and r.reaction = 'like')::bigint as like_count,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'post' and r.target_id = p.id and r.reaction = 'helpful')::bigint as helpful_count,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'post' and r.target_id = p.id and r.reaction = 'interesting')::bigint as interesting_count,
    (select count(*) from public.forum_comments c where c.post_id = p.id)::bigint as comment_count,
    (select r.reaction from public.forum_reactions r
      where r.target_type = 'post' and r.target_id = p.id and r.user_id = auth.uid()
      limit 1) as my_reaction,
    exists (select 1 from public.forum_bookmarks b where b.post_id = p.id and b.user_id = auth.uid()) as bookmarked,
    coalesce(pr.verified, false) as verified,
    pr.avatar_url,
    p.image_url
  from public.forum_posts p
  left join public.profiles pr on pr.id = p.author_id
  where p_search = ''
     or p.title ilike '%' || p_search || '%'
     or p.content ilike '%' || p_search || '%'
  order by
    (case when p.pinned then 0 else 1 end),
    case p_filter
      when 'liked' then (select count(*) from public.forum_reactions r
        where r.target_type = 'post' and r.target_id = p.id)
      else 0
    end desc nulls last,
    p.created_at desc
  limit p_page_size offset p_page * p_page_size;
$$;

-- RPC: single post with all counts.
drop function if exists public.get_forum_post(uuid);
create or replace function public.get_forum_post(
  p_post_id uuid
)
returns table (
  id uuid,
  author_id uuid,
  title text,
  content text,
  author text,
  pinned boolean,
  closed boolean,
  created_at timestamptz,
  updated_at timestamptz,
  edited_at timestamptz,
  like_count bigint,
  helpful_count bigint,
  interesting_count bigint,
  comment_count bigint,
  my_reaction text,
  bookmarked boolean,
  verified boolean,
  avatar_url text,
  image_url text
)
language sql
stable
as $$
  select
    p.id,
    p.author_id,
    p.title,
    p.content,
    p.author,
    p.pinned,
    p.closed,
    p.created_at,
    p.updated_at,
    p.edited_at,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'post' and r.target_id = p.id and r.reaction = 'like')::bigint as like_count,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'post' and r.target_id = p.id and r.reaction = 'helpful')::bigint as helpful_count,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'post' and r.target_id = p.id and r.reaction = 'interesting')::bigint as interesting_count,
    (select count(*) from public.forum_comments c where c.post_id = p.id)::bigint as comment_count,
    (select r.reaction from public.forum_reactions r
      where r.target_type = 'post' and r.target_id = p.id and r.user_id = auth.uid()
      limit 1) as my_reaction,
    exists (select 1 from public.forum_bookmarks b where b.post_id = p.id and b.user_id = auth.uid()) as bookmarked,
    coalesce(pr.verified, false) as verified,
    pr.avatar_url,
    p.image_url
  from public.forum_posts p
  left join public.profiles pr on pr.id = p.author_id
  where p.id = p_post_id;
$$;

-- -----------------------------------------------------------------------------
-- RPC: top-level comments with pagination (lazy loading, newest first).
-- -----------------------------------------------------------------------------
drop function if exists public.get_forum_comments(uuid, int, timestamptz);
create or replace function public.get_forum_comments(
  p_post_id uuid,
  p_limit int default 20,
  p_before timestamptz default null
)
returns table (
  id uuid,
  author_id uuid,
  parent_id uuid,
  content text,
  author text,
  verified boolean,
  avatar_url text,
  image_url text,
  pinned boolean,
  closed boolean,
  created_at timestamptz,
  updated_at timestamptz,
  edited_at timestamptz,
  reply_count bigint,
  my_reaction text,
  like_count bigint,
  helpful_count bigint,
  interesting_count bigint
)
language sql
stable
as $$
  select
    c.id, c.author_id, c.parent_id, c.content, c.author,
    coalesce(p.verified, false) as verified, p.avatar_url,
    c.image_url,
    c.pinned,
    c.closed,
    c.created_at, c.updated_at, c.edited_at,
    (select count(*) from public.forum_comments ch where ch.parent_id = c.id)::bigint as reply_count,
    (select r.reaction from public.forum_reactions r
      where r.target_type = 'comment' and r.target_id = c.id and r.user_id = auth.uid()
      limit 1) as my_reaction,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'comment' and r.target_id = c.id and r.reaction = 'like')::bigint as like_count,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'comment' and r.target_id = c.id and r.reaction = 'helpful')::bigint as helpful_count,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'comment' and r.target_id = c.id and r.reaction = 'interesting')::bigint as interesting_count
  from public.forum_comments c
  left join public.profiles p on p.id = c.author_id
  where c.post_id = p_post_id
    and c.parent_id is null
    and (p_before is null or c.created_at < p_before)
  order by c.pinned desc, c.created_at desc
  limit p_limit;
$$;

-- -----------------------------------------------------------------------------
-- RPC: direct children (replies) for a set of parent comments, oldest first.
-- -----------------------------------------------------------------------------
drop function if exists public.get_forum_replies(uuid, uuid[]);
create or replace function public.get_forum_replies(
  p_post_id uuid,
  p_parent_ids uuid[]
)
returns table (
  id uuid,
  author_id uuid,
  parent_id uuid,
  content text,
  author text,
  verified boolean,
  avatar_url text,
  image_url text,
  pinned boolean,
  closed boolean,
  created_at timestamptz,
  updated_at timestamptz,
  edited_at timestamptz,
  reply_count bigint,
  my_reaction text,
  like_count bigint,
  helpful_count bigint,
  interesting_count bigint
)
language sql
stable
as $$
  select
    c.id, c.author_id, c.parent_id, c.content, c.author,
    coalesce(p.verified, false) as verified, p.avatar_url,
    c.image_url,
    c.pinned,
    c.closed,
    c.created_at, c.updated_at, c.edited_at,
    (select count(*) from public.forum_comments ch where ch.parent_id = c.id)::bigint as reply_count,
    (select r.reaction from public.forum_reactions r
      where r.target_type = 'comment' and r.target_id = c.id and r.user_id = auth.uid()
      limit 1) as my_reaction,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'comment' and r.target_id = c.id and r.reaction = 'like')::bigint as like_count,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'comment' and r.target_id = c.id and r.reaction = 'helpful')::bigint as helpful_count,
    (select count(*) from public.forum_reactions r
      where r.target_type = 'comment' and r.target_id = c.id and r.reaction = 'interesting')::bigint as interesting_count
  from public.forum_comments c
  left join public.profiles p on p.id = c.author_id
  where c.post_id = p_post_id
    and c.parent_id = any(p_parent_ids)
  order by c.pinned desc, c.created_at asc;
$$;

-- -----------------------------------------------------------------------------
-- RPC: toggle a reaction (like/helpful/interesting) on a post or comment.
-- Returns the updated counts + the current user's reaction.
-- -----------------------------------------------------------------------------
create or replace function public.toggle_forum_reaction(
  p_target_type text,
  p_target_id uuid,
  p_reaction text
)
returns table (like_count bigint, helpful_count bigint, interesting_count bigint, my_reaction text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_existing
    from public.forum_reactions
   where user_id = v_uid
     and target_type = p_target_type
     and target_id = p_target_id
     and reaction = p_reaction;

  if v_existing is not null then
    delete from public.forum_reactions where id = v_existing;
  else
    insert into public.forum_reactions (user_id, target_type, target_id, reaction)
    values (v_uid, p_target_type, p_target_id, p_reaction);
  end if;

  return query
    select
      (select count(*) from public.forum_reactions r
        where r.target_type = p_target_type and r.target_id = p_target_id and r.reaction = 'like')::bigint,
      (select count(*) from public.forum_reactions r
        where r.target_type = p_target_type and r.target_id = p_target_id and r.reaction = 'helpful')::bigint,
      (select count(*) from public.forum_reactions r
        where r.target_type = p_target_type and r.target_id = p_target_id and r.reaction = 'interesting')::bigint,
      (select r.reaction from public.forum_reactions r
        where r.target_type = p_target_type and r.target_id = p_target_id and r.user_id = v_uid
        limit 1);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: toggle a bookmark on a post. Returns state + total bookmark count.
-- -----------------------------------------------------------------------------
create or replace function public.toggle_forum_bookmark(p_post_id uuid)
returns table (bookmarked boolean, bookmark_count bigint)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_existing
    from public.forum_bookmarks
   where user_id = v_uid and post_id = p_post_id;

  if v_existing is not null then
    delete from public.forum_bookmarks where id = v_existing;
  else
    insert into public.forum_bookmarks (user_id, post_id) values (v_uid, p_post_id);
  end if;

  return query
    select
      exists (select 1 from public.forum_bookmarks b
        where b.post_id = p_post_id and b.user_id = v_uid),
      (select count(*) from public.forum_bookmarks b where b.post_id = p_post_id)::bigint;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: admin toggles whether a comment is pinned (top-level comments float to
-- the top). Only the admin may do this (enforced inside the function).
-- -----------------------------------------------------------------------------
create or replace function public.toggle_forum_comment_pin(p_comment_id uuid)
returns table (pinned boolean)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.profiles where id = v_uid and email = 'gianganwneljae@gmail.com') then
    raise exception 'Only the administrator can pin comments.';
  end if;

  update public.forum_comments
     set pinned = not pinned
   where id = p_comment_id;

  return query
    select pinned from public.forum_comments where id = p_comment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: admin closes/reopens a comment. While closed, no new replies can be added
-- (enforced by the RLS insert policy), but reactions still work.
-- -----------------------------------------------------------------------------
create or replace function public.toggle_forum_comment_closed(p_comment_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_closed boolean;
begin
  if not exists (select 1 from public.profiles where id = v_uid and email = 'gianganwneljae@gmail.com') then
    raise exception 'Only the administrator can close comments.';
  end if;

  update public.forum_comments
     set closed = not closed
   where id = p_comment_id;

  select closed into v_closed from public.forum_comments where id = p_comment_id;
  return v_closed;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: admin closes/reopens a post. While closed, no new comments or replies can
-- be added (enforced by the RLS insert policy), but reactions still work.
-- -----------------------------------------------------------------------------
create or replace function public.toggle_forum_post_closed(p_post_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_closed boolean;
begin
  if not exists (select 1 from public.profiles where id = v_uid and email = 'gianganwneljae@gmail.com') then
    raise exception 'Only the administrator can close a post.';
  end if;

  update public.forum_posts
     set closed = not closed
   where id = p_post_id;

  select closed into v_closed from public.forum_posts where id = p_post_id;
  return v_closed;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: fetch a user's notifications.
-- NOTE: drop first -- the return row type changed (added eq_id) and Postgres
-- cannot CREATE OR REPLACE a function whose OUT parameter type differs.
-- -----------------------------------------------------------------------------
drop function if exists public.get_forum_notifications(uuid);
drop function if exists public.get_notifications(uuid);
create or replace function public.get_notifications(p_user_id uuid)
returns table (
  id uuid,
  type text,
  post_id uuid,
  comment_id uuid,
  eq_id text,
  details_comment_id uuid,
  read boolean,
  created_at timestamptz,
  actor_name text,
  actor_avatar text
)
language sql
stable
as $$
  select n.id, n.type, n.post_id, n.comment_id, n.eq_id, n.details_comment_id, n.read, n.created_at,
         coalesce(p.username, split_part(p.email, '@', 1)) as actor_name,
         p.avatar_url as actor_avatar
    from public.notifications n
    left join public.profiles p on p.id = n.actor_id
   where n.user_id = p_user_id
   order by n.created_at desc
   limit 30;
$$;

-- RPC: mark all of a user's notifications as read (recipient resolved from JWT).
create or replace function public.mark_notifications_read()
returns void
language sql
security definer set search_path = public
as $$
  update public.notifications
     set read = true
   where user_id = auth.uid()
     and read = false;
$$;

-- Rate limit forum reactions (reuses the toggle limiter).
drop trigger if exists enforce_forum_reaction_rate_limit_trg on public.forum_reactions;
create trigger enforce_forum_reaction_rate_limit_trg
  before insert on public.forum_reactions
  for each row execute procedure public.check_toggle_rate_limit('forum_reaction');

-- -----------------------------------------------------------------------------
-- RPC: ancestor chain (root -> ... -> target) for a comment, used to deep-link
-- to a specific comment/reply from a notification.
-- -----------------------------------------------------------------------------
create or replace function public.get_forum_comment_path(p_post_id uuid, p_comment_id uuid)
returns table (path uuid[])
language sql
stable
as $$
  with recursive chain as (
    select c.id, c.parent_id, 1 as depth
      from public.forum_comments c
     where c.id = p_comment_id and c.post_id = p_post_id
    union all
    select c.id, c.parent_id, ch.depth + 1
      from public.forum_comments c
      join chain ch on c.id = ch.parent_id
  )
  select array(
    select id from chain order by depth desc
  );
$$;

-- -----------------------------------------------------------------------------
-- Storage bucket for forum post images. Public read; only the admin uploads.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('forum-images', 'forum-images', true)
on conflict (id) do nothing;

drop policy if exists "forum-images public read" on storage.objects;
create policy "forum-images public read"
  on storage.objects for select
  using (bucket_id = 'forum-images');

drop policy if exists "forum-images admin upload" on storage.objects;
create policy "forum-images admin upload"
  on storage.objects for insert
  with check (
    bucket_id = 'forum-images'
    and public.is_forum_admin()
  );

drop policy if exists "forum-images admin delete" on storage.objects;
create policy "forum-images admin delete"
  on storage.objects for delete
  using (
    bucket_id = 'forum-images'
    and public.is_forum_admin()
  );
