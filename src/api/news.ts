export interface NewsArticle {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

export interface NewsResponse {
  success: boolean;
  count: number;
  data: NewsArticle[];
  error?: string;
}

import { apiUrl } from '../lib/apiBase';
import { nativeHttpGet, IS_NATIVE } from '../lib/nativeHttp';

const GOOGLE_NEWS_RSS = 'https://news.google.com/rss/search?q=' +
  encodeURIComponent('earthquake location:Philippines') + '&hl=en-PH&gl=PH&ceid=PH:en';

const NEWS_CACHE_KEY = 'terraguard_news_cache';
const NEWS_CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

interface CachedNews {
  response: NewsResponse;
  timestamp: number;
}

function getCachedNews(): NewsResponse | null {
  try {
    const cached = localStorage.getItem(NEWS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as CachedNews;
      if (Date.now() - parsed.timestamp < NEWS_CACHE_DURATION_MS) {
        return parsed.response;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function setCachedNews(data: NewsResponse): void {
  try {
    const entry: CachedNews = { response: data, timestamp: Date.now() };
    localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(entry));
  } catch { /* ignore */ }
}

export async function fetchNews(): Promise<NewsResponse> {
  const cached = getCachedNews();
  if (cached && cached.data.length > 0) {
    return cached;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    // Native: scrape the Google News RSS feed directly (CORS-free via plugin).
    // Web/dev: use the Vercel function or local Vite proxy.
    const url = IS_NATIVE ? GOOGLE_NEWS_RSS : apiUrl('/api/news');
    const res = await nativeHttpGet(url);
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`News API responded with ${res.status}`);

    const contentType = res.headers.get('content-type') || '';
    let result: NewsResponse;

    if (contentType.includes('application/json')) {
      // Vercel serverless function returns JSON
      result = (await res.json()) as NewsResponse;
    } else {
      // Native / Vite dev proxy returns raw RSS XML — parse it
      const xml = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');
      const items = doc.querySelectorAll('item');
      const articles: NewsArticle[] = [];

      items.forEach((item) => {
        const title = item.querySelector('title')?.textContent?.trim() || '';
        const link = item.querySelector('link')?.textContent?.trim() || '';
        const pubDate = item.querySelector('pubDate')?.textContent?.trim() || '';
        const source = item.querySelector('source')?.textContent?.trim() || '';
        if (title && link) {
          articles.push({ title, link, pubDate, source });
        }
      });

      result = { success: true, count: articles.length, data: articles.slice(0, 20) };
    }

    if (result.success && result.data.length > 0) {
      setCachedNews(result);
    }
    return result;
  } catch (error) {
    console.warn('News fetch failed:', error);

    // Return stale cache if available
    const stale = getCachedNews();
    if (stale) return stale;

    return { success: false, count: 0, data: [] };
  }
}
