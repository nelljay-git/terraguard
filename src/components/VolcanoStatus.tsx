import { useEffect, useState, useCallback } from 'react';
import { fetchVolcanoHub, alertColor, alertLabel, type VolcanoStatus } from '../api/volcano';
import { VolcanoDetailModal } from './VolcanoDetailModal';
import { Mountain, ExternalLink, RefreshCw } from 'lucide-react';
import './VolcanoStatus.css';

export function VolcanoStatus() {
  const [data, setData] = useState<VolcanoStatus[] | null>(null);
  const [issued, setIssued] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<VolcanoStatus | null>(null);

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
        {data.map((v) => {
          const hasBulletin = v.bid !== null && v.url && !v.url.endsWith('/bulletin/list-of-bulletin');
          if (!hasBulletin) {
            return (
              <div
                key={v.volcano}
                className="volcano-item"
                style={{ borderLeftColor: alertColor(v.alertLevel), cursor: 'default', opacity: 0.85 }}
                title="No bulletin available — showing latest alert level"
              >
                <div className="volcano-item-top">
                  <span className="volcano-name">{v.volcano}</span>
                  <span className="volcano-level" style={{ background: alertColor(v.alertLevel) }}>
                    {alertLabel(v.alertLevel)}
                  </span>
                </div>
                <div className="volcano-title text-muted">{v.title}</div>
                <span className="volcano-link" style={{ opacity: 0.6 }}>
                  No bulletin yet
                </span>
              </div>
            );
          }
          return (
            <button
              key={v.volcano}
              onClick={() => setSelected(v)}
              className="volcano-item"
              style={{ borderLeftColor: alertColor(v.alertLevel), textAlign: 'left', width: '100%', cursor: 'pointer' }}
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
            </button>
          );
        })}
      </div>
      <p className="volcano-foot text-muted">Source: DOST-PHIVOLCS • Updates every ~10 min</p>
      {selected && <VolcanoDetailModal volcano={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
