import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchVolcanoDetail, alertColor, alertLabel, type VolcanoStatus, type VolcanoDetail } from '../api/volcano';
import { ImageModal } from './ImageModal';
import { X, Mountain, ExternalLink, MapPin, Calendar, Activity, Maximize2, AlertTriangle, ShieldAlert, Info } from 'lucide-react';
import './VolcanoDetailModal.css';

function extractRecommendation(text: string) {
  // Try to isolate RECOMMENDATION/COMMENT ... Location of ...
  const m = text.match(/RECOMMENDATION\/COMMENT\s*([\s\S]+?)(?=\s*Location of\s+\w+\s+Volcano:|\s*Additional information on the website:|\s*Department of Science and Technology|\s*Philippine Institute|$)/i);
  const block = m ? m[1].trim() : '';
  if (!block) return null;
  // Split into "Should not be allowed" and "Reminder"
  const parts = block.split(/Reminder|Paalala/i);
  const prohibitedRaw = parts[0] || '';
  const reminderRaw = parts[1] || '';
  const clean = (s: string) =>
    s
      .replace(/Should not be allowed/gi, '')
      .replace(/Possible hazards that can occur:/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  const toBullets = (s: string) =>
    clean(s)
      .split(/Entry into|Flying any aircraft|Sudden steam|Rockfalls|Lahars|•/i)
      .map((t) => t.trim())
      .filter((t) => t.length > 8 && !/Should not be allowed/i.test(t))
      .map((t) => t.replace(/^[-–•]\s*/, '').trim())
      .slice(0, 8);
  // Fallback simple split by sentence if bullets fail
  let prohibited: string[] = [];
  let reminder: string[] = [];
  if (/Entry into/i.test(prohibitedRaw)) {
    const segs = prohibitedRaw.split(/Entry into|Flying any aircraft/i);
    if (segs[1]) prohibited.push('Entry into ' + segs[1].trim().split(/Flying/i)[0].trim());
    if (/Flying any aircraft/i.test(prohibitedRaw)) {
      const f = prohibitedRaw.match(/Flying any aircraft[^.]+/i);
      if (f) prohibited.push(f[0].trim());
    }
  }
  if (!prohibited.length) prohibited = toBullets(prohibitedRaw).slice(0, 2);
  if (/Sudden steam|Rockfalls|Lahars/i.test(reminderRaw)) {
    const r1 = reminderRaw.match(/Sudden steam[^.]+/i);
    const r2 = reminderRaw.match(/Rockfalls[^.]+/i);
    const r3 = reminderRaw.match(/Lahars[^.]+/i);
    if (r1) reminder.push(r1[0].trim());
    if (r2) reminder.push(r2[0].trim());
    if (r3) reminder.push(r3[0].trim());
  }
  if (!reminder.length) reminder = toBullets(reminderRaw);
  // Dedupe and limit
  prohibited = [...new Set(prohibited)].slice(0, 3);
  reminder = [...new Set(reminder)].slice(0, 5);
  if (!prohibited.length && !reminder.length) return null;
  return { prohibited, reminder, raw: block };
}

function locationFromText(text: string) {
  const m = text.match(/Location of\s+\w+\s+Volcano:\s*([^\n]+)/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

export function VolcanoDetailModal({ volcano, onClose }: { volcano: VolcanoStatus; onClose: () => void }) {
  const [detail, setDetail] = useState<VolcanoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetchVolcanoDetail(volcano.url).then(res => {
      if (cancelled) return;
      if (res.success) setDetail(res.data);
      else setError(res.error || 'Failed to load bulletin');
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
  }, [volcano.url, onClose]);

  const mapImg = detail?.links.find(l => /bulletinMap\//i.test(l));

  const modal = (
    <div className="volc-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="volc-modal" onClick={e => e.stopPropagation()}>
        <button className="volc-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>

        <div className="volc-modal-head">
          <div className="volc-modal-title-row">
            <Mountain size={18} />
            <h3>{detail?.title || volcano.volcano + ' Volcano'}</h3>
            <span className="volcano-level" style={{ background: alertColor(detail?.alertLevel ?? volcano.alertLevel) }}>
              {alertLabel(detail?.alertLevel ?? volcano.alertLevel)}
            </span>
          </div>
          <div className="volc-modal-meta text-muted">
            <span className="volc-meta-item"><Calendar size={12} /> {detail?.issued || '—'}{volcano.bid ? ` · BID ${volcano.bid}` : ''}</span>
            <span className="volc-meta-item"><MapPin size={12} /> Province of {volcano.volcano === 'MAYON' ? 'Albay' : volcano.volcano === 'TAAL' ? 'Batangas' : volcano.volcano === 'KANLAON' ? 'Negros' : volcano.volcano === 'BULUSAN' ? 'Sorsogon' : 'Zambales'}</span>
          </div>
        </div>

        {loading && <div className="volc-modal-loading">Loading {volcano.volcano} bulletin…</div>}
        {error && !loading && (
          <div className="volc-modal-error">
            <p className="text-muted">{error}</p>
            <a href={volcano.url} target="_blank" rel="noopener noreferrer" className="volc-external-btn">
              Open on PHIVOLCS <ExternalLink size={12} />
            </a>
          </div>
        )}

        {detail && !loading && !error && (
          <>
            {mapImg && (
              <>
                <button
                  type="button"
                  className="volc-modal-map volc-map-clickable"
                  onClick={() => setMapOpen(true)}
                  aria-label="Enlarge bulletin map"
                  title="Click to enlarge map"
                >
                  <img src={mapImg} alt={`${volcano.volcano} bulletin map`} loading="lazy" />
                  <span className="volc-map-enlarge"><Maximize2 size={14} /> Click to enlarge</span>
                  <span className="volc-map-caption text-muted">Source: DOST-PHIVOLCS bulletinMap · {detail.issued}</span>
                </button>
                <ImageModal isOpen={mapOpen} onClose={() => setMapOpen(false)} imageUrl={mapImg} altText={`${volcano.volcano} bulletin map — ${detail.issued}`} />
              </>
            )}

            <div className="volc-params">
              <h4><Activity size={14} /> Parameters</h4>
              {Object.keys(detail.parametros).length === 0 ? (
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>No parameter breakdown available for this bulletin.</p>
              ) : (
                <div className="volc-params-list">
                  {(
                    [
                      ['seismicity', 'Seismicity', '7 volcanic'],
                      ['craterGlow', 'Crater glow', 'Eye'],
                      ['so2', 'Sulfur Dioxide Flux', 'SO₂'],
                      ['plume', 'Plume', 'Wind'],
                      ['groundDeformation', 'Ground Deformation', 'Mountain'],
                    ] as const
                  ).map(([k, label]) => {
                    const v = detail.parametros[k];
                    if (!v) return null;
                    return (
                      <div key={k} className="volc-param-card">
                        <div className="volc-param-label">{label}</div>
                        <div className="volc-param-value">{v}</div>
                      </div>
                    );
                  })}
                  {Object.entries(detail.parametros)
                    .filter(([k]) => !['seismicity', 'craterGlow', 'so2', 'plume', 'groundDeformation', 'eruption', 'activity'].includes(k))
                    .map(([k, v]) => (
                      <div key={k} className="volc-param-card">
                        <div className="volc-param-label">{k}</div>
                        <div className="volc-param-value">{String(v)}</div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {(() => {
              const rec = detail ? extractRecommendation(detail.text) : null;
              const loc = detail ? locationFromText(detail.text) : '';
              if (!rec && !loc) return null;
              return (
                <div className="volc-rec">
                  <h4><ShieldAlert size={14} /> Advisory</h4>
                  {rec?.prohibited?.length ? (
                    <div className="volc-rec-block volc-rec-prohibited">
                      <div className="volc-rec-title"><AlertTriangle size={13} /> Should not be allowed</div>
                      <ul>{rec.prohibited.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    </div>
                  ) : null}
                  {rec?.reminder?.length ? (
                    <div className="volc-rec-block volc-rec-reminder">
                      <div className="volc-rec-title"><Info size={13} /> Possible hazards</div>
                      <ul>{rec.reminder.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    </div>
                  ) : null}
                  {loc && <div className="volc-rec-loc"><MapPin size={12} /> Location: {loc}</div>}
                </div>
              );
            })()}

            <details className="volc-raw-details">
              <summary>Full bulletin text</summary>
              <div className="volc-detail-text"><p>{detail.text.slice(0, 4000)}</p></div>
            </details>

            <div className="volc-modal-actions">
              <a href={volcano.url} target="_blank" rel="noopener noreferrer" className="volc-external-btn">
                View original on PHIVOLCS-LAVA <ExternalLink size={14} />
              </a>
              <button className="volc-close-btn" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
