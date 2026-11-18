import { useEffect, useState, useMemo, type CSSProperties } from 'react';
import { articles, getAllCategories } from '../data/articles';
import { Search, X, Clock, Calendar, ArrowRight, ArrowDown, ArrowUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import './Blog.css';

const CATEGORIES = ['All Articles', ...getAllCategories()] as const;
type Category = typeof CATEGORIES[number];

function readMinutes(readTime: string): number {
  const m = readTime.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function Blog() {
  const [query, setQuery] = useState(() => sessionStorage.getItem('blog_query') ?? '');
  const [category, setCategory] = useState<Category>(() => {
    const saved = sessionStorage.getItem('blog_category');
    return (CATEGORIES as readonly string[]).includes(saved ?? '') ? (saved as Category) : 'All Articles';
  });
  const [sort, setSort] = useState<'desc' | 'asc'>(() => {
    const saved = sessionStorage.getItem('blog_sort');
    return saved === 'asc' ? 'asc' : 'desc';
  });

  useEffect(() => {
    sessionStorage.setItem('blog_query', query);
    sessionStorage.setItem('blog_category', category);
    sessionStorage.setItem('blog_sort', sort);
  }, [query, category, sort]);

  const isFiltering = category !== 'All Articles' || query.trim() !== '';

  const sorted = useMemo(() => {
    let out = articles;
    if (category !== 'All Articles') out = out.filter(a => a.category === category);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter(a => `${a.title} ${a.description} ${a.category}`.toLowerCase().includes(q));
    }
    return [...out].sort((a, b) => {
      const cmp = new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
      return sort === 'asc' ? cmp : -cmp;
    });
  }, [category, query, sort]);

  // The featured block only makes sense on the unfiltered, newest-first view
  const showFeatured = !isFiltering && sort === 'desc' && sorted.length >= 2;
  const hero = showFeatured ? sorted[0] : null;
  const desk = showFeatured ? sorted.slice(1, 4) : [];
  const ledger = showFeatured ? sorted.slice(4) : sorted;

  const topics = new Set(articles.map(a => a.category)).size;
  const totalMinutes = articles.reduce((acc, a) => acc + readMinutes(a.readTime), 0);
  const latest = articles.reduce((acc, a) => (new Date(a.publishedAt) > new Date(acc.publishedAt) ? a : acc), articles[0]);

  return (
    <div className="blog-page container">
      {/* ── Masthead ── */}
      <header className="blog-mast">
        <div className="blog-mast-left">
          <span className="blog-eyebrow">TerraGuard · Educational Library</span>
          <h1 className="blog-title">Earthquake Knowledge Hub</h1>
          <p className="blog-sub">
            Field notes on seismic science — written for Filipinos by people who read the bulletins. Magnitude, intensity, tsunamis, faults, and what to do about any of it.
          </p>
        </div>
        <dl className="blog-mast-stats" aria-label="Library overview">
          <div className="blog-mstat"><dt>Articles</dt><dd className="tnum">{articles.length}</dd></div>
          <div className="blog-mstat"><dt>Topics</dt><dd className="tnum">{topics}</dd></div>
          <div className="blog-mstat"><dt>Total reading</dt><dd className="tnum">~{totalMinutes} min</dd></div>
        </dl>
      </header>

      {/* ── Toolbar: category tabs + search + sort ── */}
      <div className="blog-toolbar" role="region" aria-label="Filter the library">
        <div className="blog-cats" role="tablist" aria-label="Categories">
          {CATEGORIES.map(c => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={category === c}
              className={`blog-cat${category === c ? ' is-active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="blog-toolbar-right">
          <label className="blog-search" aria-label="Search articles">
            <Search size={15} className="blog-search-icon" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search articles…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search articles"
            />
            {query && (
              <button type="button" className="blog-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </label>
          <div className="blog-sort" role="group" aria-label="Sort order">
            <button type="button" className={`blog-sort-btn${sort === 'desc' ? ' is-active' : ''}`} aria-pressed={sort === 'desc'} onClick={() => setSort('desc')} title="Newest first">
              <ArrowDown size={13} aria-hidden="true" /><span className="blog-sort-label">Newest</span>
            </button>
            <button type="button" className={`blog-sort-btn${sort === 'asc' ? ' is-active' : ''}`} aria-pressed={sort === 'asc'} onClick={() => setSort('asc')} title="Oldest first">
              <ArrowUp size={13} aria-hidden="true" /><span className="blog-sort-label">Oldest</span>
            </button>
          </div>
          <span className="blog-count tnum">{sorted.length} {sorted.length === 1 ? 'article' : 'articles'}</span>
        </div>
      </div>

      {/* ── Empty ── */}
      {sorted.length === 0 && (
        <div className="blog-empty" role="status">
          <Search size={26} strokeWidth={1.5} className="blog-empty-icon" aria-hidden="true" />
          <p className="blog-empty-title">Nothing in the library matches that</p>
          <p className="blog-empty-sub">
            Try a broader term, or clear the filters.
          </p>
          <button type="button" className="blog-empty-btn" onClick={() => { setQuery(''); setCategory('All Articles'); }}>
            <X size={14} aria-hidden="true" /> Clear filters
          </button>
        </div>
      )}

      {/* ── Featured + desk ── */}
      {hero && (
        <section className="blog-feature" aria-label="Featured article">
          <Link to={`/blog/${hero.slug}`} className="blog-hero" style={{ '--blog-hero-bg': `url('/assets/natgeo-featured-cover.jpg')` } as CSSProperties}>
            <span className="blog-hero-kicker">
              <span className="blog-hero-kicker-dot" aria-hidden="true" />
              Featured · {hero.category}
            </span>
            <h2 className="blog-hero-title">{hero.title}</h2>
            <p className="blog-hero-desc">{hero.description}</p>
            <span className="blog-hero-foot">
              <span className="blog-hero-meta tnum"><Calendar size={13} aria-hidden="true" />{fmtDate(hero.publishedAt)}<span aria-hidden="true">·</span><Clock size={13} aria-hidden="true" />{hero.readTime}</span>
              <span className="blog-hero-cta">Continue reading<ArrowRight size={14} aria-hidden="true" /></span>
            </span>
          </Link>
          <div className="blog-desk" aria-label="Fresh on the shelf">
            <span className="blog-desk-cap">Fresh on the shelf</span>
            {desk.map((a, i) => (
              <Link key={a.slug} to={`/blog/${a.slug}`} className="blog-desk-row">
                <span className="blog-desk-num tnum">{String(i + 1).padStart(2, '0')}</span>
                <span className="blog-desk-body">
                  <span className="blog-desk-title">{a.title}</span>
                  <span className="blog-desk-meta"><span className="blog-desk-cat">{a.category}</span><span className="tnum">{fmtDate(a.publishedAt)}</span></span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── The ledger — every article, scannable ── */}
      {ledger.length > 0 && (
        <section className="blog-ledger" aria-label="All articles">
          <div className="blog-ledger-head">
            <h2 className="blog-ledger-title">{isFiltering ? 'Matching notes' : 'Latest publications'}</h2>
            <span className="blog-ledger-note tnum">{ledger.length} {ledger.length === 1 ? 'entry' : 'entries'} · latest first</span>
          </div>
          <div className="blog-ledger-list" role="list">
            {ledger.map((a, i) => (
              <Link key={a.slug} to={`/blog/${a.slug}`} className="blog-row" role="listitem">
                <span className="blog-row-index tnum">{String(i + 1 + (showFeatured ? 4 : 0)).padStart(2, '0')}</span>
                <span className="blog-row-body">
                  <span className="blog-row-title">{a.title}</span>
                  <span className="blog-row-desc">{a.description}</span>
                </span>
                <span className="blog-row-side">
                  <span className="blog-row-cat">{a.category}</span>
                  <span className="blog-row-date tnum">{fmtDate(a.publishedAt)}</span>
                </span>
                <ArrowRight size={16} className="blog-row-arrow" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <footer className="blog-wire-foot">
        <span>Field Notes — serialized on TerraGuard</span>
        <span aria-hidden="true">·</span>
        <span>Sources: PHIVOLCS, USGS, EMSC</span>
        <span aria-hidden="true">·</span>
        <span>Latest: {latest ? fmtDate(latest.publishedAt) : '—'}</span>
        <span aria-hidden="true">·</span>
        <span>Cover: National Geographic</span>
      </footer>
    </div>
  );
}
