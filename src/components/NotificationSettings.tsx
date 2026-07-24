import { useState } from 'react';
import {
  Bell,
  BellOff,
  Clock,
  Volume2,
  VolumeX,
  Shield,
  ExternalLink,
} from 'lucide-react';
import type { AlertSettings } from '../types/alerts';
import { getAlertSettings, saveAlertSettings } from '../lib/alertStorage';
import {
  requestNotificationPermission,
  getNotificationPermission,
} from '../lib/notifications';
import './NotificationSettings.css';

export function NotificationSettings() {
  const [settings, setSettings] = useState<AlertSettings>(getAlertSettings);
  const [permission, setPermission] = useState<NotificationPermission>(getNotificationPermission);

  const update = (patch: Partial<AlertSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveAlertSettings(next);
  };

  const handleToggleNotifications = async () => {
    if (!settings.notificationsEnabled) {
      const result = await requestNotificationPermission();
      setPermission(result);
      if (result === 'denied') return;
      update({ notificationsEnabled: true });
    } else {
      update({ notificationsEnabled: false });
    }
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="ns">
      <h3 className="ns-title">
        <Bell size={18} />
        Notification Settings
      </h3>

      {/* Permission status */}
      <div className="ns-perm glass-card">
        <div className="ns-perm-info">
          <Shield size={16} className={permission === 'granted' ? 'ns-perm-icon--granted' : permission === 'denied' ? 'ns-perm-icon--denied' : ''} />
          <div>
            <span className="ns-perm-label">Permission Status</span>
            <span className={`ns-perm-status ns-perm-status--${permission}`}>
              {permission === 'granted' ? 'Granted' : permission === 'denied' ? 'Blocked' : 'Not Set'}
            </span>
          </div>
        </div>
        {permission === 'denied' && (
          <p className="ns-perm-help">
            Notifications are blocked. Please enable them in your browser settings for this site.
          </p>
        )}
      </div>

      {/* Master toggle */}
      <div className="ns-toggle-row glass-card">
        <div className="ns-toggle-info">
          {settings.notificationsEnabled ? (
            <Bell size={18} style={{ color: '#10b981' }} />
          ) : (
            <BellOff size={18} style={{ color: 'var(--text-muted)' }} />
          )}
          <div>
            <span className="ns-toggle-label">Earthquake Notifications</span>
            <span className="ns-toggle-desc">
              {settings.notificationsEnabled ? 'Active — you will be alerted' : 'Disabled'}
            </span>
          </div>
        </div>
        <button
          className={`ns-switch ${settings.notificationsEnabled ? 'ns-switch--on' : ''}`}
          onClick={handleToggleNotifications}
          disabled={permission === 'denied'}
        >
          <span className="ns-switch-thumb" />
        </button>
      </div>

      {/* Magnitude threshold */}
      <div className="ns-setting glass-card">
        <label className="ns-label">
          Default Magnitude Threshold: M{settings.defaultMagnitudeThreshold.toFixed(1)}
        </label>
        <input
          type="range"
          className="ns-slider"
          min={1}
          max={9}
          step={0.5}
          value={settings.defaultMagnitudeThreshold}
          onChange={e =>
            update({ defaultMagnitudeThreshold: Number(e.target.value) })
          }
        />
        <div className="ns-slider-labels">
          <span>M1.0</span>
          <span>M9.0</span>
        </div>
      </div>

      {/* Quiet hours */}
      <div className="ns-setting glass-card">
        <div className="ns-label-row">
          <Clock size={14} />
          <label className="ns-label">Quiet Hours</label>
        </div>
        <div className="ns-quiet-row">
          <select
            className="ns-select"
            value={settings.quietHoursStart}
            onChange={e => update({ quietHoursStart: Number(e.target.value) })}
          >
            {hours.map(h => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
          <span className="ns-quiet-dash">to</span>
          <select
            className="ns-select"
            value={settings.quietHoursEnd}
            onChange={e => update({ quietHoursEnd: Number(e.target.value) })}
          >
            {hours.map(h => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </div>
        <p className="ns-quiet-desc">
          No notifications will be sent during quiet hours.
        </p>
      </div>

      {/* Sound toggle */}
      <div className="ns-toggle-row glass-card">
        <div className="ns-toggle-info">
          {settings.playSound ? (
            <Volume2 size={18} style={{ color: '#3b82f6' }} />
          ) : (
            <VolumeX size={18} style={{ color: 'var(--text-muted)' }} />
          )}
          <div>
            <span className="ns-toggle-label">Alert Sound</span>
            <span className="ns-toggle-desc">
              Play sound when a matching earthquake is detected
            </span>
          </div>
        </div>
        <button
          className={`ns-switch ${settings.playSound ? 'ns-switch--on' : ''}`}
          onClick={() => update({ playSound: !settings.playSound })}
        >
          <span className="ns-switch-thumb" />
        </button>
      </div>

      {/* Info footer */}
      <div className="ns-info glass-card">
        <ExternalLink size={14} />
        <p>
          Notifications fire when the app is open and polling. Ensure TerraGuard is open or installed as a PWA to receive alerts in real time.
        </p>
      </div>
    </div>
  );
}
