import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchPhivolcsData, type PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor, getSeverityLabel } from '../lib/utils';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import { ArrowLeft, MapPin, Activity, Clock, ShieldAlert, Users, Info } from 'lucide-react';
import './Details.css';

export function Details() {
  const { id } = useParams<{ id: string }>();
  const [earthquake, setEarthquake] = useState<PhivolcsEarthquake | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
        <div className="loader">Loading Details...</div>
      </div>
    );
  }

  if (error || !earthquake) {
    return (
      <div className="container flex-center" style={{ height: '50vh', flexDirection: 'column', gap: '16px' }}>
        <h2>Earthquake Not Found</h2>
        <p className="text-muted">This event may be too old and is no longer in the recent PHIVOLCS database.</p>
        <Link to="/archive" className="back-btn glass">Back to Archive</Link>
      </div>
    );
  }

  const mag = parseFloat(earthquake.magnitude);
  const color = getSeverityColor(mag);
  const severityLabel = getSeverityLabel(mag);
  const lat = parseFloat(earthquake.latitude);
  const lng = parseFloat(earthquake.longitude);

  return (
    <div className="details-container container">
      <Link to="/archive" className="back-link flex-center">
        <ArrowLeft size={18} />
        <span>Back to Archive</span>
      </Link>

      <div className="details-grid">
        <div className="details-main glass">
          <div className="details-header flex-between">
            <div>
              <div className="event-id text-muted"></div>
              <h1 className="details-title">{earthquake.location}</h1>
            </div>
            <div className="details-mag-badge" style={{ backgroundColor: `${color}20`, color, borderColor: color }}>
              <span className="mag-value">{earthquake.magnitude}</span>
              <span className="mag-label">Magnitude</span>
            </div>
          </div>

          <div className="info-grid">
            <div className="info-item glass-card">
              <Clock size={20} className="info-icon" />
              <div>
                <div className="info-label">Date & Time (PST)</div>
                <div className="info-value">{earthquake.datetime}</div>
              </div>
            </div>
            <div className="info-item glass-card">
              <Activity size={20} className="info-icon" />
              <div>
                <div className="info-label">Depth</div>
                <div className="info-value">{earthquake.depth} km</div>
              </div>
            </div>
            <div className="info-item glass-card">
              <MapPin size={20} className="info-icon" />
              <div>
                <div className="info-label">Coordinates</div>
                <div className="info-value">{earthquake.latitude}°N, {earthquake.longitude}°E</div>
              </div>
            </div>
            <div className="info-item glass-card">
              <Info size={20} className="info-icon" />
              <div>
                <div className="info-label">Source Provider</div>
                <div className="info-value">PHIVOLCS-DOST</div>
              </div>
            </div>
          </div>

          <div className="map-section">
            <h3 className="section-title">Exact Map Location</h3>
            <div className="details-map-container">
              {!isNaN(lat) && !isNaN(lng) ? (
                <MapContainer center={[lat, lng]} zoom={8} scrollWheelZoom={false} style={{ height: '100%', width: '100%', zIndex: 0 }}>
                  <TileLayer
                    attribution='&copy; OpenStreetMap &copy; CARTO'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  />
                  <CircleMarker
                    center={[lat, lng]}
                    radius={Math.max(mag * 3, 6)}
                    pathOptions={{ color, fillColor: color, fillOpacity: 0.6, weight: 2 }}
                  />
                </MapContainer>
              ) : (
                <div className="flex-center" style={{ height: '100%' }}>Invalid Coordinates</div>
              )}
            </div>
          </div>
        </div>

        <div className="details-sidebar">
          <div className="impact-card glass" style={{ borderTop: `4px solid ${color}` }}>
            <h3 className="section-title flex-center" style={{ gap: '8px' }}>
              <ShieldAlert size={20} />
              Impact Assessment
            </h3>
            <div className="impact-severity" style={{ color }}>{severityLabel}</div>
            <p className="impact-desc text-muted">
              {mag < 4 ? "Generally not felt by people, but recorded by local seismographs." :
                mag < 5 ? "Felt by many indoors, some outdoors. Dishes and windows disturbed." :
                  mag < 6 ? "Felt by everyone. Slight damage to buildings." :
                    mag < 7 ? "Can cause damage to moderately built structures." :
                      "Major earthquake. Can cause widespread severe damage."}
            </p>

            <div className="pop-estimate flex-center glass-card" style={{ marginTop: '16px', padding: '12px', gap: '12px' }}>
              <Users size={20} color="var(--text-muted)" />
              <div>
                <div className="info-label">Est. Affected Population</div>
                <div className="info-value">Data Unavailable</div>
              </div>
            </div>
          </div>

          <div className="safety-card glass">
            <h3 className="section-title">Safety Guidelines</h3>

            <div className="safety-item">
              <h4>Before</h4>
              <p>Secure heavy furniture to walls. Prepare an emergency kit with food, water, and first aid supplies.</p>
            </div>
            <div className="safety-item">
              <h4>During</h4>
              <p><strong>DROP, COVER, and HOLD ON.</strong> Stay away from glass, windows, and outside doors.</p>
            </div>
            <div className="safety-item">
              <h4>After</h4>
              <p>Check for injuries. Be prepared for aftershocks. Listen to emergency broadcasts.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
