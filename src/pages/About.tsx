import { Info, Code2, Clock } from 'lucide-react';
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
            TerraGuard is a modern seismic monitoring dashboard that provides real-time updates and analytics on earthquake activities, powered by data from PHIVOLCS/USGS.
          </p>

          <Link to="/history" className="version-history-btn glass">
            <Clock size={18} />
            View Version History
          </Link>

          <div className="about-developer glass-card">
            <Code2 size={24} className="dev-icon" />
            <div className="dev-info">
              <span className="dev-label">Created by team of</span>
              <span className="dev-name">Wneljae Giangan</span>
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
        </div>
      </div>
    </div>
  );
}
