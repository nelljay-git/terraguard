import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { fetchVolcanoDetail, alertColor, alertLabel } from '../api/volcano';
import type { VolcanoDetail } from '../api/volcano';
import { ArrowLeft, ExternalLink, Mountain, Calendar, MapPin, Activity } from 'lucide-react';
import '../components/VolcanoDetailModal.css';

export function VolcanoBulletin() {
  const location = useLocation();
  const navigate = useNavigate();
  const wovodatUrl = `https://wovodat.phivolcs.dost.gov.ph${location.pathname}${location.search}`;
  const [detail, setDetail] = useState<VolcanoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Derive volcano code from pathname: /bulletin/activity-mvo -> mvo
  const m = /activity-([a-z]+)/i.exec(location.pathname);
  const code = m ? m[1].toLowerCase() : '';
  const map: Record<string, string> = { tvo: 'TAAL', kvo: 'KANLAON', bvo: 'BULUSAN', mvo: 'MAYON', pvo: 'PINATUBO' };
  const volcano = code && map[code] ? map[code] : 'Volcano';
  const bid = new URLSearchParams(location.search).get('bid') || '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetchVolcanoDetail(wovodatUrl).then(res => {
      if (cancelled) return;
      if (res.success) setDetail(res.data);
      else setError(res.error || 'Failed to load bulletin');
      setLoading(false);
    }).catch(e => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [wovodatUrl]);

  const mapImg = detail?.links.find(l => /bulletinMap\//i.test(l));

  return (
    <div className="container" style={{ padding: '24px 0', maxWidth: 720 }}>
      <button onClick={() => navigate(-1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)', padding: '8px 12px', borderRadius: 10, cursor: 'pointer' }}>
        <ArrowLeft size={14} /> Back
      </button>

      <div className="glass" style={{ padding: 22, borderRadius: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Mountain size={18} />
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{detail?.title || `${volcano} Volcano`}</h2>
          <span className="volcano-level" style={{ background: alertColor(detail?.alertLevel ?? null) }}>{alertLabel(detail?.alertLevel ?? null)}</span>
        </div>
        <div className="text-muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.75rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Calendar size={12} /> {detail?.issued || '—'}{bid ? ` · BID ${bid}` : ''}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> {wovodatUrl}</span>
        </div>

        {loading && <div style={{ padding: 24, textAlign: 'center' }} className="text-muted">Loading bulletin…</div>}
        {error && !loading && (
          <div style={{ padding: 24, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 14 }}>
            <p className="text-muted">{error}</p>
            <p style={{ fontSize: '0.8rem' }} className="text-muted">Tried: {wovodatUrl}</p>
            <a href={wovodatUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '9px 14px', borderRadius: 10, background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)', textDecoration: 'none' }}>
              Open on PHIVOLCS <ExternalLink size={12} />
            </a>
          </div>
        )}

        {detail && !loading && !error && (
          <>
            {mapImg && (
              <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                <img src={mapImg} alt={`${volcano} bulletin map`} style={{ width: '100%', display: 'block' }} />
                <span className="text-muted" style={{ display: 'block', padding: '8px 10px', fontSize: '0.7rem' }}>Source: DOST-PHIVOLCS bulletinMap · {detail.issued}</span>
              </div>
            )}

            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={14} /> Parameters</h4>
              {Object.keys(detail.parametros).length === 0 ? (
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>No parameter breakdown available. See full text below.</p>
              ) : (
                <table className="volc-params-tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <tbody>
                    {Object.entries({ seismicity: 'Seismicity', craterGlow: 'Crater glow', so2: 'Sulfur Dioxide Flux', plume: 'Plume', groundDeformation: 'Ground Deformation', eruption: 'Eruption', activity: 'Activity' }).map(([k, label]) => {
                      const v = detail.parametros[k];
                      if (!v) return null;
                      return <tr key={k}><td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 700, width: 160, color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)' }}>{label}</td><td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{v}</td></tr>;
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-secondary)', maxHeight: 400, overflow: 'auto', padding: 12, background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)', whiteSpace: 'pre-wrap' }}>
              {detail.text.slice(0, 6000)}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <a href={wovodatUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)', textDecoration: 'none', fontSize: '0.82rem', fontWeight: 600 }}>
                View original on PHIVOLCS-LAVA <ExternalLink size={14} />
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
