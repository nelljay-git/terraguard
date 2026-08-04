import { useEffect, useState, type FormEvent, type ChangeEvent, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ImagePlus, Loader2, Save, ShieldAlert, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getForumPost,
  createForumPost,
  updateForumPost,
  uploadForumImage,
  isForumAdmin,
  getErrorMessage,
} from '../lib/forum';
import './Forum.css';

export function ForumEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const admin = isForumAdmin(user?.email);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(Boolean(id));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getForumPost(id)
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setNotFound(true);
          return;
        }
        setTitle(p.title);
        setContent(p.content);
        setImageUrl(p.image_url ?? null);
        document.title = `Edit: ${p.title} | TerraGuard Forum`;
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    document.title = id ? 'Edit Post | TerraGuard Forum' : 'New Post | TerraGuard Forum';
  }, [id]);

  if (authLoading) {
    return (
      <div className="forum-page container">
        <div className="forum-loading glass">
          <div className="spinner-ring"></div>
        </div>
      </div>
    );
  }

  if (!user || !admin) {
    return (
      <div className="forum-page container">
        <div className="forum-auth-required glass">
          <ShieldAlert size={44} color="#ef4444" />
          <h2>Administrator access required</h2>
          <p>
            Only the TerraGuard administrator can publish forum posts. If you are the
            administrator, sign in with the admin account first.
          </p>
          <Link to="/forum" className="forum-back-link">
            <ArrowLeft size={15} /> Back to Forum
          </Link>
        </div>
      </div>
    );
  }

  const handlePickImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be 5MB or smaller.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const url = await uploadForumImage(file);
      setImageUrl(url);
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    const c = content.trim();
    if (t.length < 3 || c.length < 1 || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      if (id) {
        await updateForumPost(id, t, c, imageUrl);
        navigate(`/forum/${id}`, { replace: true });
      } else {
        const created = await createForumPost(t, c, imageUrl);
        navigate(`/forum/${created.id}`, { replace: true });
      }
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="forum-page container">
      <Link to={id ? `/forum/${id}` : '/forum'} className="forum-back-link">
        <ArrowLeft size={15} />
        {id ? 'Back to Post' : 'Back to Forum'}
      </Link>

      <form className="forum-form glass" onSubmit={handleSubmit}>
        <h1 className="forum-form-title">{id ? 'Edit Post' : 'New Forum Post'}</h1>

        <label>
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Announcement title"
            maxLength={300}
            required
          />
        </label>

        <label>
          Content
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your post... Markdown-style line breaks are preserved."
            maxLength={10000}
            required
          />
        </label>

        <div className="forum-form-image">
          {imageUrl ? (
            <div className="forum-form-image-preview">
              <img src={imageUrl} alt="Post image preview" />
              <div className="forum-form-image-actions">
                <button
                  type="button"
                  className="forum-icon-btn danger"
                  onClick={() => setImageUrl(null)}
                  title="Remove image"
                >
                  <Trash2 size={15} />
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="forum-form-image-pick"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 size={18} className="spin" /> : <ImagePlus size={18} />}
              {uploading ? 'Uploading...' : 'Attach an image (optional)'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handlePickImage}
            style={{ display: 'none' }}
          />
        </div>

        {error && (
          <div className="forum-form-error">
            <ShieldAlert size={15} />
            {error}
          </div>
        )}

        <div className="forum-form-actions">
          <button
            type="submit"
            className="forum-form-submit"
            disabled={title.trim().length < 3 || !content.trim() || submitting || loading}
          >
            {submitting ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {submitting ? 'Saving...' : id ? 'Save Changes' : 'Publish Post'}
          </button>
          <Link to={id ? `/forum/${id}` : '/forum'} className="forum-form-cancel">
            Cancel
          </Link>
        </div>
      </form>

      {notFound && (
        <div className="forum-error-banner" style={{ marginTop: 12 }}>
          This post could not be found. It may have been deleted.
        </div>
      )}
    </div>
  );
}
