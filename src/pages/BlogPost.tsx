import { useParams, Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { getArticleBySlug } from '../data/articles';
import { ArticleView } from '../components/ArticleView';
import { BlogLayout } from '../components/BlogLayout';

export function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const article = slug ? getArticleBySlug(slug) : undefined;

  if (!article) {
    return (
      <BlogLayout title="Article Not Found">
        <div className="blog-not-found">
          <AlertTriangle size={48} className="blog-not-found-icon" />
          <h2>Article Not Found</h2>
          <p>The article you are looking for does not exist or has been removed.</p>
          <Link to="/blog" className="blog-back-btn">
            Back to Blog
          </Link>
        </div>
      </BlogLayout>
    );
  }

  return (
    <BlogLayout title={article.title}>
      <ArticleView article={article} />
    </BlogLayout>
  );
}
