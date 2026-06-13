import { useState, useEffect, useMemo } from 'react';
import { fetchPhivolcsData, fetchPhivolcsArchiveData, getCachedData, type PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor } from '../lib/utils';
import { Search, Filter, Clock, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import './Archive.css';

export function Archive() {
  const initialCache = getCachedData();
  const [earthquakes, setEarthquakes] = useState<PhivolcsEarthquake[]>(initialCache?.data ?? []);
  const [loading, setLoading] = useState(!initialCache?.data?.length);

  const [search, setSearch] = useState(() => sessionStorage.getItem('archive_search') || "");
  const [dateSearch, setDateSearch] = useState(() => sessionStorage.getItem('archive_dateSearch') || "");
  const [timeSearch, setTimeSearch] = useState(() => sessionStorage.getItem('archive_timeSearch') || "");
  const [minMag, setMinMag] = useState(() => {
    const saved = sessionStorage.getItem('archive_minMag');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [visibleCount, setVisibleCount] = useState(10);

  const currentYear = new Date().getFullYear();
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
  const years = Array.from({ length: currentYear - 2017 }, (_, i) => currentYear - i); // 2018 to current

  // Persist state
  useEffect(() => {
    sessionStorage.setItem('archive_search', search);
    sessionStorage.setItem('archive_dateSearch', dateSearch);
    sessionStorage.setItem('archive_timeSearch', timeSearch);
    sessionStorage.setItem('archive_minMag', minMag.toString());
  }, [search, dateSearch, timeSearch, minMag]);

  useEffect(() => {
    sessionStorage.setItem('archive_fetchMode', fetchMode);
    sessionStorage.setItem('archive_selectedYear', selectedYear.toString());
    sessionStorage.setItem('archive_selectedMonth', selectedMonth);
  }, [fetchMode, selectedYear, selectedMonth]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        let res;
        if (fetchMode === 'latest') {
          res = await fetchPhivolcsData();
        } else {
          res = await fetchPhivolcsArchiveData(selectedYear, selectedMonth);
        }
        if (res && res.data) {
          setEarthquakes(res.data);
        } else {
          setEarthquakes([]);
        }
        setVisibleCount(10); // reset visible count on new data
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

  // Handle client-side "infinite scroll"
  useEffect(() => {
    function handleScroll() {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
        if (visibleCount < filteredData.length) {
          setVisibleCount(prev => Math.min(prev + 10, filteredData.length));
        }
      }
    }
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [visibleCount, filteredData.length]);

  if (loading) {
    return (
      <div className="container flex-center" style={{ height: '50vh' }}>
        <div className="loader">Loading Archive...</div>
      </div>
    );
  }

  return (
    <div className="archive-container container">
      <div className="archive-header">
        <h1 className="archive-title">Earthquake Database</h1>
        <p className="archive-subtitle">Search and filter recent seismic events from PHIVOLCS.</p>
      </div>

      <div className="filters-container glass">
        <div className="filter-box" style={{ flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
          <select value={fetchMode} onChange={e => setFetchMode(e.target.value as 'latest' | 'archive')} style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', fontWeight: 'bold' }}>
            <option value="latest">Latest Events (Live)</option>
            <option value="archive">Historical Archive</option>
          </select>

          {fetchMode === 'archive' && (
            <>
              <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
                {months.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </>
          )}
        </div>

        <div className='filter-box-archive'>
          <div className="search-box">
            <Search size={20} className="filter-icon" />
            <input
              type="text"
              placeholder="Search by location..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="search-box">
            <Clock size={20} className="filter-icon" />
            <input
              type="text"
              placeholder="Search by date (e.g. 08 June 2026)"
              value={dateSearch}
              onChange={e => setDateSearch(e.target.value)}
            />
          </div>

          <div className="search-box">
            <Clock size={20} className="filter-icon" />
            <input
              type="text"
              placeholder="Search by time (e.g. 07:48 AM)"
              value={timeSearch}
              onChange={e => setTimeSearch(e.target.value)}
            />
          </div>

          <div className="filter-box">
            <Filter size={20} className="filter-icon" />
            <select value={minMag} onChange={e => setMinMag(Number(e.target.value))}>
              <option value={0}>All Magnitudes</option>
              <option value={3}>Mag 3.0+</option>
              <option value={4}>Mag 4.0+</option>
              <option value={5}>Mag 5.0+</option>
              <option value={6}>Mag 6.0+</option>
            </select>
          </div>
        </div>
      </div>
      <div style={{ marginTop: '5px', textAlign: 'center', color: '#707070ff' }}>
        {fetchMode === 'archive' ? `Archive Results for ${selectedMonth} ${selectedYear}` : 'Recent Activities'}
      </div>
      <div className="archive-grid">
        {filteredData.slice(0, visibleCount).map((eq, i) => {
          const mag = parseFloat(eq.magnitude);
          const color = getSeverityColor(mag);
          // Generate a simple deterministic ID for the details page
          const eqId = btoa(`${eq.datetime}-${eq.latitude}-${eq.longitude}`).replace(/=/g, '');

          return (
            <Link to={`/details/${eqId}`} state={{ earthquake: eq }} key={i} className="archive-card glass-card">
              <div className="archive-card-mag" style={{ backgroundColor: `${color}20`, color }}>
                {eq.magnitude}
              </div>
              <div className="archive-card-info">
                <h3 className="archive-card-loc">{eq.location}</h3>
                <div className="archive-card-meta">
                  <span className="flex-center" style={{ gap: '4px' }}>
                    <Clock size={14} /> {eq.datetime}
                  </span>
                  <span className="flex-center" style={{ gap: '4px' }}>
                    <Activity size={14} /> {eq.depth} km depth
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {filteredData.length === 0 && (
        <div className="no-results">No earthquakes match your filters.</div>
      )}

      {visibleCount < filteredData.length && (
        <div className="loader-small">Scroll for more...</div>
      )}
    </div>
  );
}
