import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, User, Save, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './SettingsModal.css';

const USERNAME_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { profile, updateUsername } = useAuth();
  const [value, setValue] = useState(profile?.username ?? '');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

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
      setError('Username must be 3-20 characters using letters, numbers, or underscores.');
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
            Shown on your comments. Letters, numbers, and underscores only (3-20 chars).
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
