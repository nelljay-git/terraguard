import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Pin, Inbox, Loader2, Reply, ThumbsUp, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getNotifications, markNotificationsRead, formatForumTime, type Notification } from '../lib/forum';
import './Navbar.css';

type Group = { latest: Notification; count: number };

export function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      return;
    }
    try {
      const list = await getNotifications(user.id);
      setItems(list);
    } catch (err) {
      console.error('Failed to load notifications', err);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refresh = () => {
      getNotifications(user.id)
        .then((list) => {
          if (!cancelled) setItems(list);
        })
        .catch((err) => console.error('Failed to load notifications', err));
    };
    refresh();
    const t = setInterval(refresh, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  /* Escape to close — consistent with menus and modals */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const unread = items.filter((n) => !n.read).length;

  /* Collapse consecutive notifications that share actor + type + target into
     a single row with a count chip — the feed otherwise repeats the same
     reaction dozens of times. Groups no-ops if the order changes. */
  const groups = useMemo<Group[]>(() => {
    const key = (n: Notification) => `${n.type}|${n.actor_name ?? ''}|${n.post_id ?? ''}|${n.comment_id ?? ''}|${n.eq_id ?? ''}|${n.details_comment_id ?? ''}`;
    const out: Group[] = [];
    for (const n of items) {
      const last = out[out.length - 1];
      if (last && key(last.latest) === key(n)) {
        out[out.length - 1] = { latest: last.latest, count: last.count + 1 };
      } else {
        out.push({ latest: n, count: 1 });
      }
    }
    return out;
  }, [items]);

  const handleOpen = async () => {
    setOpen((o) => !o);
    if (open || !user) return;
    setLoading(true);
    try {
      await load();
    } finally {
      setLoading(false);
    }
    if (unread > 0) {
      await markNotificationsRead().catch(() => {});
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  };

  const handleItemClick = (n: Notification) => {
    setOpen(false);
    if (n.post_id) {
      const qs = n.comment_id ? `?comment=${encodeURIComponent(n.comment_id)}` : '';
      navigate(`/forum/${n.post_id}${qs}`);
    } else if (n.eq_id) {
      const qs = n.details_comment_id
        ? `?comment=${encodeURIComponent(n.details_comment_id)}`
        : '';
      navigate(`/details/${n.eq_id}${qs}`);
    }
  };

  if (!user) return null;

  const actionText = (n: Notification) => {
    switch (n.type) {
      case 'reply':
        return 'replied to your comment';
      case 'comment_pin':
        return 'pinned your comment';
      case 'comment_like':
        return 'liked your comment';
      default:
        return `reacted to your ${n.comment_id ? 'comment' : 'post'}`;
    }
  };

  const typeClass = (n: Notification) =>
    n.type === 'reply' ? 'is-reply' : n.type === 'comment_pin' ? 'is-pin' : n.type === 'comment_like' ? 'is-like' : 'is-reaction';

  const TypeIcon = (n: Notification) => {
    switch (n.type) {
      case 'reply':
        return <Reply size={13} aria-hidden="true" />;
      case 'comment_pin':
        return <Pin size={13} aria-hidden="true" />;
      default:
        return <ThumbsUp size={13} aria-hidden="true" />;
    }
  };

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-btn"
        onClick={handleOpen}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notif-panel"
        title="Notifications"
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && <span className="notif-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="notif-panel" id="notif-panel" role="region" aria-label="Notifications">
          <div className="notif-head">
            <span className="notif-head-title">
              Notifications
              {unread > 0 && <span className="notif-count tnum">{unread}</span>}
            </span>
            <button type="button" className="notif-close" onClick={() => setOpen(false)} aria-label="Close notifications">
              <X size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="notif-list" role="list">
            {loading ? (
              <div className="notif-empty notif-empty-loading" role="status" aria-label="Loading notifications">
                <Loader2 size={20} className="spin" aria-hidden="true" />
              </div>
            ) : groups.length === 0 ? (
              <div className="notif-empty">
                <span className="notif-empty-icon" aria-hidden="true">
                  <Inbox size={22} />
                </span>
                <p className="notif-empty-title">All caught up</p>
                <p className="notif-empty-sub">You&apos;ll be notified when someone replies to, reacts to, likes, or pins your comments.</p>
              </div>
            ) : (
              groups.map(({ latest: n, count }) => (
                <button
                  key={n.id}
                  type="button"
                  role="listitem"
                  className={`notif-item notif-item--${typeClass(n)}${n.read ? '' : ' unread'}`}
                  onClick={() => handleItemClick(n)}
                >
                  <span className={`notif-avatar${n.actor_avatar ? ' has-photo' : ''}`} aria-hidden="true">
                    <span>{n.actor_name?.[0]?.toUpperCase() ?? 'U'}</span>
                    {n.actor_avatar && (
                      <img
                        src={n.actor_avatar}
                        alt=""
                        loading="lazy"
                        className="notif-avatar-img"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                    {!n.read && <span className="notif-unread-dot" />}
                  </span>
                  <span className="notif-body">
                    <span className="notif-text">
                      <strong>{n.actor_name ?? 'Someone'}</strong> {actionText(n)}
                      {count > 1 && <span className="notif-repeat tnum">×{count}</span>}
                    </span>
                    <span className="notif-time">{formatForumTime(n.created_at, now)}</span>
                  </span>
                  <span className="notif-type-icon" aria-hidden="true">{TypeIcon(n)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
