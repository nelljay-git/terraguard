import type { PhivolcsEarthquake } from '../api/phivolcs';
import { Activity, AlertTriangle, TrendingUp, Compass, Zap } from 'lucide-react';
import { MagnitudeChart } from './MagnitudeChart';
import { getSeverityColor } from '../lib/utils';
import './SummaryCards.css';

interface Props {
  recent: PhivolcsEarthquake[];
  significant: PhivolcsEarthquake[];
}

export function SummaryCards({ recent, significant }: Props) {
  // Filter for last 24 hours
  const now = new Date().getTime();
  const last24Hours = recent.filter(eq => {
    const cleanDateStr = eq.datetime.replace(' - ', ' ').replace(/ UTC$/i, '');
    const eqDate = new Date(cleanDateStr).getTime();
    if (isNaN(eqDate)) return true;
    return (now - eqDate) <= 24 * 60 * 60 * 1000;
  });

  const sigLast24 = significant.filter(eq => last24Hours.includes(eq));

  const validMags = last24Hours.map(f => parseFloat(f.magnitude)).filter(m => !isNaN(m));
  const validDepths = last24Hours.map(f => parseFloat(f.depth)).filter(d => !isNaN(d));

  const maxMag = validMags.length > 0 ? Math.max(...validMags) : 0;
  const avgMag = validMags.length > 0 ? (validMags.reduce((a, b) => a + b, 0) / validMags.length).toFixed(1) : "0.0";
  const maxDepth = validDepths.length > 0 ? Math.max(...validDepths).toFixed(0) : "0";
  const maxMagColor = getSeverityColor(maxMag);

  const cards = [
    { title: 'Events (24h)', value: String(last24Hours.length), icon: Activity, color: '#3b82f6', desc: 'Total recorded' },
    { title: 'Peak Mag', value: maxMag.toFixed(1), icon: TrendingUp, color: maxMagColor, desc: 'Strongest event' },
    { title: 'Avg Mag', value: avgMag, icon: Zap, color: '#eab308', desc: 'Mean magnitude' },
    { title: 'Max Depth', value: `${maxDepth} km`, icon: Compass, color: '#8b5cf6', desc: 'Deepest source' },
    { title: 'Significant', value: String(sigLast24.length), icon: AlertTriangle, color: '#f97316', desc: 'M ≥ 4.5 events' },
  ];

  return (
    <>
      <div className="summary-cards">
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <div className="summary-card glass" key={card.title}>
              <div className="sc-icon-wrap" style={{ backgroundColor: `${card.color}12`, color: card.color }}>
                <Icon size={20} />
              </div>
              <div className="sc-body">
                <span className="sc-label">{card.title}</span>
                <span className="sc-value">{card.value}</span>
                <span className="sc-desc">{card.desc}</span>
              </div>
              <div className="sc-accent-line" style={{ backgroundColor: card.color }}></div>
            </div>
          );
        })}
      </div>
      <MagnitudeChart data={last24Hours} />
    </>
  );
}
