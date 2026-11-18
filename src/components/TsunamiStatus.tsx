import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchTsunamiEvents, type TsunamiAdvisory, type TsunamiEvent } from '../api/tsunami';
import { getSeverityColor } from '../lib/utils';
import { TsunamiDetailModal } from './TsunamiDetailModal';
import { Waves, RefreshCw, ChevronRight, FileText } from 'lucide-react';
import './TsunamiStatus.css';

/** Latest advisory for an event = the highest-numbered one PHIVOLCS issued. */
function latestAdvisory(ev: TsunamiEvent): TsunamiAdvisory | null {
  if (!ev.advisories.length) return null;
  return [...ev.advisories].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))[ev.advisories.length - 1];
}

function formatEventDate(ev: TsunamiEvent): string {
  // PHIVOLCS renders e.g. "26 Sep 2026 - 05:23 AM" — show as-is (PHT).
  return ev.dateTimePST || ev.occurredAtPST || 'Unknown time';
}

export function TsunamiStatus() {
  const [events, setEvents] = useState<TsunamiEvent[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<TsunamiAdvisory | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = await fetchTsunamiEvents();
      if (res.success) setEvents(res.data);
      else setError(res.error || 'Failed to load tsunami bulletins');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="tsunami-card">
        <div className="tsunami-head">
          <div className="tsunami-head-left">
            <Waves size={18} />
            <h3>Tsunami Bulletins</h3>
          </div>
        </div>
        <div className="tsunami-skeleton">Fetching DOST-PHIVOLCS tsunami advisories…</div>
      </div>
    );
  }

  if (error && !events) {
    return (
      <div className="tsunami-card">
        <div className="tsunami-head">
          <div className="tsunami-head-left">
            <Waves size={18} />
            <h3>Tsunami Bulletins</h3>
          </div>
          <button className="tsunami-refresh" onClick={() => load(true)} aria-label="Retry">
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          </button>
        </div>
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>{error}</p>
      </div>
    );
  }

  const list = events ?? [];
  const year = new Date().getFullYear();

  return (
    <div className="tsunami-card">
      <div className="tsunami-head">
        <div className="tsunami-head-left">
          <Waves size={18} />
          <h3>Tsunami Bulletins</h3>
          <span className="tsunami-badge">PHIVOLCS-TSUNAMI</span>
        </div>
        <div className="tsunami-head-right">
          <span className="tsunami-count text-muted">{list.length} this year</span>
          <button className="tsunami-refresh" onClick={() => load(true)} title="Refresh" aria-label="Refresh">
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="tsunami-empty">
          <Waves size={28} strokeWidth={1.5} style={{ color: '#4ade80', opacity: 0.9 }} />
          <span><strong>All clear.</strong> No tsunami bulletins issued by PHIVOLCS in {year}.</span>
          <Link to="/tsunami" className="tsunami-item-adv" style={{ fontSize: '0.78rem' }}>
            Tsunami safety guide &amp; archive <ChevronRight size={13} />
          </Link>
        </div>
      ) : (
        <>
          <div className="tsunami-list">
            {list.slice(0, 3).map((ev) => {
              const latest = latestAdvisory(ev);
              const mag = ev.magnitude;
              return (
                <button
                  key={`${ev.occurredAtUtc}-${ev.location}`}
                  type="button"
                  className="tsunami-item"
                  style={{ borderLeftColor: mag != null ? getSeverityColor(mag) : undefined }}
                  onClick={() => latest && setSelected(latest)}
                  disabled={!latest}
                  title={latest ? `View advisory (${latest.label || 'Tsunami Information'})` : 'No advisory link for this event'}
                >
                  <span className="tsunami-item-mag" style={{ color: mag != null ? getSeverityColor(mag) : undefined }}>
                    {mag != null ? `M${mag.toFixed(1)}` : '—'}
                  </span>
                  <span className="tsunami-item-body">
                    <span className="tsunami-item-loc">{ev.location || 'Location not reported'}</span>
                    <span className="tsunami-item-meta">
                      <span>{formatEventDate(ev)}</span>
                      {ev.depth != null && <span>Depth {ev.depth} km</span>}
                    </span>
                  </span>
                  {latest && (
                    <span className="tsunami-item-adv">
                      <FileText size={12} />
                      {latest.number != null ? `Advisory No. ${latest.number}` : 'Advisory'}
                      {ev.advisories.length > 1 && ` (+${ev.advisories.length - 1})`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <Link to="/tsunami" className="tsunami-item-adv" style={{ alignSelf: 'flex-end' }}>
            View all bulletins &amp; safety guide <ChevronRight size={13} />
          </Link>
        </>
      )}
      <p className="tsunami-foot text-muted">Source: DOST-PHIVOLCS Tsunami • Updates ~10 min • Not an official alert channel — always follow PHIVOLCS/NDRRMC advisories</p>
      {selected && <TsunamiDetailModal advisory={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
