import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Calendar, Clock } from 'lucide-react';
import { articles, getArticleBySlug } from '../data/articles';
import '../components/ArticleView.css';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Split raw content paragraphs into typed blocks, grouping bullet runs into real lists. */
function renderBlocks(content: string[]) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul className="article-list" key={`ul-${key++}`}>
        {list.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    );
    list = [];
  };

  for (const raw of content) {
    if (raw.startsWith('## ')) {
      flushList();
      blocks.push(<h2 className="article-h2" key={key++}>{raw.slice(3)}</h2>);
    } else if (raw.startsWith('### ')) {
      flushList();
      blocks.push(<h3 className="article-h3" key={key++}>{raw.slice(4)}</h3>);
    } else if (raw.startsWith('- ')) {
      list.push(raw.slice(2));
    } else if (raw.includes(' — ')) {
      flushList();
      const idx = raw.indexOf(' — ');
      blocks.push(
        <p className="article-p" key={key++}>
          <strong>{raw.slice(0, idx + 3)}</strong>{raw.slice(idx + 3)}
        </p>
      );
    } else {
      flushList();
      blocks.push(<p className="article-p" key={key++}>{raw}</p>);
    }
  }
  flushList();
  return blocks;
}

export function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const article = slug ? getArticleBySlug(slug) : undefined;
  const [progress, setProgress] = useState(0);

  const ordered = useMemo(
    () => [...articles].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()),
    []
  );
  const idx = article ? ordered.findIndex(a => a.slug === article.slug) : -1;
  const newer = idx >= 1 ? ordered[idx - 1] : undefined;
  const older = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : undefined;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [article?.slug]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const el = document.documentElement;
        const max = el.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  if (!article) {
    return (
      <div className="article-page container">
        <div className="article-progress" aria-hidden="true" style={{ transform: 'scaleX(0)' }} />
        <div className="article-notfound" role="status">
          <AlertTriangle size={30} strokeWidth={1.5} aria-hidden="true" />
          <h1 className="article-notfound-title">Article not found</h1>
          <p className="article-notfound-sub">It may have been renamed or moved. The full library is one click away.</p>
          <Link to="/blog" className="article-notfound-btn">
            <ArrowLeft size={14} aria-hidden="true" /> All articles
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="article-page container">
      <div className="article-progress" aria-hidden="true" style={{ transform: `scaleX(${progress})` }} />

      <header className="article-head">
        <Link to="/blog" className="article-back">
          <ArrowLeft size={14} aria-hidden="true" />
          <span>Knowledge Hub</span>
        </Link>
        <div className="article-headrow">
          <span className="article-kicker">{article.category}</span>
          <h1 className="article-title">{article.title}</h1>
          <p className="article-description">{article.description}</p>
          <div className="article-meta tnum">
            <span className="article-meta-item"><Calendar size={13} aria-hidden="true" />{fmtDate(article.publishedAt)}</span>
            <span className="article-meta-sep" aria-hidden="true">·</span>
            <span className="article-meta-item"><Clock size={13} aria-hidden="true" />{article.readTime}</span>
            <span className="article-meta-sep" aria-hidden="true">·</span>
            <span className="article-meta-item">TerraGuard Editorial</span>
          </div>
        </div>
      </header>

      <article className="article-body">
        {renderBlocks(article.content)}
      </article>

      <nav className="article-nav" aria-label="Continue reading">
        {older ? (
          <Link to={`/blog/${older.slug}`} className="article-nav-link article-nav-prev">
            <span className="article-nav-cap"><ArrowLeft size={12} aria-hidden="true" /> Older note</span>
            <span className="article-nav-title">{older.title}</span>
          </Link>
        ) : <span className="article-nav-spacer" />}
        {newer ? (
          <Link to={`/blog/${newer.slug}`} className="article-nav-link article-nav-next">
            <span className="article-nav-cap">Newer note <ArrowRight size={12} aria-hidden="true" /></span>
            <span className="article-nav-title">{newer.title}</span>
          </Link>
        ) : <span className="article-nav-spacer" />}
      </nav>
    </div>
  );
}
