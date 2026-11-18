import { useEffect, useState, useCallback, useMemo, type CSSProperties } from 'react';
import { fetchNews, type NewsArticle } from '../api/news';
import { getPreferredApi } from '../lib/apiPreference';
import { RefreshCw, Clock, ExternalLink, Search, X, ArrowDown, ArrowUp, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import './News.css';

const CATEGORIES = ['All News', 'Luzon', 'Visayas', 'Mindanao', 'Alerts & Volcanic', 'Preparedness'] as const;
type Category = typeof CATEGORIES[number];

function formatTime(pubDate: string): string {
  try {
    const date = new Date(pubDate);
    if (isNaN(date.getTime())) return pubDate;
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return pubDate;
  }
}

function getArticleCategory(title: string): Category {
  const t = title.toLowerCase();

  if (t.match(/volcano|taal|mayon|kanlaon|bulusan|pinatubo|tsunami|alert|warning|evacuation/)) return 'Alerts & Volcanic';
  if (t.match(/prepared|emergency kit|drill|ready for|readiness|safety tips|civil defense/)) return 'Preparedness';
  if (t.match(/mindanao|davao|cotabato|zamboanga|agusan|surigao|misamis|bukidnon|camiguin|lanao|maguindanao|sulu|tawi-tawi|basilan|dinagat/)) return 'Mindanao';
  if (t.match(/visayas|panay|cebu|bohol|samar|leyte|negros|siquijor|guimaras|capiz|iloilo|antique|aklan/)) return 'Visayas';
  if (t.match(/luzon|manila|ncr|batanes|ilocos|cagayan|pampanga|bulacan|bataan|zambales|tarlac|nueva ecija|aurora|calabarzon|cavite|laguna|batangas|rizal|quezon|mimaropa|mindoro|marinduque|romblon|palawan|bicol|albay|camarines|catanduanes|masbate|sorsogon/)) return 'Luzon';

  return 'All News'; // Fallback if no specific region matched
}

export function News() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Category>(() => {
    const saved = sessionStorage.getItem('news_category');
    return (CATEGORIES as readonly string[]).includes(saved ?? '') ? (saved as Category) : 'All News';
  });
  const [query, setQuery] = useState(() => sessionStorage.getItem('news_query') ?? '');
  const [sort, setSort] = useState<'desc' | 'asc'>(() => {
    const saved = sessionStorage.getItem('news_sort');
    return saved === 'asc' ? 'asc' : 'desc';
  });

  const isGlobal = getPreferredApi() === 'usgs' || getPreferredApi() === 'emsc';
  // Night-lights view of Earth (Discover Magazine cover art, stored locally).
  const heroBg = '/assets/darker-earth-cover.jpg';

  useEffect(() => {
    sessionStorage.setItem('news_category', activeCategory);
    sessionStorage.setItem('news_query', query);
    sessionStorage.setItem('news_sort', sort);
  }, [activeCategory, query, sort]);

  const loadNews = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
      try {
        localStorage.removeItem('terraguard_news_cache_phivolcs');
        localStorage.removeItem('terraguard_news_cache_usgs');
      } catch { /* ignore */ }
    } else {
      setLoading(true);
    }

    try {
      const res = await fetchNews();
      if (res.data && res.data.length > 0) {
        setArticles(res.data);
      } else if (!forceRefresh) {
        setArticles([]);
      }
    } catch (err) {
      console.error('News page error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  const filteredArticles = useMemo(() => {
    let out = articles;
    if (activeCategory !== 'All News') {
      out = out.filter(article => getArticleCategory(article.title) === activeCategory);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter(article =>
        `${article.title} ${article.source}`.toLowerCase().includes(q)
      );
    }
    if (sort === 'asc') {
      out = [...out].reverse();
    }
    return out;
  }, [articles, activeCategory, query, sort]);

  const isFiltering = activeCategory !== 'All News' || query.trim() !== '';
  const showFeatured = !isFiltering && filteredArticles.length >= 3 && !loading;

  const heroArticle = showFeatured ? filteredArticles[0] : null;
  const secondaryFeatured = showFeatured ? [filteredArticles[1], filteredArticles[2]] : [];
  const feedArticles = showFeatured ? filteredArticles.slice(3) : filteredArticles;

  const scopeLabel = isGlobal ? 'Global wire' : 'Philippines wire';
  const wireUpdatedAt = articles.length > 0 && articles[0]?.pubDate ? formatTime(articles[0].pubDate) : null;

  return (
    <div className="news-page container">
      {/* ── Masthead ── */}
      <header className="news-mast">
        <div className="news-mast-left">
          <span className="news-eyebrow">TerraGuard · {scopeLabel}</span>
          <h1 className="news-title">Earthquake News</h1>
          <p className="news-sub">
            {isGlobal
              ? 'Seismic activity, disaster response and geoscience headlines from around the world — from agencies, newsrooms and wires, refreshed throughout the day.'
              : 'Seismic activity, government advisories, volcanic alerts and disaster response from across the Philippines — from agencies, newsrooms and wires, refreshed throughout the day.'}
          </p>
        </div>
        <div className="news-mast-right">
          <span className="news-synced">
            <span className="news-synced-dot" aria-hidden="true" />
            {wireUpdatedAt ? `Fresh as of ${wireUpdatedAt}` : 'Refreshing…'}
          </span>
          <button
            className="news-refresh"
            onClick={() => loadNews(true)}
            disabled={refreshing}
            aria-label="Refresh news"
            title="Refresh news — clears the 10-minute cache"
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* ── Newsroom toolbar ── */}
      <div className="news-toolbar" role="region" aria-label="Filter and search news">
        <div className="news-cats" role="tablist" aria-label="News categories">
          {CATEGORIES.map(category => (
            <button
              key={category}
              type="button"
              role="tab"
              aria-selected={activeCategory === category}
              className={`news-cat${activeCategory === category ? ' is-active' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>
        <div className="news-toolbar-right">
          <label className="news-search" aria-label="Search headlines">
            <Search size={15} className="news-search-icon" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search headlines, sources…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search headlines and sources"
            />
            {query && (
              <button
                type="button"
                className="news-search-clear"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </label>
          <div className="news-sort" role="group" aria-label="Sort order">
            <button type="button" className={`news-sort-btn${sort === 'desc' ? ' is-active' : ''}`} aria-pressed={sort === 'desc'} onClick={() => setSort('desc')} title="Newest first">
              <ArrowDown size={13} aria-hidden="true" /><span className="news-sort-label">Newest</span>
            </button>
            <button type="button" className={`news-sort-btn${sort === 'asc' ? ' is-active' : ''}`} aria-pressed={sort === 'asc'} onClick={() => setSort('asc')} title="Oldest first">
              <ArrowUp size={13} aria-hidden="true" /><span className="news-sort-label">Oldest</span>
            </button>
          </div>
          <span className="news-count tnum">{filteredArticles.length} {filteredArticles.length === 1 ? 'story' : 'stories'}</span>
        </div>
      </div>

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="news-skeleton" aria-busy="true" aria-label="Loading news">
          <div className="news-skeleton-feature">
            <div className="news-sk news-sk-title" />
            <div className="news-sk news-sk-sub" />
            <div className="news-sk news-sk-meta" />
          </div>
          <div className="news-skeleton-feed">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="news-skeleton-row" key={i}>
                <div className="news-sk news-sk-index" />
                <div className="news-sk news-sk-line news-sk-wide" />
                <div className="news-sk news-sk-line news-sk-narrow" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty — no articles at all ── */}
      {!loading && articles.length === 0 && (
        <div className="news-empty" role="status">
          <AlertTriangle size={28} strokeWidth={1.5} className="news-empty-icon" aria-hidden="true" />
          <p className="news-empty-title">No earthquake coverage right now</p>
          <p className="news-empty-sub">The wire is quiet — or the news source is unreachable. It refreshes automatically and on demand.</p>
          <button className="news-empty-btn" onClick={() => loadNews(true)}>
            <RefreshCw size={14} aria-hidden="true" /> Retry the wire
          </button>
        </div>
      )}

      {/* ── Empty — filters match nothing ── */}
      {!loading && articles.length > 0 && filteredArticles.length === 0 && (
        <div className="news-empty" role="status">
          <Search size={28} strokeWidth={1.5} className="news-empty-icon" aria-hidden="true" />
          <p className="news-empty-title">No stories match the current filters</p>
          <p className="news-empty-sub">
            {query ? <>Nothing matches “<span className="news-empty-query">{query}</span>”. </> : null}
            Loosen the search or switch the category.
          </p>
          <button className="news-empty-btn" onClick={() => { setQuery(''); setActiveCategory('All News'); }}>
            <X size={14} aria-hidden="true" /> Clear filters
          </button>
        </div>
      )}

      {/* ── Featured front story + index desk ── */}
      {showFeatured && heroArticle && (
        <section className="news-feature" aria-label="Featured coverage">
          <a
            href={heroArticle.link}
            target="_blank"
            rel="noopener noreferrer"
            className="news-hero"
            style={{ '--hero-bg': `url(${heroBg})` } as CSSProperties}
            aria-label={`Top story — ${heroArticle.title}`}
          >
            <span className="news-hero-kicker">
              <span className="news-hero-kicker-dot" aria-hidden="true" />
              Top story · {heroArticle.source || 'Wire'}
            </span>
            <h2 className="news-hero-title">{heroArticle.title}</h2>
            <span className="news-hero-foot">
              <span className="news-hero-time tnum"><Clock size={13} aria-hidden="true" />{formatTime(heroArticle.pubDate)}</span>
              <span className="news-hero-cta">Read at source<ExternalLink size={13} aria-hidden="true" /></span>
            </span>
          </a>
          <div className="news-index-desk" aria-label="Also on the wire">
            <span className="news-index-cap">Also on the wire</span>
            {secondaryFeatured.map((article, idx) => (
              <a
                key={idx}
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className="news-index-row"
              >
                <span className="news-index-num tnum">{String(idx + 1).padStart(2, '0')}</span>
                <span className="news-index-body">
                  <span className="news-index-title">{article.title}</span>
                  <span className="news-index-meta"><span className="news-index-src">{article.source || 'Wire'}</span><span className="tnum">{formatTime(article.pubDate)}</span></span>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* ── Feed ── */}
      {!loading && filteredArticles.length > 0 && (
        <section className="news-feed-wrap" aria-label="Latest coverage">
          <div className="news-feed-head">
            <h2 className="news-feed-title">{isFiltering ? 'Matching coverage' : 'Latest coverage'}</h2>
            <span className="news-feed-note">Wire order · {sort === 'desc' ? 'newest first' : 'oldest first'}</span>
          </div>
          <div className="news-feed" role="list">
            {feedArticles.map((article, i) => (
              <a
                key={`${article.link}-${i}`}
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className="news-row"
                role="listitem"
              >
                <span className="news-row-index tnum">{String(i + 1 + (showFeatured ? 3 : 0)).padStart(2, '0')}</span>
                <span className="news-row-body">
                  <span className="news-row-title">{article.title}</span>
                  <span className="news-row-meta">
                    <span className="news-row-source">{article.source || 'Wire'}</span>
                    <span className="news-row-sep" aria-hidden="true">·</span>
                    <span className="tnum">{formatTime(article.pubDate)}</span>
                  </span>
                </span>
                <ExternalLink size={14} className="news-row-arrow" aria-hidden="true" />
              </a>
            ))}
          </div>
        </section>
      )}

      {/* ── Wire footer ── */}
      <footer className="news-wire-foot">
        <span>Headlines via Google News RSS · {isGlobal ? 'global earthquake coverage' : 'Philippines earthquake coverage'}</span>
        <span aria-hidden="true">·</span>
        <span>Source links open on the publisher's site</span>
        <span aria-hidden="true">·</span>
        <span>Cached ~10 minutes</span>
        <span aria-hidden="true">·</span>
        <span>Cover image: Discover Magazine</span>
      </footer>
    </div>
  );
}
