import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { PhivolcsEarthquake } from '../api/phivolcs';

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
    <div className="magnitude-chart-container glass" style={{ padding: '24px', height: '300px', display: 'flex', flexDirection: 'column', borderRadius: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <TrendingUp size={18} style={{ color: 'var(--text-muted)' }} />
          <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', fontWeight: 600 }}>Magnitude Trend</h3>
        </div>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.5px', textTransform: 'uppercase' as const, fontWeight: 600 }}>Last 24 Hours</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorMagDash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} tickMargin={10} minTickGap={50} />
            <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 'auto']} />
            <Tooltip 
              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
              itemStyle={{ color: '#f8fafc', fontWeight: 600 }}
              labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
            />
            <Area type="monotone" dataKey="magnitude" stroke="#f97316" strokeWidth={2} fillOpacity={1} fill="url(#colorMagDash)" dot={{ r: 3, fill: '#f97316', strokeWidth: 0 }} activeDot={{ r: 6 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
