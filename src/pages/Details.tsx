import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchPhivolcsData, type PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor, getSeverityLabel } from '../lib/utils';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import { ArrowLeft, MapPin, Activity, Clock, ShieldAlert, Users, Info, Share2, Copy, Check, Zap, AlertTriangle } from 'lucide-react';
import './Details.css';

export function Details() {
  const { id } = useParams<{ id: string }>();
  const [earthquake, setEarthquake] = useState<PhivolcsEarthquake | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function loadEq() {
      try {
        const res = await fetchPhivolcsData();
        // Decode ID to match
        const found = res.data.find(eq => {
          const eqId = btoa(`${eq.datetime}-${eq.latitude}-${eq.longitude}`).replace(/=/g, '');
          return eqId === id;
        });

        if (found) {
          setEarthquake(found);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error(err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    loadEq();
  }, [id]);

  if (loading) {
    return (
      <div className="container flex-center" style={{ height: '50vh' }}>
        <div className="loader-container">
          <div className="pulse-loader" style={{ borderColor: 'var(--color-minor)' }}></div>
          <div className="loader-text">Analyzing Seismic Signature...</div>
        </div>
      </div>
    );
  }

  if (error || !earthquake) {
    return (
      <div className="container flex-center" style={{ height: '50vh', flexDirection: 'column', gap: '16px' }}>
        <div className="error-icon-wrapper">
          <AlertTriangle size={48} color="var(--color-strong)" />
        </div>
        <h2>Earthquake Details Unavailable</h2>
        <p className="text-muted" style={{ textAlign: 'center', maxWidth: '400px' }}>
          This event may be historical or currently unavailable in the recent PHIVOLCS feed.
        </p>
        <Link to="/archive" className="back-btn glass">Back to Archive</Link>
      </div>
    );
  }

  const mag = parseFloat(earthquake.magnitude);
  const color = getSeverityColor(mag);
  const severityLabel = getSeverityLabel(mag);
  const lat = parseFloat(earthquake.latitude);
  const lng = parseFloat(earthquake.longitude);

  // Energy Calculation: E = 10^(1.5 * M + 4.8) Joules
  // 1 Ton of TNT = 4.184e9 Joules
  const calculateEnergy = (magnitude: number) => {
    const joules = Math.pow(10, 1.5 * magnitude + 4.8);
    const tntTons = joules / 4.184e9;
    if (tntTons < 1) {
      return `${(tntTons * 1000).toFixed(1)} kg of TNT`;
    } else if (tntTons < 1000) {
      return `${tntTons.toLocaleString(undefined, { maximumFractionDigits: 1 })} Tons of TNT`;
    } else if (tntTons < 1000000) {
      return `${(tntTons / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} Kilotons of TNT`;
    } else {
      return `${(tntTons / 1000000).toLocaleString(undefined, { maximumFractionDigits: 1 })} Megatons of TNT`;
    }
  };

  // Generate responsive seismograph wavy path based on severity
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleShare = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `M${earthquake.magnitude} Earthquake - ${earthquake.location}`,
          text: `Check out details for this M${earthquake.magnitude} earthquake in ${earthquake.location} at ${earthquake.datetime}`,
          url: window.location.href,
        });
      } catch (err) {
        console.error('Error sharing', err);
      }
    } else {
      handleCopy();
    }
  };

  return (
    <div className="details-container container">
      <div className="details-nav flex-between">
        <Link to="/archive" className="back-link flex-center">
          <ArrowLeft size={18} />
          <span>Back to Archive</span>
        </Link>
        <div className="action-buttons flex-center">
          <button className="action-btn glass flex-center" onClick={handleCopy} title="Copy Link">
            {copied ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
            <span>{copied ? 'Copied!' : 'Copy Link'}</span>
          </button>
          {typeof navigator.share === 'function' && (
            <button
              className="action-btn glass flex-center"
              onClick={handleShare}
              title="Share Event"
            >
              <Share2 size={16} />
              <span>Share</span>
            </button>
          )}
        </div>
      </div>

      {/* Hero Header Card */}
      <div className="details-hero glass" style={{ '--severity-color': color } as React.CSSProperties}>
        <div className="hero-backdrop-glow" style={{ backgroundColor: `${color}15` }}></div>
        <div className="hero-content">
          <div className="hero-left">
            <span className="hero-subtitle text-muted">SEISMIC EVENT RECORDED</span>
            <h1 className="hero-title">{earthquake.location}</h1>
            <div className="coordinates-badge">
              <MapPin size={14} style={{ color }} />
              <span>{earthquake.latitude}°N, {earthquake.longitude}°E</span>
            </div>
          </div>

          <div className="hero-right">
            <div className="magnitude-display" style={{ boxShadow: `0 0 30px ${color}30`, borderColor: color }}>
              <div className="mag-glow" style={{ background: `radial-gradient(circle, ${color}30 0%, transparent 70%)` }}></div>
              <span className="mag-num" style={{ color }}>{earthquake.magnitude}</span>
              <span className="mag-txt">MAGNITUDE</span>
            </div>
          </div>
        </div>

        {/* Dynamic Seismograph Animation */}
        <div className="seismograph-container">
          <svg className="seismograph-svg" viewBox="0 0 600 100" preserveAspectRatio="none">
            <path
              className="seismograph-line-static"
              d="M 0 50 L 600 50"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
            <path
              className="seismograph-line"
              d={generateSeismographPath(mag)}
              stroke={color}
              strokeWidth="2"
              fill="none"
              style={{
                animationDuration: `${Math.max(1, 4 - (mag / 3))}s`
              } as React.CSSProperties}
            />
          </svg>
        </div>
      </div>

      <div className="details-grid">
        <div className="details-main-pane">
          {/* Richter Scale & Key Details */}
          <div className="details-card glass">
            <h3 className="card-title">Key Parameters</h3>
            <div className="info-grid">
              <div className="info-item glass-card">
                <Clock size={20} className="info-icon" style={{ color }} />
                <div>
                  <div className="info-label">Date & Time (PST)</div>
                  <div className="info-value">{earthquake.datetime}</div>
                </div>
              </div>
              <div className="info-item glass-card">
                <Activity size={20} className="info-icon" style={{ color }} />
                <div>
                  <div className="info-label">Depth of Focus</div>
                  <div className="info-value">{earthquake.depth} km</div>
                </div>
              </div>
              <div className="info-item glass-card">
                <Zap size={20} className="info-icon" style={{ color }} />
                <div>
                  <div className="info-label">Energy Equivalent</div>
                  <div className="info-value">{calculateEnergy(mag)}</div>
                </div>
              </div>
              <div className="info-item glass-card">
                <Info size={20} className="info-icon" style={{ color }} />
                <div>
                  <div className="info-label">Reporting Agency</div>
                  <div className="info-value">PHIVOLCS-DOST</div>
                </div>
              </div>
            </div>

            {/* Richter Scale Visualizer */}
            <div className="richter-visualizer">
              <div className="richter-labels flex-between">
                <span>Richter Scale</span>
                <span style={{ color, fontWeight: 700 }}>M{mag} - {severityLabel}</span>
              </div>
              <div className="richter-bar-container">
                <div className="richter-bar-bg"></div>
                <div className="richter-bar-fill" style={{ width: `${Math.min(mag * 10, 100)}%`, background: `linear-gradient(to right, #10b981 0%, ${color} 100%)` }}></div>
                <div className="richter-marker" style={{ left: `${Math.min(mag * 10, 100)}%`, backgroundColor: color, boxShadow: `0 0 12px ${color}` }}></div>
              </div>
              <div className="richter-ticks flex-between">
                <span>1.0</span>
                <span>3.0</span>
                <span>5.0</span>
                <span>7.0</span>
                <span>9.0+</span>
              </div>
            </div>
          </div>

          {/* Interactive Map */}
          <div className="details-card glass map-card">
            <h3 className="card-title">Seismic Epicenter Location</h3>
            <div className="details-map-container">
              {!isNaN(lat) && !isNaN(lng) ? (
                <MapContainer center={[lat, lng]} zoom={8} scrollWheelZoom={false} style={{ height: '100%', width: '100%', zIndex: 0 }}>
                  <TileLayer
                    attribution='&copy; OpenStreetMap &copy; CARTO'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  />
                  <CircleMarker
                    center={[lat, lng]}
                    radius={Math.max(mag * 3.5, 8)}
                    pathOptions={{ color, fillColor: color, fillOpacity: 0.5, weight: 2 }}
                  />
                </MapContainer>
              ) : (
                <div className="flex-center" style={{ height: '100%' }}>Invalid Coordinates</div>
              )}
            </div>
          </div>
        </div>

        <div className="details-sidebar-pane">
          {/* Impact assessment */}
          <div className="impact-card glass" style={{ borderTop: `4px solid ${color}` }}>
            <h3 className="card-title flex-center" style={{ gap: '8px', justifyContent: 'flex-start' }}>
              <ShieldAlert size={20} style={{ color }} />
              Impact Assessment
            </h3>
            <div className="impact-severity" style={{ color }}>{severityLabel}</div>
            <p className="impact-desc text-muted">
              {mag < 4 ? "Generally not felt by people, but recorded by local seismographs near the epicenter." :
                mag < 5 ? "Felt by many indoors, some outdoors. Shaking of indoor items and windows is common." :
                  mag < 6 ? "Felt by everyone. Slight damage to poorly constructed buildings; generally safe for modern structures." :
                    mag < 7 ? "Can cause moderate to severe damage to standard buildings and structures within the epicentral zone." :
                      "Major earthquake. High potential for severe damage, ground rupture, and risk to life over wider regions."}
            </p>

            <div className="pop-estimate flex-center glass-card" style={{ marginTop: '20px', padding: '14px', gap: '12px' }}>
              <Users size={20} className="text-muted" />
              <div style={{ flex: 1 }}>
                <div className="info-label">Potential Shaking Zone</div>
                <div className="info-value">{mag < 4.5 ? "Local Only" : mag < 6 ? "Regional Alert" : "Widespread"}</div>
              </div>
            </div>
          </div>

          {/* Safety Guidelines */}
          <div className="safety-card glass">
            <h3 className="card-title">Safety Protocol</h3>
            <div className="safety-timeline">
              <div className="safety-step">
                <div className="step-indicator">1</div>
                <div className="step-content">
                  <h4>Before Shaking</h4>
                  <p>Secure overhead shelves, heavy appliances, and emergency supplies.</p>
                </div>
              </div>
              <div className="safety-step">
                <div className="step-indicator">2</div>
                <div className="step-content">
                  <h4>During Shaking</h4>
                  <p><strong>DROP, COVER, and HOLD ON.</strong> Protect your head, stay clear of glass.</p>
                </div>
              </div>
              <div className="safety-step">
                <div className="step-indicator">3</div>
                <div className="step-content">
                  <h4>After Shaking</h4>
                  <p>Check for structural hazards, anticipate potential aftershocks, monitor official reports.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

