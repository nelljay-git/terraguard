import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import './SummaryCards.css';

export function MagnitudeChart({ data }: { data: PhivolcsEarthquake[] }) {
  const sorted = [...data].reverse();

  const chartData = sorted.map(eq => {
    const timePart = eq.datetime.includes(' - ') ? eq.datetime.split(' - ')[1] : eq.datetime;
    return {
      time: timePart,
      magnitude: parseFloat(eq.magnitude) || 0
    };
  });

  return (
    <div className="tg-chart-panel" role="region" aria-label="Magnitude trend, last 24 hours">
      <div className="tg-chart-head">
        <h3 className="tg-chart-title">Magnitude Trend</h3>
        <span className="tg-chart-note">Last 24h</span>
      </div>
      <div className="tg-chart-body">
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <AreaChart data={chartData} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="colorMagDash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(148,163,184,0.08)" vertical={false} />
            <XAxis dataKey="time" stroke="var(--tg-text-3)" fontSize={10} tickMargin={8} minTickGap={50} />
            <YAxis stroke="var(--tg-text-3)" fontSize={10} domain={[0, 'auto']} width={34} />
            <Tooltip
              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.96)', border: '1px solid var(--tg-hairline)', borderRadius: '8px', boxShadow: 'none' }}
              itemStyle={{ color: '#f8fafc', fontWeight: 600 }}
              labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
            />
            <Area type="monotone" dataKey="magnitude" stroke="#f97316" strokeWidth={1.75} fillOpacity={1} fill="url(#colorMagDash)" dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
