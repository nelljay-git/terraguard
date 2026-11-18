import { Bell, Info } from 'lucide-react';
import { NotificationSettings } from '../components/NotificationSettings';
import { AlertZoneManager } from '../components/AlertZoneManager';
import './Alerts.css';

export function Alerts() {
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

      <div className="alerts-grid">
        <div className="alerts-section">
          <NotificationSettings />
        </div>

        <div className="alerts-section">
          <AlertZoneManager />
        </div>
      </div>

      <div className="alerts-info">
        <Info size={18} aria-hidden="true" />
        <div className="alerts-info-content">
          <h4>How it works — and its limits</h4>
          <ul className="alerts-how-list">
            <li>Create alert zones by clicking locations on the map</li>
            <li>Set a magnitude threshold for each zone (e.g., M4.5+)</li>
            <li>When the app is open and visible, it polls PHIVOLCS every 60 seconds</li>
            <li>A matching event triggers a browser notification — after publication, not in advance</li>
            <li>Install TerraGuard as a PWA for the best chance of receiving alerts</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
