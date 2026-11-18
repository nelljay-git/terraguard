import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  Bookmark,
  BookmarkCheck,
  Loader2,
  ListOrdered,
  Lock,
  MessageSquare,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { ForumFilter, ForumPost as ForumPostType, ForumReaction } from '../lib/forum';
import {
  getForumPosts,
  toggleForumReaction,
  toggleForumBookmark,
  togglePinForumPost,
  deleteForumPost,
  isForumAdmin,
  formatForumTime,
  truncateContent,
  getErrorMessage,
} from '../lib/forum';
import { ForumReactions } from '../components/ForumReactions';
import { ImageLightbox } from '../components/ImageLightbox';
import './Forum.css';

const PAGE_SIZE = 15;
const FILTERS: { key: ForumFilter; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'liked', label: 'Most Liked' },
  { key: 'pinned', label: 'Pinned' },
];

export function Forum() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const admin = isForumAdmin(user?.email);

  const [posts, setPosts] = useState<ForumPostType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<ForumFilter>('newest');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, ForumReaction | null>>({});
  const [bookmarkBusy, setBookmarkBusy] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    document.title = 'Forum | TerraGuard';
    return () => {
      document.title = 'TerraGuard - Earthquake Monitoring';
    };
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchInput]);

  const load = useCallback(
    async (p: number, append: boolean, f: ForumFilter, s: string) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const list = await getForumPosts(f, s, p, PAGE_SIZE);
        setHasMore(list.length === PAGE_SIZE);
        setPosts((prev) => (append ? [...prev, ...list] : list));
        setPage(p);
      } catch (err) {
        console.error(err);
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    load(0, false, filter, search);
  }, [filter, search, user, load]);

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    load(page + 1, true, filter, search);
  };

  const requireAuth = () => {
    if (!user) {
      navigate('/auth', { state: { from: '/forum' } });
      return false;
    }
    return true;
  };

  const updatePost = (id: string, patch: Partial<ForumPostType>) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const handleReact = async (post: ForumPostType, reaction: ForumReaction) => {
    if (!requireAuth()) return;
    setBusy((prev) => ({ ...prev, [post.id]: reaction }));
    try {
      const res = await toggleForumReaction('post', post.id, reaction);
      updatePost(post.id, {
        like_count: res.like_count,
        helpful_count: res.helpful_count,
        interesting_count: res.interesting_count,
        my_reaction: res.my_reaction,
      });
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setBusy((prev) => ({ ...prev, [post.id]: null }));
    }
  };

  const handleBookmark = async (post: ForumPostType) => {
    if (!requireAuth()) return;
    setBookmarkBusy((prev) => ({ ...prev, [post.id]: true }));
    try {
      const res = await toggleForumBookmark(post.id);
      updatePost(post.id, { bookmarked: res.bookmarked });
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setBookmarkBusy((prev) => ({ ...prev, [post.id]: false }));
    }
  };

  const handlePin = async (post: ForumPostType) => {
    try {
      await togglePinForumPost(post.id, !post.pinned);
      updatePost(post.id, { pinned: !post.pinned });
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    }
  };

  const handleDelete = async (post: ForumPostType) => {
    if (!window.confirm(`Delete "${post.title}" and all of its comments?`)) return;
    try {
      await deleteForumPost(post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className="forum-page container">
      {/* ── Masthead: editorial header, no container card ── */}
      <header className="forum-mast">
        <div className="forum-mast-left">
          <span className="forum-eyebrow">TerraGuard · Community</span>
          <h1 className="forum-title">Community Forum</h1>
          <p className="forum-sub">
            Official, admin-published updates on the events TerraGuard tracks — bulletins,
            data notes, and changes to the app. Newest first; nothing here is speculation.
          </p>
        </div>
        {admin && (
          <div className="forum-mast-right">
            <Link to="/forum/new" className="forum-new-post-btn">
              <Plus size={16} aria-hidden="true" />
              Publish post
            </Link>
          </div>
        )}
      </header>

      {/* ── Toolbar: underline tabs + search ── */}
      <div className="forum-toolbar">
        <div className="forum-filters" role="tablist" aria-label="Filter discussions">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={`forum-filter-chip ${filter === key ? 'active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {key === 'pinned' && <Pin size={13} aria-hidden="true" />}
              {label}
            </button>
          ))}
        </div>
        <div className="forum-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search discussions"
            aria-label="Search discussions"
          />
          {searchInput && (
            <button
              type="button"
              className="forum-search-clear"
              onClick={() => setSearchInput('')}
              aria-label="Clear search"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {error && <div className="forum-error-banner" role="alert">{error}</div>}

      {/* ── Body: feed + rail ── */}
      <div className="forum-grid">
        <main className="forum-feed" aria-label="Discussions">
          {loading ? (
            <div className="forum-skeleton" aria-busy="true" aria-label="Loading discussions">
              {[0, 1, 2, 3].map((i) => (
                <div className="forum-skeleton-row" key={i}>
                  <div className="forum-skeleton-avatar" />
                  <div className="forum-skeleton-body">
                    <div className="forum-skeleton-line w-30" />
                    <div className="forum-skeleton-line w-70" />
                    <div className="forum-skeleton-line w-90" />
                    <div className="forum-skeleton-line w-55" />
                  </div>
                </div>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="forum-empty">
              <MessageSquare size={44} strokeWidth={1.25} style={{ opacity: 0.25 }} aria-hidden="true" />
              <h2 className="forum-empty-title">{search ? 'No discussions match' : 'No discussions yet'}</h2>
              <p className="forum-empty-copy">
                {search
                  ? `Nothing matches “${search}”. Try a shorter keyword or check the Pinned tab.`
                  : 'The administrator has not published anything yet. New bulletins will appear here first.'}
              </p>
              {search && (
                <button type="button" className="forum-empty-action" onClick={() => setSearchInput('')}>
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <>
              {posts.map((post) => (
                <article
                  key={post.id}
                  className={`forum-thread${post.pinned ? ' is-pinned' : ''}${post.closed ? ' is-closed' : ''}`}
                >
                  <span className={`forum-avatar${post.avatar_url ? ' has-photo' : ''}`} aria-hidden="true">
                    <span>{post.author?.[0]?.toUpperCase() ?? 'T'}</span>
                    {post.avatar_url && (
                      <img
                        src={post.avatar_url}
                        alt=""
                        loading="lazy"
                        className="forum-avatar-img"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                  </span>

                  <div className="forum-thread-body">
                    <div className="forum-thread-topline">
                      <span className="forum-thread-author">
                        <span className="forum-thread-author-name">
                          {post.author ?? 'TerraGuard'}
                          {post.verified && (
                            <BadgeCheck size={13} color="#3b82f6" aria-hidden="true" />
                          )}
                        </span>
                      </span>
                      <span className="forum-thread-time">
                        {formatForumTime(post.created_at, now)}
                        {post.edited_at && <span className="edited"> · edited</span>}
                      </span>
                      {post.pinned && (
                        <span className="forum-tag forum-tag--pinned">
                          <Pin size={10} aria-hidden="true" /> Pinned
                        </span>
                      )}
                      {post.author_id === user?.id && (
                        <span className="forum-tag forum-tag--admin">
                          <BadgeCheck size={10} aria-hidden="true" /> Admin
                        </span>
                      )}
                      {post.closed && (
                        <span className="forum-tag forum-tag--closed">
                          <Lock size={10} aria-hidden="true" /> Closed
                        </span>
                      )}
                    </div>

                    <h2 className="forum-thread-title">
                      <Link to={`/forum/${post.id}`}>{post.title}</Link>
                    </h2>
                    <p className="forum-thread-excerpt">{truncateContent(post.content)}</p>
                    {post.image_url && (
                      <button
                        type="button"
                        className="forum-thread-thumb-btn"
                        aria-label="View attached image"
                        onClick={() => setLightboxSrc(post.image_url ?? null)}
                      >
                        <img
                          src={post.image_url}
                          alt=""
                          loading="lazy"
                          className="forum-thread-thumb"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      </button>
                    )}

                    <div className="forum-thread-actions">
                      <ForumReactions
                        likeCount={post.like_count}
                        helpfulCount={post.helpful_count}
                        interestingCount={post.interesting_count}
                        myReaction={post.my_reaction}
                        busy={busy[post.id] ?? null}
                        onReact={(reaction) => handleReact(post, reaction)}
                      />
                      <div className="forum-thread-right">
                        <Link to={`/forum/${post.id}#comments`} className="forum-comment-link" aria-label={`${post.comment_count} comments`}>
                          <MessageSquare size={14} aria-hidden="true" />
                          {post.comment_count}
                        </Link>
                        <span className="forum-actions-divider" aria-hidden="true" />
                        <button
                          type="button"
                          className={`forum-icon-btn${post.bookmarked ? ' bookmarked' : ''}`}
                          onClick={() => handleBookmark(post)}
                          disabled={bookmarkBusy[post.id]}
                          title={post.bookmarked ? 'Remove bookmark' : 'Save post'}
                          aria-pressed={post.bookmarked}
                          aria-label={post.bookmarked ? 'Remove bookmark' : 'Save post'}
                        >
                          {bookmarkBusy[post.id] ? (
                            <Loader2 size={15} className="spin" aria-hidden="true" />
                          ) : post.bookmarked ? (
                            <BookmarkCheck size={15} aria-hidden="true" />
                          ) : (
                            <Bookmark size={15} aria-hidden="true" />
                          )}
                        </button>
                        {admin && (
                          <div className="forum-admin-actions" aria-label="Admin actions">
                            <Link to={`/forum/${post.id}/edit`} className="forum-icon-btn" title="Edit post" aria-label="Edit post">
                              <PencilLine size={15} aria-hidden="true" />
                            </Link>
                            <button
                              type="button"
                              className="forum-icon-btn"
                              onClick={() => handlePin(post)}
                              title={post.pinned ? 'Unpin post' : 'Pin post'}
                              aria-label={post.pinned ? 'Unpin post' : 'Pin post'}
                            >
                              {post.pinned ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
                            </button>
                            <button
                              type="button"
                              className="forum-icon-btn danger"
                              onClick={() => handleDelete(post)}
                              title="Delete post"
                              aria-label="Delete post"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              ))}

              {hasMore && (
                <button
                  type="button"
                  className="forum-load-more"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <MessageSquare size={16} aria-hidden="true" />}
                  {loadingMore ? 'Loading…' : 'Load more discussions'}
                </button>
              )}
            </>
          )}
        </main>

        {/* ── Rail: why this exists, honest and static ── */}
        <aside className="forum-rail" aria-label="About this forum">
          <div className="forum-rail-block">
            <h2 className="forum-rail-title"><Radio size={13} aria-hidden="true" />Why this exists</h2>
            <p className="forum-rail-copy">
              Official bulletins, data notes, and changes to TerraGuard — published by the administrator, backed by the same sources the map and alerts use.
            </p>
          </div>

          <div className="forum-rail-block">
            <h2 className="forum-rail-title"><ListOrdered size={13} aria-hidden="true" />How it works</h2>
            <ol className="forum-rail-list">
              <li className="forum-rail-item"><span className="forum-rail-num">01</span><span>Read the <strong>pinned</strong> guide first — it covers the event-detail redesign and how to read revised bulletins.</span></li>
              <li className="forum-rail-item"><span className="forum-rail-num">02</span><span>Newest first by default. Search narrows the loaded page as you type; the Pinned tab is the reference shelf.</span></li>
              <li className="forum-rail-item"><span className="forum-rail-num">03</span><span>Reactions tell the admin what matters — a recurring “Helpful” on a post becomes a guide, not a one-off.</span></li>
            </ol>
            <p className="forum-rail-foot"><strong>Reading tip:</strong> posts marked <em>edited</em> were corrected after publication — the change is always described in the body.</p>
          </div>

          <div className="forum-rail-block">
            <h2 className="forum-rail-title"><ShieldCheck size={13} aria-hidden="true" />House rules</h2>
            <ul className="forum-rail-list">
              <li className="forum-rail-item"><span className="forum-rail-num">01</span><span>Every post links its source or shows its bulletin number. No unattributed numbers, ever.</span></li>
              <li className="forum-rail-item"><span className="forum-rail-num">02</span><span>Admin-published only. There is deliberately no member posting yet — quality over volume.</span></li>
              <li className="forum-rail-item"><span className="forum-rail-num">03</span><span>Spot an error? Reply with the correction and it will be fixed for everyone.</span></li>
            </ul>
          </div>
        </aside>
      </div>

      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          alt="Forum post image"
          caption="Forum post image"
          open={true}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </div>
  );
}
