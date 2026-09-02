import { articles } from '../data/articles';
import { BlogCard } from '../components/BlogCard';
import { BlogLayout } from '../components/BlogLayout';
import './Blog.css';

export function Blog() {
  return (
    <BlogLayout title="Earthquake Knowledge Hub">
      <p className="blog-intro">
        Learn about earthquake science, preparedness, and safety. Our articles help you understand seismic activity in the Philippines and how to protect yourself and your family.
      </p>
      <div className="blog-grid">
        {articles.map(article => (
          <BlogCard key={article.slug} article={article} />
        ))}
      </div>
    </BlogLayout>
  );
}
