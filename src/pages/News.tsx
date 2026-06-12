import { useEffect, useState, useCallback, useMemo } from 'react';
import { fetchNews, type NewsArticle } from '../api/news';
import { Newspaper, RefreshCw, Clock, ExternalLink, ChevronRight, Zap, Filter, Flame } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import placeholderImg from '../assets/news_placeholder.png';
import './News.css';

const CATEGORIES = ['All News', 'Luzon', 'Visayas', 'Mindanao', 'Alerts & Volcanic'] as const;
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
  if (t.match(/mindanao|davao|cotabato|zamboanga|agusan|surigao|misamis|bukidnon|camiguin|lanao|maguindanao|sulu|tawi-tawi|basilan|dinagat/)) return 'Mindanao';
  if (t.match(/visayas|panay|cebu|bohol|samar|leyte|negros|siquijor|guimaras|capiz|iloilo|antique|aklan/)) return 'Visayas';
  if (t.match(/luzon|manila|ncr|batanes|ilocos|cagayan|pampanga|bulacan|bataan|zambales|tarlac|nueva ecija|aurora|calabarzon|cavite|laguna|batangas|rizal|quezon|mimaropa|mindoro|marinduque|romblon|palawan|bicol|albay|camarines|catanduanes|masbate|sorsogon/)) return 'Luzon';
  
  return 'All News'; // Fallback if no specific region matched
}

export function News() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Category>('All News');

  const loadNews = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
      try { localStorage.removeItem('terraguard_news_cache'); } catch { /* ignore */ }
    } else {
      setLoading(true);
    }

    try {
      const res = await fetchNews();
      if (res.data && res.data.length > 0) {
        setArticles(res.data);
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

  // Filter articles based on active category
  const filteredArticles = useMemo(() => {
    if (activeCategory === 'All News') return articles;
    return articles.filter(article => {
      // If filtering by a specific region, check if it matches that region OR if it's broadly categorized
      const cat = getArticleCategory(article.title);
      return cat === activeCategory;
    });
  }, [articles, activeCategory]);

  // Separate featured from the rest (only when looking at 'All News')
  const isAllNews = activeCategory === 'All News';
  const showFeatured = isAllNews && filteredArticles.length >= 3 && !loading;
  
  const heroArticle = showFeatured ? filteredArticles[0] : null;
  const secondaryFeatured = showFeatured ? [filteredArticles[1], filteredArticles[2]] : [];
  const gridArticles = showFeatured ? filteredArticles.slice(3) : filteredArticles;

  return (
    <div className="news-page-container container">
      
      {/* ── Header ── */}
      <div className="news-page-header glass">
        <div className="news-page-header-left">
          <div className="news-page-title-wrapper">
            <h1 className="news-page-title">
              <Newspaper size={28} className="text-accent" />
              Earthquake News
            </h1>
            <div className="live-badge">
              <span className="live-dot"></span> LIVE
            </div>
          </div>
          <p className="news-page-subtitle">
            Curated seismic activity reports, warnings, and updates across the Philippines.
          </p>
        </div>
        <button
          className="news-page-refresh-btn"
          onClick={() => loadNews(true)}
          disabled={refreshing}
          title="Refresh news"
        >
          <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* ── Category Filter ── */}
      <div className="news-filter-container glass">
        <Filter size={16} className="filter-icon" />
        <div className="news-filter-scroll">
          {CATEGORIES.map(category => (
            <button
              key={category}
              className={`news-filter-chip ${activeCategory === category ? 'active' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category === 'Alerts & Volcanic' && <Flame size={14} style={{ marginRight: 6 }} />}
              {category}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="news-page-loading">
          <div className="spinner-ring"></div>
          <p>Fetching latest news...</p>
        </div>
      )}

      {!loading && articles.length === 0 && (
        <div className="news-page-empty glass">
          <Newspaper size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
          <h3>No news available</h3>
          <p>We couldn't fetch the latest earthquake news. Please try again later.</p>
          <button className="btn-primary" onClick={() => loadNews(true)} style={{ marginTop: 16 }}>
            Retry
          </button>
        </div>
      )}

      {/* ── Featured Section (Only shown on 'All News') ── */}
      {showFeatured && heroArticle && (
        <div className="news-featured-section">
          <a href={heroArticle.link} target="_blank" rel="noopener noreferrer" className="news-hero-card glass">
            <div className="news-hero-bg" style={{ backgroundImage: `url(${placeholderImg})` }}></div>
            <div className="news-hero-content">
              <div className="news-badge top-story">
                <Zap size={14} /> Top Story
              </div>
              <h2 className="news-hero-title">{heroArticle.title}</h2>
              <div className="news-hero-meta">
                <span className="news-source">
                  <span className="source-dot"></span>
                  {heroArticle.source || 'Verified Source'}
                </span>
                <span className="news-time">
                  <Clock size={14} />
                  {formatTime(heroArticle.pubDate)}
                </span>
              </div>
            </div>
          </a>

          <div className="news-secondary-featured">
            {secondaryFeatured.map((article, idx) => (
              <a key={idx} href={article.link} target="_blank" rel="noopener noreferrer" className="news-secondary-card glass">
                <div className="news-secondary-content">
                  <h3 className="news-secondary-title">{article.title}</h3>
                  <div className="news-secondary-meta">
                    <span className="news-source">{article.source}</span>
                    <span className="news-time">{formatTime(article.pubDate)}</span>
                  </div>
                </div>
                <div className="news-secondary-arrow">
                  <ChevronRight size={20} />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Grid Section ── */}
      {!loading && filteredArticles.length > 0 && (
        <div className="news-section-header">
          <h3>{isAllNews ? 'Latest Updates' : `${activeCategory} News`}</h3>
          <div className="news-section-line"></div>
        </div>
      )}

      <div className="news-page-grid">
        {!loading && gridArticles.map((article, i) => (
          <a
            key={i}
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            className="news-standard-card glass"
          >
            <div className="news-standard-body">
              <div className="news-standard-title">{article.title}</div>
              <div className="news-standard-footer">
                <span className="news-source">
                  <span className="source-dot"></span>
                  {article.source || 'News Source'}
                </span>
                <span className="news-time">
                  <Clock size={12} />
                  {formatTime(article.pubDate)}
                </span>
                <ExternalLink size={14} className="news-link-icon" />
              </div>
            </div>
            <div className="news-card-hover-border"></div>
          </a>
        ))}
      </div>

      {!loading && filteredArticles.length === 0 && articles.length > 0 && (
        <div className="news-page-empty glass">
          <Filter size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
          <h3>No articles found</h3>
          <p>No recent news matched the "{activeCategory}" category.</p>
          <button className="btn-secondary" onClick={() => setActiveCategory('All News')} style={{ marginTop: 16 }}>
            Clear Filters
          </button>
        </div>
      )}

    </div>
  );
}
