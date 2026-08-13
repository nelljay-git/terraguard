import { Info, Code2, Clock, Activity, Map, Radio, Newspaper, Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import './About.css';

export function About() {
  return (
    <div className="about-container container">
      <div className="about-card glass">
        <div className="about-header">
          <Info size={32} className="about-icon" />
          <h1 className="about-title">About TerraGuard</h1>
        </div>

        <div className="about-content">
          <p className="about-description">
            TerraGuard is an independent, free-to-use earthquake monitoring dashboard for the Philippines. It brings together live PHIVOLCS and USGS seismic records, an interactive map, historical archives, statistics, and news into one clean interface — so you can understand seismic activity near you without digging through scattered official sites.
          </p>

          <div className="about-block">
            <h2 className="about-block-title">Why TerraGuard exists</h2>
            <p>
              Earthquake information in the Philippines is published by several different agencies in different formats, which makes it hard to get a quick, complete picture when it matters. TerraGuard was built to fix that: it pulls the official record, keeps it updated every minute, and presents it in a way anyone can read at a glance — then lets you drill down into the details when you need them.
            </p>
          </div>

          <div className="about-block">
            <h2 className="about-block-title">How it works</h2>
            <ul className="about-feature-list">
              <li>
                <Activity size={16} className="about-feature-icon" />
                <div>
                  <strong>Live feed</strong> — earthquake events are fetched from PHIVOLCS (with USGS as an alternative source) and refreshed automatically every minute.
                </div>
              </li>
              <li>
                <Map size={16} className="about-feature-icon" />
                <div>
                  <strong>Interactive map</strong> — every event is plotted by its recorded coordinates, with severity color-coding and the ability to center on the latest quake.
                </div>
              </li>
              <li>
                <Radio size={16} className="about-feature-icon" />
                <div>
                  <strong>Statistics &amp; archives</strong> — monthly and yearly breakdowns, depth and magnitude distributions, plus a searchable database of historical events.
                </div>
              </li>
              <li>
                <Newspaper size={16} className="about-feature-icon" />
                <div>
                  <strong>Earthquake news</strong> — a curated feed of earthquake-related headlines relevant to the Philippines.
                </div>
              </li>
              <li>
                <Bell size={16} className="about-feature-icon" />
                <div>
                  <strong>Custom alerts</strong> — define alert zones and magnitude thresholds, and receive browser notifications when a matching quake is recorded.
                </div>
              </li>
            </ul>
          </div>

          <div className="about-block">
            <h2 className="about-block-title">Frequently asked questions</h2>
            <div className="about-faq">
              <details className="about-faq-item">
                <summary>Is TerraGuard an official source?</summary>
                <p>
                  No. TerraGuard is an independent tool that presents data published by PHIVOLCS and USGS. For official warnings and tsunami alerts, always refer to the issuing agencies and your local disaster risk reduction office.
                </p>
              </details>
              <details className="about-faq-item">
                <summary>How up to date is the data?</summary>
                <p>
                  The live feed refreshes roughly every minute while the app is open, and the dashboard shows the time of the last successful sync so you always know how fresh the data is.
                </p>
              </details>
              <details className="about-faq-item">
                <summary>Can I use TerraGuard offline?</summary>
                <p>
                  TerraGuard works as a Progressive Web App, so after your first visit you can install it on your phone or desktop. Previously loaded data can be viewed offline, though live updates require a connection.
                </p>
              </details>
              <details className="about-faq-item">
                <summary>Does TerraGuard collect my data?</summary>
                <p>
                  We keep things minimal. Basic usage analytics and any optional account features are handled with your consent — full details are in our Privacy Policy.
                </p>
              </details>
            </div>
          </div>

          <div className="about-actions">
            <Link to="/alerts" className="version-history-btn glass">
              <Bell size={18} />
              Configure Alerts
            </Link>
            <Link to="/history" className="version-history-btn glass">
              <Clock size={18} />
              View Version History
            </Link>
            <Link to="/safety" className="version-history-btn glass">
              <Info size={18} />
              Earthquake Safety Guide
            </Link>
          </div>

          <div className="about-developer glass-card">
            <Code2 size={24} className="dev-icon" />
            <div className="dev-info">
              <span className="dev-label">Created by team of</span>
              <span className="dev-name">WG</span>
            </div>
          </div>

          <div className="about-support glass-card">
            <h3>Support the Project</h3>
            <p className="support-desc">If you find TerraGuard helpful, consider buying me a coffee!</p>
            <div className="support-actions">
              <div className="qr-container">
                <img
                  src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=00020101021127830012com.p2pqrpay0111GXCHPHM2XXX02089996440303152170200000006560417DWQM4TK3JDO7CAT055204601653036085802PH5910WN****E G.6014San Isidro (La610412346304A771&color=3b82f6&bgcolor=1e293b"
                  alt="Support QR Code"
                  className="qr-image"
                />
                <span className="qr-label">Scan to Support</span>
              </div>
            </div>
          </div>

          <div className="about-tech">
            <h3>Technologies Used</h3>
            <div className="tech-tags">
              <span className="tech-tag glass-card">React</span>
              <span className="tech-tag glass-card">TypeScript</span>
              <span className="tech-tag glass-card">Vite</span>
              <span className="tech-tag glass-card">Recharts</span>
              <span className="tech-tag glass-card">Leaflet</span>
            </div>
          </div>

          <div className="about-legal glass-card">
            <div className="legal-links">
              <Link to="/privacy-policy" className="legal-link">
                Privacy Policy
              </Link>
              <span className="legal-separator">|</span>
              <Link to="/terms-of-service" className="legal-link">
                Terms of Service
              </Link>
            </div>
            <span className="legal-copy">© {new Date().getFullYear()} TerraGuard. All rights reserved.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
