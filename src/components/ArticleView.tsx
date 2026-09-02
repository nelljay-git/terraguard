import { Clock, Calendar } from 'lucide-react';
import type { Article } from '../data/articles';
import './ArticleView.css';

interface ArticleViewProps {
  article: Article;
}

export function ArticleView({ article }: ArticleViewProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <article className="article-view">
      <header className="article-header">
        <div className="article-category">{article.category}</div>
        <h1 className="article-title">{article.title}</h1>
        <p className="article-description">{article.description}</p>
        <div className="article-meta">
          <div className="article-meta-item">
            <Calendar size={16} />
            <span>{formatDate(article.publishedAt)}</span>
          </div>
          <div className="article-meta-item">
            <Clock size={16} />
            <span>{article.readTime}</span>
          </div>
        </div>
      </header>

      <div className="article-content">
        {article.content.map((paragraph, index) => {
          if (paragraph.startsWith('## ')) {
            return (
              <h2 key={index} className="article-heading">
                {paragraph.replace('## ', '')}
              </h2>
            );
          }
          if (paragraph.startsWith('### ')) {
            return (
              <h3 key={index} className="article-subheading">
                {paragraph.replace('### ', '')}
              </h3>
            );
          }
          if (paragraph.startsWith('- ')) {
            return (
              <li key={index} className="article-list-item">
                {paragraph.replace('- ', '')}
              </li>
            );
          }
          if (paragraph.includes(' — ')) {
            const parts = paragraph.split(' — ');
            return (
              <p key={index} className="article-paragraph">
                <strong>{parts[0]} —</strong> {parts.slice(1).join(' — ')}
              </p>
            );
          }
          return (
            <p key={index} className="article-paragraph">
              {paragraph}
            </p>
          );
        })}
      </div>
    </article>
  );
}
