import { useEffect, useState, useCallback } from 'react';
import { fetchNews, type NewsArticle } from '../api/news';
import { Link } from 'react-router-dom';
import { Newspaper, ArrowRight, Clock, ExternalLink, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import './NewsFeed.css';

interface NewsFeedProps {
  /** Max number of articles to show. Defaults to 5. */
  limit?: number;
  /** If true, shows a "View All" link to /news. Defaults to true. */
  showViewAll?: boolean;
}

export function NewsFeed({ limit = 5, showViewAll = true }: NewsFeedProps) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchNews();
      if (res.data.length > 0) {
        setArticles(res.data);
      }
    } catch (err) {
      console.error('NewsFeed error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  const displayArticles = articles.slice(0, limit);

  function formatTime(pubDate: string): string {
    try {
      const date = new Date(pubDate);
      if (isNaN(date.getTime())) return pubDate;
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return pubDate;
    }
  }

  return (
    <div className="news-feed glass">
      <div className="news-feed-header">
        <div className="news-feed-title-row">
          <Newspaper size={18} className="news-feed-icon" />
          <h3 className="news-feed-title">Earthquake News</h3>
        </div>
        {showViewAll && (
          <Link to="/news" className="news-feed-view-all">
            View All <ArrowRight size={14} />
          </Link>
        )}
      </div>

      {loading && (
        <div className="news-feed-loading">
          <RefreshCw size={14} className="spin" />
          Loading news...
        </div>
      )}

      {!loading && displayArticles.length === 0 && (
        <div className="news-feed-empty">No earthquake news available right now.</div>
      )}

      {!loading && displayArticles.length > 0 && (
        <div className="news-feed-list">
          {displayArticles.map((article, i) => (
            <a
              key={i}
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="news-feed-item"
            >
              <div className="news-feed-source-badge">
                {(article.source || 'N')[0].toUpperCase()}
              </div>

              <div className="news-feed-item-body">
                <div className="news-feed-item-title">{article.title}</div>
                <div className="news-feed-item-meta">
                  {article.source && (
                    <span className="news-feed-source-name">
                      <Newspaper size={11} />
                      {article.source}
                    </span>
                  )}
                  <span className="news-feed-time">
                    <Clock size={11} />
                    {formatTime(article.pubDate)}
                  </span>
                </div>
              </div>

              <ExternalLink size={14} className="news-feed-arrow" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
