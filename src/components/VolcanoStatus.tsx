import { useEffect, useState, useCallback } from 'react';
import { fetchVolcanoHub, alertColor, alertLabel, type VolcanoStatus } from '../api/volcano';
import { Mountain, ExternalLink, RefreshCw } from 'lucide-react';
import './VolcanoStatus.css';

export function VolcanoStatus() {
  const [data, setData] = useState<VolcanoStatus[] | null>(null);
  const [issued, setIssued] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = await fetchVolcanoHub();
      if (res.success) {
        setData(res.data);
        setIssued(res.issued);
      } else {
        setError(res.error || 'Failed to load volcano status');
      }
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
      <div className="volcano-card glass">
        <div className="volcano-head">
          <Mountain size={18} />
          <h3>Volcano Status</h3>
          <span className="volcano-issued text-muted">Loading…</span>
        </div>
        <div className="volcano-skeleton">Fetching PHIVOLCS-LAVA…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="volcano-card glass">
        <div className="volcano-head">
          <Mountain size={18} />
          <h3>Volcano Status</h3>
          <button className="volcano-refresh" onClick={() => load(true)} aria-label="Retry"><RefreshCw size={14} className={refreshing ? 'spin' : ''} /></button>
        </div>
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="volcano-card glass">
      <div className="volcano-head">
        <div className="volcano-head-left">
          <Mountain size={18} />
          <h3>Volcano Status</h3>
          <span className="volcano-badge">PHIVOLCS-LAVA</span>
        </div>
        <div className="volcano-head-right">
          {issued && <span className="volcano-issued text-muted">{issued}</span>}
          <button className="volcano-refresh" onClick={() => load(true)} title="Refresh" aria-label="Refresh">
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="volcano-grid">
        {data.map((v) => (
          <a
            key={v.volcano}
            href={v.url}
            target="_blank"
            rel="noopener noreferrer"
            className="volcano-item"
            style={{ borderLeftColor: alertColor(v.alertLevel) }}
          >
            <div className="volcano-item-top">
              <span className="volcano-name">{v.volcano}</span>
              <span className="volcano-level" style={{ background: alertColor(v.alertLevel) }}>
                {alertLabel(v.alertLevel)}
              </span>
            </div>
            <div className="volcano-title text-muted">{v.title}</div>
            <span className="volcano-link">
              View bulletin <ExternalLink size={12} />
            </span>
          </a>
        ))}
      </div>
      <p className="volcano-foot text-muted">Source: DOST-PHIVOLCS • Updates every ~10 min</p>
    </div>
  );
}
