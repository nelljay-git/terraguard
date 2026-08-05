import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Star, Heart, Send, Trash2, LogIn, Loader2, Users, ShieldAlert, X, BadgeCheck, Pin, PinOff, CornerUpLeft, CornerUpRight } from 'lucide-react';
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
  toggleCommentPin,
  fetchCommentReplies,
  fetchCommentPath,
  getErrorMessage,
  type EventComment,
} from '../lib/supabase';
import { isForumAdmin } from '../lib/forum';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor } from '../lib/utils';
import './CommunitySection.css';

interface CommunitySectionProps {
  eqId: string;
  earthquake: PhivolcsEarthquake;
}

export function CommunitySection({ eqId, earthquake }: CommunitySectionProps) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusCommentId = searchParams.get('comment');
  const color = getSeverityColor(parseFloat(earthquake.magnitude));
  const admin = isForumAdmin(user?.email);

  const [starCount, setStarCount] = useState(0);
  const [starred, setStarred] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [comments, setComments] = useState<EventComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(5);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState<null | 'star' | 'like'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [commentLikes, setCommentLikes] = useState<Record<string, { count: number; liked: boolean }>>({});
  const [commentLikeBusy, setCommentLikeBusy] = useState<Record<string, boolean>>({});
  const [replies, setReplies] = useState<Record<string, EventComment[]>>({});
  const [repliesOpen, setRepliesOpen] = useState<Record<string, boolean>>({});
  const [repliesLoading, setRepliesLoading] = useState<Record<string, boolean>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyPosting, setReplyPosting] = useState<Record<string, boolean>>({});
  const [replyErrors, setReplyErrors] = useState<Record<string, string | null>>({});
  const [replyCooldowns, setReplyCooldowns] = useState<Record<string, number>>({});
  const [pinBusy, setPinBusy] = useState<Record<string, boolean>>({});

  const POST_COOLDOWN_SECONDS = 10;

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Live countdown for reply rate limits (one timer per open reply thread).
  useEffect(() => {
    const keys = Object.keys(replyCooldowns).filter((k) => (replyCooldowns[k] ?? 0) > 0);
    if (keys.length === 0) return;
    const t = setTimeout(() => {
      setReplyCooldowns((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const k of Object.keys(next)) {
          if (next[k] > 0) {
            next[k] -= 1;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [replyCooldowns]);

  // Read the wait time out of a rate-limit message like "Please wait 12 seconds".
  const extractWaitSeconds = (message: string): number => {
    const m = /(\d+)\s*(second|minute)s?/i.exec(message);
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    return m[2].toLowerCase().startsWith('m') ? n * 60 : n;
  };

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
      setComments((prev) => [
        { ...comment, verified: profile?.verified ?? false, avatar_url: profile?.avatar_url ?? null },
        ...prev,
      ]);
      setDraft('');
      setCooldown(POST_COOLDOWN_SECONDS);
    } catch (err) {
      console.error(err);
      const msg = getErrorMessage(err);
      setCommentError(msg);
      const wait = extractWaitSeconds(msg);
      if (wait > 0) setCooldown(wait);
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteComment(id);
    } catch (err) {
      console.error(err);
      return;
    }
    // Remove the comment (and any loaded subtree) from state.
    let parentId: string | null = null;
    for (const [pid, arr] of Object.entries(replies)) {
      if (arr.some((r) => r.id === id)) {
        parentId = pid;
        break;
      }
    }
    if (parentId) {
      setReplies((prev) => {
        const next = { ...prev, [parentId]: (prev[parentId] ?? []).filter((r) => r.id !== id) };
        delete next[id];
        return next;
      });
      bumpReplyCount(parentId, -1);
    } else {
      setComments((prev) => prev.filter((c) => c.id !== id));
      setReplies((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  // Adjust a comment/reply's direct reply count wherever it lives in state.
  const bumpReplyCount = (id: string, delta: number) => {
    setComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, reply_count: Math.max(0, c.reply_count + delta) } : c))
    );
    setReplies((prev) => {
      let found = false;
      const next: Record<string, EventComment[]> = {};
      for (const [pid, arr] of Object.entries(prev)) {
        next[pid] = arr.map((r) => {
          if (r.id === id) {
            found = true;
            return { ...r, reply_count: Math.max(0, r.reply_count + delta) };
          }
          return r;
        });
      }
      return found ? next : prev;
    });
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

  // Patch a comment (or reply) wherever it lives in state.
  const updateComment = (id: string, patch: Partial<EventComment>) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setReplies((prev) => {
      let found = false;
      const next: Record<string, EventComment[]> = {};
      for (const [pid, arr] of Object.entries(prev)) {
        const mapped = arr.map((r) => (r.id === id ? { ...r, ...patch } : r));
        if (mapped !== arr) found = true;
        next[pid] = mapped;
      }
      return found ? next : prev;
    });
  };

  const handleCommentPin = async (comment: EventComment) => {
    if (!admin) return;
    setPinBusy((prev) => ({ ...prev, [comment.id]: true }));
    try {
      const res = await toggleCommentPin(comment.id);
      updateComment(comment.id, { pinned: res.pinned });
    } catch (err) {
      console.error(err);
      setActionError(getErrorMessage(err));
    } finally {
      setPinBusy((prev) => ({ ...prev, [comment.id]: false }));
    }
  };

  const toggleReplies = async (parentId: string) => {
    const next = !repliesOpen[parentId];
    setRepliesOpen((prev) => ({ ...prev, [parentId]: next }));
    if (next && !replies[parentId] && !repliesLoading[parentId]) {
      setRepliesLoading((prev) => ({ ...prev, [parentId]: true }));
      try {
        const list = await fetchCommentReplies(eqId, [parentId]);
        setReplies((prev) => ({ ...prev, [parentId]: list }));
      } catch (err) {
        console.error('Failed to load replies', err);
      } finally {
        setRepliesLoading((prev) => ({ ...prev, [parentId]: false }));
      }
    }
  };

  const handleReply = async (parentId: string) => {
    if (!requireAuth()) return;
    const content = (replyDrafts[parentId] ?? '').trim();
    if (!content || replyPosting[parentId]) return;
    setReplyErrors((prev) => ({ ...prev, [parentId]: null }));
    setReplyPosting((prev) => ({ ...prev, [parentId]: true }));
    try {
      const reply = await addComment(eqId, content, parentId);
      const full: EventComment = {
        ...reply,
        verified: profile?.verified ?? false,
        avatar_url: profile?.avatar_url ?? null,
      };
      setReplies((prev) => ({
        ...prev,
        [parentId]: [...(prev[parentId] ?? []), full],
      }));
      bumpReplyCount(parentId, 1);
      setRepliesOpen((prev) => ({ ...prev, [parentId]: true }));
      setReplyDrafts((prev) => ({ ...prev, [parentId]: '' }));
      setReplyingTo(null);
    } catch (err) {
      console.error(err);
      const msg = getErrorMessage(err);
      setReplyErrors((prev) => ({ ...prev, [parentId]: msg }));
      const wait = extractWaitSeconds(msg);
      if (wait > 0) setReplyCooldowns((prev) => ({ ...prev, [parentId]: wait }));
    } finally {
      setReplyPosting((prev) => ({ ...prev, [parentId]: false }));
    }
  };

  const formatDate = (iso: string, current: number) => {
    const d = new Date(iso);
    const diff = current - d.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Pinned comments float to the top, then verified users' comments, then newest.
  const sortedComments = useMemo(
    () =>
      [...comments].sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          Number(b.verified) - Number(a.verified) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [comments]
  );

  const visibleComments = useMemo(
    () => sortedComments.slice(0, visibleCount),
    [sortedComments, visibleCount]
  );
  const hasMoreComments = visibleCount < sortedComments.length;

  const commentsListRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  // Reveal 5 more comments when the sentinel scrolls into view inside the list.
  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    const root = commentsListRef.current;
    if (!el || !root || !hasMoreComments) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => c + 5);
        }
      },
      { root, rootMargin: '80px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMoreComments, visibleComments]);

  const commentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const focusedOnce = useRef(false);

  // Deep-link from a notification: resolve the target's ancestor chain, expand
  // and load every thread level along it, then scroll to the target. All state
  // updates happen inside async callbacks so React never cascades renders.
  useEffect(() => {
    if (!focusCommentId || comments.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        let path: string[];
        if (sortedComments.some((c) => c.id === focusCommentId)) {
          path = [focusCommentId];
        } else {
          path = await fetchCommentPath(eqId, focusCommentId);
          if (cancelled || path.length === 0) return;
        }

        const target = path[path.length - 1];
        const rootId = path[0];
        const parents = path.slice(0, -1);

        // Ensure the root comment is within the paginated window.
        const rootIdx = sortedComments.findIndex((c) => c.id === rootId);
        if (rootIdx >= 0 && rootIdx >= visibleCount) setVisibleCount(rootIdx + 1);

        // Open every ancestor thread so the target becomes visible.
        setRepliesOpen((prev) => {
          const next = { ...prev };
          for (const pid of parents) next[pid] = true;
          return next;
        });

        // Load any unloaded ancestor levels.
        const toLoad = parents.filter((pid) => !replies[pid] && !repliesLoading[pid]);
        if (toLoad.length > 0) {
          setRepliesLoading((prev) => {
            const next = { ...prev };
            for (const pid of toLoad) next[pid] = true;
            return next;
          });
          const list = await fetchCommentReplies(eqId, toLoad);
          if (cancelled) return;
          setReplies((prev) => {
            const next = { ...prev };
            for (const pid of toLoad) next[pid] = list.filter((r) => r.parent_id === pid);
            return next;
          });
          for (const pid of toLoad) {
            setRepliesLoading((prev) => ({ ...prev, [pid]: false }));
          }
        }

        // Scroll once the target has rendered (this effect re-runs when the
        // thread data lands, and focusedOnce guards against repeated scrolls).
        const el = commentRefs.current.get(target);
        if (el && !focusedOnce.current) {
          focusedOnce.current = true;
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } catch {
        /* ignore focus errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusCommentId, sortedComments, visibleCount, comments, eqId, replies, repliesLoading]);

  const totalComments =
    comments.length + comments.reduce((sum, c) => sum + (c.reply_count ?? 0), 0);

  const renderCommentNode = (node: EventComment, parentAuthor: string | null, depth: number) => {
    const isFocused = node.id === focusCommentId;
    const open = repliesOpen[node.id] === true;
    const hasReplies =
      (node.reply_count ?? 0) > 0 ||
      (replies[node.id]?.length ?? 0) > 0 ||
      repliesOpen[node.id] === true;

    return (
      <div
        key={node.id}
        className={`community-comment${depth > 0 ? ' comment-reply' : ''}${
          isFocused ? ' community-comment-focus' : ''
        }`}
        ref={(el) => {
          if (el) commentRefs.current.set(node.id, el);
          else commentRefs.current.delete(node.id);
        }}
      >
        <div
          className={`comment-avatar${depth > 0 ? ' comment-avatar-sm' : ''}${
            node.avatar_url ? ' has-photo' : ''
          }`}
        >
          <span className="comment-avatar-letter">{node.author?.[0]?.toUpperCase() ?? 'U'}</span>
          {node.avatar_url && (
            <img
              src={node.avatar_url}
              alt={node.author ?? 'User'}
              loading="lazy"
              className="comment-avatar-img"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
        </div>
        <div className="comment-body">
          <div className="comment-meta">
            <span className="comment-author-row">
              <span className="comment-author">{node.author ?? 'User'}</span>
              {node.verified && (
                <span title="Verified user" className="comment-verified-wrap">
                  <BadgeCheck size={14} className="comment-verified" />
                </span>
              )}
            </span>
            <span className="comment-meta-sub">
              <span className="comment-time text-muted">{formatDate(node.created_at, now)}</span>
              {node.pinned && (
                <span className="comment-pinned-badge">
                  <Pin size={10} />
                  Pinned
                </span>
              )}
            </span>
          </div>

          {parentAuthor && (
            <div className="comment-replied-to">
              <CornerUpRight size={11} />
              <span>
                replied to <strong>{parentAuthor}</strong>
              </span>
            </div>
          )}

          <p className="comment-content">{node.content}</p>
          <div className="comment-footer">
            <button
              type="button"
              className={`comment-like-btn ${commentLikes[node.id]?.liked ? 'active' : ''}`}
              onClick={() => handleCommentLike(node)}
              disabled={commentLikeBusy[node.id]}
              title={commentLikes[node.id]?.liked ? 'Unlike' : 'Like'}
            >
              {commentLikeBusy[node.id] ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <Heart size={13} fill={commentLikes[node.id]?.liked ? 'currentColor' : 'none'} />
              )}
              <span>{commentLikes[node.id]?.count ?? 0}</span>
            </button>
            <button
              type="button"
              className="comment-reply-btn"
              onClick={() => {
                if (!requireAuth()) return;
                setReplyingTo((prev) => (prev === node.id ? null : node.id));
              }}
              title="Reply"
            >
              <CornerUpLeft size={12} />
              <span>Reply</span>
            </button>
            {hasReplies && (
              <button
                type="button"
                className="comment-replies-toggle"
                onClick={() => toggleReplies(node.id)}
                disabled={repliesLoading[node.id]}
                title={repliesOpen[node.id] ? 'Hide replies' : 'Show replies'}
              >
                <CornerUpRight size={12} />
                <span>
                  {repliesLoading[node.id]
                    ? 'Loading...'
                    : repliesOpen[node.id]
                      ? 'Hide replies'
                      : `${node.reply_count ?? 0} ${(node.reply_count ?? 0) === 1 ? 'reply' : 'replies'}`}
                </span>
              </button>
            )}
            {admin && (
              <button
                type="button"
                className={`comment-pin-btn${node.pinned ? ' active' : ''}`}
                onClick={() => handleCommentPin(node)}
                disabled={pinBusy[node.id]}
                title={node.pinned ? 'Unpin comment' : 'Pin comment'}
              >
                {pinBusy[node.id] ? (
                  <Loader2 size={12} className="spin" />
                ) : node.pinned ? (
                  <PinOff size={12} />
                ) : (
                  <Pin size={12} />
                )}
                <span>{node.pinned ? 'Unpin' : 'Pin'}</span>
              </button>
            )}
            {user && user.id === node.user_id && (
              <button
                type="button"
                className="comment-delete"
                onClick={() => handleDelete(node.id)}
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>

          {replyingTo === node.id && (
            <form
              className="community-composer reply-composer"
              onSubmit={(e) => {
                e.preventDefault();
                handleReply(node.id);
              }}
            >
              <textarea
                autoFocus
                value={replyDrafts[node.id] ?? ''}
                onChange={(e) =>
                  setReplyDrafts((prev) => ({ ...prev, [node.id]: e.target.value }))
                }
                placeholder={
                  user ? `Reply to ${node.author ?? 'user'}...` : 'Sign in to reply'
                }
                rows={2}
                maxLength={500}
                disabled={!user}
              />
              <div className="community-composer-row">
                {(replyCooldowns[node.id] ?? 0) > 0 && (
                  <span className="community-cooldown text-muted">
                    You can reply again in {replyCooldowns[node.id]}s
                  </span>
                )}
                {replyErrors[node.id] && (
                  <span className="community-error reply-error">
                    <ShieldAlert size={13} />
                    <span>{replyErrors[node.id]}</span>
                  </span>
                )}
                <button
                  type="submit"
                  className="community-send"
                  disabled={
                    !user ||
                    !(replyDrafts[node.id] ?? '').trim() ||
                    replyPosting[node.id] ||
                    (replyCooldowns[node.id] ?? 0) > 0
                  }
                >
                  {replyPosting[node.id] ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                  <span>
                    {(replyCooldowns[node.id] ?? 0) > 0
                      ? `${replyCooldowns[node.id]}s`
                      : 'Reply'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {open && (
            <div className="comment-replies">
              {repliesLoading[node.id] ? (
                <div className="community-loading flex-center" style={{ minHeight: '36px' }}>
                  <div className="pulse-loader" style={{ width: '18px', height: '18px' }}></div>
                </div>
              ) : (
                (replies[node.id] ?? []).map((child) =>
                  renderCommentNode(child, node.author ?? null, depth + 1)
                )
              )}
            </div>
          )}
        </div>
      </div>
    );
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
          {likeCount === 1 ? 'like' : 'likes'} · {totalComments}{' '}
          {totalComments === 1 ? 'comment' : 'comments'}
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

      <div className="community-comments" ref={commentsListRef}>
        {commentsLoading ? (
          <div className="community-loading flex-center">
            <div className="pulse-loader" style={{ width: '22px', height: '22px' }}></div>
          </div>
        ) : comments.length === 0 ? (
          <p className="text-muted" style={{ fontSize: '0.85rem', textAlign: 'center', padding: '12px 0' }}>
            No comments yet. Be the first to react to this event.
          </p>
        ) : (
          <>
            {visibleComments.map((c) => renderCommentNode(c, null, 0))}
            {hasMoreComments && (
              <div
                ref={loadMoreSentinelRef}
                className="community-load-more"
              >
                Scroll for more comments
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
