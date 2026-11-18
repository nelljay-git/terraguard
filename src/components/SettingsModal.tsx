import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { X, User, Save, Clock, Sun, Moon, Monitor } from 'lucide-react';
import { useAuth, type ThemePreference } from '../context/AuthContext';
import './SettingsModal.css';

const USERNAME_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000;
const USERNAME_PATTERN = /^[a-zA-Z0-9_ ]{3,20}$/;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { profile, updateUsername, updateAvatarUrl, updateTheme, updatePreferredApi } = useAuth();
  const [value, setValue] = useState(profile?.username ?? '');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '');
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarSuccess, setAvatarSuccess] = useState<string | null>(null);

  const [theme, setTheme] = useState<ThemePreference>(profile?.theme ?? 'system');
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [themeSuccess, setThemeSuccess] = useState<string | null>(null);

  const [preferredApi, setPreferredApi] = useState<'phivolcs' | 'usgs' | 'emsc'>(profile?.preferred_api ?? 'phivolcs');
  const [apiSaving, setApiSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiSuccess, setApiSuccess] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  const lastChanged = profile?.username_changed_at ?? null;
  const cooldownUntil = lastChanged
    ? new Date(new Date(lastChanged).getTime() + USERNAME_COOLDOWN_MS)
    : null;
  const onCooldown = cooldownUntil !== null && now < cooldownUntil.getTime();

  /* Escape to close, body scroll lock, simple focus trap, focus restore */
  useEffect(() => {
    const modal = modalRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const firstFocusable = modal?.querySelector<HTMLElement>('input, button:not([disabled])');
    firstFocusable?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !modal) return;
      const focusables = Array.from(
        modal.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    const name = value.trim();
    if (!USERNAME_PATTERN.test(name)) {
      setError('Username must be 3-20 characters using letters, numbers, underscores, or spaces.');
      return;
    }
    if (name === profile?.username) {
      setError('That is already your username.');
      return;
    }

    setConfirming(true);
  };

  const handleConfirm = async () => {
    setSaving(true);
    const err = await updateUsername(value.trim());
    setSaving(false);
    setConfirming(false);

    if (err) {
      setError(err);
    } else {
      setSuccess('Username updated.');
    }
  };

  const handleAvatarSave = async () => {
    setAvatarError(null);
    setAvatarSuccess(null);

    const url = avatarUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      setAvatarError('Enter a valid link starting with http:// or https://');
      return;
    }

    setAvatarSaving(true);
    const err = await updateAvatarUrl(url || null);
    setAvatarSaving(false);

    if (err) {
      setAvatarError(err);
    } else {
      setAvatarSuccess(url ? 'Profile photo updated.' : 'Profile photo removed.');
    }
  };

  const handleThemeSave = async (next: ThemePreference) => {
    setThemeError(null);
    setThemeSuccess(null);
    setThemeSaving(true);
    const err = await updateTheme(next);
    setThemeSaving(false);
    if (err) {
      setThemeError(err);
    } else {
      setTheme(next);
      setThemeSuccess('Theme preference saved.');
    }
  };

  const handleApiSave = async (next: 'phivolcs' | 'usgs' | 'emsc') => {
    setApiError(null);
    setApiSuccess(null);
    setApiSaving(true);
    const err = await updatePreferredApi(next);
    setApiSaving(false);
    if (err) {
      setApiError(err);
    } else {
      setPreferredApi(next);
      setApiSuccess('Preferred API saved. Reloading…');
      setTimeout(() => window.location.reload(), 600);
    }
  };

  const themeOptions: { value: ThemePreference; label: string; icon: ReactElement }[] = [
    { value: 'light', label: 'Light', icon: <Sun size={15} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={15} /> },
    { value: 'system', label: 'System', icon: <Monitor size={15} /> },
  ];

  const apiOptions: { value: 'phivolcs' | 'usgs' | 'emsc'; label: string; sub: string }[] = [
    { value: 'phivolcs', label: 'PHIVOLCS', sub: 'Philippines' },
    { value: 'usgs', label: 'USGS', sub: 'Global · M4.5+' },
    { value: 'emsc', label: 'EMSC', sub: 'Global · M1.0+' },
  ];

  return createPortal(
    <div
      className="settings-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div className="settings-modal-header">
          <div className="settings-modal-header-content">
            <div className="settings-modal-icon" aria-hidden="true">
              <User size={20} />
            </div>
            <div>
              <h2 id="settings-modal-title" className="settings-modal-title">Settings</h2>
              <span className="settings-modal-subtitle">Manage your account</span>
            </div>
          </div>
          <button className="settings-modal-close" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        <div className="settings-modal-body">
          <label className="settings-field-label" htmlFor="settings-username">
            Username
          </label>
          <input
            id="settings-username"
            className="settings-input"
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
              setSuccess(null);
              setConfirming(false);
            }}
            placeholder="Your display name"
            maxLength={20}
            disabled={onCooldown || saving}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="settings-hint">
            Shown on your comments. Letters, numbers, underscores, and spaces only (3-20 chars).
          </p>

          {onCooldown && cooldownUntil && (
            <div className="settings-cooldown" role="status">
              <Clock size={15} aria-hidden="true" />
              <span>
                Username was changed on {formatDate(String(lastChanged))}. You can change it again
                after {formatDate(cooldownUntil.toISOString())} (once every 60 days).
              </span>
            </div>
          )}

          {error && <div className="settings-error" role="alert">{error}</div>}
          {success && <div className="settings-success" role="status">{success}</div>}

          {profile?.verified && (
            <div className="settings-avatar-section">
              <div className="settings-avatar-row">
                <label className="settings-field-label" htmlFor="settings-avatar">
                  Profile Photo (link)
                </label>
                {avatarUrl.trim() && (
                  <img
                    className="settings-avatar-preview"
                    src={avatarUrl.trim()}
                    alt="Profile preview"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </div>
              <input
                id="settings-avatar"
                className="settings-input"
                type="text"
                value={avatarUrl}
                onChange={(e) => {
                  setAvatarUrl(e.target.value);
                  setAvatarError(null);
                  setAvatarSuccess(null);
                }}
                placeholder="https://example.com/photo.jpg"
                disabled={avatarSaving}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="settings-hint">
                Shown as your profile picture on comments. Verified users only. Leave empty to
                remove.
              </p>
              {avatarError && <div className="settings-error" role="alert">{avatarError}</div>}
              {avatarSuccess && <div className="settings-success" role="status">{avatarSuccess}</div>}
              <button
                className="settings-save-btn settings-avatar-save"
                onClick={handleAvatarSave}
                disabled={avatarSaving}
              >
                <Save size={16} aria-hidden="true" />
                {avatarSaving ? 'Saving…' : 'Save Photo'}
              </button>
            </div>
          )}

          <div className="settings-theme-section">
            <span className="settings-field-label" id="settings-theme-label">Theme</span>
            <div className="settings-theme-options" role="radiogroup" aria-labelledby="settings-theme-label">
              {themeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === opt.value}
                  className={`settings-theme-btn${theme === opt.value ? ' active' : ''}`}
                  onClick={() => handleThemeSave(opt.value)}
                  disabled={themeSaving}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="settings-hint">
              Choose how Terra Guard looks for you. This is saved to your account.
            </p>
            {themeError && <div className="settings-error" role="alert">{themeError}</div>}
            {themeSuccess && <div className="settings-success" role="status">{themeSuccess}</div>}
          </div>

          <div className="settings-api-section">
            <span className="settings-field-label" id="settings-api-label">Preferred API</span>
            <div className="settings-api-options" role="radiogroup" aria-labelledby="settings-api-label">
              {apiOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={preferredApi === opt.value}
                  className={`settings-api-btn${preferredApi === opt.value ? ' active' : ''}`}
                  onClick={() => handleApiSave(opt.value)}
                  disabled={apiSaving}
                >
                  <strong>{opt.label}</strong>
                  <small>{opt.sub}</small>
                </button>
              ))}
            </div>
            <p className="settings-hint">
              Choose your preferred earthquake data source. This is saved to your account.
            </p>
            {apiError && <div className="settings-error" role="alert">{apiError}</div>}
            {apiSuccess && <div className="settings-success" role="status">{apiSuccess}</div>}
          </div>
        </div>

        <div className="settings-modal-footer">
          {confirming ? (
            <>
              <div className="settings-confirm-note" role="status">
                Change your username to <strong>&ldquo;{value.trim()}&rdquo;</strong>? This can only
                be done once every 60 days.
              </div>
              <button
                className="settings-save-btn"
                onClick={handleConfirm}
                disabled={saving || onCooldown}
              >
                <Save size={16} aria-hidden="true" />
                {saving ? 'Saving…' : 'Yes, change my username'}
              </button>
              <button
                className="settings-cancel-btn"
                onClick={() => setConfirming(false)}
                disabled={saving}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="settings-save-btn"
              onClick={handleSave}
              disabled={onCooldown || saving || value.trim() === (profile?.username ?? '')}
            >
              <Save size={16} aria-hidden="true" />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
