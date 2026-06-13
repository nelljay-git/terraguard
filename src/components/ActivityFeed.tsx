import type { PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor, getSeverityLabel } from '../lib/utils';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, MapPin, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import './ActivityFeed.css';

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 260,
      damping: 20
    }
  }
};

export function ActivityFeed({ earthquakes }: { earthquakes: PhivolcsEarthquake[] }) {
  return (
    <div className="activity-feed glass">
      <div className="feed-header">
        <div className="feed-title-row">
          <Activity size={18} className="feed-icon" />
          <h3 className="feed-title">Recent Activity</h3>
        </div>
        <Link to="/archive" className="feed-view-all">
          View All <ArrowRight size={14} />
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
          const label = getSeverityLabel(mag);
          const eqId = btoa(`${eq.datetime}-${eq.latitude}-${eq.longitude}`).replace(/=/g, '');

          return (
            <motion.div key={i} variants={itemVariants}>
              <Link to={`/details/${eqId}`} state={{ earthquake: eq }} className="feed-item">
                {/* Left accent */}
                <div className="feed-accent" style={{ backgroundColor: color }}></div>
                
                <div className="feed-mag-badge" style={{ backgroundColor: `${color}15`, color }}>
                  {eq.magnitude || '—'}
                </div>

                <div className="feed-body">
                  <div className="feed-loc">{eq.location}</div>
                  <div className="feed-meta">
                    <span className="feed-chip"><Clock size={11} />{eq.datetime}</span>
                    <span className="feed-chip"><MapPin size={11} />{eq.depth} km deep</span>
                    <span className="feed-severity-tag" style={{ color, backgroundColor: `${color}10` }}>{label}</span>
                  </div>
                </div>

                <ArrowRight size={16} className="feed-arrow" />
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}

