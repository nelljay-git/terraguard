import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  Bookmark,
  BookmarkCheck,
  Loader2,
  Lock,
  MessageSquare,
  MessagesSquare,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
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
      <div className="forum-header glass">
        <div className="forum-header-left">
          <h1 className="forum-header-title">
            <MessagesSquare size={28} className="text-accent" style={{ color: '#3b82f6' }} />
            Community Forum
          </h1>
          <p className="forum-header-subtitle">
            Discuss earthquakes, safety tips, and seismic activity with the TerraGuard community.
            The administrator publishes announcements and pinned guides.
          </p>
        </div>
        {admin && (
          <Link to="/forum/new" className="forum-new-post-btn">
            <Plus size={17} />
            New Post
          </Link>
        )}
      </div>

      <div className="forum-toolbar glass">
        <div className="forum-search">
          <Search size={16} />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search posts..."
          />
        </div>
        <div className="forum-filters">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`forum-filter-chip ${filter === key ? 'active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {key === 'pinned' && <Pin size={13} />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="forum-error-banner">{error}</div>}

      {loading ? (
        <div className="forum-loading glass">
          <div className="spinner-ring"></div>
          <p>Loading posts...</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="forum-empty glass">
          <MessageSquare size={48} style={{ opacity: 0.2 }} />
          <h3>{search ? 'No posts found' : 'No forum posts yet'}</h3>
          <p>
            {search
              ? `No posts matched "${search}". Try a different search term.`
              : 'The administrator has not published any posts yet. Check back soon.'}
          </p>
        </div>
      ) : (
        <div className="forum-posts">
          {posts.map((post) => (
            <article key={post.id} className={`forum-post-card glass${post.pinned ? ' pinned' : ''}`}>
              <div className="forum-post-topline">
                {post.pinned && (
                  <span className="forum-pin-badge">
                    <Pin size={11} /> Pinned
                  </span>
                )}
                {post.closed && (
                  <span className="forum-closed-tag">
                    <Lock size={11} /> Closed
                  </span>
                )}
                {post.author_id === user?.id && (
                  <span className="forum-admin-badge">
                    <BadgeCheck size={11} /> Admin
                  </span>
                )}
              </div>

              <Link to={`/forum/${post.id}`} style={{ textDecoration: 'none' }}>
                <h2 className="forum-post-title">{post.title}</h2>
                {post.image_url && (
                  <button
                    type="button"
                    className="forum-thumb-btn"
                    aria-label="View full image"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setLightboxSrc(post.image_url ?? null);
                    }}
                  >
                    <img
                      src={post.image_url}
                      alt={post.title}
                      loading="lazy"
                      className="forum-post-thumb"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </button>
                )}
                <p className="forum-post-excerpt">{truncateContent(post.content)}</p>
              </Link>

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
                        <BadgeCheck size={13} color="#3b82f6" />
                      </span>
                    )}
                  </span>
                </span>
                <span className="forum-post-time">
                  {formatForumTime(post.created_at, now)}
                  {post.edited_at && <span className="forum-edited-tag"> · edited</span>}
                </span>
                <span className="forum-comment-count">
                  <MessageSquare size={13} /> {post.comment_count}
                </span>
              </div>

              <div className="forum-post-footer">
                <ForumReactions
                  likeCount={post.like_count}
                  helpfulCount={post.helpful_count}
                  interestingCount={post.interesting_count}
                  myReaction={post.my_reaction}
                  busy={busy[post.id] ?? null}
                  onReact={(reaction) => handleReact(post, reaction)}
                />

                <div className="forum-secondary-actions">
                  {admin && (
                    <>
                      <Link to={`/forum/${post.id}/edit`} className="forum-icon-btn" title="Edit post">
                        <PencilLine size={14} />
                      </Link>
                      <button
                        type="button"
                        className="forum-icon-btn"
                        onClick={() => handlePin(post)}
                        title={post.pinned ? 'Unpin post' : 'Pin post'}
                      >
                        {post.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                      </button>
                      <button
                        type="button"
                        className="forum-icon-btn danger"
                        onClick={() => handleDelete(post)}
                        title="Delete post"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={`forum-icon-btn${post.bookmarked ? ' bookmarked' : ''}`}
                    onClick={() => handleBookmark(post)}
                    disabled={bookmarkBusy[post.id]}
                    title={post.bookmarked ? 'Remove bookmark' : 'Save post'}
                  >
                    {bookmarkBusy[post.id] ? (
                      <Loader2 size={15} className="spin" />
                    ) : post.bookmarked ? (
                      <BookmarkCheck size={15} />
                    ) : (
                      <Bookmark size={15} />
                    )}
                  </button>
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
              {loadingMore ? <Loader2 size={16} className="spin" /> : <MessageSquare size={16} />}
              Load more posts
            </button>
          )}
        </div>
      )}

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
