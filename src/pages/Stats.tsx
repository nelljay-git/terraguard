import { useEffect, useMemo, useState, useCallback, startTransition } from 'react';
import { parse, isValid, startOfDay, subDays, subMonths, format } from 'date-fns';
import { fetchEarthquakeData, getCachedData, normalizeEarthquakes, type NormalizedEarthquake } from '../api/phivolcs';
import { getSeverityLabel } from '../lib/utils';
import { InteractiveMap } from '../components/InteractiveMap';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ScatterChart, Scatter, ZAxis,
  AreaChart, Area
} from 'recharts';
import { Radio, RefreshCw, Activity, BarChart3, PieChart as PieIcon, Crosshair, Clock } from 'lucide-react';
import './Stats.css';

// Severity colors (raw hex, not CSS vars, for recharts)
const SEVERITY_COLORS: Record<string, string> = {
  Micro: '#10b981',
  Minor: '#3b82f6',
  Light: '#eab308',
  Moderate: '#f97316',
  Strong: '#ef4444',
  Major: '#8b5cf6',
};

const SEVERITY_ORDER = ['Micro', 'Minor', 'Light', 'Moderate', 'Strong', 'Major'];
const TIME_RANGES = [
  { key: 'day', label: 'This Day' },
  { key: '3d', label: 'Last 3 Days' },
  { key: '7d', label: '7 Days' },
  { key: 'month', label: 'This Month' },
] as const;

type TimeRangeKey = typeof TIME_RANGES[number]['key'];

function getEarthquakeMag(eq: NormalizedEarthquake): number {
  return Number.parseFloat(eq.magnitude);
}

function getEarthquakeDepth(eq: NormalizedEarthquake): number {
  return Number.parseFloat(eq.depth);
}

function getEarthquakeLocation(eq: NormalizedEarthquake): string {
  return eq.location;
}

function getEarthquakeDatetime(eq: NormalizedEarthquake): string {
  return eq.datetime;
}

const parsedDateCache = new Map<string, Date | null>();

function parseEarthquakeDate(datetime: string): Date | null {
  const cached = parsedDateCache.get(datetime);
  if (cached !== undefined) return cached;

  const datePart = datetime.split(' - ')[0]?.trim();
  let result: Date | null = null;
  if (datePart) {
    const parsed = parse(datePart, 'd MMMM yyyy', new Date());
    if (isValid(parsed)) result = parsed;
  }
  parsedDateCache.set(datetime, result);
  return result;
}

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) {
    out.push(arr[Math.floor(i)]);
  }
  if (out.length < max && arr.length > 0) {
    out.push(arr[arr.length - 1]);
  }
  return out;
}

const MAX_SCATTER_POINTS = 250;
const MAX_TIMELINE_POINTS = 250;

export function Stats() {
  const initialCache = getCachedData();
  const initialData = initialCache?.data ? normalizeEarthquakes(initialCache.data) : [];
  const [earthquakes, setEarthquakes] = useState<NormalizedEarthquake[]>(initialData);
  const [loading, setLoading] = useState(initialData.length === 0);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('day');
  const [selectedTimelinePoint, setSelectedTimelinePoint] = useState<{ date: string; time: string; magnitude: number } | null>(null);

  const loadData = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetchEarthquakeData();
      if (res.data.length > 0) {
        const normalized = normalizeEarthquakes(res.data);
        for (const eq of normalized) {
          parseEarthquakeDate(getEarthquakeDatetime(eq));
        }
        setEarthquakes(normalized);
        setLastSync(new Date());
      }
    } catch (err) {
      console.error('Stats fetch error', err);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;

    const startPolling = () => {
      if (interval) return;
      interval = setInterval(loadData, 60000);
    };
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
    };

    loadData();
    startPolling();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadData();
        startPolling();
      } else {
        stopPolling();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadData]);

  const filteredEarthquakes = useMemo(() => {
    const now = new Date();
    const lowerBound =
      timeRange === 'day'
        ? startOfDay(now)
        : timeRange === '3d'
          ? subDays(now, 2)
          : timeRange === '7d'
            ? subDays(now, 6)
            : subMonths(now, 1);

    return earthquakes.filter(eq => {
      const parsedDate = parseEarthquakeDate(getEarthquakeDatetime(eq));
      return parsedDate ? parsedDate >= lowerBound : false;
    });
  }, [earthquakes, timeRange]);

  const timeRangeLabel = useMemo(() => {
    return TIME_RANGES.find(option => option.key === timeRange)?.label ?? 'One Month';
  }, [timeRange]);

  const timeRangeSubtitle = useMemo(() => {
    if (timeRange === 'day') {
      return format(new Date(), 'dd MMMM yyyy');
    }
    return timeRangeLabel;
  }, [timeRange, timeRangeLabel]);

  const statsData = useMemo(() => {
    const magCounts: Record<string, number> = {};
    const regionCounts: Record<string, number> = {};
    const dayCounts: Record<string, number> = {};
    const depthMagPoints: Array<{ magnitude: number; depth: number }> = [];
    const magTimelinePoints: Array<{ date: string; time: string; magnitude: number }> = [];
    let magSum = 0;
    let magCount = 0;
    let maxMag = 0;
    let maxDepth = 0;

    SEVERITY_ORDER.forEach(s => (magCounts[s] = 0));

    for (const eq of filteredEarthquakes) {
      const mag = getEarthquakeMag(eq);
      const depth = getEarthquakeDepth(eq);
      const location = getEarthquakeLocation(eq);
      const datetime = getEarthquakeDatetime(eq);

      if (!Number.isNaN(mag)) {
        const label = getSeverityLabel(mag);
        magCounts[label] = (magCounts[label] || 0) + 1;
        magSum += mag;
        magCount += 1;
        maxMag = Math.max(maxMag, mag);
      }

      if (!Number.isNaN(mag) && !Number.isNaN(depth)) {
        depthMagPoints.push({ magnitude: mag, depth });
        maxDepth = Math.max(maxDepth, depth);
      }

      const parts = location.split(/,|\(/).map(s => s.trim().replace(')', ''));
      const region = parts[parts.length - 1] || location;
      regionCounts[region] = (regionCounts[region] || 0) + 1;

      const datePart = datetime.split(' - ')[0]?.trim();
      if (datePart) {
        dayCounts[datePart] = (dayCounts[datePart] || 0) + 1;
      }

      const timePart = datetime.includes(' - ') ? datetime.split(' - ')[1] : datetime;
      magTimelinePoints.push({
        date: datetime.split(' - ')[0]?.trim() || '',
        time: timePart,
        magnitude: Number.isNaN(mag) ? 0 : mag,
      });
    }

    const magDistribution = SEVERITY_ORDER
      .map(name => ({ name, value: magCounts[name] }))
      .filter(d => d.value > 0);

    const topRegions = Object.entries(regionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([region, count]) => ({ region: region.length > 25 ? region.substring(0, 22) + '...' : region, count }));

    const timelineData = Object.entries(dayCounts)
      .map(([day, count]) => ({ day, count }))
      .reverse();

    return {
      magDistribution,
      topRegions,
      depthMagPoints: downsample(depthMagPoints, MAX_SCATTER_POINTS),
      timelineData,
      magTimeline: downsample(magTimelinePoints.reverse(), MAX_TIMELINE_POINTS),
      maxMag,
      maxDepth,
      avgMag: magCount > 0 ? magSum / magCount : 0,
      significantCount: filteredEarthquakes.filter(eq => getEarthquakeMag(eq) >= 4.5).length,
    };
  }, [filteredEarthquakes]);

  if (loading) {
    return (
      <div className="container flex-center" style={{ height: '50vh' }}>
        <div className="loader">Loading Statistics...</div>
      </div>
    );
  }

  return (
    <div className="stats-container container">
      {/* ── Header ── */}
      <div className="stats-header glass">
        <div className="stats-header-left">
          <h1 className="stats-title">
            <BarChart3 size={28} />
            Seismic Analytics
          </h1>
          <p className="text-muted" style={{ lineHeight: 1.6, maxWidth: '640px' }}>
            Explore how often earthquakes occur, where they concentrate, and how strong or deep they tend to be — across today, the last few days, or this month.
          </p>
        </div>
        <div className="stats-header-right">
          <div className="time-range-group" role="group" aria-label="Statistics time range">
            {TIME_RANGES.map(option => (
              <button
                key={option.key}
                type="button"
                className={`time-range-btn ${timeRange === option.key ? 'active' : ''}`}
                onClick={() => startTransition(() => setTimeRange(option.key))}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className={`sync-status ${syncing ? 'syncing' : 'live'}`}>
            <Radio size={16} className="pulse-icon" />
            <span>{syncing ? 'Syncing...' : 'LIVE'}</span>
          </div>
          <div className="last-sync text-muted">
            <Clock size={14} />
            {lastSync ? `Synced ${lastSync.toLocaleTimeString()}` : 'Waiting...'}
          </div>
          <button className="refresh-btn glass-card" onClick={loadData} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Quick Stats ── */}
      <div className="quick-stats-row" style={{ display: 'none' }}>
        <div className="quick-stat glass-card">
          <span className="qs-value">{filteredEarthquakes.length}</span>
          <span className="qs-label">Total Events {timeRange === 'day' ? 'Today' : timeRangeLabel}</span>
          {timeRange === 'day' && <span className="qs-sub-label">{timeRangeSubtitle}</span>}
        </div>
        <div className="quick-stat glass-card">
          <span className="qs-value" style={{ color: '#ef4444' }}>
            {statsData.maxMag > 0 ? statsData.maxMag.toFixed(1) : '—'}
          </span>
          <span className="qs-label">Peak Mag</span>
        </div>
        <div className="quick-stat glass-card">
          <span className="qs-value" style={{ color: '#3b82f6' }}>
            {statsData.avgMag > 0 ? statsData.avgMag.toFixed(1) : '—'}
          </span>
          <span className="qs-label">Avg Mag</span>
        </div>
        <div className="quick-stat glass-card">
          <span className="qs-value" style={{ color: '#8b5cf6' }}>
            {statsData.maxDepth > 0 ? statsData.maxDepth.toFixed(0) : '—'}
          </span>
          <span className="qs-label">Max Depth (km)</span>
        </div>
        <div className="quick-stat glass-card">
          <span className="qs-value" style={{ color: '#f97316' }}>
            {statsData.significantCount}
          </span>
          <span className="qs-label">Significant (≥4.5)</span>
        </div>
      </div>

      <div className="stats-map-shell glass-card">
        <InteractiveMap
          earthquakes={filteredEarthquakes}
          showAllEvents={true}
          compactMarkers={true}
          enableLegendFilter={true}
          pulseMarkers={false}
        />
      </div>

      <div className="stats-summary">
        <div className="stat-item">
          <span className="stat-label">Events</span>
          <span className="stat-value">{filteredEarthquakes.length}</span>
          <span className="stat-secondary">Total Recorded</span>

        </div>

        <div className="stat-item">
          <span className="stat-label">Range</span>
          <span className="stat-value">
            {timeRange === 'day' ? 'Today' : timeRangeLabel}

          </span>
          {timeRange === 'day' && <span className="stat-secondary">{timeRangeSubtitle}</span>}
        </div>

        <div className="stat-item">
          <span className="stat-label">High Mag</span>
          <span className="stat-value" style={{ color: '#ef4444' }}>
            {statsData.maxMag > 0 ? statsData.maxMag.toFixed(1) : '—'} MG
          </span>
          <span className="stat-secondary">Strongest event</span>
        </div>

        <div className="stat-item">
          <span className="stat-label">Avg Mag</span>
          <span className="stat-value" style={{ color: '#f59e0b' }}>
            {statsData.avgMag > 0 ? statsData.avgMag.toFixed(1) : '—'} MG
          </span>
          <span className="stat-secondary">Mean magnitude</span>
        </div>

        <div className="stat-item">
          <span className="stat-label">Max Depth</span>
          <span className="stat-value" style={{ color: '#8b5cf6' }}>
            {statsData.maxDepth > 0 ? `${statsData.maxDepth.toFixed(0)} km` : '—'}
          </span>

          <span className="stat-secondary">Deepest event</span>
        </div>

        <div className="stat-item">
          <span className="stat-label">Significant</span>
          <span className="stat-value" style={{ color: '#10b981' }}>
            {statsData.significantCount}
          </span>
          <span className="stat-secondary">M ≥ 4.5 events</span>
        </div>


      </div>

      {/* ── Charts Grid ── */}
      <div className="charts-grid">

        {/* Magnitude Over Time */}
        <div className="chart-panel glass-card full-width chart-panel--timeline">
          <div className="chart-title">
            <Activity size={18} />
            Magnitude Timeline
          </div>
          <div className="chart-body chart-body--timeline" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <AreaChart data={statsData.magTimeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradMag" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} minTickGap={50} />
                <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  wrapperStyle={{ pointerEvents: 'none', zIndex: 10 }}
                  itemStyle={{ color: '#f8fafc', fontWeight: 600 }}
                  labelStyle={{ color: '#94a3b8' }}
                  labelFormatter={(label, payload) => {
                    if (payload && payload.length > 0 && payload[0].payload.date) {
                      return `${payload[0].payload.date} - ${label}`;
                    }
                    return label;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="magnitude"
                  stroke="#f97316"
                  strokeWidth={2}
                  fill="url(#gradMag)"
                  isAnimationActive={false}
                  dot={statsData.magTimeline.length <= 200 ? { r: 3, fill: '#f97316' } : false}
                  activeDot={{ r: 6 }}
                  onMouseMove={(point: any) => {
                    const payload = point?.payload;
                    if (payload?.date || payload?.time) {
                      setSelectedTimelinePoint(payload);
                    }
                  }}
                  onMouseLeave={() => setSelectedTimelinePoint(null)}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="timeline-detail">
            {selectedTimelinePoint ? (
              <>
                <div className="timeline-detail-date">
                  {selectedTimelinePoint.date} {selectedTimelinePoint.time ? `- ${selectedTimelinePoint.time}` : ''}
                </div>
                <div className="timeline-detail-mag">
                  Magnitude: {selectedTimelinePoint.magnitude.toFixed(1)}
                </div>
              </>
            ) : (
              <div className="timeline-detail-empty">Hover a point to see its date and magnitude.</div>
            )}
          </div>
        </div>

        {/* Magnitude Distribution Donut */}
        <div className="chart-panel glass-card">
          <div className="chart-title">
            <PieIcon size={18} />
            Magnitude Distribution
          </div>
          <div className="chart-body" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <PieChart>
                <Pie
                  data={statsData.magDistribution}
                  cx="50%" cy="50%"
                  innerRadius={65} outerRadius={100}
                  paddingAngle={4}
                  dataKey="value"
                  stroke="none"
                >
                  {statsData.magDistribution.map((entry) => (
                    <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name] || '#64748b'} />
                  ))}
                </Pie>
                <Tooltip
                  wrapperStyle={{ pointerEvents: 'none' }}
                  contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ color: '#f8fafc' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="donut-legend">
            {statsData.magDistribution.map(d => (
              <div key={d.name} className="legend-item">
                <span className="legend-dot" style={{ backgroundColor: SEVERITY_COLORS[d.name] }}></span>
                <span className="legend-label">{d.name}</span>
                <span className="legend-value">{d.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Active Regions */}
        <div className="chart-panel glass-card" id="top-active-regions">
          <div className="chart-title">
            <BarChart3 size={18} />
            Top Active Regions
          </div>
          <div className="chart-body" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <BarChart data={statsData.topRegions} layout="vertical" margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis type="number" stroke="var(--text-muted)" fontSize={11} />
                <YAxis dataKey="region" type="category" width={120} stroke="var(--text-muted)" fontSize={11} tick={{ fill: 'var(--text-secondary)' }} />
                <Tooltip
                  wrapperStyle={{ pointerEvents: 'none' }}
                  contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ color: '#f8fafc' }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 8, 8, 0]} barSize={20}>
                  {statsData.topRegions.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? '#ef4444' : i === 1 ? '#f97316' : '#3b82f6'} fillOpacity={1 - i * 0.08} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Depth vs Magnitude Scatter */}
        <div className="chart-panel glass-card">
          <div className="chart-title">
            <Crosshair size={18} />
            Depth vs Magnitude Profile
          </div>
          <div className="chart-body" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <ScatterChart margin={{ top: 10, right: 10, left: -10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="magnitude" type="number" name="Magnitude" stroke="var(--text-muted)" fontSize={11} label={{ value: 'Magnitude', position: 'insideBottom', offset: -5, fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis dataKey="depth" type="number" name="Depth (km)" stroke="var(--text-muted)" fontSize={11} reversed label={{ value: 'Depth (km)', angle: -90, position: 'insideLeft', offset: 20, fill: 'var(--text-muted)', fontSize: 11 }} />
                <ZAxis range={[40, 200]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  wrapperStyle={{ pointerEvents: 'none' }}
                  contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ color: '#f8fafc' }}
                />
                <Scatter data={statsData.depthMagPoints} fill="#8b5cf6" fillOpacity={0.7} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Events per Day */}
        <div className="chart-panel glass-card">
          <div className="chart-title">
            <Clock size={18} />
            Events Per Day
          </div>
          <div className="chart-body" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <BarChart data={statsData.timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="day" stroke="var(--text-muted)" fontSize={10} angle={-30} textAnchor="end" interval={0} />
                <YAxis stroke="var(--text-muted)" fontSize={11} allowDecimals={false} />
                <Tooltip
                  wrapperStyle={{ pointerEvents: 'none' }}
                  contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ color: '#f8fafc' }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Bar dataKey="count" fill="#10b981" radius={[8, 8, 0, 0]} barSize={36}>
                  {statsData.timelineData.map((_, i) => (
                    <Cell key={i} fill={i === statsData.timelineData.length - 1 ? '#10b981' : '#10b98180'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div >
  );
}
