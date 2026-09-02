import { Link } from 'react-router-dom';
import { Clock, ArrowRight } from 'lucide-react';
import type { Article } from '../data/articles';
import './BlogCard.css';

interface BlogCardProps {
  article: Article;
}

export function BlogCard({ article }: BlogCardProps) {
  return (
    <Link to={`/blog/${article.slug}`} className="blog-card glass">
      <div className="blog-card-category">{article.category}</div>
      <h2 className="blog-card-title">{article.title}</h2>
      <p className="blog-card-description">{article.description}</p>
      <div className="blog-card-footer">
        <div className="blog-card-meta">
          <Clock size={14} />
          <span>{article.readTime}</span>
        </div>
        <span className="blog-card-link">
          Read Article <ArrowRight size={14} />
        </span>
      </div>
    </Link>
  );
}
