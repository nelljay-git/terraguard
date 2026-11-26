import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, Info } from 'lucide-react';
import { NotificationSettings } from '../components/NotificationSettings';
import { PushSettings } from '../components/PushSettings';
import { IS_NATIVE } from '../lib/nativeHttp';
import { AlertZoneManager } from '../components/AlertZoneManager';
import './Alerts.css';

type AlertsTab = 'alerts' | 'settings';

export function Alerts() {
  const [params] = useSearchParams();
  const tabParam = params.get('tab');
  const [tab, setTab] = useState<AlertsTab>(tabParam === 'settings' ? 'settings' : 'alerts');

  // Tapping "Notification Settings" in the account menu while already on this
  // page reuses the same component, so react to the query param changing.
  useEffect(() => {
    if (tabParam === 'settings') setTab('settings');
  }, [tabParam]);

  return (
    <div className="alerts-container container">
      <header className="alerts-header">
        <span className="alerts-kicker">Notifications</span>
        <h1 className="alerts-title">
          <Bell size={26} aria-hidden="true" />
          Earthquake Alerts
        </h1>
        <p className="alerts-subtitle">
          Get notified shortly after PHIVOLCS records an earthquake that matters to you. Draw
          alert zones around the places that matter — home, work, family — set a magnitude
          threshold, and TerraGuard polls the feed every 60 seconds while it is open.
          <strong> This is not an early warning system</strong> — alerts fire after an event is
          detected and published, not before the ground moves.
        </p>
      </header>

      <div className="alerts-tabs" role="tablist" aria-label="Alerts sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'alerts'}
          className={`alerts-tab${tab === 'alerts' ? ' alerts-tab--active' : ''}`}
          onClick={() => setTab('alerts')}
        >
          Alerts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'settings'}
          className={`alerts-tab${tab === 'settings' ? ' alerts-tab--active' : ''}`}
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
      </div>

      <div className="alerts-grid">
        {tab === 'alerts' ? (
          <div className="alerts-section">
            <AlertZoneManager />
          </div>
        ) : (
          <div className="alerts-section">
            {IS_NATIVE ? <PushSettings /> : <NotificationSettings />}
          </div>
        )}
      </div>

      <div className="alerts-info">
        <Info size={18} aria-hidden="true" />
        <div className="alerts-info-content">
          <h4>How it works — and its limits</h4>
          <ul className="alerts-how-list">
            <li>Create alert zones by clicking locations on the map</li>
            <li>Set a magnitude threshold for each zone (e.g., M4.5+)</li>
            <li>
              Push notifications follow the same feed — pick PHIVOLCS, USGS or EMSC in the app's
              Settings (gear icon). Each notification states its source and never claims to be an
              early warning.
            </li>
            <li>
              When the app is open and visible, it polls the feed you picked in the app's Settings
              — PHIVOLCS by default, USGS or EMSC if you switched — every 60 seconds
            </li>
            <li>A matching event triggers a browser notification — after publication, not in advance</li>
            {!IS_NATIVE && (
              <li>Install TerraGuard as a PWA for the best chance of receiving alerts</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
