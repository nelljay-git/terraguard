import { useEffect, useState, useCallback } from 'react';
import { parse, isValid, isSameMonth } from 'date-fns';
import { fetchEarthquakeData, getSignificantEarthquakes, getCachedData, normalizeEarthquakes, type NormalizedEarthquake } from '../api/phivolcs';
import { getPreferredApi } from '../lib/apiPreference';
import { SummaryCards } from '../components/SummaryCards';
import { LatestEarthquake } from '../components/LatestEarthquake';
import { InteractiveMap } from '../components/InteractiveMap';
import { ActivityFeed } from '../components/ActivityFeed';
import { NewsFeed } from '../components/NewsFeed';
import { Radio, RefreshCw, Shield } from 'lucide-react';
import { FunFactLoader } from '../components/FunFactLoader';
import { checkAlerts } from '../lib/alertSystem';
import './Dashboard.css';

export function Dashboard() {
  // Try to load cached data instantly so the user sees something right away
  const initialCache = getCachedData();
  const initialData = initialCache?.data ? normalizeEarthquakes(initialCache.data) : [];
  const [earthquakes, setEarthquakes] = useState<NormalizedEarthquake[]>(initialData);
  const [sigEarthquakes, setSigEarthquakes] = useState<NormalizedEarthquake[]>(
    initialData.length > 0 ? getSignificantEarthquakes(initialData) : []
  );
  const [loading, setLoading] = useState(initialData.length === 0);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadData = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetchEarthquakeData();
      if (res.data.length > 0) {
        const normalized = normalizeEarthquakes(res.data);
        setEarthquakes(normalized);
        setSigEarthquakes(getSignificantEarthquakes(normalized));
        setLastSync(new Date());
        checkAlerts(normalized);
      }
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
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

  const currentMonth = new Date();
  const sourceName = getPreferredApi() === 'usgs' ? 'USGS' : 'PHIVOLCS';
  const monthlyEarthquakes = earthquakes.filter(eq => {
    const datePart = eq.datetime.split(' - ')[0]?.trim();
    if (!datePart) return false;

    const parsedDate = parse(datePart, 'd MMMM yyyy', new Date());
    return isValid(parsedDate) && isSameMonth(parsedDate, currentMonth);
  });

  if (loading) {
    return (
      <FunFactLoader
        title={`Connecting to ${sourceName}...`}
        subtitle="Fetching real-time seismic data"
        icon={<Shield size={28} className="spinner-icon" />}
      />
    );
  }

  if (earthquakes.length === 0) return (
    <div className="container flex-center" style={{ height: '50vh', flexDirection: 'column', gap: '16px' }}>
      <Shield size={48} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
      <h2>Connecting to {sourceName}...</h2>
      <p className="text-muted">The data source is temporarily unavailable. Retrying automatically.</p>
      <button
        className="dash-refresh-btn"
        onClick={loadData}
        disabled={syncing}
        style={{ padding: '10px 24px', borderRadius: '12px', fontSize: '0.9rem', cursor: 'pointer', background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)' }}
      >
        <RefreshCw size={16} className={syncing ? 'spin' : ''} style={{ marginRight: '8px', display: 'inline' }} />
        {syncing ? 'Retrying...' : 'Retry Now'}
      </button>
    </div>
  );

  const latestEq = earthquakes[0];

  return (
    <div className="dashboard-container container">
      {/* ── Status Bar ── */}
      <div className="dash-status-bar">
        <div className="dash-status-left">
          <h1 className="dash-page-title">Dashboard</h1>
          <span className="dash-subtitle text-muted">{sourceName === 'USGS' ? 'Global earthquake monitoring — live data from USGS' : 'Philippine earthquake monitoring — live data from PHIVOLCS'}</span>
        </div>
        <div className="dash-status-right">
          <div className={`dash-live-indicator ${syncing ? 'syncing' : ''}`}>
            <Radio size={14} />
            <span>{syncing ? 'SYNCING' : 'LIVE'}</span>
          </div>
          {lastSync && (
            <span className="dash-sync-time text-muted">
              {lastSync.toLocaleTimeString()}
            </span>
          )}
          <button className="dash-refresh-btn" onClick={loadData} disabled={syncing} title="Refresh data">
            <RefreshCw size={16} className={syncing ? 'spin' : ''} />
          </button>
        </div>
      </div>



      {/* ── Hero: Latest + Map side by side ── */}
      <div className="dash-hero-row">
        <LatestEarthquake earthquake={latestEq} />
        <InteractiveMap earthquakes={monthlyEarthquakes} latestEarthquake={latestEq} autoCenter={true} disableDragging={true} />
      </div>

      {/* ── Summary Cards + Chart ── */}
      <SummaryCards recent={earthquakes} significant={sigEarthquakes} />

      {/* ── Activity Feed (full-width below) ── */}
      <ActivityFeed earthquakes={earthquakes.slice(0, 5)} />

      {/* ── News Feed ── */}
      <NewsFeed limit={4} />
    </div>
  );
}
