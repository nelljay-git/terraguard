import type { PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor, getSeverityLabel } from '../lib/utils';
import { earthquakeToEqId } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { distanceKm, formatDistance, type UserCoords } from '../lib/userLocation';
import './ActivityFeed.css';

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      duration: 0.2,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: 'easeOut' },
  },
};

export function ActivityFeed({ earthquakes, userCoords }: { earthquakes: PhivolcsEarthquake[]; userCoords?: UserCoords | null }) {
  return (
    <div className="activity-feed">
      <div className="feed-header">
        <h3 className="feed-title">Recent Activity</h3>
        <Link to="/archive" className="feed-view-all">
          View all <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>

      <motion.div
        className="feed-list"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {earthquakes.map((eq, i) => {
          const mag = parseFloat(eq.magnitude);
          const color = getSeverityColor(mag);
          const label = getSeverityLabel(mag).toUpperCase();
          const eqId = earthquakeToEqId(eq);
          const dist = userCoords ? distanceKm(userCoords, eq.latitude, eq.longitude) : null;

          return (
            <motion.div key={i} variants={itemVariants}>
              <Link to={`/details/${eqId}`} state={{ earthquake: eq }} className="feed-item" aria-label={`${eq.magnitude} magnitude, ${eq.location}`}>
                <span className="feed-mag tnum" style={{ color }}>{eq.magnitude || '—'}</span>
                <span className="feed-body">
                  <span className="feed-loc">{eq.location}</span>
                  <span className="feed-meta">
                    <span className="tnum">{eq.datetime}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tnum">{eq.depth} km deep</span>
                    {dist != null && <><span aria-hidden="true">·</span><span className="tnum feed-distance">{formatDistance(dist)} away</span></>}
                  </span>
                </span>
                <span className="feed-severity" style={{ color }}>{label}</span>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
