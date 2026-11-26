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

import { nativeHttpGet, IS_NATIVE } from '../lib/nativeHttp';
import { getPreferredApi } from '../lib/apiPreference';

// PHIVOLCS scopes to Philippines; USGS/EMSC pull global
function buildNewsQuery(): string {
  const pref = getPreferredApi();
  const query = pref === 'usgs' || pref === 'emsc' ? 'earthquake' : 'earthquake location:Philippines';
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en-PH&gl=PH&ceid=PH:en';
}

// Native builds load from file:// assets, so a relative /api/news would resolve
// to file:///api/news. Use the deployed function's ORIGIN as the native fallback;
// the /api/news path is appended below. (Including the path here would produce
// /api/news/api/news, which Pages answers with a 200 SPA HTML page.)
const NATIVE_NEWS_API = 'https://terraguard-ph.pages.dev';

const NEWS_CACHE_KEY = 'terraguard_news_cache';
const NEWS_CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

interface CachedNews {
  response: NewsResponse;
  timestamp: number;
}

function getNewsCacheKey(): string {
  return `${NEWS_CACHE_KEY}_${getPreferredApi()}`;
}

function getCachedNews(): NewsResponse | null {
  try {
    const cached = localStorage.getItem(getNewsCacheKey());
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
    localStorage.setItem(getNewsCacheKey(), JSON.stringify(entry));
  } catch { /* ignore */ }
}

function parseRssFeed(xml: string): NewsResponse {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const articles: NewsArticle[] = [];
  doc.querySelectorAll('item').forEach((item) => {
    const title = item.querySelector('title')?.textContent?.trim() || '';
    const link = item.querySelector('link')?.textContent?.trim() || '';
    const pubDate = item.querySelector('pubDate')?.textContent?.trim() || '';
    const source = item.querySelector('source')?.textContent?.trim() || '';
    if (title && link) articles.push({ title, link, pubDate, source });
  });
  return { success: true, count: articles.length, data: articles.slice(0, 20) };
}

export async function fetchNews(): Promise<NewsResponse> {
  const cached = getCachedNews();
  if (cached && cached.data.length > 0) {
    return cached;
  }

  const isGlobal = getPreferredApi() === 'usgs' || getPreferredApi() === 'emsc';
  const serverlessUrl = `${IS_NATIVE ? NATIVE_NEWS_API : ''}/api/news${isGlobal ? '?global=1' : ''}`;
  // Prefer the deployed serverless proxy on native too: it is CORS-enabled and
  // always reachable, whereas Google News RSS is CORS-blocked in the WebView
  // and can return an empty feed. RSS remains the fallback.
  const urls = [serverlessUrl, buildNewsQuery()];

  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const res = await nativeHttpGet(url);
      if (!res.ok) throw new Error(`News API responded with ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      const body = await res.text();
      const result: NewsResponse = contentType.includes('application/json')
        ? (JSON.parse(body) as NewsResponse)
        : parseRssFeed(body);
      if (result.success && result.data.length > 0) {
        setCachedNews(result);
        return result;
      }
      lastError = new Error('News source returned no articles');
    } catch (error) {
      lastError = error;
      console.warn('News fetch failed for', url, error);
    }
  }

  // Return stale cache if available
  const stale = getCachedNews();
  if (stale) return stale;

  return {
    success: false,
    count: 0,
    data: [],
    error: lastError instanceof Error ? lastError.message : String(lastError ?? 'News unavailable'),
  };
}
