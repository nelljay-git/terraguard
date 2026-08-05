import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Loader2, Pin, Reply, ThumbsUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getNotifications, markNotificationsRead, formatForumTime, type Notification } from '../lib/forum';
import '../pages/Forum.css';

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

  const unread = items.filter((n) => !n.read).length;

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

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-btn"
        onClick={handleOpen}
        title="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && <span className="notif-dot" />}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <h4>Notifications</h4>
            <button type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <div className="notif-list">
            {loading ? (
              <div className="notif-empty">
                <Loader2 size={18} className="spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="notif-empty">
                No notifications yet. You'll be notified when someone replies to, reacts to, likes, or pins your comments.
              </div>
            ) : (
              items.map((n) => {
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`notif-item${n.read ? '' : ' unread'}`}
                    onClick={() => handleItemClick(n)}
                  >
                    <span className={`forum-avatar${n.actor_avatar ? ' has-photo' : ''}`}>
                      <span>{n.actor_name?.[0]?.toUpperCase() ?? 'U'}</span>
                      {n.actor_avatar && (
                        <img
                          src={n.actor_avatar}
                          alt={n.actor_name ?? 'User'}
                          loading="lazy"
                          className="forum-avatar-img"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      )}
                    </span>
                    <span className="notif-body">
                      <span className="notif-text">
                        {n.type === 'reply' ? (
                          <>
                            <strong>{n.actor_name ?? 'Someone'}</strong> replied to your comment
                          </>
                        ) : n.type === 'comment_pin' ? (
                          <>
                            <strong>{n.actor_name ?? 'Someone'}</strong> pinned your comment
                          </>
                        ) : n.type === 'comment_like' ? (
                          <>
                            <strong>{n.actor_name ?? 'Someone'}</strong> liked your comment
                          </>
                        ) : (
                          <>
                            <strong>{n.actor_name ?? 'Someone'}</strong> reacted to your{' '}
                            {n.comment_id ? 'comment' : 'post'}
                          </>
                        )}
                      </span>
                      <span className="notif-time">{formatForumTime(n.created_at, now)}</span>
                    </span>
                    {n.type === 'reply' ? (
                      <Reply size={13} />
                    ) : n.type === 'comment_pin' ? (
                      <Pin size={13} />
                    ) : (
                      <ThumbsUp size={13} />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
