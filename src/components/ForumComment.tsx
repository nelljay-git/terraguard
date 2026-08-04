import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ChevronDown,
  Loader2,
  PencilLine,
  Pin,
  PinOff,
  Reply,
  Send,
  Trash2,
  BadgeCheck,
} from 'lucide-react';
import type { ForumComment as ForumCommentType, ForumReaction } from '../lib/forum';
import {
  getForumReplies,
  toggleForumReaction,
  addForumComment,
  updateForumComment,
  deleteForumComment,
  toggleForumCommentPin,
  formatForumTime,
  getErrorMessage,
} from '../lib/forum';
import { ForumReactions } from './ForumReactions';

interface ForumCommentProps {
  comment: ForumCommentType;
  postId: string;
  isAdmin: boolean;
  currentUserId: string | null;
  now: number;
  requireAuth: () => boolean;
  focusPath?: string[] | null;
  parentAuthor?: string | null;
  closed?: boolean;
  onAddReply: () => void;
  onDeleteReply?: () => void;
  onDelete: () => void;
  onPinToggle?: (id: string, pinned: boolean) => void;
}

export function ForumComment({
  comment,
  postId,
  isAdmin,
  currentUserId,
  now,
  requireAuth,
  focusPath,
  parentAuthor,
  closed = false,
  onAddReply,
  onDeleteReply,
  onDelete,
  onPinToggle,
}: ForumCommentProps) {
  const [data, setData] = useState<ForumCommentType>(comment);
  const [children, setChildren] = useState<ForumCommentType[] | null>(null);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [editText, setEditText] = useState(data.content);
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState<ForumReaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const canManage = currentUserId === data.author_id || isAdmin;

  // If this comment is on the focused path, ensure its replies are expanded.
  const isFocused = focusPath !== null && focusPath !== undefined && focusPath.length > 0;
  const isTarget = isFocused && focusPath.length === 1 && focusPath[0] === data.id;
  const childFocus =
    isFocused && focusPath[0] === data.id && focusPath.length > 1 ? focusPath.slice(1) : null;

  useEffect(() => {
    if (!isFocused) return;
    if (focusPath[0] !== data.id) return;
    if (focusPath.length > 1 && children === null) {
      loadReplies();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPath, data.id]);

  useEffect(() => {
    if (!isTarget) return;
    const el = rootRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [isTarget]);

  const handleReact = async (reaction: ForumReaction) => {
    if (!requireAuth()) return;
    setError(null);
    setBusy(reaction);
    try {
      const res = await toggleForumReaction('comment', data.id, reaction);
      setData((prev) => ({
        ...prev,
        like_count: res.like_count,
        helpful_count: res.helpful_count,
        interesting_count: res.interesting_count,
        my_reaction: res.my_reaction,
      }));
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const loadReplies = async () => {
    if (children !== null || loadingReplies) return;
    setLoadingReplies(true);
    setError(null);
    try {
      const list = await getForumReplies(postId, [data.id]);
      setChildren(list);
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setLoadingReplies(false);
    }
  };

  const handleReplySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!requireAuth()) return;
    const content = replyText.trim();
    if (!content || posting) return;
    setError(null);
    setPosting(true);
    try {
      const created = await addForumComment(postId, data.id, content);
      const full: ForumCommentType = {
        ...created,
        parent_id: data.id,
        verified: false,
        avatar_url: null,
        pinned: false,
        reply_count: 0,
        my_reaction: null,
        like_count: 0,
        helpful_count: 0,
        interesting_count: 0,
      };
      setChildren((prev) => (prev ? [...prev, full] : [full]));
      setReplyText('');
      setReplying(false);
      onAddReply();
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const content = editText.trim();
    if (!content || posting) return;
    setError(null);
    setPosting(true);
    try {
      await updateForumComment(data.id, content);
      setData((prev) => ({
        ...prev,
        content,
        updated_at: new Date().toISOString(),
        edited_at: new Date().toISOString(),
      }));
      setEditing(false);
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this comment and all of its replies?')) return;
    try {
      await deleteForumComment(data.id);
      onDelete();
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    }
  };

  const handlePin = async () => {
    if (!isAdmin) return;
    setPinBusy(true);
    setError(null);
    try {
      const res = await toggleForumCommentPin(data.id);
      setData((prev) => ({ ...prev, pinned: res.pinned }));
      onPinToggle?.(data.id, res.pinned);
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setPinBusy(false);
    }
  };

  const renderChildren = (child: ForumCommentType) => (
    <ForumComment
      key={child.id}
      comment={child}
      postId={postId}
      isAdmin={isAdmin}
      currentUserId={currentUserId}
      now={now}
      requireAuth={requireAuth}
      focusPath={childFocus && childFocus[0] === child.id ? childFocus : null}
      parentAuthor={data.author ?? null}
      closed={closed}
      onAddReply={onAddReply}
      onPinToggle={onPinToggle}
      onDeleteReply={onDeleteReply}
      onDelete={() => {
        setChildren((prev) => prev?.filter((c) => c.id !== child.id) ?? null);
        onDeleteReply?.();
      }}
    />
  );

  return (
    <div
      className={`forum-comment${isTarget ? ' forum-comment-focus' : ''}`}
      ref={rootRef}
    >
      <div className="forum-comment-main">
        <div className={`forum-avatar${data.avatar_url ? ' has-photo' : ''}`}>
          <span>{data.author?.[0]?.toUpperCase() ?? 'U'}</span>
          {data.avatar_url && (
            <img
              src={data.avatar_url}
              alt={data.author ?? 'User'}
              loading="lazy"
              className="forum-avatar-img"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
        </div>

        <div className="forum-comment-body">
          <div className="forum-comment-meta">
            <span className="forum-comment-author">
              {data.author ?? 'User'}
              {data.edited_at && <span className="forum-edited-tag">(edited)</span>}
              {data.verified && (
                <span title="Verified user">
                  <BadgeCheck size={14} className="forum-verified" color="#3b82f6" />
                </span>
              )}
            </span>
            <span className="forum-comment-time">{formatForumTime(data.created_at, now)}</span>
            {data.pinned && (
              <span className="forum-comment-pin-badge">
                <Pin size={10} />
                Pinned
              </span>
            )}
          </div>

          {parentAuthor && (
            <div className="forum-replied-to">
              replied to <strong>{parentAuthor}</strong>
            </div>
          )}

          {editing ? (
            <form className="forum-composer" onSubmit={handleEditSubmit}>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={2}
                maxLength={2000}
                autoFocus
              />
              <div className="forum-composer-row">
                <button type="button" className="forum-form-cancel" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="forum-composer-submit"
                  disabled={!editText.trim() || posting}
                >
                  {posting ? <Loader2 size={15} className="spin" /> : <PencilLine size={15} />}
                  Save
                </button>
              </div>
            </form>
          ) : (
            <p className="forum-comment-content">{data.content}</p>
          )}

          <div className="forum-comment-actions">
            <ForumReactions
              likeCount={data.like_count}
              helpfulCount={data.helpful_count}
              interestingCount={data.interesting_count}
              myReaction={data.my_reaction}
              busy={busy}
              onReact={handleReact}
            />

            {!closed && (
              <button
                type="button"
                className="forum-reply-btn"
                onClick={() => {
                  if (!requireAuth()) return;
                  setReplying((r) => !r);
                }}
              >
                <Reply size={13} />
                Reply
              </button>
            )}

            {isAdmin && (
              <button
                type="button"
                className={`forum-comment-pin${data.pinned ? ' active' : ''}`}
                onClick={handlePin}
                disabled={pinBusy}
                title={data.pinned ? 'Unpin comment' : 'Pin comment'}
              >
                {pinBusy ? <Loader2 size={13} className="spin" /> : data.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                {data.pinned ? 'Unpin' : 'Pin'}
              </button>
            )}

            {canManage && (
              <>
                {currentUserId === data.author_id && (
                  <button
                    type="button"
                    className="forum-comment-edit"
                    onClick={() => {
                      setEditText(data.content);
                      setEditing((v) => !v);
                    }}
                  >
                    <PencilLine size={13} />
                    Edit
                  </button>
                )}
                <button type="button" className="forum-comment-delete" onClick={handleDelete}>
                  <Trash2 size={13} />
                  Delete
                </button>
              </>
            )}
          </div>

          {error && <div className="forum-error-banner">{error}</div>}

          {replying && (
            <form className="forum-composer" onSubmit={handleReplySubmit}>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a reply..."
                rows={2}
                maxLength={2000}
                autoFocus
              />
              <div className="forum-composer-row">
                <button type="button" className="forum-form-cancel" onClick={() => setReplying(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="forum-composer-submit"
                  disabled={!replyText.trim() || posting}
                >
                  {posting ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                  Reply
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {children === null && data.reply_count > 0 && (
        <button type="button" className="forum-load-replies-btn" onClick={loadReplies}>
          {loadingReplies ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <ChevronDown size={14} />
          )}
          View {data.reply_count} {data.reply_count === 1 ? 'reply' : 'replies'}
        </button>
      )}

      {children !== null && children.length > 0 && (
        <div className="forum-replies">{children.map(renderChildren)}</div>
      )}
    </div>
  );
}
