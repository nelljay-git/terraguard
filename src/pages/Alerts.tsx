import { Bell, Info } from 'lucide-react';
import { NotificationSettings } from '../components/NotificationSettings';
import { AlertZoneManager } from '../components/AlertZoneManager';
import './Alerts.css';

export function Alerts() {
  return (
    <div className="alerts-container container">
      <div className="alerts-header glass">
        <div className="alerts-header-left">
          <h1 className="alerts-title">
            <Bell size={28} className="text-accent" />
            Earthquake Alerts
          </h1>
          <p className="alerts-subtitle">
            Turn TerraGuard into a personal seismic early-warning screen. Draw alert zones around the places that matter to you — home, work, or family — set a magnitude threshold, and get notified the moment PHIVOLCS records a matching quake.
          </p>
        </div>
      </div>

      <div className="alerts-grid">
        <div className="alerts-section">
          <NotificationSettings />
        </div>

        <div className="alerts-section">
          <AlertZoneManager />
        </div>
      </div>

      <div className="alerts-info glass-card">
        <Info size={18} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 2 }} />
        <div className="alerts-info-content">
          <h4>How It Works</h4>
          <ul className="alerts-how-list">
            <li>Create alert zones by clicking locations on the map</li>
            <li>Set a magnitude threshold for each zone (e.g., M4.5+)</li>
            <li>When the app is open and visible, it polls PHIVOLCS every 60 seconds</li>
            <li>Matching earthquakes trigger a browser notification</li>
            <li>Install TerraGuard as a PWA for the best experience</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
