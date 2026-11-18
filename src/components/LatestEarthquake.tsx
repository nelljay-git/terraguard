import { useEffect, useRef } from 'react';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor, getSeverityLabel } from '../lib/utils';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { earthquakeToEqId } from '../lib/supabase';
import { distanceKm, formatDistance, type UserCoords } from '../lib/userLocation';
import { buildWaveform } from '../lib/seismogram';
import { StaticMapCover } from './StaticMapCover';

import './LatestEarthquake.css';

export function LatestEarthquake({ earthquake, userCoords }: { earthquake: PhivolcsEarthquake; userCoords?: UserCoords | null }) {
  const mag = parseFloat(earthquake.magnitude);
  const color = getSeverityColor(mag);
  const label = getSeverityLabel(mag);
  const eqId = earthquakeToEqId(earthquake);
  const lat = parseFloat(earthquake.latitude);
  const lng = parseFloat(earthquake.longitude);
  const dist = userCoords ? distanceKm(userCoords, earthquake.latitude, earthquake.longitude) : null;

  // Deterministic-but-realistic waveform: calm baseline → P-arrival → S-arrival → decaying coda.
  // Seeded by the event identity so every earthquake draws its own stable trace.
  const seedKey = `${earthquake.datetime}|${earthquake.latitude}|${earthquake.longitude}|${earthquake.magnitude}`;
  const trace = buildWaveform(seedKey, mag);

  // Track the previous earthquake's unique key to detect updates
  const prevEqKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const currentKey = `${earthquake.datetime}-${earthquake.latitude}-${earthquake.longitude}`;

    // Only play sound when the earthquake actually changes (not on first mount)
    if (prevEqKeyRef.current !== null && prevEqKeyRef.current !== currentKey) {
      playAlertSound();
    }

    prevEqKeyRef.current = currentKey;
  }, [earthquake.datetime, earthquake.latitude, earthquake.longitude]);

  const playAlertSound = () => {
    try {
      const audio = new Audio('/alert.mp3');
      audio.volume = 0.7;
      audio.play().catch((err) => {
        // Browsers may block autoplay until the user has interacted with the page
        console.warn('Alert sound could not be played:', err);
      });
    } catch (err) {
      console.error('Failed to initialize alert audio:', err);
    }
  };

  return (
    <article className="latest-eq-card latest-eq-card--flat" aria-label="Latest earthquake">
      <StaticMapCover lat={lat} lng={lng} />
      <div className="eq-veil" aria-hidden="true" />
      <span className="eq-accent" style={{ background: color }} aria-hidden="true" />

      <header className="eq-head">
        <span className="eq-eyebrow">
          <span className="eq-eyebrow-dot" style={{ background: color }} aria-hidden="true" />
          Latest earthquake
        </span>
        <span className="eq-severity" style={{ color }}>{label}</span>
      </header>

      <div className="eq-magline">
        <span className="eq-magnum tnum" style={{ color }}>{mag.toFixed(1)}</span>
        <span className="eq-magside">
          <span className="eq-unit">Magnitude</span>
          <span className="eq-scale" style={{ color }}>{label}</span>
        </span>
      </div>

      <h2 className="eq-location">{earthquake.location}</h2>

      <dl className="eq-meta">
        <div className="eq-meta-item">
          <dt>Time</dt>
          <dd>{earthquake.datetime}</dd>
        </div>
        <div className="eq-meta-item">
          <dt>Depth</dt>
          <dd className="tnum">{earthquake.depth} km</dd>
        </div>
        <div className="eq-meta-item">
          <dt>Epicenter</dt>
          <dd className="tnum">{earthquake.latitude}°N, {earthquake.longitude}°E</dd>
        </div>
        {dist != null && (
          <div className="eq-meta-item eq-meta-item--accent">
            <dt>From you</dt>
            <dd className="tnum">{formatDistance(dist)} away</dd>
          </div>
        )}
      </dl>

      <footer className="eq-foot">
        <Link to={`/details/${eqId}`} state={{ earthquake }} className="eq-view">
          View event <ArrowRight size={15} aria-hidden="true" />
        </Link>
        <Link to="/archive" className="eq-archive">Archive</Link>
      </footer>

      <div className="eq-trace-strip" aria-hidden="true">
        <svg className="eq-trace-strip-svg" viewBox="0 0 600 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="eqTraceFade" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#fff" stopOpacity="0" />
              <stop offset="6%" stopColor="#fff" stopOpacity="1" />
              <stop offset="94%" stopColor="#fff" stopOpacity="1" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="eqTraceMask">
              <rect x="0" y="0" width="600" height="100" fill="url(#eqTraceFade)" />
            </mask>
          </defs>
          <g mask="url(#eqTraceMask)">
            <path className="eq-trace-baseline" d="M0 50 L600 50" />
            <path className="eq-trace-line" pathLength={1000} d={trace} style={{ stroke: color }} />
            <path className="eq-trace-pulse" pathLength={1000} d={trace} style={{ stroke: color, color }} />
          </g>
        </svg>
      </div>
    </article>
  );
}