import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchVolcanoHub, alertColor, alertLabel, type VolcanoStatus } from '../api/volcano';
import { fetchTsunamiEvents } from '../api/tsunami';
import { VolcanoDetailModal } from './VolcanoDetailModal';
import { ShieldCheck, Waves, ChevronRight } from 'lucide-react';
import './HazardStrip.css';

/**
 * One-line mission-control hazard strip merging the two slow-changing hazard
 * feeds (volcano + tsunami) into compact chips. Scrolls horizontally on
 * narrow screens. Data is cached upstream (10 min), so this is cheap.
 */
export function HazardStrip() {
  const [volcanoes, setVolcanoes] = useState<VolcanoStatus[] | null>(null);
  const [tsunamiCount, setTsunamiCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<VolcanoStatus | null>(null);

  const load = useCallback(async () => {
    const [vRes, tRes] = await Promise.allSettled([fetchVolcanoHub(), fetchTsunamiEvents()]);
    if (vRes.status === 'fulfilled') setVolcanoes(vRes.value.success ? vRes.value.data : null);
    if (tRes.status === 'fulfilled') setTsunamiCount(tRes.value.success ? tRes.value.data.length : null);
    if (vRes.status === 'rejected' && tRes.status === 'rejected') {
      setLoadError('Hazard feeds unavailable');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loading = volcanoes === null && tsunamiCount === null && !loadError;

  return (
    <div className="hazard-strip" role="region" aria-label="Hazard status">
      <span className="hazard-strip-label"><ShieldCheck size={14} /> Hazards</span>

      {loading && (
        <>
          <span className="hazard-shimmer" />
          <span className="hazard-shimmer" />
          <span className="hazard-shimmer" />
        </>
      )}

      {!loading && volcanoes?.map(v => (
        <button
          key={v.volcano}
          type="button"
          className="hazard-chip"
          title={`${v.volcano} — ${v.title || alertLabel(v.alertLevel)}`}
          onClick={() => setSelected(v)}
        >
          <span className="hazard-chip-dot" style={{ background: alertColor(v.alertLevel), color: alertColor(v.alertLevel) }} />
          <span className="hazard-chip-name">{v.volcano}</span>
          <span className="hazard-chip-value">{alertLabel(v.alertLevel)}</span>
        </button>
      ))}

      {!loading && volcanoes === null && (
        <span className="hazard-chip hazard-chip--muted" title={loadError}>Volcano data unavailable</span>
      )}

      <span className="hazard-divider" aria-hidden="true" />

      {!loading && tsunamiCount !== null && (
        <Link
          to="/tsunami"
          className={`hazard-chip ${tsunamiCount === 0 ? 'hazard-chip--ok' : 'hazard-chip--warn'}`}
          title={tsunamiCount === 0 ? 'No PHIVOLCS tsunami bulletins this year' : `${tsunamiCount} tsunami bulletin(s) issued this year — open Tsunami page`}
        >
          <Waves size={13} />
          <span className="hazard-chip-name">Tsunami</span>
          <span className="hazard-chip-value">{tsunamiCount === 0 ? 'All clear' : `${tsunamiCount} this year`}</span>
          <ChevronRight size={12} />
        </Link>
      )}

      {!loading && tsunamiCount === null && (
        <Link to="/tsunami" className="hazard-chip hazard-chip--muted" title="Tsunami details unavailable — open the Tsunami page">
          <Waves size={13} />
          <span className="hazard-chip-name">Tsunami</span>
          <span className="hazard-chip-value">unavailable</span>
        </Link>
      )}

      {selected && <VolcanoDetailModal volcano={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
