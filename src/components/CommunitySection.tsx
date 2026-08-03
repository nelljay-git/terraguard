import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Heart, Send, Trash2, LogIn, Loader2, Users, ShieldAlert, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getEngagement,
  toggleStar,
  toggleLike,
  fetchComments,
  addComment,
  deleteComment,
  getCommentLikes,
  toggleCommentLike,
  getErrorMessage,
  type EventComment,
} from '../lib/supabase';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor } from '../lib/utils';
import './CommunitySection.css';

interface CommunitySectionProps {
  eqId: string;
  earthquake: PhivolcsEarthquake;
}

export function CommunitySection({ eqId, earthquake }: CommunitySectionProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const color = getSeverityColor(parseFloat(earthquake.magnitude));

  const [starCount, setStarCount] = useState(0);
  const [starred, setStarred] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [comments, setComments] = useState<EventComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState<null | 'star' | 'like'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [commentLikes, setCommentLikes] = useState<Record<string, { count: number; liked: boolean }>>({});
  const [commentLikeBusy, setCommentLikeBusy] = useState<Record<string, boolean>>({});

  const POST_COOLDOWN_SECONDS = 10;

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getEngagement(eqId)
      .then(({ stars, likes }) => {
        if (cancelled) return;
        setStarCount(stars.count);
        setStarred(stars.mine);
        setLikeCount(likes.count);
        setLiked(likes.mine);
      })
      .catch((err) => console.error('Failed to load engagement', err));

    fetchComments(eqId)
      .then((list) => {
        if (!cancelled) setComments(list);
      })
      .catch((err) => console.error('Failed to load comments', err))
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });

    getCommentLikes(eqId)
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, { count: number; liked: boolean }> = {};
        for (const r of rows) map[r.comment_id] = { count: r.like_count, liked: r.liked };
        setCommentLikes(map);
      })
      .catch((err) => console.error('Failed to load comment likes', err));

    return () => {
      cancelled = true;
    };
  }, [eqId]);

  const requireAuth = () => {
    if (!user) {
      navigate('/auth', { state: { from: window.location.pathname } });
      return false;
    }
    return true;
  };

  const handleStar = async () => {
    if (!requireAuth()) return;
    setActionError(null);
    setBusy('star');
    try {
      const result = await toggleStar(eqId, earthquake);
      setStarred(result.starred);
      setStarCount(result.count);
    } catch (err) {
      console.error(err);
      setActionError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleLike = async () => {
    if (!requireAuth()) return;
    setActionError(null);
    setBusy('like');
    try {
      const result = await toggleLike(eqId);
      setLiked(result.liked);
      setLikeCount(result.count);
    } catch (err) {
      console.error(err);
      setActionError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handlePost = async (e: FormEvent) => {
    e.preventDefault();
    if (!requireAuth()) return;
    const content = draft.trim();
    if (!content || posting || cooldown > 0) return;
    setCommentError(null);
    setPosting(true);
    try {
      const comment = await addComment(eqId, content);
      setComments((prev) => [comment, ...prev]);
      setDraft('');
      setCooldown(POST_COOLDOWN_SECONDS);
    } catch (err) {
      console.error(err);
      setCommentError(getErrorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteComment(id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleCommentLike = async (comment: EventComment) => {
    if (!requireAuth()) return;
    setCommentLikeBusy((prev) => ({ ...prev, [comment.id]: true }));
    try {
      const result = await toggleCommentLike(comment.id);
      setCommentLikes((prev) => ({
        ...prev,
        [comment.id]: { count: result.count, liked: result.liked },
      }));
    } catch (err) {
      console.error(err);
      setActionError(getErrorMessage(err));
    } finally {
      setCommentLikeBusy((prev) => ({ ...prev, [comment.id]: false }));
    }
  };

  const formatDate = (iso: string, current: number) => {
    const d = new Date(iso);
    const diff = current - d.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="community-section glass">
      <div className="community-header">
        <h3 className="card-title flex-center" style={{ gap: '8px', justifyContent: 'flex-start' }}>
          <Users size={20} style={{ color }} />
          Community
        </h3>
        <span className="text-muted" style={{ fontSize: '0.8rem' }}>
          {starCount} {starCount === 1 ? 'star' : 'stars'} · {likeCount}{' '}
          {likeCount === 1 ? 'like' : 'likes'} · {comments.length}{' '}
          {comments.length === 1 ? 'comment' : 'comments'}
        </span>
      </div>

      <div className="community-actions">
        <button
          type="button"
          className={`community-btn ${starred ? 'active star-active' : ''}`}
          onClick={handleStar}
          disabled={busy === 'star'}
        >
          {busy === 'star' ? (
            <Loader2 size={18} className="spin" />
          ) : (
            <Star size={18} fill={starred ? 'currentColor' : 'none'} />
          )}
          <span>{starred ? 'Starred' : 'Star'}</span>
          <span className="community-count">{starCount}</span>
        </button>

        <button
          type="button"
          className={`community-btn ${liked ? 'active like-active' : ''}`}
          onClick={handleLike}
          disabled={busy === 'like'}
        >
          {busy === 'like' ? (
            <Loader2 size={18} className="spin" />
          ) : (
            <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
          )}
          <span>{liked ? 'Liked' : 'Like'}</span>
          <span className="community-count">{likeCount}</span>
        </button>
      </div>

      {!user && (
        <div className="community-login-hint">
          <LogIn size={15} />
          <span>
            <button type="button" className="community-inline-link" onClick={requireAuth}>
              Sign in
            </button>{' '}
            to star, like, and comment on this event.
          </span>
        </div>
      )}

      {actionError && (
        <div className="community-error">
          <ShieldAlert size={15} />
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} title="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      <form className="community-composer" onSubmit={handlePost}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={user ? 'Share your thoughts about this event...' : 'Sign in to leave a comment'}
          rows={2}
          maxLength={500}
          disabled={!user}
        />
        <div className="community-composer-row">
          {cooldown > 0 && (
            <span className="community-cooldown text-muted">
              You can comment again in {cooldown}s
            </span>
          )}
          <button
            type="submit"
            className="community-send"
            disabled={!user || !draft.trim() || posting || cooldown > 0}
          >
            {posting ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            <span>{cooldown > 0 ? `${cooldown}s` : 'Comment'}</span>
          </button>
        </div>
      </form>

      {commentError && (
        <div className="community-error">
          <ShieldAlert size={15} />
          <span>{commentError}</span>
          <button type="button" onClick={() => setCommentError(null)} title="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="community-comments">
        {commentsLoading ? (
          <div className="community-loading flex-center">
            <div className="pulse-loader" style={{ width: '22px', height: '22px' }}></div>
          </div>
        ) : comments.length === 0 ? (
          <p className="text-muted" style={{ fontSize: '0.85rem', textAlign: 'center', padding: '12px 0' }}>
            No comments yet. Be the first to react to this event.
          </p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="community-comment">
              <div className="comment-avatar">{c.author?.[0]?.toUpperCase() ?? 'U'}</div>
              <div className="comment-body">
                <div className="comment-meta">
                  <span className="comment-author">{c.author ?? 'User'}</span>
                  <span className="comment-time text-muted">{formatDate(c.created_at, now)}</span>
                </div>
                <p className="comment-content">{c.content}</p>
                <div className="comment-footer">
                  <button
                    type="button"
                    className={`comment-like-btn ${commentLikes[c.id]?.liked ? 'active' : ''}`}
                    onClick={() => handleCommentLike(c)}
                    disabled={commentLikeBusy[c.id]}
                    title={commentLikes[c.id]?.liked ? 'Unlike comment' : 'Like comment'}
                  >
                    {commentLikeBusy[c.id] ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Heart
                        size={13}
                        fill={commentLikes[c.id]?.liked ? 'currentColor' : 'none'}
                      />
                    )}
                    <span>{commentLikes[c.id]?.count ?? 0}</span>
                  </button>
                  {user && user.id === c.user_id && (
                    <button
                      type="button"
                      className="comment-delete"
                      onClick={() => handleDelete(c.id)}
                      title="Delete comment"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
