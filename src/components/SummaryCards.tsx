import type { PhivolcsEarthquake } from '../api/phivolcs';
import { MagnitudeChart } from './MagnitudeChart';
import { getSeverityColor } from '../lib/utils';
import './SummaryCards.css';

interface Props {
  recent: PhivolcsEarthquake[];
  significant: PhivolcsEarthquake[];
  /** Set false when the dashboard renders the chart inside a lazy below-the-fold section. */
  showChart?: boolean;
}

/** Last-24h filter shared with the dashboard's below-the-fold chart. */
export function filterLast24Hours(recent: PhivolcsEarthquake[]): PhivolcsEarthquake[] {
  const now = Date.now();
  return recent.filter(eq => {
    const cleanDateStr = eq.datetime.replace(' - ', ' ').replace(/ UTC$/i, '');
    const eqDate = new Date(cleanDateStr).getTime();
    if (isNaN(eqDate)) return true;
    return (now - eqDate) <= 24 * 60 * 60 * 1000;
  });
}

export function SummaryCards({ recent, significant, showChart = true }: Props) {
  // Filter for last 24 hours
  const last24Hours = filterLast24Hours(recent);
  const sigLast24 = significant.filter(eq => last24Hours.includes(eq));

  const validMags = last24Hours.map(f => parseFloat(f.magnitude)).filter(m => !isNaN(m));
  const validDepths = last24Hours.map(f => parseFloat(f.depth)).filter(d => !isNaN(d));

  const maxMag = validMags.length > 0 ? Math.max(...validMags) : 0;
  const avgMag = validMags.length > 0 ? (validMags.reduce((a, b) => a + b, 0) / validMags.length).toFixed(1) : '0.0';
  const maxDepth = validDepths.length > 0 ? Math.max(...validDepths).toFixed(0) : '0';
  const maxMagColor = getSeverityColor(maxMag);
  const avgMagColor = getSeverityColor(parseFloat(avgMag));

  const cells: Array<{ label: string; value: string; cap: string; color?: string; accent: string }> = [
    { label: 'Events · 24h', value: String(last24Hours.length), cap: 'Recorded', accent: '#38bdf8' },
    { label: 'Peak', value: maxMag.toFixed(1), cap: 'Strongest', color: maxMagColor, accent: maxMagColor },
    { label: 'Average', value: avgMag, cap: 'Mean magnitude', color: avgMagColor, accent: avgMagColor },
    { label: 'Max depth', value: `${maxDepth}`, cap: 'km', accent: '#8b5cf6' },
    { label: 'Significant', value: String(sigLast24.length), cap: 'M ≥ 4.5', color: sigLast24.length > 0 ? '#f97316' : undefined, accent: '#f97316' },
  ];

  return (
    <>
      <div className="tg-stats" role="region" aria-label="Last 24 hours at a glance">
        {cells.map((cell) => (
          <div className="tg-stat" key={cell.label}>
            <span className="tg-stat-label">{cell.label}</span>
            <span className="tg-stat-value tnum" style={cell.color ? { color: cell.color } : undefined}>{cell.value}</span>
            <span className="tg-stat-cap">{cell.cap}</span>
            <span className="tg-stat-divider" style={{ background: cell.accent }} aria-hidden="true" />
          </div>
        ))}
      </div>
      {showChart && <MagnitudeChart data={last24Hours} />}
    </>
  );
}
