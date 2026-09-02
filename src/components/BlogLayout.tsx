import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import './BlogLayout.css';

interface BlogLayoutProps {
  title: string;
  children: ReactNode;
}

export function BlogLayout({ title, children }: BlogLayoutProps) {
  return (
    <div className="blog-container container">
      <div className="blog-card glass">
        <div className="blog-header">
          <Link to="/blog" className="back-link flex-center">
            <ArrowLeft size={18} />
            <span>Back to Blog</span>
          </Link>
          <div className="blog-title-wrapper flex-center">
            <BookOpen size={28} className="blog-icon" />
            <h1 className="blog-title">{title}</h1>
          </div>
        </div>
        <div className="blog-content">
          {children}
        </div>
      </div>
    </div>
  );
}
