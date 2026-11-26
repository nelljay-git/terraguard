// Admin-only helper: after an admin publishes a forum post, broadcast a
// system notification to all devices that have the app installed.
// Notification failures must never break forum posting.

import { supabase } from './supabase';

const WORKER_URL = (
  (import.meta.env?.VITE_WORKER_URL as string | undefined) ??
  'https://terraguard-monitor.gianganwneljae.workers.dev'
).replace(/\/+$/, '');

export async function notifyUsersAboutForumPost(post: {
  id: string;
  title: string;
  content: string;
}): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? '';
    if (!token) return;

    const title = `New from TerraGuard: ${post.title.trim()}`.slice(0, 120);
    const excerpt = post.content.trim().replace(/\s+/g, ' ').slice(0, 180);
    const body = `${excerpt}${post.content.trim().length > 180 ? '…' : ''}`.slice(0, 300) ||
      'Tap to read the full post.';

    await fetch(`${WORKER_URL}/admin/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title,
        body,
        link: `/forum/${post.id}`,
        source: 'all',
        scope: 'all',
      }),
    });
  } catch (e) {
    console.warn('Forum push notification skipped:', e);
  }
}
