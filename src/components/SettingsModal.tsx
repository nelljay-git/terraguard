import { useEffect, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
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
  const { profile, updateUsername, updateAvatarUrl, updateTheme } = useAuth();
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

  const lastChanged = profile?.username_changed_at ?? null;
  const cooldownUntil = lastChanged
    ? new Date(new Date(lastChanged).getTime() + USERNAME_COOLDOWN_MS)
    : null;
  const onCooldown = cooldownUntil !== null && now < cooldownUntil.getTime();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
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

  const themeOptions: { value: ThemePreference; label: string; icon: ReactElement }[] = [
    { value: 'light', label: 'Light', icon: <Sun size={15} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={15} /> },
    { value: 'system', label: 'System', icon: <Monitor size={15} /> },
  ];

  return createPortal(
    <motion.div
      className="settings-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="settings-modal"
        initial={{ opacity: 0, scale: 0.92, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', damping: 28, stiffness: 350, mass: 0.8 }}
      >
        <div className="settings-modal-header">
          <div className="settings-modal-header-content">
            <div className="settings-modal-icon">
              <User size={22} />
            </div>
            <div>
              <h2 className="settings-modal-title">Settings</h2>
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
            <div className="settings-cooldown">
              <Clock size={15} />
              <span>
                Username was changed on {formatDate(String(lastChanged))}. You can change it again
                after {formatDate(cooldownUntil.toISOString())} (once every 60 days).
              </span>
            </div>
          )}

          {error && <div className="settings-error">{error}</div>}
          {success && <div className="settings-success">{success}</div>}

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
              {avatarError && <div className="settings-error">{avatarError}</div>}
              {avatarSuccess && <div className="settings-success">{avatarSuccess}</div>}
              <button
                className="settings-save-btn settings-avatar-save"
                onClick={handleAvatarSave}
                disabled={avatarSaving}
              >
                <Save size={16} />
                {avatarSaving ? 'Saving…' : 'Save Photo'}
              </button>
            </div>
          )}

          <div className="settings-theme-section">
            <label className="settings-field-label">Theme</label>
            <div className="settings-theme-options">
              {themeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
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
            {themeError && <div className="settings-error">{themeError}</div>}
            {themeSuccess && <div className="settings-success">{themeSuccess}</div>}
          </div>
        </div>

        <div className="settings-modal-footer">
          {confirming ? (
            <>
              <div className="settings-confirm-note">
                Change your username to <strong>&ldquo;{value.trim()}&rdquo;</strong>? This can only
                be done once every 60 days.
              </div>
              <button
                className="settings-save-btn"
                onClick={handleConfirm}
                disabled={saving || onCooldown}
              >
                <Save size={16} />
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
              <Save size={16} />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
