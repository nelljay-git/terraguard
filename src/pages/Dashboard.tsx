import { useEffect, useState, useCallback } from 'react';
import { parse, isValid, isSameMonth } from 'date-fns';
import { fetchPhivolcsData, getSignificantEarthquakes, getCachedData, type PhivolcsEarthquake } from '../api/phivolcs';
import { SummaryCards } from '../components/SummaryCards';
import { LatestEarthquake } from '../components/LatestEarthquake';
import { InteractiveMap } from '../components/InteractiveMap';
import { ActivityFeed } from '../components/ActivityFeed';
import { NewsFeed } from '../components/NewsFeed';
import { Radio, RefreshCw, Shield, Bell, BellOff } from 'lucide-react';
import './Dashboard.css';

export function Dashboard() {
  // Try to load cached data instantly so the user sees something right away
  const initialCache = getCachedData();
  const [earthquakes, setEarthquakes] = useState<PhivolcsEarthquake[]>(initialCache?.data ?? []);
  const [sigEarthquakes, setSigEarthquakes] = useState<PhivolcsEarthquake[]>(
    initialCache?.data ? getSignificantEarthquakes(initialCache.data) : []
  );
  const [loading, setLoading] = useState(!initialCache?.data?.length);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    if ('Notification' in window) {
      setNotificationsEnabled(Notification.permission === 'granted' && localStorage.getItem('terraguard_notifications_muted') !== 'true');
    }
  }, []);

  const toggleNotifications = async () => {
    if (!('Notification' in window)) {
      alert('This browser does not support desktop notifications.');
      return;
    }
    
    if (notificationsEnabled) {
      localStorage.setItem('terraguard_notifications_muted', 'true');
      setNotificationsEnabled(false);
    } else {
      if (Notification.permission === 'granted') {
        localStorage.removeItem('terraguard_notifications_muted');
        setNotificationsEnabled(true);
      } else if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          localStorage.removeItem('terraguard_notifications_muted');
          setNotificationsEnabled(true);
        }
      } else {
        alert('Notifications are blocked by your browser. Please enable them in your settings.');
      }
    }
  };

  const loadData = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetchPhivolcsData();
      if (res.data.length > 0) {
        const latestEq = res.data[0];
        const latestEqId = `${latestEq.datetime}-${latestEq.latitude}-${latestEq.longitude}`;
        const notifiedEqId = localStorage.getItem('terraguard_last_notified_eq');
        const isMuted = localStorage.getItem('terraguard_notifications_muted') === 'true';

        // Check if there's a new earthquake and it's not the first load
        if (notifiedEqId && notifiedEqId !== latestEqId && !isMuted) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('New Earthquake Detected!', {
              body: `Magnitude ${latestEq.magnitude} • ${latestEq.location}`,
              icon: '/favicon.ico'
            });
          }
        }

        // Always update the tracked ID to prevent loops
        if (notifiedEqId !== latestEqId) {
          localStorage.setItem('terraguard_last_notified_eq', latestEqId);
        }

        setEarthquakes(res.data);
        setSigEarthquakes(getSignificantEarthquakes(res.data));
        setLastSync(new Date());
      }
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadData]);

  const currentMonth = new Date();
  const monthlyEarthquakes = earthquakes.filter(eq => {
    const datePart = eq.datetime.split(' - ')[0]?.trim();
    if (!datePart) return false;

    const parsedDate = parse(datePart, 'd MMMM yyyy', new Date());
    return isValid(parsedDate) && isSameMonth(parsedDate, currentMonth);
  });

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner">
          <div className="spinner-ring"></div>
          <Shield size={28} className="spinner-icon" />
        </div>
        <p className="loading-text">Connecting to PHIVOLCS...</p>
        <p className="loading-sub">Fetching real-time seismic data</p>
      </div>
    );
  }

  if (earthquakes.length === 0) return (
    <div className="container flex-center" style={{ height: '50vh', flexDirection: 'column', gap: '16px' }}>
      <Shield size={48} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
      <h2>Connecting to PHIVOLCS...</h2>
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
          <span className="dash-subtitle text-muted">Philippine earthquake monitoring — live data from PHIVOLCS</span>
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
          <button 
            className={`dash-refresh-btn ${notificationsEnabled ? 'active' : ''}`} 
            onClick={toggleNotifications} 
            title={notificationsEnabled ? 'Mute notifications' : 'Enable notifications'}
            style={{ color: notificationsEnabled ? '#10b981' : undefined }}
          >
            {notificationsEnabled ? <Bell size={16} /> : <BellOff size={16} />}
          </button>
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
