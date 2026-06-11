import type { PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor, getSeverityLabel } from '../lib/utils';
import { MapPin, Clock, Activity, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import './LatestEarthquake.css';

export function LatestEarthquake({ earthquake }: { earthquake: PhivolcsEarthquake }) {
  const mag = parseFloat(earthquake.magnitude);
  const color = getSeverityColor(mag);
  const label = getSeverityLabel(mag);
  const eqId = btoa(`${earthquake.datetime}-${earthquake.latitude}-${earthquake.longitude}`).replace(/=/g, '');

  const generateSeismographPath = (magnitude: number) => {
    const amp = Math.min(Math.max((magnitude - 2) * 12, 4), 45); // Amplitude scaled with magnitude
    return `M 0 50 
            Q 30 50, 60 ${50 - amp * 0.2} 
            T 120 ${50 + amp * 0.4} 
            T 180 ${50 - amp * 0.8} 
            T 240 ${50 + amp} 
            T 300 ${50 - amp * 0.9} 
            T 360 ${50 + amp * 0.5} 
            T 420 ${50 - amp * 0.2} 
            T 480 50 L 600 50`;
  };

  return (
    <div className="latest-eq-card glass" style={{ borderLeft: `4px solid ${color}`, backgroundImage: 'url(/image.png)' }}>
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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-activity"
              aria-hidden="true"
            >
              <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
            </svg>
            <span className="eq-mag-number" style={{ color }}>{earthquake.magnitude}</span>
            <span className="eq-mag-unit">MAG</span>
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
          <Link to={`/details/${eqId}`} className="eq-action-btn eq-action-primary" style={{ backgroundColor: `${color}15`, color, borderColor: `${color}30`, marginRight: "4px" }}>
            View Details
            <ArrowRight size={15} />
          </Link>
          <Link to="/archive" className="eq-action-btn eq-action-secondary">
            Browse Archive
            <ArrowRight size={15} />
          </Link>
        </div>
      </div>



      {/* Dynamic Seismograph Animation */}
      <div className="seismograph-container">
        <svg
          className="seismograph-container"
          style={{
            position: 'absolute',
            top: '-230px',
            left: 0,
            width: '100%',
            height: '200px',
          }}

        >
          <defs>
            {/* Right-side fade */}
            <linearGradient id="fadeRight" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="white" stopOpacity="1" />
              <stop offset="0%" stopColor="white" stopOpacity="1" />
              <stop offset="90%" stopColor="white" stopOpacity="0.4" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>

            <mask id="fadeMask">
              <rect
                x="0"
                y="0"
                width="600"
                height="200"
                fill="url(#fadeRight)"
              />
            </mask>
          </defs>

          {/* Baseline */}
          <path
            className="seismograph-line-static"
            d="M 0 100 L 600 100"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
            fill="none"
            mask="url(#fadeMask)"
          />

          {/* Seismograph Wave */}
          <path
            className="seismograph-line"
            d={generateSeismographPath(mag)}
            stroke={color}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            mask="url(#fadeMask)"
            style={{
              animationDuration: `${Math.max(1, 4 - mag / 3)}s`,
            }}
          />
        </svg>
      </div>


    </div >
  );
}
