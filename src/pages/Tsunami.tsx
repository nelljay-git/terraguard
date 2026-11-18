import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  fetchTsunamiEvents,
  fetchTsunamiArchive,
  fetchTsunamiDetail,
  type TsunamiAdvisory,
  type TsunamiEvent,
  type TsunamiAdvisoryDetail,
} from '../api/tsunami';
import { getSeverityColor } from '../lib/utils';
import { TsunamiDetailModal } from '../components/TsunamiDetailModal';
import {
  Waves, ShieldCheck, AlertTriangle, AlertOctagon,
  ExternalLink, RefreshCw, FileText, ArrowUp,
  CircleDot, Volume2, ChevronRight,
} from 'lucide-react';
import './Tsunami.css';

const ARCHIVE_YEARS = [2023, 2022, 2021, 2020] as const;

type ArchiveSel = 'current' | number;
type Status = 'loading' | 'warning' | 'all-clear' | 'unknown' | 'unavailable';

const TOC = [
  { id: 'tsunami-signs', num: '01', label: 'Natural warning signs' },
  { id: 'tsunami-act', num: '02', label: 'If you feel it' },
  { id: 'tsunami-reading', num: '03', label: 'Reading a PHIVOLCS bulletin' },
  { id: 'tsunami-archive', num: '04', label: 'Bulletin archive' },
  { id: 'tsunami-sources', num: '05', label: 'Official sources & numbers' },
  { id: 'tsunami-data', num: '06', label: 'Where this data comes from' },
] as const;

const ACTIVE_WINDOW_MS = 72 * 60 * 60 * 1000;

export function Tsunami() {
  const [events, setEvents] = useState<TsunamiEvent[]>([]);
  const [latestDetail, setLatestDetail] = useState<TsunamiAdvisoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [archiveSel, setArchiveSel] = useState<ArchiveSel>('current');
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<TsunamiAdvisory | null>(null);
  const [active, setActive] = useState<string>(TOC[0].id);
  const [showTop, setShowTop] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const load = useCallback(async (sel: ArchiveSel, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = sel === 'current' ? await fetchTsunamiEvents() : await fetchTsunamiArchive(sel);
      if (res.success) {
        setEvents(res.data);
        setLastChecked(new Date());
        // Fetch the newest advisory's verdict — best effort, cached upstream.
        if (sel === 'current' && res.data.length > 0) {
          const latestEvent = res.data[0];
          const newest = [...(latestEvent.advisories ?? [])].sort(
            (a, b) => (a.number ?? 0) - (b.number ?? 0)
          )[latestEvent.advisories.length - 1];
          if (newest) {
            const det = await fetchTsunamiDetail(newest.url);
            setLatestDetail(det.success ? det.data : null);
          }
        }
      } else {
        setError(res.error || 'The PHIVOLCS bulletin source is unreachable right now');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(archiveSel); }, [archiveSel, load]);

  const onScroll = useCallback(() => setShowTop(window.scrollY > 480), []);
  useEffect(() => {
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const targets = TOC.map(t => document.getElementById(t.id)).filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
    }, { rootMargin: '-10% 0px -65% 0px', threshold: 0 });
    targets.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const handleTopClick = () => {
    const smooth = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches;
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  };

  const year = new Date().getFullYear();
  const isArchive = archiveSel !== 'current';
  const list = events;
  const latestEvent = list[0] ?? null;
  const latestAdvisory = latestEvent?.advisories.length
    ? [...latestEvent.advisories].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))[latestEvent.advisories.length - 1]
    : null;
  const totalAdvisories = list.reduce((acc, ev) => acc + ev.advisories.length, 0);

  // Honest status — never "all clear" from a silent failure.
  let status: Status;
  if (!isArchive) {
    if (loading && list.length === 0) status = 'loading';
    else if (error) status = 'unavailable';
    else if (latestDetail) {
      const t = (latestDetail.threat || '').toLowerCase();
      const occurred = Date.parse(latestDetail.occurredAtUtc || '');
      const fresh = Number.isFinite(occurred) && Date.now() - occurred < ACTIVE_WINDOW_MS;
      if ((t === 'warning' || t === 'threat') && fresh) status = 'warning';
      else status = 'all-clear';
    } else status = 'unknown';
  } else {
    status = 'loading';
  }

  const statusTone: Record<Status, string> = {
    loading: 'tone-neutral',
    warning: 'tone-warning',
    'all-clear': 'tone-clear',
    unknown: 'tone-caution',
    unavailable: 'tone-alert',
  };

  const statusIcon: Record<Status, ReactNode> = {
    loading: <Waves size={22} aria-hidden="true" />,
    warning: <AlertOctagon size={22} aria-hidden="true" />,
    'all-clear': <ShieldCheck size={22} aria-hidden="true" />,
    unknown: <AlertTriangle size={22} aria-hidden="true" />,
    unavailable: <AlertTriangle size={22} aria-hidden="true" />,
  };

  const statusTitle: Record<Status, string> = {
    loading: 'Checking PHIVOLCS bulletins…',
    warning: 'Tsunami threat — official advisory in effect',
    'all-clear': 'No active tsunami threat reported',
    unknown: 'Bulletin received — verdict unverifiable right now',
    unavailable: 'Bulletin source unreachable right now',
  };

  const latestMagnitude = latestEvent?.magnitude;
  const statusDetail = (() => {
    if (status === 'loading') return 'Reading the latest PHIVOLCS tsunami bulletins…';
    if (status === 'unavailable') return 'TerraGuard could not reach PHIVOLCS. This is not an all-clear — check official sources before assuming it is safe.';
    if (status === 'unknown') return 'The newest bulletin loaded, but its verdict field could not be read. Treat conditions as unknown and check official sources.';
    if (latestDetail) {
      const m = Number.isFinite(Number(latestDetail.magnitude)) ? `M${Number(latestDetail.magnitude).toFixed(1)} · ` : '';
      const when = latestDetail.issuedAt || latestDetail.occurredAtUtc || '';
      if (status === 'warning') return `PHIVOLCS tsunami advisory is in effect. ${m}${latestDetail.location || 'Epicenter location see bulletin'} · issued ${when}. Move to high ground now if you are near the coast.`;
      return `Latest advisory No. ${latestDetail.number ?? '?'} — ${latestDetail.headline || 'no threat'} · ${m}${latestDetail.location || ''} · issued ${when}.`;
    }
    return 'No current-year bulletins on file. Stay prepared regardless.';
  })();

  return (
    <div className="tsunami-page container">
      {/* ── Masthead ── */}
      <header className="tsunami-mast">
        <div className="tsunami-mast-left">
          <span className="tsunami-eyebrow">TerraGuard · Coastal Hazard Desk</span>
          <h1 className="tsunami-title">Tsunami</h1>
          <p className="tsunami-sub">
            Live PHIVOLCS tsunami bulletins, the natural warning signs, and the exact steps to take — for the Philippines and anywhere else quakes make waves.
          </p>
          <nav className="tsunami-quicknav" aria-label="Jump to a chapter">
            <a href="#tsunami-signs">Warning signs</a>
            <a href="#tsunami-act">If you feel it</a>
            <a href="#tsunami-archive">Bulletin archive</a>
            <a href="#tsunami-sources">Official sources</a>
          </nav>
        </div>
        <div className="tsunami-mast-note" role="note">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>Not an emergency warning. TerraGuard relays official bulletins — follow PHIVOLCS &amp; NDRRMC.</span>
        </div>
      </header>

      {/* ── Live status — only for the current (live) view ── */}
      {!isArchive && (
        <section
          className={`tsunami-status ${statusTone[status]}`}
          role={status === 'warning' || status === 'unavailable' ? 'alert' : 'status'}
          aria-live={status === 'warning' ? 'assertive' : 'polite'}
          id="tsunami-status"
        >
        <div className="tsunami-status-head">
          <span className="tsunami-status-cap">{status === 'warning' ? 'Active advisory' : 'Bulletin status'}</span>
          <button
            type="button"
            className="tsunami-refresh"
            onClick={() => load(archiveSel, true)}
            disabled={refreshing}
            aria-label="Refresh bulletins"
            title="Refresh bulletins"
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} aria-hidden="true" />
          </button>
        </div>
        <div className="tsunami-status-body">
          <span className="tsunami-status-icon">{statusIcon[status]}</span>
          <div className="tsunami-status-text">
            <h2 className="tsunami-status-title">{statusTitle[status]}</h2>
            <p className="tsunami-status-detail">{statusDetail}</p>
            {status !== 'unavailable' && latestEvent && (
              <p className="tsunami-status-meta tnum">
                {lastChecked ? `Last checked ${lastChecked.toLocaleTimeString()}` : ''}
                {lastChecked && ' · '}
                Source: DOST-PHIVOLCS{latestMagnitude != null ? ` · latest epicenter M${latestMagnitude.toFixed(1)} · ${latestEvent.location}` : ''}
              </p>
            )}
            {status === 'warning' && latestAdvisory && (
              <div className="tsunami-status-actions">
                <button type="button" className="tsunami-cta" onClick={() => setSelected(latestAdvisory)}>
                  <FileText size={14} aria-hidden="true" /> Read the official advisory
                </button>
                <a
                  className="tsunami-cta tsunami-cta--ghost"
                  href="https://tsunami.phivolcs.dost.gov.ph/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open PHIVOLCS Tsunami site <ExternalLink size={13} aria-hidden="true" />
                </a>
              </div>
            )}
            {status === 'all-clear' && latestAdvisory && (
              <button type="button" className="tsunami-cta tsunami-cta--ghost2" onClick={() => setSelected(latestAdvisory)}>
                Read the latest advisory <ChevronRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        </section>
      )}

      <div className="tsunami-body">
        {/* ── TOC rail ── */}
        <nav className="tsunami-toc" aria-label="Table of contents">
          <span className="tsunami-toc-cap">In this guide</span>
          <ol className="tsunami-toc-list">
            {TOC.map(item => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`tsunami-toc-link${active === item.id ? ' is-active' : ''}`}
                  aria-current={active === item.id ? 'true' : undefined}
                >
                  <span className="tsunami-toc-num tnum">{item.num}</span>
                  <span className="tsunami-toc-text">{item.label}</span>
                </a>
              </li>
            ))}
          </ol>
          <div className="tsunami-toc-foot">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>Emergency guidance preserved verbatim from the original guide.</span>
          </div>
        </nav>

        <div className="tsunami-content">
          {/* ── 01 Warning signs ── */}
          <section id="tsunami-signs" className="tsunami-chapter" aria-labelledby="h-signs">
            <span className="tsunami-ch-num">01</span>
            <h2 id="h-signs" className="tsunami-ch-title">Know the Natural Warning Signs</h2>
            <p>Do not wait for an official bulletin. If you are near the coast and any of these happen, move to high ground immediately:</p>
            <div className="tsunami-signs-table">
              <div className="tsunami-sign-row tsunami-sign-head">
                <span>Signal</span><span>What it means</span>
              </div>
              <div className="tsunami-sign-row">
                <div className="tsunami-sign-name"><CircleDot size={15} aria-hidden="true" /><span>Strong or long shaking</span></div>
                <span>An earthquake so strong you cannot stand, or shaking that lasts <strong>20 seconds or more</strong>, is a possible tsunami generator — especially if the epicenter is offshore.</span>
              </div>
              <div className="tsunami-sign-row">
                <div className="tsunami-sign-name"><Waves size={15} aria-hidden="true" /><span>Rapid sea level drop</span></div>
                <span>The sea suddenly <strong>retreats</strong>, exposing the ocean floor, fish, and reefs. This is the classic warning sign — the trough of the wave arrives first.</span>
              </div>
              <div className="tsunami-sign-row">
                <div className="tsunami-sign-name"><Volume2 size={15} aria-hidden="true" /><span>A loud ocean roar</span></div>
                <span>A freight-train-like rumble or roar coming from the sea, growing rapidly louder — often the only sign for people who never felt the quake.</span>
              </div>
            </div>
          </section>

          {/* ── 02 If you feel it ── */}
          <section id="tsunami-act" className="tsunami-chapter" aria-labelledby="h-act">
            <span className="tsunami-ch-num">02</span>
            <h2 id="h-act" className="tsunami-ch-title">If You Feel It — Do These, In Order</h2>
            <ol className="tsunami-steps">
              <li><strong>Drop, cover, hold on</strong> while the shaking is happening — protect your head and neck. Do not stand, run, or drive during strong shaking.</li>
              <li><strong>When the shaking stops and you are near the coast, evacuate immediately</strong> — walk or run inland and uphill. Leave cars and belongings behind; your life matters more.</li>
              <li><strong>Go to high ground</strong> (at least ~30 meters above sea level) or as far inland as you can (at least 2 km). Follow tsunami evacuation route signs if present.</li>
              <li><strong>Stay away from beaches, rivers and estuaries</strong> — tsunamis travel up rivers and inlets far beyond the shoreline. Never go down to watch the wave.</li>
              <li><strong>Expect multiple waves.</strong> The biggest wave is often not the first, and they can keep arriving <strong>minutes to hours</strong> apart.</li>
              <li><strong>Stay put until the official all-clear.</strong> Return home only when PHIVOLCS or your local DRRM office officially cancels the threat — never on your own judgment.</li>
            </ol>
          </section>

          {/* ── 03 Reading a bulletin ── */}
          <section id="tsunami-reading" className="tsunami-chapter" aria-labelledby="h-reading">
            <span className="tsunami-ch-num">03</span>
            <h2 id="h-reading" className="tsunami-ch-title">How to Read a PHIVOLCS Tsunami Bulletin</h2>
            <p>PHIVOLCS issues numbered bulletins (“TSUNAMI INFORMATION NO. 1, 2, …”) as new data arrives. Each bulletin carries a verdict in its banner:</p>
            <div className="tsunami-verdicts">
              <div className="tsunami-verdict tsunami-verdict--info">
                <span className="tsunami-verdict-pill">Tsunami Information / No Threat</span>
                <p>The ocean-wide monitoring shows <strong>no destructive tsunami is expected</strong> for this event. The bulletin exists so you know it was assessed — no action needed, but stay tuned for updates.</p>
              </div>
              <div className="tsunami-verdict tsunami-verdict--threat">
                <span className="tsunami-verdict-pill">Tsunami Threat / Warning</span>
                <p>A destructive tsunami <strong>may have been generated</strong>. People in coastal areas must evacuate to high ground <strong>immediately</strong>. Follow local officials and tsunami sirens. Do not return until the threat is officially cancelled.</p>
              </div>
              <div className="tsunami-verdict tsunami-verdict--cancelled">
                <span className="tsunami-verdict-pill">Threat Cancelled / All Clear</span>
                <p>The tsunami threat has <strong>passed</strong>. Authorities cancel the warning. You may return home — but still stay alert for aftershocks and check on neighbors, especially near the shore.</p>
              </div>
            </div>
          </section>

          {/* ── 04 Archive ── */}
          <section id="tsunami-archive" className="tsunami-chapter" aria-labelledby="h-archive">
            <span className="tsunami-ch-num">04</span>
            <h2 id="h-archive" className="tsunami-ch-title">Bulletin Archive</h2>
            <p>Every tsunami advisory issued by PHIVOLCS since 2020, with links to the original bulletins.</p>

            <div className="tsunami-archive-controls" role="tablist" aria-label="Archive period">
              <button type="button" role="tab" aria-selected={archiveSel === 'current'} className={`tsunami-year-btn${archiveSel === 'current' ? ' active' : ''}`} onClick={() => setArchiveSel('current')}>This year ({year})</button>
              {ARCHIVE_YEARS.map(y => (
                <button key={y} type="button" role="tab" aria-selected={archiveSel === y} className={`tsunami-year-btn${archiveSel === y ? ' active' : ''}`} onClick={() => setArchiveSel(y)}>{y}</button>
              ))}
            </div>

            {error && (
              <div className="tsunami-error" role="alert">
                <span>{error}</span>
                <button type="button" className="tsunami-cta tsunami-cta--ghost2" onClick={() => load(archiveSel, true)}>Retry</button>
              </div>
            )}

            <div className="tsunami-table-wrap">
              <table className="tsunami-table">
                <thead>
                  <tr><th>Date &amp; time (PHT)</th><th>Magnitude</th><th>Depth</th><th>Location</th><th>Advisories</th></tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={5} className="tsunami-empty-row">Loading bulletins…</td></tr>
                  )}
                  {!loading && list.length === 0 && (
                    <tr><td colSpan={5} className="tsunami-empty-row">No bulletins recorded for this period.</td></tr>
                  )}
                  {!loading && list.map((ev, i) => (
                    <tr key={`${ev.occurredAtUtc}-${i}`}>
                      <td style={{ whiteSpace: 'nowrap' }} className="tnum">{ev.dateTimePST || '—'}</td>
                      <td className="tsun-mag tnum" style={{ color: ev.magnitude != null ? getSeverityColor(ev.magnitude) : undefined }}>
                        {ev.magnitude != null ? `M${ev.magnitude.toFixed(1)}` : '—'}
                      </td>
                      <td className="tnum">{ev.depth != null ? `${ev.depth} km` : '—'}</td>
                      <td>{ev.location || '—'}{ev.latitude != null && ev.longitude != null && (
                        <span className="tsunami-coords tnum">
                          {Math.abs(ev.latitude).toFixed(2)}° {ev.latitude >= 0 ? 'N' : 'S'}, {Math.abs(ev.longitude).toFixed(2)}° {ev.longitude >= 0 ? 'E' : 'W'}
                        </span>
                      )}</td>
                      <td>
                        {ev.advisories.length === 0 ? <span className="tsunami-muted">—</span> : ev.advisories.map(a => (
                          <button
                            key={a.url}
                            type="button"
                            className="tsunami-advisory-btn"
                            onClick={() => setSelected(a)}
                            title={a.label || 'Advisory'}
                          >
                            {a.isPdf && <FileText size={11} className="tsun-pdf" aria-hidden="true" />}
                            No. {a.number ?? '?'}
                          </button>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && totalAdvisories > 0 && (
              <p className="tsunami-footnote">Total advisories in this view: {totalAdvisories}. Archives for 2010–2019 use a legacy PHIVOLCS layout that cannot be parsed yet; 2024+ yearly archives are not published by PHIVOLCS. Use “This year” for the current period.</p>
            )}
          </section>

          {/* ── 05 Sources ── */}
          <section id="tsunami-sources" className="tsunami-chapter" aria-labelledby="h-sources">
            <span className="tsunami-ch-num">05</span>
            <h2 id="h-sources" className="tsunami-ch-title">Official Sources &amp; Emergency Numbers</h2>
            <ul className="tsunami-sources">
              <li><strong>911</strong> — the national emergency hotline (police, fire, medical, rescue) anywhere in the Philippines.</li>
              <li><strong>PHIVOLCS Tsunami</strong> — <a href="https://tsunami.phivolcs.dost.gov.ph/" target="_blank" rel="noopener noreferrer">tsunami.phivolcs.dost.gov.ph</a> · official bulletins and maps.</li>
              <li><strong>NDRRMC / OCD</strong> — <a href="https://ndrrmc.gov.ph/" target="_blank" rel="noopener noreferrer">ndrrmc.gov.ph</a> · National Disaster Risk Reduction and Management Council · your local PDRRMO/MDRRMO is usually the fastest source for evacuations and all-clear calls.</li>
              <li><strong>Philippine Red Cross</strong> — 143 (text 143) for disaster-related assistance.</li>
            </ul>
          </section>

          {/* ── 06 Data honesty ── */}
          <section id="tsunami-data" className="tsunami-chapter" aria-labelledby="h-data">
            <span className="tsunami-ch-num">06</span>
            <h2 id="h-data" className="tsunami-ch-title">Where This Data Comes From</h2>
            <ul className="tsunami-sources">
              <li><strong>Bulletins</strong> — parsed from PHIVOLCS' own public tsunami site (tsunami.phivolcs.dost.gov.ph) via a caching proxy. Advisory verdicts shown here come straight from the official advisory pages — never predicted, never guessed.</li>
              <li><strong>Status line</strong> — reflects reported data. If PHIVOLCS is unreachable, this page says so explicitly — a failed check is not the same as “all clear.”</li>
              <li><strong>Refresh</strong> — the list and latest advisory are fetched on load and cached for about 10 minutes. Tap Refresh to force a new read.</li>
              <li><strong>TerraGuard is not an emergency alert system.</strong> It cannot guarantee delivery of life-safety warnings. Always follow official PHIVOLCS/NDRRMC advisories, your local DRRM office, sirens, and media broadcasts. If in doubt, treat strong coastal shaking as a tsunami and evacuate.</li>
            </ul>
          </section>

          <aside className="tsunami-cta-panel">
            <div className="tsunami-cta-panel-text">
              <span className="tsunami-cta-cap">Stay ready</span>
              <h3 className="tsunami-cta-title">Want proactive alerts on the next quake?</h3>
              <p>TerraGuard can notify you when any M4.5+ event lands near your saved alert zones — even offshore ones. Sirens first, app second; but this is how you stay informed.</p>
            </div>
            <a href="/alerts" className="tsunami-cta">Set up alerts <ChevronRight size={15} aria-hidden="true" /></a>
          </aside>
        </div>
      </div>

      <button type="button" className={`tsunami-backtop${showTop ? ' is-visible' : ''}`} onClick={handleTopClick} aria-label="Back to top" hidden={!showTop}>
        <ArrowUp size={18} aria-hidden="true" />
      </button>

      {selected && <TsunamiDetailModal advisory={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
