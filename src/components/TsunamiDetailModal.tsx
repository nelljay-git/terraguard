import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  fetchTsunamiDetail,
  threatColor,
  threatLabel,
  formatCoordinates,
  type TsunamiAdvisory,
  type TsunamiAdvisoryDetail,
} from '../api/tsunami';
import { X, Waves, ExternalLink, MapPin, Calendar, Activity, ShieldAlert, Info, AlertTriangle, FileText } from 'lucide-react';
import './TsunamiDetailModal.css';

export function TsunamiDetailModal({ advisory, onClose }: { advisory: TsunamiAdvisory; onClose: () => void }) {
  const [detail, setDetail] = useState<TsunamiAdvisoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchTsunamiDetail(advisory.url).then(res => {
      if (cancelled) return;
      if (res.success) setDetail(res.data);
      else setError(res.error || 'Failed to load advisory');
      setLoading(false);
    }).catch(e => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => { cancelled = true; document.removeEventListener('keydown', onEsc); document.body.style.overflow = ''; };
  }, [advisory.url, onClose]);

  const threat = detail?.threat;
  const color = threatColor(threat);
  const label = threatLabel(threat);
  const coords = detail ? formatCoordinates(detail.latitude, detail.longitude) : '';
  const occurred = detail?.occurredAtUtc
    ? new Date(detail.occurredAtUtc).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
    : '';

  const modal = (
    <div className="tsun-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Tsunami advisory">
      <div className="tsun-modal" onClick={e => e.stopPropagation()}>
        <button className="tsun-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>

        <div className="tsun-modal-head">
          <div className="tsun-modal-title-row">
            <Waves size={18} aria-hidden="true" />
            <h3>{advisory.number != null ? `TSUNAMI INFORMATION NO. ${advisory.number}` : 'Tsunami Advisory'}</h3>
            {detail && !detail.isPdf && (
              <span className="tsun-threat-badge" style={{ background: color }}>{label}</span>
            )}
          </div>
          <div className="tsun-modal-meta text-muted">
            {detail?.issuedAt && <span className="tsun-meta-item"><Calendar size={12} /> Issued: {detail.issuedAt}</span>}
            {detail?.issuedBy && <span className="tsun-meta-item"><MapPin size={12} /> {detail.issuedBy}</span>}
          </div>
        </div>

        {loading && <div className="tsun-modal-loading">Loading advisory…</div>}

        {error && !loading && (
          <div className="tsun-modal-error">
            <p className="text-muted">{error}</p>
            <a href={advisory.url} target="_blank" rel="noopener noreferrer" className="tsun-external-btn" style={{ marginTop: 10 }}>
              Open on PHIVOLCS <ExternalLink size={12} />
            </a>
          </div>
        )}

        {!loading && detail?.isPdf && (
          <>
            <div className="tsun-verdict" style={{ borderColor: 'rgba(59,130,246,0.35)' }}>
              <div className="tsun-verdict-title" style={{ color: '#60a5fa' }}><FileText size={16} /> Advisory published as PDF</div>
              <div className="tsun-verdict-sub">{detail.note || 'PHIVOLCS published this advisory as a PDF. Open it to read the full bulletin.'}</div>
            </div>
            <div className="tsun-modal-actions">
              <a href={advisory.url} target="_blank" rel="noopener noreferrer" className="tsun-external-btn">Open advisory PDF <ExternalLink size={14} /></a>
              <button className="tsun-close-btn" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {detail && !loading && !error && !detail.isPdf && (
          <>
            <div className="tsun-verdict" style={{ background: `${color}1a`, borderColor: `${color}55` }}>
              <div className="tsun-verdict-title" style={{ color }}>
                <Waves size={16} /> {detail.headline || label}
              </div>
              <div className="tsun-verdict-sub">
                {detail.evaluation
                  ? detail.evaluation.slice(0, 320) + (detail.evaluation.length > 320 ? '…' : '')
                  : 'Official PHIVOLCS tsunami bulletin for this event.'}
              </div>
            </div>

            <div className="tsun-params">
              <h4><Activity size={14} /> Earthquake Parameters</h4>
              <div className="tsun-params-list">
                {detail.magnitude != null && (
                  <div className="tsun-param-card">
                    <div className="tsun-param-label">Magnitude</div>
                    <div className="tsun-param-value">M {detail.magnitude.toFixed(1)}</div>
                  </div>
                )}
                {detail.depth != null && (
                  <div className="tsun-param-card">
                    <div className="tsun-param-label">Depth</div>
                    <div className="tsun-param-value">{detail.depth} km</div>
                  </div>
                )}
                {detail.location && (
                  <div className="tsun-param-card" style={{ gridColumn: 'span 2' }}>
                    <div className="tsun-param-label">Location</div>
                    <div className="tsun-param-value">{detail.location}</div>
                  </div>
                )}
                {coords && (
                  <div className="tsun-param-card" style={{ gridColumn: 'span 2' }}>
                    <div className="tsun-param-label">Coordinates</div>
                    <div className="tsun-param-value">{coords}</div>
                  </div>
                )}
                {occurred && (
                  <div className="tsun-param-card" style={{ gridColumn: 'span 2' }}>
                    <div className="tsun-param-label">Date &amp; Time</div>
                    <div className="tsun-param-value">{occurred}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="tsun-rec">
              <h4><ShieldAlert size={14} /> PHIVOLCS Bulletin</h4>
              {detail.evaluation && (
                <div className="tsun-rec-block tsun-rec-evaluation">
                  <div className="tsun-rec-title"><Info size={13} /> Evaluation</div>
                  <p>{detail.evaluation}</p>
                </div>
              )}
              {detail.recommendedAction && (
                <div className="tsun-rec-block tsun-rec-action">
                  <div className="tsun-rec-title"><AlertTriangle size={13} /> Recommended Action</div>
                  <p>{detail.recommendedAction}</p>
                </div>
              )}
              {detail.important && (
                <div className="tsun-rec-block tsun-rec-important">
                  <div className="tsun-rec-title"><AlertTriangle size={13} /> Important</div>
                  <p>{detail.important}</p>
                </div>
              )}
            </div>

            <div className="tsun-modal-actions">
              <a href={advisory.url} target="_blank" rel="noopener noreferrer" className="tsun-external-btn">
                View original advisory <ExternalLink size={14} />
              </a>
              <button className="tsun-close-btn" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
