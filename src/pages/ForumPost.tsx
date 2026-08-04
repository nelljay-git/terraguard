import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  Bookmark,
  BookmarkCheck,
  Loader2,
  MessageSquare,
  PencilLine,
  Pin,
  PinOff,
  Send,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { ForumComment as ForumCommentType, ForumReaction } from '../lib/forum';
import {
  getForumPost,
  getForumComments,
  getForumCommentPath,
  toggleForumReaction,
  toggleForumBookmark,
  addForumComment,
  togglePinForumPost,
  deleteForumPost,
  isForumAdmin,
  formatForumTime,
  getErrorMessage,
} from '../lib/forum';
import { ForumComment } from '../components/ForumComment';
import { ForumReactions } from '../components/ForumReactions';
import './Forum.css';

const ROOT_PAGE_SIZE = 5;

export function ForumPost() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusCommentId = searchParams.get('comment');
  const { user } = useAuth();
  const admin = isForumAdmin(user?.email);

  const [post, setPost] = useState<{
    id: string;
    author_id: string;
    title: string;
    content: string;
    author: string | null;
    pinned: boolean;
    image_url: string | null;
    created_at: string;
    edited_at: string | null;
    like_count: number;
    helpful_count: number;
    interesting_count: number;
    my_reaction: ForumReaction | null;
    bookmarked: boolean;
    verified: boolean;
    avatar_url: string | null;
  } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const [roots, setRoots] = useState<ForumCommentType[]>([]);
  const [rootsLoading, setRootsLoading] = useState(true);
  const [hasMoreRoots, setHasMoreRoots] = useState(false);
  const cursorRef = useRef<string | null>(null);

  const [focusPath, setFocusPath] = useState<string[] | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const [commentCount, setCommentCount] = useState(0);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState<ForumReaction | null>(null);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
    setLoading(true);
    setNotFound(false);
    setPost(null);
    setRoots([]);
    setRootsLoading(true);
    cursorRef.current = null;
    setHasMoreRoots(false);

    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    getForumPost(id)
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setNotFound(true);
          return;
        }
        setPost(p);
        setCommentCount(p.comment_count);
        document.title = `${p.title} | TerraGuard Forum`;
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      document.title = 'TerraGuard - Earthquake Monitoring';
    };
  }, [id]);

  const loadRoots = useCallback(
    async (before: string | null, append: boolean) => {
      if (!id) return;
      setRootsLoading(true);
      try {
        const list = await getForumComments(id, ROOT_PAGE_SIZE, before);        setHasMoreRoots(list.length === ROOT_PAGE_SIZE);
        if (append && before) {
          setRoots((prev) => [...prev, ...list]);
        } else {
          setRoots(list);
        }
        if (list.length > 0) {
          cursorRef.current = list[list.length - 1].created_at;
        }
      } catch (err) {
        console.error(err);
        setActionError(getErrorMessage(err));
      } finally {
        setRootsLoading(false);
      }
    },
    [id, user]
  );

  useEffect(() => {
    if (!id) return;
    setRootsLoading(true);
    setRoots([]);
    cursorRef.current = null;
    setHasMoreRoots(false);
    loadRoots(null, false);
  }, [id, user, loadRoots]);

  // Resolve the ancestor chain for the comment deep-linked via ?comment=
  useEffect(() => {
    if (!id || !focusCommentId) {
      setFocusPath(null);
      return;
    }
    let cancelled = false;
    getForumCommentPath(id, focusCommentId)
      .then((path) => {
        if (cancelled) return;
        setFocusPath(path.length > 0 ? path : null);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setFocusPath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id, focusCommentId]);

  // Keep loading more root comments until the focused comment's ancestor is loaded.
  useEffect(() => {
    if (!focusPath || focusPath.length === 0) return;
    const ancestorId = focusPath[0];
    const loaded = roots.some((r) => r.id === ancestorId);
    if (!loaded && hasMoreRoots && !rootsLoading) {
      loadRoots(cursorRef.current, true);
    }
  }, [focusPath, roots, hasMoreRoots, rootsLoading, loadRoots]);

  // Auto-load more root comments (5 at a time) when the sentinel scrolls into view.
  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (!el || !hasMoreRoots || rootsLoading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMoreRoots && !rootsLoading) {
          loadRoots(cursorRef.current, true);
        }
      },
      { rootMargin: '120px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMoreRoots, rootsLoading, loadRoots]);

  const requireAuth = () => {
    if (!user) {
      navigate('/auth', { state: { from: window.location.pathname } });
      return false;
    }
    return true;
  };

  const handlePostReact = async (reaction: ForumReaction) => {
    if (!requireAuth()) return;
    if (!post) return;
    setError(null);
    setBusy(reaction);
    try {
      const res = await toggleForumReaction('post', post.id, reaction);
      setPost((prev) =>
        prev
          ? {
              ...prev,
              like_count: res.like_count,
              helpful_count: res.helpful_count,
              interesting_count: res.interesting_count,
              my_reaction: res.my_reaction,
            }
          : prev
      );
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleBookmark = async () => {
    if (!requireAuth()) return;
    if (!post) return;
    setBookmarkBusy(true);
    try {
      const res = await toggleForumBookmark(post.id);
      setPost((prev) => (prev ? { ...prev, bookmarked: res.bookmarked } : prev));
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setBookmarkBusy(false);
    }
  };

  const handlePin = async () => {
    if (!post) return;
    try {
      await togglePinForumPost(post.id, !post.pinned);
      setPost((prev) => (prev ? { ...prev, pinned: !prev.pinned } : prev));
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    }
  };

  const handleDeletePost = async () => {
    if (!post) return;
    if (!window.confirm('Delete this post and all of its comments?')) return;
    try {
      await deleteForumPost(post.id);
      navigate('/forum');
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    }
  };

  const handleComposerSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!requireAuth()) return;
    if (!post) return;
    const content = draft.trim();
    if (!content || posting || cooldown > 0) return;
    setError(null);
    setPosting(true);
    try {
      const created = await addForumComment(post.id, null, content);
      const full: ForumCommentType = {
        ...created,
        parent_id: null,
        verified: false,
        avatar_url: null,
        pinned: false,
        reply_count: 0,
        my_reaction: null,
        like_count: 0,
        helpful_count: 0,
        interesting_count: 0,
      };
      setRoots((prev) => [full, ...prev]);
      setCommentCount((c) => c + 1);
      setDraft('');
      setCooldown(POST_COOLDOWN_SECONDS);
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div className="forum-page container">
        <div className="forum-loading glass">
          <div className="spinner-ring"></div>
          <p>Loading post...</p>
        </div>
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="forum-page container">
        <div className="forum-empty glass">
          <MessageSquare size={48} style={{ opacity: 0.2 }} />
          <h3>Post not found</h3>
          <p>This forum post may have been removed by the administrator.</p>
          <Link to="/forum" className="forum-back-link" style={{ marginTop: 8 }}>
            <ArrowLeft size={15} /> Back to Forum
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="forum-post-page container">
      <Link to="/forum" className="forum-back-link">
        <ArrowLeft size={15} />
        Back to Forum
      </Link>

      <article className={`forum-post-full glass${post.pinned ? ' pinned' : ''}`}>
        <div className="forum-post-topline">
          {post.pinned && (
            <span className="forum-pin-badge">
              <Pin size={11} /> Pinned
            </span>
          )}
          {admin && (
            <span className="forum-admin-badge">
              <BadgeCheck size={11} /> Admin
            </span>
          )}
        </div>

        <h1 className="forum-full-title">{post.title}</h1>

        <div className="forum-post-meta">
          <span className="forum-author-row">
            <span className={`forum-avatar${post.avatar_url ? ' has-photo' : ''}`}>
              <span>{post.author?.[0]?.toUpperCase() ?? 'U'}</span>
              {post.avatar_url && (
                <img
                  src={post.avatar_url}
                  alt={post.author ?? 'User'}
                  loading="lazy"
                  className="forum-avatar-img"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
            </span>
            <span className="forum-author-name">
              {post.author ?? 'User'}
              {post.verified && (
                <span className="forum-verified" title="Verified user">
                  <BadgeCheck size={14} color="#3b82f6" />
                </span>
              )}
            </span>
          </span>
          <span className="forum-post-time">
            {formatForumTime(post.created_at, now)}
            {post.edited_at && <span className="forum-edited-tag"> · edited</span>}
          </span>
        </div>

        {admin && (
          <div className="forum-full-adminbar">
            <Link to={`/forum/${post.id}/edit`} className="forum-icon-btn">
              <PencilLine size={14} />
              Edit
            </Link>
            <button type="button" className="forum-icon-btn" onClick={handlePin}>
              {post.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              {post.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button type="button" className="forum-icon-btn danger" onClick={handleDeletePost}>
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        )}

        <p className="forum-full-content">{post.content}</p>

        {post.image_url && (
          <img
            src={post.image_url}
            alt={post.title}
            className="forum-full-image"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}

        {error && <div className="forum-error-banner">{error}</div>}

        <div className="forum-post-footer">
          <ForumReactions
            likeCount={post.like_count}
            helpfulCount={post.helpful_count}
            interestingCount={post.interesting_count}
            myReaction={post.my_reaction}
            busy={busy}
            onReact={handlePostReact}
          />

          <div className="forum-secondary-actions">
            <span className="forum-comment-count">
              {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
            </span>
            <button
              type="button"
              className={`forum-icon-btn${post.bookmarked ? ' bookmarked' : ''}`}
              onClick={handleBookmark}
              disabled={bookmarkBusy}
              title={post.bookmarked ? 'Remove bookmark' : 'Save post'}
            >
              {bookmarkBusy ? (
                <Loader2 size={15} className="spin" />
              ) : post.bookmarked ? (
                <BookmarkCheck size={15} />
              ) : (
                <Bookmark size={15} />
              )}
              {post.bookmarked ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </article>

      <section className="forum-comments glass">
        <div className="forum-comments-header">
          <h3 className="forum-comments-title">
            <MessageSquare size={18} />
            Discussion
          </h3>
          <span className="forum-comment-count">{commentCount} total</span>
        </div>

        <form className="forum-composer" onSubmit={handleComposerSubmit}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={user ? 'Join the discussion...' : 'Sign in to leave a comment'}
            rows={3}
            maxLength={2000}
            disabled={!user}
          />
          <div className="forum-composer-row">
            {cooldown > 0 && <span className="forum-cooldown">You can comment again in {cooldown}s</span>}
            <button
              type="submit"
              className="forum-composer-submit"
              disabled={!user || !draft.trim() || posting || cooldown > 0}
            >
              {posting ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              Comment
            </button>
          </div>
        </form>

        {actionError && <div className="forum-error-banner">{actionError}</div>}

        <div className="forum-comments-list">
          {rootsLoading ? (
            <div className="forum-loading">
              <div className="spinner-ring"></div>
            </div>
          ) : roots.length === 0 ? (
            <p className="text-muted" style={{ textAlign: 'center', padding: '12px 0', fontSize: '0.9rem' }}>
              No comments yet. Be the first to join the discussion.
            </p>
          ) : (
            roots.map((root) => (
              <ForumComment
                key={root.id}
                comment={root}
                postId={post.id}
                isAdmin={admin}
                currentUserId={user?.id ?? null}
                now={now}
                requireAuth={requireAuth}
                focusPath={focusPath?.[0] === root.id ? focusPath : null}
                onAddReply={() => setCommentCount((c) => c + 1)}
                onPinToggle={(id, pinned) => {
                  setRoots((prev) => {
                    const next = prev.map((r) => (r.id === id ? { ...r, pinned } : r));
                    return [...next].sort(
                      (a, b) => Number(b.pinned) - Number(a.pinned) ||
                        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                    );
                  });
                }}
                onDelete={() => {
                  setRoots((prev) => prev.filter((r) => r.id !== root.id));
                  setCommentCount((c) => Math.max(0, c - 1));
                }}
              />
            ))
          )}

          {hasMoreRoots && (
            <div ref={loadMoreSentinelRef} style={{ height: 1 }} aria-hidden="true" />
          )}

          {hasMoreRoots && (
            <button
              type="button"
              className="forum-load-more"
              onClick={() => loadRoots(cursorRef.current, true)}
              disabled={rootsLoading}
            >
              {rootsLoading ? <Loader2 size={16} className="spin" /> : <MessageSquare size={16} />}
              Load more comments
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
