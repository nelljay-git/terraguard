import { supabase, getErrorMessage } from './supabase';

export const FORUM_ADMIN_EMAIL = 'gianganwneljae@gmail.com';

export type ForumReaction = 'like' | 'helpful' | 'interesting';
export type ForumFilter = 'newest' | 'liked' | 'pinned';

export interface ForumPost {
  id: string;
  author_id: string;
  title: string;
  content: string;
  author: string | null;
  pinned: boolean;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  like_count: number;
  helpful_count: number;
  interesting_count: number;
  comment_count: number;
  my_reaction: ForumReaction | null;
  bookmarked: boolean;
  verified: boolean;
  avatar_url: string | null;
}

export interface ForumComment {
  id: string;
  author_id: string;
  parent_id: string | null;
  content: string;
  author: string | null;
  verified: boolean;
  avatar_url: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  reply_count: number;
  my_reaction: ForumReaction | null;
  like_count: number;
  helpful_count: number;
  interesting_count: number;
}

export interface Notification {
  id: string;
  type: 'reply' | 'reaction' | 'comment_like';
  post_id: string | null;
  comment_id: string | null;
  eq_id: string | null;
  details_comment_id: string | null;
  read: boolean;
  created_at: string;
  actor_name: string | null;
  actor_avatar: string | null;
}

export interface ReactionCounts {
  like_count: number;
  helpful_count: number;
  interesting_count: number;
  my_reaction: ForumReaction | null;
}

export function isForumAdmin(email: string | null | undefined): boolean {
  return email?.toLowerCase() === FORUM_ADMIN_EMAIL.toLowerCase();
}

export async function getForumPosts(
  filter: ForumFilter,
  search: string,
  page: number,
  pageSize: number
): Promise<ForumPost[]> {
  const { data, error } = await supabase.rpc('get_forum_posts', {
    p_filter: filter,
    p_search: search,
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) throw error;
  return (data ?? []) as ForumPost[];
}

export async function getForumPost(id: string): Promise<ForumPost | null> {
  const { data, error } = await supabase.rpc('get_forum_post', {
    p_post_id: id,
  });
  if (error) throw error;
  return (data?.[0] ?? null) as ForumPost | null;
}

export async function createForumPost(
  title: string,
  content: string,
  imageUrl: string | null = null
): Promise<ForumPost> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('forum_posts')
    .insert({ author_id: user.id, title, content, image_url: imageUrl })
    .select()
    .single();
  if (error) throw error;
  return data as ForumPost;
}

export async function updateForumPost(
  id: string,
  title: string,
  content: string,
  imageUrl: string | null = null
): Promise<void> {
  const { error } = await supabase
    .from('forum_posts')
    .update({
      title,
      content,
      image_url: imageUrl,
      updated_at: new Date().toISOString(),
      edited_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function uploadForumImage(file: File): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await supabase.storage.from('forum-images').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  });
  if (error) throw error;
  return supabase.storage.from('forum-images').getPublicUrl(path).data.publicUrl;
}

export async function togglePinForumPost(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase
    .from('forum_posts')
    .update({ pinned })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteForumPost(id: string): Promise<void> {
  const { error } = await supabase.from('forum_posts').delete().eq('id', id);
  if (error) throw error;
}

export async function toggleForumReaction(
  targetType: 'post' | 'comment',
  targetId: string,
  reaction: ForumReaction
): Promise<ReactionCounts> {
  const { data, error } = await supabase.rpc('toggle_forum_reaction', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reaction: reaction,
  });
  if (error) throw error;
  return (data?.[0] ?? {
    like_count: 0,
    helpful_count: 0,
    interesting_count: 0,
    my_reaction: null,
  }) as ReactionCounts;
}

export async function toggleForumBookmark(
  postId: string
): Promise<{ bookmarked: boolean; bookmark_count: number }> {
  const { data, error } = await supabase.rpc('toggle_forum_bookmark', { p_post_id: postId });
  if (error) throw error;
  return (data?.[0] ?? { bookmarked: false, bookmark_count: 0 }) as {
    bookmarked: boolean;
    bookmark_count: number;
  };
}

export async function getForumComments(
  postId: string,
  limit: number,
  before: string | null
): Promise<ForumComment[]> {
  const { data, error } = await supabase.rpc('get_forum_comments', {
    p_post_id: postId,
    p_limit: limit,
    p_before: before,
  });
  if (error) throw error;
  return (data ?? []) as ForumComment[];
}

export async function getForumReplies(
  postId: string,
  parentIds: string[]
): Promise<ForumComment[]> {
  if (parentIds.length === 0) return [];
  const { data, error } = await supabase.rpc('get_forum_replies', {
    p_post_id: postId,
    p_parent_ids: parentIds,
  });
  if (error) throw error;
  return (data ?? []) as ForumComment[];
}

export async function getForumCommentPath(
  postId: string,
  commentId: string
): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_forum_comment_path', {
    p_post_id: postId,
    p_comment_id: commentId,
  });
  if (error) throw error;
  const row = (data?.[0] ?? null) as { path?: string[] } | null;
  return row?.path ?? [];
}

export async function addForumComment(
  postId: string,
  parentId: string | null,
  content: string
): Promise<ForumComment> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('forum_comments')
    .insert({ post_id: postId, author_id: user.id, parent_id: parentId, content })
    .select()
    .single();
  if (error) throw error;
  return data as ForumComment;
}

export async function updateForumComment(id: string, content: string): Promise<void> {
  const { error } = await supabase
    .from('forum_comments')
    .update({ content, updated_at: new Date().toISOString(), edited_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function toggleForumCommentPin(
  commentId: string
): Promise<{ pinned: boolean }> {
  const { data, error } = await supabase.rpc('toggle_forum_comment_pin', {
    p_comment_id: commentId,
  });
  if (error) throw error;
  return (data?.[0] ?? { pinned: false }) as { pinned: boolean };
}

export async function deleteForumComment(id: string): Promise<void> {
  const { error } = await supabase.from('forum_comments').delete().eq('id', id);
  if (error) throw error;
}

export async function getNotifications(
  userId: string
): Promise<Notification[]> {
  const { data, error } = await supabase.rpc('get_notifications', {
    p_user_id: userId,
  });
  if (error) throw error;
  return (data ?? []) as Notification[];
}

export async function markNotificationsRead(): Promise<void> {
  const { error } = await supabase.rpc('mark_notifications_read');
  if (error) throw error;
}

export function formatForumTime(iso: string, now: number): string {
  const d = new Date(iso);
  const diff = now - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function truncateContent(text: string, max = 220): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max).trim()}…`;
}

export { getErrorMessage };
