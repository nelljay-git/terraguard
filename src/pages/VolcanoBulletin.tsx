import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { fetchVolcanoDetail, alertColor, alertLabel } from '../api/volcano';
import type { VolcanoDetail } from '../api/volcano';
import { ArrowLeft, ExternalLink, Mountain, Calendar, MapPin, Activity, FileText } from 'lucide-react';
import './VolcanoBulletin.css';

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
    <div className="vb container">
      <button onClick={() => navigate(-1)} className="vb-back">
        <ArrowLeft size={16} aria-hidden="true" /> Back
      </button>

      <article className="vb-masthead">
        <div className="vb-masthead-row">
          <Mountain size={26} aria-hidden="true" className="vb-volcano-icon" />
          <div className="vb-masthead-text">
            <span className="vb-kicker">PHIVOLCS bulletin{bid ? ` · BID ${bid}` : ''}</span>
            <h1 className="vb-title">{detail?.title || `${volcano} Volcano`}</h1>
          </div>
          <span className="volcano-level vb-alert" style={{ background: alertColor(detail?.alertLevel ?? null) }}>
            {alertLabel(detail?.alertLevel ?? null)}
          </span>
        </div>
        <div className="vb-meta">
          <span className="vb-meta-item"><Calendar size={13} aria-hidden="true" /> Issued: {detail?.issued || '—'}</span>
          <span className="vb-meta-item vb-meta-url"><MapPin size={13} aria-hidden="true" /> {wovodatUrl}</span>
        </div>
      </article>

      {loading && (
        <div className="vb-loading" role="status">Loading bulletin…</div>
      )}

      {error && !loading && (
        <div className="vb-error">
          <p className="vb-error-text">{error}</p>
          <p className="vb-error-url">Tried: {wovodatUrl}</p>
          <a href={wovodatUrl} target="_blank" rel="noopener noreferrer" className="vb-cta">
            Open on PHIVOLCS <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      )}

      {detail && !loading && !error && (
        <div className="vb-grid">
          {/* ── Left rail: map + parameters ── */}
          <div className="vb-rail">
            {mapImg && (
              <figure className="vb-map">
                <img src={mapImg} alt={`${volcano} bulletin map`} />
                <figcaption>Source: DOST-PHIVOLCS bulletinMap · {detail.issued}</figcaption>
              </figure>
            )}

            <section className="vb-panel" aria-labelledby="vb-params-title">
              <h2 id="vb-params-title" className="vb-panel-title">
                <Activity size={16} aria-hidden="true" /> Parameters
              </h2>
              {Object.keys(detail.parametros).length === 0 ? (
                <p className="vb-panel-empty">No parameter breakdown available — see full bulletin text.</p>
              ) : (
                <table className="vb-params">
                  <tbody>
                    {Object.entries({
                      seismicity: 'Seismicity',
                      craterGlow: 'Crater glow',
                      so2: 'Sulfur Dioxide Flux',
                      plume: 'Plume',
                      groundDeformation: 'Ground Deformation',
                      eruption: 'Eruption',
                      activity: 'Activity',
                    }).map(([k, label]) => {
                      const v = detail.parametros[k];
                      if (!v) return null;
                      return (
                        <tr key={k}>
                          <th scope="row">{label}</th>
                          <td>{v}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {/* ── Full bulletin text ── */}
          <section className="vb-panel vb-text-panel" aria-labelledby="vb-text-title">
            <h2 id="vb-text-title" className="vb-panel-title">
              <FileText size={16} aria-hidden="true" /> Bulletin text
            </h2>
            <div className="vb-text">
              {detail.text.slice(0, 6000)}
            </div>
            <div className="vb-footer">
              <a href={wovodatUrl} target="_blank" rel="noopener noreferrer" className="vb-cta">
                View original on PHIVOLCS-LAVA <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
