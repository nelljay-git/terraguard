import { useEffect, useState } from 'react';
import { parse, isValid, addDays } from 'date-fns';
import { Link } from 'react-router-dom';
import { Link as LinkIcon, MapPin, Clock, Activity } from 'lucide-react';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import { fetchPhivolcsData } from '../api/phivolcs';
import { getSeverityColor, getSeverityLabel } from '../lib/utils';
import { haversineDistance } from '../lib/alertSystem';
import './AftershockTracker.css';

const AFTERSHOCK_RADIUS_KM = 100;
const AFTERSHOCK_WINDOW_DAYS = 7;
const DATETIME_FORMAT = "d MMMM yyyy - hh:mm a";

interface AftershockTrackerProps {
  currentEarthquake: PhivolcsEarthquake;
}

function parseEarthquakeDatetime(dt: string): Date | null {
  const cleaned = dt.replace(/\s+/g, ' ').trim();
  const parsed = parse(cleaned, DATETIME_FORMAT, new Date());
  return isValid(parsed) ? parsed : null;
}

export function AftershockTracker({ currentEarthquake }: AftershockTrackerProps) {
  const currentLat = parseFloat(currentEarthquake.latitude);
  const currentLng = parseFloat(currentEarthquake.longitude);
  const currentMag = parseFloat(currentEarthquake.magnitude);
  const currentDate = parseEarthquakeDatetime(currentEarthquake.datetime);
  const hasValidCoords = !isNaN(currentLat) && !isNaN(currentLng) && !isNaN(currentMag) && !!currentDate;

  const [aftershocks, setAftershocks] = useState<PhivolcsEarthquake[]>([]);
  const [loading, setLoading] = useState(hasValidCoords);

  useEffect(() => {
    if (!hasValidCoords) return;

    let cancelled = false;

    fetchPhivolcsData()
      .then(res => {
        if (cancelled) return;
        const windowEnd = addDays(currentDate, AFTERSHOCK_WINDOW_DAYS);

        const nearby = res.data.filter(eq => {
          if (eq === currentEarthquake) return false;

          const lat = parseFloat(eq.latitude);
          const lng = parseFloat(eq.longitude);
          const mag = parseFloat(eq.magnitude);
          if (isNaN(lat) || isNaN(lng) || isNaN(mag)) return false;

          const eqDate = parseEarthquakeDatetime(eq.datetime);
          if (!eqDate) return false;

          // Must be after current event and within 7-day window
          if (eqDate <= currentDate || eqDate > windowEnd) return false;

          // Must be within radius and smaller magnitude
          const dist = haversineDistance(currentLat, currentLng, lat, lng);
          if (dist > AFTERSHOCK_RADIUS_KM) return false;
          if (mag >= currentMag) return false;

          return true;
        });

        // Sort by time, oldest first
        nearby.sort((a, b) => {
          const dA = parseEarthquakeDatetime(a.datetime);
          const dB = parseEarthquakeDatetime(b.datetime);
          return (dA?.getTime() ?? 0) - (dB?.getTime() ?? 0);
        });

        setAftershocks(nearby);
      })
      .catch(() => {
        // Silently fail — component just shows 0
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [hasValidCoords, currentLat, currentLng, currentMag, currentDate, currentEarthquake]);

  if (loading) {
    return (
      <div className="ast-card glass">
        <h3 className="ast-title">
          <Activity size={18} />
          Aftershock Activity
        </h3>
        <div className="ast-loading">
          <div className="pulse-loader" style={{ width: '20px', height: '20px', borderColor: '#3b82f6', borderWidth: '2px' }}></div>
        </div>
      </div>
    );
  }

  if (aftershocks.length === 0) {
    return (
      <div className="ast-card glass">
        <h3 className="ast-title">
          <Activity size={18} />
          Aftershock Activity
        </h3>
        <p className="ast-empty">No aftershocks detected within {AFTERSHOCK_RADIUS_KM} km in the past {AFTERSHOCK_WINDOW_DAYS} days.</p>
      </div>
    );
  }

  return (
    <div className="ast-card glass">
      <h3 className="ast-title">
        <Activity size={18} />
        Aftershock Activity
      </h3>
      <p className="ast-summary">
        {aftershocks.length} aftershock{aftershocks.length !== 1 ? 's' : ''} detected within {AFTERSHOCK_RADIUS_KM} km
      </p>

      <div className={`ast-list${aftershocks.length > 10 ? ' ast-list-scroll' : ''}`}>
        {aftershocks.map((eq, i) => {
          const mag = parseFloat(eq.magnitude);
          const color = getSeverityColor(mag);
          const label = getSeverityLabel(mag);
          const eqId = btoa(`${eq.datetime}-${eq.latitude}-${eq.longitude}`).replace(/=/g, '');

          return (
            <Link
              key={i}
              to={`/details/${eqId}`}
              state={{ earthquake: eq }}
              className="ast-item"
            >
              <div className="ast-item-mag" style={{ color, backgroundColor: `${color}15` }}>
                M{eq.magnitude}
              </div>
              <div className="ast-item-info">
                <span className="ast-item-meta">
                  <MapPin size={11} /> {eq.depth} km depth · {label}
                </span>
                <span className="ast-item-dt">
                  <Clock size={11} /> {eq.datetime}
                </span>
              </div>
              <LinkIcon size={12} className="ast-item-link" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
