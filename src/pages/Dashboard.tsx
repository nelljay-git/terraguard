import { useEffect, useState, useCallback } from 'react';
import { parse, isValid, isSameMonth } from 'date-fns';
import { fetchEarthquakeData, getSignificantEarthquakes, getCachedData, normalizeEarthquakes, type NormalizedEarthquake } from '../api/phivolcs';
import { getPreferredApi, PREFERRED_API_CHANGE_EVENT } from '../lib/apiPreference';
import { SummaryCards } from '../components/SummaryCards';
import { LatestEarthquake } from '../components/LatestEarthquake';
import { InteractiveMap } from '../components/InteractiveMap';
import { ActivityFeed } from '../components/ActivityFeed';
import { NewsFeed } from '../components/NewsFeed';
import { VolcanoStatus } from '../components/VolcanoStatus';
import { Radio, RefreshCw, Shield, Clapperboard } from 'lucide-react';
import { FunFactLoader } from '../components/FunFactLoader';
import { checkAlerts } from '../lib/alertSystem';
import { DailyEarthReportModal } from '../components/DailyEarthReport';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
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
  const [showDaily, setShowDaily] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const { user } = useAuth();
  const isDailyAllowed = (user?.email?.toLowerCase() ?? '') === 'gianganwneljae@gmail.com';
  const triggerDaily = async () => {
    try {
      setTriggering(true);
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? '';
      if (!token) throw new Error('Not logged in');
      const res = await fetch('/api/trigger-daily', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) throw new Error(j.error || `HTTP ${res.status}`);
      alert('Daily report triggered — check Actions in ~10s');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setTriggering(false);
    }
  };
  const [preferredApi, setPreferredApi] = useState(() => getPreferredApi());

  useEffect(() => {
    const handler = () => setPreferredApi(getPreferredApi());
    window.addEventListener(PREFERRED_API_CHANGE_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(PREFERRED_API_CHANGE_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const prefDash = preferredApi;
  const sourceName = prefDash === 'usgs' ? 'USGS' : prefDash === 'emsc' ? 'EMSC' : 'PHIVOLCS';
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
          {isDailyAllowed && (
            <>
              <button
                className="dash-refresh-btn"
                onClick={() => setShowDaily(true)}
                title="Daily Earth Report (EMSC • UTC) — cinematic global scan"
                style={{ gap: '6px', padding: '8px 14px', fontSize: '0.82rem', fontWeight: 600 }}
              >
                <Clapperboard size={14} />
                <span>Daily Report</span>
              </button>
              <button
                className="dash-refresh-btn"
                onClick={triggerDaily}
                disabled={triggering}
                title="Trigger auto post now (no GitHub login needed)"
                style={{ gap: '6px', padding: '8px 14px', fontSize: '0.82rem', fontWeight: 600 }}
              >
                <Clapperboard size={14} />
                <span>{triggering ? 'Triggering…' : 'Test Auto Post'}</span>
              </button>
            </>
          )}
        </div>
      </div>
      {showDaily && isDailyAllowed && <DailyEarthReportModal onClose={() => setShowDaily(false)} />}



      {/* ── Hero: Latest + Map side by side ── */}
      <div className="dash-hero-row">
        <LatestEarthquake earthquake={latestEq} />
        <InteractiveMap earthquakes={monthlyEarthquakes} latestEarthquake={latestEq} autoCenter={true} disableDragging={true} />
      </div>

      {/* ── Summary Cards + Chart ── */}
      <SummaryCards recent={earthquakes} significant={sigEarthquakes} />

      {/* ── Volcano Status (PHIVOLCS-LAVA) — only for PHIVOLCS feed ── */}
      {prefDash === 'phivolcs' && <VolcanoStatus />}

      {/* ── Activity Feed (full-width below) ── */}
      <ActivityFeed earthquakes={earthquakes.slice(0, 5)} />

      {/* ── News Feed ── */}
      <NewsFeed limit={4} />
    </div>
  );
}
