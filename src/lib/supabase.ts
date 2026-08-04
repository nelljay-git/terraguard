import { createClient } from '@supabase/supabase-js';
import type { PhivolcsEarthquake } from '../api/phivolcs';

export const supabase = createClient(
  'https://qiszvooehbfjteyrfryk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpc3p2b29laGJmanRleXJmcnlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3Njc5NTIsImV4cCI6MjEwMTM0Mzk1Mn0.mW_DHjAOqu99PlvrkAuc_VO4CQ-EilsJzZClLVaacio'
);

export interface StarredEarthquake {
  id: string;
  eq_id: string;
  datetime: string | null;
  latitude: string | null;
  longitude: string | null;
  depth: string | null;
  magnitude: string | null;
  location: string | null;
  created_at: string;
}

export interface EventComment {
  id: string;
  user_id: string;
  eq_id: string;
  content: string;
  author: string | null;
  created_at: string;
  verified: boolean;
  avatar_url: string | null;
}

export interface EngagementState {
  stars: { count: number; mine: boolean };
  likes: { count: number; mine: boolean };
}

export function earthquakeToEqId(eq: PhivolcsEarthquake): string {
  return btoa(`${eq.datetime}-${eq.latitude}-${eq.longitude}`).replace(/=/g, '');
}

export async function getEngagement(eqId: string): Promise<EngagementState> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [stars, likes] = await Promise.all([
    countWithMine('stars', eqId, user?.id),
    countWithMine('likes', eqId, user?.id),
  ]);

  return { stars, likes };
}

async function countWithMine(
  table: 'stars' | 'likes',
  eqId: string,
  userId?: string
): Promise<{ count: number; mine: boolean }> {
  const { count } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('eq_id', eqId);

  let mine = false;
  if (userId) {
    const { data } = await supabase
      .from(table)
      .select('id')
      .eq('eq_id', eqId)
      .eq('user_id', userId)
      .maybeSingle();
    mine = Boolean(data);
  }

  return { count: count ?? 0, mine };
}

export async function toggleStar(
  eqId: string,
  earthquake: PhivolcsEarthquake
): Promise<{ starred: boolean; count: number }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: existing } = await supabase
    .from('stars')
    .select('id')
    .eq('eq_id', eqId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('stars').delete().eq('id', existing.id);
    if (error) throw error;
    const { count } = await supabase
      .from('stars')
      .select('*', { count: 'exact', head: true })
      .eq('eq_id', eqId);
    return { starred: false, count: count ?? 0 };
  }

  const { error } = await supabase.from('stars').insert({
    user_id: user.id,
    eq_id: eqId,
    datetime: earthquake.datetime,
    latitude: earthquake.latitude,
    longitude: earthquake.longitude,
    depth: earthquake.depth,
    magnitude: earthquake.magnitude,
    location: earthquake.location,
  });
  if (error) throw error;

  const { count } = await supabase
    .from('stars')
    .select('*', { count: 'exact', head: true })
    .eq('eq_id', eqId);
  return { starred: true, count: count ?? 0 };
}

export async function toggleLike(eqId: string): Promise<{ liked: boolean; count: number }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: existing } = await supabase
    .from('likes')
    .select('id')
    .eq('eq_id', eqId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('likes').delete().eq('id', existing.id);
    if (error) throw error;
    const { count } = await supabase
      .from('likes')
      .select('*', { count: 'exact', head: true })
      .eq('eq_id', eqId);
    return { liked: false, count: count ?? 0 };
  }

  const { error } = await supabase.from('likes').insert({ user_id: user.id, eq_id: eqId });
  if (error) throw error;

  const { count } = await supabase
    .from('likes')
    .select('*', { count: 'exact', head: true })
    .eq('eq_id', eqId);
  return { liked: true, count: count ?? 0 };
}

export async function fetchComments(eqId: string): Promise<EventComment[]> {
  const { data, error } = await supabase.rpc('get_comments', { p_eq_id: eqId });
  if (error) throw error;
  return (data ?? []) as EventComment[];
}

export async function addComment(eqId: string, content: string): Promise<EventComment> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('comments')
    .insert({ user_id: user.id, eq_id: eqId, content })
    .select()
    .single();
  if (error) throw error;
  return data as EventComment;
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; code?: unknown };
    const code = typeof e.code === 'string' ? e.code : '';
    const details = typeof e.details === 'string' ? e.details : '';
    const message = typeof e.message === 'string' ? e.message : '';
    // PostgREST puts `raise exception` text in `details` (code P0001)
    if (code === 'P0001' && details) return details;
    if (message) return message;
  }
  return 'Something went wrong. Please try again.';
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from('comments').delete().eq('id', id);
  if (error) throw error;
}

export interface CommentLikeCount {
  comment_id: string;
  like_count: number;
  liked: boolean;
}

export async function getCommentLikes(eqId: string): Promise<CommentLikeCount[]> {
  const { data, error } = await supabase.rpc('get_comment_likes', { p_eq_id: eqId });
  if (error) throw error;
  return (data ?? []) as CommentLikeCount[];
}

export async function toggleCommentLike(
  commentId: string
): Promise<{ liked: boolean; count: number }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: existing } = await supabase
    .from('comment_likes')
    .select('id')
    .eq('comment_id', commentId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('comment_likes').delete().eq('id', existing.id);
    if (error) throw error;
    const { count } = await supabase
      .from('comment_likes')
      .select('*', { count: 'exact', head: true })
      .eq('comment_id', commentId);
    return { liked: false, count: count ?? 0 };
  }

  const { error } = await supabase
    .from('comment_likes')
    .insert({ user_id: user.id, comment_id: commentId });
  if (error) throw error;

  const { count } = await supabase
    .from('comment_likes')
    .select('*', { count: 'exact', head: true })
    .eq('comment_id', commentId);
  return { liked: true, count: count ?? 0 };
}

export async function fetchUserStars(): Promise<StarredEarthquake[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('stars')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function deleteStar(eqId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase.from('stars').delete().eq('eq_id', eqId).eq('user_id', user.id);
  if (error) throw error;
}

export async function updateUsername(uid: string, username: string): Promise<string | null> {
  const { error } = await supabase.from('profiles').update({ username }).eq('id', uid);
  return error ? getErrorMessage(error) : null;
}

export async function updateAvatarUrl(uid: string, url: string | null): Promise<string | null> {
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', uid);
  return error ? getErrorMessage(error) : null;
}

export async function updateTheme(uid: string, theme: string): Promise<string | null> {
  const { error } = await supabase.from('profiles').update({ theme }).eq('id', uid);
  return error ? getErrorMessage(error) : null;
}
