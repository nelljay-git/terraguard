import { useEffect, useMemo, useState, useCallback, startTransition } from 'react';
import { parse, isValid, startOfDay, startOfMonth, subDays, format } from 'date-fns';
import { fetchEarthquakeData, getCachedData, normalizeEarthquakes, type NormalizedEarthquake } from '../api/phivolcs';
import { getPreferredApi } from '../lib/apiPreference';
import { getSeverityLabel, getSeverityColor } from '../lib/utils';
import { InteractiveMap } from '../components/InteractiveMap';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ScatterChart, Scatter, ZAxis,
  AreaChart, Area
} from 'recharts';
import { RefreshCw, Clock, Waves } from 'lucide-react';
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
  { key: '3d', label: '3 Days' },
  { key: '7d', label: '7 Days' },
  { key: 'month', label: 'Month' },
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

const CHART_TOOLTIP = {
  backgroundColor: 'rgba(11, 18, 32, 0.97)',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: '8px',
  boxShadow: 'none',
};

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
      // For EMSC, fetch the exact window the chart needs (otherwise 100/day cap makes 3d/7d/month inaccurate)
      const pref = getPreferredApi();
      let res: Awaited<ReturnType<typeof fetchEarthquakeData>> | null = null;
      if (pref === 'emsc') {
        const now = new Date();
        const lower = timeRange === 'day' ? startOfDay(now) : timeRange === '3d' ? subDays(now, 2) : timeRange === '7d' ? subDays(now, 6) : startOfMonth(now);
        const start = new Date(Date.UTC(lower.getUTCFullYear(), lower.getUTCMonth(), lower.getUTCDate(), 0,0,0,0));
        const end = new Date();
        const params = new URLSearchParams({
          format: 'json', limit: '20000', orderby: 'time', minmag: '1.0',
          starttime: start.toISOString(), endtime: end.toISOString(),
        });
        const r = await fetch(`https://www.seismicportal.eu/fdsnws/event/1/query?${params}`);
        if (r.ok) {
          const j = await r.json() as { features: Array<{ id:string; properties: { unid:string; source_id:string; source_catalog:string; time:string; lastupdate:string; lat:number; lon:number; depth:number; mag:number; magtype:string; flynn_region:string; auth:string; evtype:string }; geometry: { type:string; coordinates:[number,number,number]}; type:string }> };
          if (j.features?.length) {
            const fakeRes = { data: j.features.map((f)=> ({
              id: f.id,
              properties: f.properties,
              geometry: f.geometry,
              type: f.type,
            })) as unknown as Awaited<ReturnType<typeof fetchEarthquakeData>>['data'], source: 'emsc' as const };
            const normalized = normalizeEarthquakes(fakeRes.data as unknown as Parameters<typeof normalizeEarthquakes>[0]);
            for (const eq of normalized) parseEarthquakeDate(getEarthquakeDatetime(eq));
            setEarthquakes(normalized);
            setLastSync(new Date());
            return;
          }
        }
      }
      res = await fetchEarthquakeData();
      if (res && res.data.length > 0) {
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
  }, [timeRange]);

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
            : startOfMonth(now);

    return earthquakes.filter(eq => {
      const parsedDate = parseEarthquakeDate(getEarthquakeDatetime(eq));
      return parsedDate ? parsedDate >= lowerBound : false;
    });
  }, [earthquakes, timeRange]);

  const timeRangeLabel = useMemo(() => {
    return TIME_RANGES.find(option => option.key === timeRange)?.label ?? 'Month';
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

  const pref = getPreferredApi();
  const sourceName = pref === 'usgs' ? 'USGS' : pref === 'emsc' ? 'EMSC' : 'PHIVOLCS';
  const peakColor = statsData.maxMag > 0 ? getSeverityColor(statsData.maxMag) : undefined;

  if (loading) {
    return (
      <div className="stats-page container" aria-busy="true" aria-label="Loading statistics">
        <div className="stats-skeleton stats-skeleton--mast" />
        <div className="stats-skeleton stats-skeleton--kpis" />
        <div className="stats-skeleton stats-skeleton--map" />
        <div className="stats-skeleton stats-skeleton--chart" />
        <div className="stats-skeleton-row">
          <div className="stats-skeleton stats-skeleton--chart" />
          <div className="stats-skeleton stats-skeleton--chart" />
        </div>
      </div>
    );
  }

  const isEmpty = filteredEarthquakes.length === 0;

  const kpiCells: Array<{ label: string; value: string; cap: string; color?: string }> = [
    { label: 'Events', value: String(filteredEarthquakes.length), cap: timeRange === 'day' ? 'Recorded today' : `Across ${timeRangeSubtitle.toLowerCase()}` },
    { label: 'Peak', value: statsData.maxMag > 0 ? statsData.maxMag.toFixed(1) : '—', cap: 'Strongest magnitude', color: peakColor },
    { label: 'Average', value: statsData.avgMag > 0 ? statsData.avgMag.toFixed(1) : '—', cap: 'Mean magnitude' },
    { label: 'Max depth', value: statsData.maxDepth > 0 ? `${statsData.maxDepth.toFixed(0)} km` : '—', cap: 'Deepest event' },
    { label: 'Significant', value: String(statsData.significantCount), cap: 'M ≥ 4.5', color: statsData.significantCount > 0 ? '#f97316' : undefined },
  ];

  return (
    <div className="stats-page container">
      {/* ── Masthead ── */}
      <header className="stats-mast">
        <div className="stats-mast-left">
          <span className="stats-eyebrow">TerraGuard · Analytics</span>
          <h1 className="stats-title">Statistics</h1>
          <p className="stats-sub">
            How often events occur, where they cluster, and how strong or deep they run — computed from {sourceName}, {timeRangeSubtitle}.
          </p>
        </div>
        <div className="stats-mast-right">
          <div className="stats-range" role="tablist" aria-label="Statistics window">
            {TIME_RANGES.map(option => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={timeRange === option.key}
                className={`stats-range-btn${timeRange === option.key ? ' is-active' : ''}`}
                onClick={() => startTransition(() => setTimeRange(option.key))}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="stats-sync">
            <span className={`stats-live ${syncing ? 'syncing' : 'live'}`}>
              <span className="stats-live-dot" aria-hidden="true" />
              {syncing ? 'Syncing' : 'Live'}
            </span>
            <span className="stats-sync-time tnum">
              <Clock size={12} aria-hidden="true" />
              {lastSync ? lastSync.toLocaleTimeString() : '--:--:--'}
            </span>
            <button className="stats-refresh" onClick={loadData} disabled={syncing} aria-label="Refresh statistics" title="Refresh statistics">
              <RefreshCw size={15} className={syncing ? 'spin' : ''} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {isEmpty ? (
        <div className="stats-empty" role="status">
          <Waves size={30} strokeWidth={1.5} className="stats-empty-icon" aria-hidden="true" />
          <p className="stats-empty-title">No events recorded in this window</p>
          <p className="stats-empty-sub">Try a wider range — or switch the preferred data source in Settings.</p>
        </div>
      ) : (
        <>
          {/* ── KPI strip ── */}
          <div className="stats-kpis" role="region" aria-label="Key figures for the selected window">
            {kpiCells.map((cell, i) => (
              <div className="stats-kpi" key={cell.label}>
                <span className="stats-kpi-label">{cell.label}</span>
                <span className="stats-kpi-value tnum" style={cell.color ? { color: cell.color } : undefined}>{cell.value}</span>
                <span className="stats-kpi-cap">{cell.cap}</span>
                {i > 0 && <span className="stats-kpi-divider" aria-hidden="true" />}
              </div>
            ))}
          </div>

          {/* ── Geographic distribution ── */}
          <section className="stats-map" aria-label="Geographic distribution of events">
            <div className="tg-panel-head">
              <div>
                <h2 className="tg-panel-title">Geographic footprint</h2>
                <p className="tg-panel-sub">Where the ground moved in this window</p>
              </div>
              <span className="tg-panel-note tnum">{filteredEarthquakes.length} events · {timeRangeSubtitle}</span>
            </div>
            <div className="stats-map-frame">
              <InteractiveMap
                earthquakes={filteredEarthquakes}
                showAllEvents={true}
                compactMarkers={true}
                enableLegendFilter={true}
                pulseMarkers={false}
              />
            </div>
          </section>

          {/* ── Magnitude timeline ── */}
          <section className="stats-panel stats-timeline" aria-label="Magnitude over time">
            <div className="tg-panel-head">
              <div>
                <h2 className="tg-panel-title">Magnitude over time</h2>
                <p className="tg-panel-sub">Each event plotted through the window, oldest on the left</p>
              </div>
              <span className="tg-panel-note">Hover for exact values</span>
            </div>
            <div className="stats-chart stats-chart--timeline">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <AreaChart data={statsData.magTimeline} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tgGradMag" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 5" stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="time" stroke="var(--tg-text-3)" fontSize={10} minTickGap={50} tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis stroke="var(--tg-text-3)" fontSize={10} domain={[0, 'auto']} tickLine={false} axisLine={false} width={34} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP}
                    wrapperStyle={{ pointerEvents: 'none', zIndex: 10 }}
                    itemStyle={{ color: '#f8fafc' }}
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
                    strokeWidth={1.75}
                    fill="url(#tgGradMag)"
                    isAnimationActive={false}
                    dot={statsData.magTimeline.length <= 200 ? { r: 3, fill: '#f97316', strokeWidth: 0 } : false}
                    activeDot={{ r: 4 }}
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
            <div className="stats-timeline-foot" aria-live="polite">
              {selectedTimelinePoint ? (
                <>
                  <span className="stats-timeline-date tnum">{selectedTimelinePoint.date} — {selectedTimelinePoint.time}</span>
                  <span className="stats-timeline-mag tnum">Magnitude {selectedTimelinePoint.magnitude.toFixed(1)}</span>
                </>
              ) : (
                <span className="stats-timeline-hint">Sweep the curve — exact magnitude and timestamp for any event appear here.</span>
              )}
            </div>
          </section>

          {/* ── Distribution + depth ── */}
          <div className="stats-split">
            <section className="stats-panel" aria-label="Magnitude distribution">
              <div className="tg-panel-head">
                <div>
                  <h2 className="tg-panel-title">Magnitude distribution</h2>
                  <p className="tg-panel-sub">How events spread across severity classes</p>
                </div>
              </div>
              <div className="stats-panel-body stats-panel-body--split">
                <div className="stats-chart stats-chart--donut">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <PieChart>
                      <Pie
                        data={statsData.magDistribution}
                        cx="50%" cy="50%"
                        innerRadius={62} outerRadius={92}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                      >
                        {statsData.magDistribution.map((entry) => (
                          <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name] || '#64748b'} fillOpacity={0.88} />
                        ))}
                      </Pie>
                      <Tooltip
                        wrapperStyle={{ pointerEvents: 'none' }}
                        contentStyle={CHART_TOOLTIP}
                        itemStyle={{ color: '#f8fafc' }}
                        labelStyle={{ color: '#94a3b8' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="stats-donut-legend">
                  {statsData.magDistribution.map(d => (
                    <li key={d.name} className="stats-legend-item">
                      <span className="stats-legend-dot" style={{ backgroundColor: SEVERITY_COLORS[d.name] }} aria-hidden="true" />
                      <span className="stats-legend-label">{d.name}</span>
                      <span className="stats-legend-value tnum">{d.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="stats-panel" aria-label="Depth versus magnitude">
              <div className="tg-panel-head">
                <div>
                  <h2 className="tg-panel-title">Depth vs magnitude</h2>
                  <p className="tg-panel-sub">Two readings of the same set — how deep each event ran</p>
                </div>
              </div>
              <div className="stats-panel-body">
                <div className="stats-chart stats-chart--scatter">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <ScatterChart margin={{ top: 10, right: 8, left: -12, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="2 5" stroke="rgba(148,163,184,0.08)" />
                      <XAxis dataKey="magnitude" type="number" name="Magnitude" stroke="var(--tg-text-3)" fontSize={10} tickLine={false} axisLine={false} tickMargin={8}
                        label={{ value: 'Magnitude', position: 'insideBottom', offset: -8, fill: 'var(--tg-text-3)', fontSize: 10 }} />
                      <YAxis dataKey="depth" type="number" name="Depth (km)" stroke="var(--tg-text-3)" fontSize={10} reversed tickLine={false} axisLine={false} width={32}
                        label={{ value: 'Depth (km)', angle: -90, position: 'insideLeft', offset: 24, fill: 'var(--tg-text-3)', fontSize: 10 }} />
                      <ZAxis range={[40, 200]} />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 4', stroke: 'rgba(148,163,184,0.4)' }}
                        wrapperStyle={{ pointerEvents: 'none' }}
                        contentStyle={CHART_TOOLTIP}
                        itemStyle={{ color: '#f8fafc' }}
                        labelStyle={{ color: '#94a3b8' }}
                      />
                      <Scatter data={statsData.depthMagPoints} fill="#8b9cf9" fillOpacity={0.62} stroke="#8b9cf9" strokeOpacity={0.9} strokeWidth={0.5} isAnimationActive={false} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          </div>

          {/* ── Regions + daily frequency ── */}
          <div className="stats-split">
            <section className="stats-panel" aria-label="Most active regions" id="top-active-regions">
              <div className="tg-panel-head">
                <div>
                  <h2 className="tg-panel-title">Most active regions</h2>
                  <p className="tg-panel-sub">Where the ground moved the most — top eight</p>
                </div>
              </div>
              <div className="stats-panel-body">
                <div className="stats-chart stats-chart--regions">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <BarChart data={statsData.topRegions} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="2 5" stroke="rgba(148,163,184,0.08)" horizontal={false} />
                      <XAxis type="number" stroke="var(--tg-text-3)" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis dataKey="region" type="category" width={132} stroke="var(--tg-text-3)" fontSize={10} tickLine={false} axisLine={false} tick={{ fill: 'var(--tg-text-2)' }} />
                      <Tooltip
                        wrapperStyle={{ pointerEvents: 'none' }}
                        contentStyle={CHART_TOOLTIP}
                        itemStyle={{ color: '#f8fafc' }}
                        labelStyle={{ color: '#94a3b8' }}
                      />
                      <Bar dataKey="count" fill="#5b8def" fillOpacity={0.85} radius={[0, 2, 2, 0]} barSize={17} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            <section className="stats-panel" aria-label="Events per day">
              <div className="tg-panel-head">
                <div>
                  <h2 className="tg-panel-title">Events per day</h2>
                  <p className="tg-panel-sub">Daily frequency through the window</p>
                </div>
              </div>
              <div className="stats-panel-body">
                <div className="stats-chart stats-chart--days">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <BarChart data={statsData.timelineData} margin={{ top: 10, right: 6, left: -14, bottom: 34 }}>
                      <CartesianGrid strokeDasharray="2 5" stroke="rgba(148,163,184,0.08)" vertical={false} />
                      <XAxis dataKey="day" stroke="var(--tg-text-3)" fontSize={9} angle={-28} textAnchor="end" interval={0} tickLine={false} axisLine={false} tickMargin={6} />
                      <YAxis stroke="var(--tg-text-3)" fontSize={10} allowDecimals={false} tickLine={false} axisLine={false} width={30} />
                      <Tooltip
                        wrapperStyle={{ pointerEvents: 'none' }}
                        contentStyle={CHART_TOOLTIP}
                        itemStyle={{ color: '#f8fafc' }}
                        labelStyle={{ color: '#94a3b8' }}
                      />
                      <Bar dataKey="count" fill="#5b8def" fillOpacity={0.85} radius={[2, 2, 0, 0]} barSize={26} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
