import { useState, useEffect, useMemo } from 'react';
import { fetchEarthquakeData, fetchArchiveData, getCachedData, normalizeEarthquakes, type NormalizedEarthquake } from '../api/phivolcs';
import { getPreferredApi } from '../lib/apiPreference';
import { getSeverityColor, getSeverityLabel } from '../lib/utils';
import { earthquakeToEqId } from '../lib/supabase';
import { Search, Clock, ChevronDown, Activity, ArrowDown, ArrowUp, Plus, RotateCcw, Waves } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StarButton } from '../components/StarButton';
import './Archive.css';

function tsOf(eq: NormalizedEarthquake): number {
  const d = new Date(eq.datetime.replace(' - ', ' ').replace(/ UTC$/i, ''));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function trimTime(datetime: string): string {
  // "17 November 2026 - 10:53:21 UTC" -> "17 November 2026 - 10:53 UTC"
  return datetime.replace(/(\d{2}):(\d{2}):\d{2}(\s*UTC)?/, '$1:$2$3');
}

export function Archive() {
  const initialCache = getCachedData();
  const initialData = initialCache?.data ? normalizeEarthquakes(initialCache.data) : [];
  const [earthquakes, setEarthquakes] = useState<NormalizedEarthquake[]>(initialData);
  const [loading, setLoading] = useState(initialData.length === 0);

  const [search, setSearch] = useState(() => sessionStorage.getItem('archive_search') || '');
  const [dateSearch, setDateSearch] = useState(() => sessionStorage.getItem('archive_dateSearch') || '');
  const [timeSearch, setTimeSearch] = useState(() => sessionStorage.getItem('archive_timeSearch') || '');
  const [minMag, setMinMag] = useState(() => {
    const saved = sessionStorage.getItem('archive_minMag');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [sort, setSort] = useState<'desc' | 'asc'>(() => {
    const saved = sessionStorage.getItem('archive_sort');
    return saved === 'asc' ? 'asc' : 'desc';
  });
  const [visibleCount, setVisibleCount] = useState(15);

  const currentYear = new Date().getFullYear();
  const pref = getPreferredApi();
  const sourceName = pref === 'usgs' ? 'USGS' : pref === 'emsc' ? 'EMSC' : 'PHIVOLCS';
  const [fetchMode, setFetchMode] = useState<'latest' | 'archive'>(() => {
    return (sessionStorage.getItem('archive_fetchMode') as 'latest' | 'archive') || 'latest';
  });
  const [selectedYear, setSelectedYear] = useState(() => {
    const saved = sessionStorage.getItem('archive_selectedYear');
    return saved ? parseInt(saved, 10) : currentYear;
  });
  const [selectedMonth, setSelectedMonth] = useState(() => {
    return sessionStorage.getItem('archive_selectedMonth') || 'January';
  });
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const minArchiveYear = pref === 'usgs' ? 1900 : pref === 'emsc' ? 1998 : 2018;
  const years = Array.from({ length: currentYear - minArchiveYear + 1 }, (_, i) => currentYear - i); // oldest available year to current

  // Persist state
  useEffect(() => {
    sessionStorage.setItem('archive_search', search);
    sessionStorage.setItem('archive_dateSearch', dateSearch);
    sessionStorage.setItem('archive_timeSearch', timeSearch);
    sessionStorage.setItem('archive_minMag', minMag.toString());
    sessionStorage.setItem('archive_sort', sort);
  }, [search, dateSearch, timeSearch, minMag, sort]);

  useEffect(() => {
    sessionStorage.setItem('archive_fetchMode', fetchMode);
    sessionStorage.setItem('archive_selectedYear', selectedYear.toString());
    sessionStorage.setItem('archive_selectedMonth', selectedMonth);
  }, [fetchMode, selectedYear, selectedMonth]);

  useEffect(() => {
    if (selectedYear < minArchiveYear) {
      setSelectedYear(currentYear);
    }
  }, [minArchiveYear, selectedYear, currentYear]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        let res;
        if (fetchMode === 'latest') {
          res = await fetchEarthquakeData();
        } else {
          res = await fetchArchiveData(selectedYear, selectedMonth);
        }
        if (res && res.data) {
          setEarthquakes(normalizeEarthquakes(res.data));
        } else {
          setEarthquakes([]);
        }
        setVisibleCount(15); // reset visible count on new data
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [fetchMode, selectedYear, selectedMonth]);

  const filteredData = useMemo(() => {
    return earthquakes.filter(eq => {
      const matchSearch = eq.location.toLowerCase().includes(search.toLowerCase());
      const matchMag = parseFloat(eq.magnitude) >= minMag;
      const [eqDate = '', eqTime = ''] = eq.datetime.split(' - ').map(part => part.trim());
      const normalizedDateSearch = dateSearch.trim().toLowerCase();
      const normalizedTimeSearch = timeSearch.trim().toLowerCase();
      const matchDate = !normalizedDateSearch || eqDate.toLowerCase().includes(normalizedDateSearch);
      const matchTime = !normalizedTimeSearch || eqTime.toLowerCase().includes(normalizedTimeSearch);
      return matchSearch && matchMag && matchDate && matchTime;
    });
  }, [earthquakes, search, dateSearch, timeSearch, minMag]);

  const sortedData = useMemo(() => {
    const decorated = filteredData.map((eq, i) => ({ eq, i, ts: tsOf(eq) }));
    decorated.sort((a, b) => (sort === 'desc' ? b.ts - a.ts : a.ts - b.ts) || (a.i - b.i));
    return decorated.map(d => d.eq);
  }, [filteredData, sort]);

  const stats = useMemo(() => {
    let maxMag = 0;
    let sigCount = 0;
    for (const eq of filteredData) {
      const m = parseFloat(eq.magnitude);
      if (!Number.isNaN(m)) {
        if (m > maxMag) maxMag = m;
        if (m >= 4.5) sigCount++;
      }
    }
    return { count: filteredData.length, maxMag, sigCount };
  }, [filteredData]);

  // Handle client-side "infinite scroll"
  useEffect(() => {
    function handleScroll() {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
        if (visibleCount < sortedData.length) {
          setVisibleCount(prev => Math.min(prev + 15, sortedData.length));
        }
      }
    }
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [visibleCount, sortedData.length]);

  const resetAll = () => {
    setSearch('');
    setDateSearch('');
    setTimeSearch('');
    setMinMag(0);
    setSort('desc');
    setFetchMode('latest');
    setSelectedYear(currentYear);
    setSelectedMonth('January');
    setVisibleCount(15);
  };

  const scopeLabel = fetchMode === 'archive' ? `${selectedMonth} ${selectedYear}` : 'Live feed';

  return (
    <div className="arc-page container">
      {/* ── Masthead ── */}
      <header className="arc-head">
        <div className="arc-head-text">
          <span className="arc-eyebrow">TerraGuard · Seismic History</span>
          <h1 className="arc-title">Archive</h1>
          <p className="arc-sub">
            Every recorded event — the live feed, or full monthly scans back to {minArchiveYear}. Filter the registry, sort it, and open any event for its complete bulletin and map.
          </p>
        </div>
        <dl className="arc-head-stats" aria-label="In-view statistics">
          <div className="arc-hstat">
            <dt>Events in view</dt>
            <dd className="tnum">{stats.count}</dd>
          </div>
          <div className="arc-hstat">
            <dt>Max magnitude</dt>
            <dd className="tnum" style={{ color: stats.maxMag > 0 ? getSeverityColor(stats.maxMag) : undefined }}>
              {stats.maxMag > 0 ? stats.maxMag.toFixed(1) : '—'}
            </dd>
          </div>
          <div className="arc-hstat">
            <dt>Significant · M ≥ 4.5</dt>
            <dd className="tnum" style={{ color: stats.sigCount > 0 ? '#f97316' : undefined }}>{stats.sigCount}</dd>
          </div>
        </dl>
      </header>

      <div className="arc-body">
        {/* ── Filter rail ── */}
        <aside className="arc-rail" aria-label="Archive filters">
          <div className="arc-rail-head">
            <span className="arc-rail-title">Filter Registry</span>
            <button type="button" className="arc-reset" onClick={resetAll} title="Reset every filter and return to the live feed" aria-label="Reset all filters">
              <RotateCcw size={13} aria-hidden="true" />
              <span>Reset</span>
            </button>
          </div>

          <div className="arc-rail-section">
            <span className="arc-rail-cap">Scope</span>
            <div className="arc-mode" role="tablist" aria-label="Data scope">
              <button
                type="button"
                role="tab"
                aria-selected={fetchMode === 'latest'}
                className={`arc-mode-btn${fetchMode === 'latest' ? ' is-active' : ''}`}
                onClick={() => setFetchMode('latest')}
              >
                Live feed
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={fetchMode === 'archive'}
                className={`arc-mode-btn${fetchMode === 'archive' ? ' is-active' : ''}`}
                onClick={() => setFetchMode('archive')}
              >
                Archive
              </button>
            </div>
            {fetchMode === 'archive' && (
              <div className="arc-pair">
                <label className="arc-field">
                  <span className="arc-field-cap">Year</span>
                  <span className="arc-select-wrap">
                    <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} aria-label="Select year">
                      {years.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <ChevronDown size={14} aria-hidden="true" />
                  </span>
                </label>
                <label className="arc-field">
                  <span className="arc-field-cap">Month</span>
                  <span className="arc-select-wrap">
                    <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} aria-label="Select month">
                      {months.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <ChevronDown size={14} aria-hidden="true" />
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="arc-rail-section">
            <span className="arc-rail-cap">Search</span>
            <label className="arc-field arc-field--icon">
              <Search size={16} className="arc-field-icon" aria-hidden="true" />
              <input
                type="text"
                placeholder="Location — e.g. Davao"
                value={search}
                onChange={e => setSearch(e.target.value)}
                aria-label="Filter by location"
              />
            </label>
            <label className="arc-field arc-field--icon">
              <Clock size={16} className="arc-field-icon" aria-hidden="true" />
              <input
                type="text"
                placeholder="Date contains — e.g. 08 June 2026"
                value={dateSearch}
                onChange={e => setDateSearch(e.target.value)}
                aria-label="Filter by date"
              />
            </label>
            <label className="arc-field arc-field--icon">
              <Clock size={16} className="arc-field-icon" aria-hidden="true" />
              <input
                type="text"
                placeholder="Time contains — e.g. 07:48 AM"
                value={timeSearch}
                onChange={e => setTimeSearch(e.target.value)}
                aria-label="Filter by time"
              />
            </label>
          </div>

          <div className="arc-rail-section">
            <span className="arc-rail-cap">Magnitude</span>
            <label className="arc-field">
              <span className="arc-field-cap">Minimum</span>
              <span className="arc-select-wrap">
                <select value={minMag} onChange={e => setMinMag(Number(e.target.value))} aria-label="Minimum magnitude">
                  <option value={0}>All magnitudes</option>
                  <option value={3}>Magnitude 3.0 +</option>
                  <option value={4}>Magnitude 4.0 +</option>
                  <option value={5}>Magnitude 5.0 +</option>
                  <option value={6}>Magnitude 6.0 +</option>
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </span>
            </label>
          </div>

          <div className="arc-rail-foot">
            <p className="arc-source">
              <span className="arc-source-cap">Data source</span>
              <span className="arc-source-val">{sourceName}{fetchMode === 'archive' ? ` · ${selectedMonth} ${selectedYear}` : ' · live feed'}</span>
            </p>
          </div>
        </aside>

        {/* ── Results ── */}
        <section className="arc-results" aria-label="Earthquake results">
          <div className="arc-toolbar">
            <div className="arc-toolbar-left">
              <span className="arc-toolbar-cap">Query</span>
              <span className="arc-toolbar-scope">{scopeLabel} · {sourceName}</span>
            </div>
            <div className="arc-toolbar-right">
              <div className="arc-sort" role="group" aria-label="Sort order">
                <button
                  type="button"
                  className={`arc-sort-btn${sort === 'desc' ? ' is-active' : ''}`}
                  aria-pressed={sort === 'desc'}
                  onClick={() => setSort('desc')}
                >
                  Newest <ArrowDown size={12} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`arc-sort-btn${sort === 'asc' ? ' is-active' : ''}`}
                  aria-pressed={sort === 'asc'}
                  onClick={() => setSort('asc')}
                >
                  Oldest <ArrowUp size={12} aria-hidden="true" />
                </button>
              </div>
              <span className="arc-count tnum">{sortedData.length} {sortedData.length === 1 ? 'event' : 'events'}</span>
            </div>
          </div>

          {loading ? (
            <div className="arc-table arc-table--loading" aria-busy="true" aria-label="Loading archive">
              {Array.from({ length: 8 }, (_, i) => (
                <div className="arc-tr arc-row arc-row--skeleton" key={i}>
                  <span className="arc-sk arc-sk-mag" />
                  <span className="arc-sk arc-sk-line arc-sk-wide" />
                  <span className="arc-sk arc-sk-line" />
                  <span className="arc-sk arc-sk-line arc-sk-short" />
                </div>
              ))}
            </div>
          ) : sortedData.length === 0 ? (
            <div className="arc-empty" role="status">
              <Waves size={30} strokeWidth={1.5} className="arc-empty-icon" aria-hidden="true" />
              <p className="arc-empty-title">No events match the current filters</p>
              <p className="arc-empty-sub">Try a broader location, a different month, or a lower magnitude threshold.</p>
              <button type="button" className="arc-empty-btn" onClick={resetAll}>
                <RotateCcw size={14} aria-hidden="true" /> Clear all filters
              </button>
            </div>
          ) : (
            <>
              <div className="arc-table" role="table" aria-label="Earthquake registry">
                <div className="arc-tr arc-thead" role="row" aria-hidden="true">
                  <span role="columnheader">Mag</span>
                  <span role="columnheader">Epicenter</span>
                  <span role="columnheader">Date / Time</span>
                  <span role="columnheader">Depth</span>
                  <span role="columnheader">Class</span>
                  <span role="columnheader"><span className="sr-only">Star</span></span>
                </div>
                {sortedData.slice(0, visibleCount).map((eq, i) => {
                  const mag = parseFloat(eq.magnitude);
                  const color = getSeverityColor(mag);
                  const label = getSeverityLabel(mag).toUpperCase();
                  const eqId = earthquakeToEqId(eq);

                  return (
                    <div className="arc-tr arc-row" key={`${eq.datetime}-${eq.location}-${i}`} role="row">
                      <Link to={`/details/${eqId}`} state={{ earthquake: eq }} className="arc-link" aria-label={`M ${eq.magnitude}, ${eq.location}, ${eq.datetime}`}>
                        <span className="arc-mag tnum" style={{ color }} role="cell">{eq.magnitude}</span>
                        <span className="arc-loc-cell" role="cell">
                          <span className="arc-loc">{eq.location}</span>
                          <span className="arc-loc-meta tnum">{trimTime(eq.datetime)} · {eq.depth} km · {label}</span>
                        </span>
                        <span className="arc-cell arc-datetime tnum" role="cell">{trimTime(eq.datetime)}</span>
                        <span className="arc-cell arc-depth tnum" role="cell">{eq.depth} km</span>
                        <span className="arc-cell arc-class tnum" role="cell" style={{ color }}>{label}</span>
                      </Link>
                      <span className="arc-star-cell" role="cell">
                        <StarButton earthquake={eq} />
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="arc-results-foot">
                <span className="arc-showing tnum">Showing {Math.min(visibleCount, sortedData.length)} of {sortedData.length}</span>
                {visibleCount < sortedData.length && (
                  <button
                    type="button"
                    className="arc-more"
                    onClick={() => setVisibleCount(v => Math.min(v + 15, sortedData.length))}
                  >
                    <Plus size={14} aria-hidden="true" />
                    Load more
                    <span className="arc-more-count tnum">+{Math.min(15, sortedData.length - visibleCount)}</span>
                  </button>
                )}
                {visibleCount >= sortedData.length && sortedData.length > 15 && (
                  <span className="arc-end"><Activity size={12} aria-hidden="true" /> End of registry</span>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
