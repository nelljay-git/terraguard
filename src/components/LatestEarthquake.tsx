import type { PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor, getSeverityLabel } from '../lib/utils';
import { MapPin, Clock, Activity, ArrowRight, Waves } from 'lucide-react';
import { Link } from 'react-router-dom';
import './LatestEarthquake.css';

export function LatestEarthquake({ earthquake }: { earthquake: PhivolcsEarthquake }) {
  const mag = parseFloat(earthquake.magnitude);
  const color = getSeverityColor(mag);
  const label = getSeverityLabel(mag);
  const eqId = btoa(`${earthquake.datetime}-${earthquake.latitude}-${earthquake.longitude}`).replace(/=/g, '');

  return (
    <div className="latest-eq-card glass" style={{ borderLeft: `4px solid ${color}` }}>
      {/* Decorative background glow */}
      <div className="eq-glow" style={{ background: `radial-gradient(circle at 20% 30%, ${color}12 0%, transparent 60%)` }}></div>

      <div className="eq-card-inner">
        {/* Top badge row */}
        <div className="eq-badge-row">
          <div className="eq-live-badge">
            <span className="eq-live-dot" style={{ backgroundColor: color }}></span>
            LATEST EVENT
          </div>
          <span className="eq-severity-tag" style={{ backgroundColor: `${color}18`, color, borderColor: `${color}40` }}>
            {label}
          </span>
        </div>

        {/* Magnitude circle + location */}
        <div className="eq-hero-section">
          <div className="eq-mag-circle" style={{ borderColor: `${color}50`, background: `${color}0A` }}>
            <Waves size={16} style={{ color, opacity: 0.5 }} />
            <span className="eq-mag-number" style={{ color }}>{earthquake.magnitude}</span>
            <span className="eq-mag-unit">M<sub>L</sub></span>
          </div>
          <div className="eq-hero-info">
            <h2 className="eq-location">{earthquake.location}</h2>
            <div className="eq-meta-chips">
              <span className="eq-chip">
                <Clock size={13} />
                {earthquake.datetime}
              </span>
              <span className="eq-chip">
                <Activity size={13} />
                {earthquake.depth} km deep
              </span>
              <span className="eq-chip">
                <MapPin size={13} />
                {earthquake.latitude}°N, {earthquake.longitude}°E
              </span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="eq-actions">
          <Link to={`/details/${eqId}`} className="eq-action-btn eq-action-primary" style={{ backgroundColor: `${color}15`, color, borderColor: `${color}30` }}>
            View Details
            <ArrowRight size={15} />
          </Link>
          <Link to="/archive" className="eq-action-btn eq-action-secondary">
            Browse Archive
            <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}
