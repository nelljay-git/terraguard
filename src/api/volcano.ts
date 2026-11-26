import { volcanoListUrl, volcanoDetailUrl, apiUrl, expandPhpFailoverUrls } from '../lib/apiBase';
import { nativeHttpGet, nativeHttpGetWithPhpFailover, IS_NATIVE } from '../lib/nativeHttp';

export interface VolcanoStatus {
  volcano: string;
  title: string;
  alertLevel: number | null;
  bid: string | null;
  url: string;
}

export interface VolcanoHubResponse {
  success: boolean;
  page: string;
  source: string;
  issued: string;
  count: number;
  data: VolcanoStatus[];
  error?: string;
}

const CACHE_KEY = 'terraguard_volcano_cache';
const CACHE_TTL = 10 * 60 * 1000;

function getCached(): VolcanoHubResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { timestamp: number; payload: VolcanoHubResponse };
    if (Date.now() - parsed.timestamp > CACHE_TTL) return null;
    return parsed.payload;
  } catch { return null; }
}
function setCache(payload: VolcanoHubResponse): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), payload })); } catch {}
}

export async function fetchVolcanoHub(): Promise<VolcanoHubResponse> {
  const fetchVia = async (url: string, isDirectHtml = false): Promise<VolcanoHubResponse | null> => {
    try {
      // Both the PHP host and WOVODAT are CORS-less. On Android a plain WebView
      // `fetch` is blocked, so route even the direct HTML scrape through the
      // native HTTP plugin.
      const res = isDirectHtml ? await nativeHttpGet(url) : await nativeHttpGetWithPhpFailover(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const json = (await res.json()) as VolcanoHubResponse;
        if (json.success) setCache(json);
        return json;
      }
      // Fallback: try to parse HTML (dev proxy returns HTML, PHP may return HTML on error)
      try {
        const html = await res.text();
        // Only attempt HTML parse if it looks like the WOVODAT hub
        if (html && /Alert Level Status|list-of-bulletin|activity-[a-z]+/i.test(html)) {
          const parsed = parseVolcanoHtml(html, url);
          if (parsed.data.length > 0) {
            parsed.success = true;
            setCache(parsed);
            return parsed;
          }
        }
        // If we expected HTML via isDirectHtml but got empty, treat as error
        if (isDirectHtml) {
          const parsed = parseVolcanoHtml(html, url);
          if (parsed.data.length > 0) {
            parsed.success = true;
            setCache(parsed);
            return parsed;
          }
        }
      } catch {}
      return { success: false, page: 'hub', source: url, issued: '', count: 0, data: [], error: 'Unexpected HTML response' };
    } catch (e) {
      // bubble up so the caller can try the next fallback
      throw e;
    }
  };

  // Native prefers the deployed Pages function (the free PHP hosts are often
  // unreachable from mobile networks); web keeps PHP first so polling doesn't
  // exhaust the Cloudflare invocation quota.
  const candidates: { url: string; isDirectHtml: boolean }[] = [];
  const serverlessUrl = apiUrl('/api/volcano?page=hub');
  if (IS_NATIVE && !candidates.some((c) => c.url === serverlessUrl)) {
    candidates.push({ url: serverlessUrl, isDirectHtml: false });
  }
  const phpUrl = volcanoListUrl();
  for (const u of expandPhpFailoverUrls(phpUrl)) {
    if (!candidates.some((c) => c.url === u)) candidates.push({ url: u, isDirectHtml: false });
  }
  if (!IS_NATIVE && !candidates.some((c) => c.url === serverlessUrl)) {
    candidates.push({ url: serverlessUrl, isDirectHtml: false });
  }
  // Direct HTML scrape is the last resort on native (and a dev/web fallback).
  const directUrl = 'https://wovodat.phivolcs.dost.gov.ph/bulletin/list-of-bulletin';
  if (!candidates.some((c) => c.url === directUrl)) candidates.push({ url: directUrl, isDirectHtml: true });

  let lastError: unknown = null;
  for (let i = 0; i < candidates.length; i++) {
    const { url, isDirectHtml } = candidates[i];
    try {
      const res = await fetchVia(url, isDirectHtml);
      if (res) {
        // If PHP returned JSON with success:false due to upstream failure,
        // try next candidate instead of immediately showing error
        if (!res.success && res.error && i < candidates.length - 1) {
          lastError = new Error(res.error);
          continue;
        }
        return res;
      }
    } catch (e) {
      lastError = e;
      continue;
    }
  }

  const cached = getCached();
  if (cached) return cached;
  const msg = lastError instanceof Error ? lastError.message : String(lastError ?? 'Failed to load volcano status');
  return { success: false, page: 'hub', source: '', issued: '', count: 0, data: [], error: msg };
}

// Minimal HTML parser for native direct fetch fallback.
// Extracts alert ticker + bulletin links without needing a full DOM.
function parseVolcanoHtml(html: string, pageUrl: string): VolcanoHubResponse {
  const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const text = strip(html);
  const levels: Record<string, number> = {};
  const re = /([A-Za-z ]+?)\s*-\s*([0-5])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim().toUpperCase();
    if (name.length >= 3 && name.length <= 20 && levels[name] === undefined) {
      if (['TAAL', 'KANLAON', 'BULUSAN', 'PINATUBO', 'MAYON'].includes(name)) levels[name] = parseInt(m[2], 10);
    }
  }
  const codes: Record<string, string> = { tvo: 'TAAL', kvo: 'KANLAON', bvo: 'BULUSAN', mvo: 'MAYON', pvo: 'PINATUBO' };
  const seen: Record<string, boolean> = {};
  const items: VolcanoStatus[] = [];
  const anchorRe = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = anchorRe.exec(html)) !== null) {
    const href = am[1];
    const inner = strip(am[2]);
    const bm = /\/bulletin\/activity-([a-z]+)\?bid=(\d+)/i.exec(href);
    if (!bm) continue;
    const code = bm[1].toLowerCase();
    if (!codes[code]) continue;
    const volcano = codes[code];
    const isEn = /Summary of 24Hr/i.test(inner) || /lang=en/i.test(href);
    if (seen[volcano] && !isEn) continue;
    if (seen[volcano] && isEn) {
      for (let i = 0; i < items.length; i++) if (items[i].volcano === volcano) { items.splice(i, 1); break; }
    }
    seen[volcano] = true;
    const hrefWithLang = href.includes('lang=') ? href : href + '&lang=en';
    let url = hrefWithLang;
    if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(hrefWithLang)) {
      try { url = new URL(hrefWithLang, pageUrl).href; } catch { url = hrefWithLang; }
    }
    items.push({ volcano, title: inner ? inner.slice(0, 160) : `${volcano} Bulletin`, alertLevel: levels[volcano] ?? null, bid: bm[2], url });
    if (items.length >= 10) break;
  }
  for (const [volcano, lvl] of Object.entries(levels)) {
    if (!items.some((it) => it.volcano === volcano)) {
      items.push({ volcano, title: `${volcano} Volcano Status`, alertLevel: lvl, bid: null, url: pageUrl });
    }
  }
  let issued = '';
  const petsa = /(?:Petsa|Date):\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(text);
  if (petsa) issued = petsa[1].trim();
  else {
    const dm = /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i.exec(text);
    if (dm) issued = dm[0].trim();
  }
  return { success: items.length > 0, page: 'hub', source: pageUrl, issued, count: items.length, data: items, error: items.length ? undefined : 'No volcano data found' };
}

export interface VolcanoDetail {
  title: string;
  alertLevel: number | null;
  issued: string;
  text: string;
  parametros: Record<string, string>;
  parametros_en?: Record<string, string>;
  parametros_fil?: Record<string, string>;
  text_en?: string;
  text_fil?: string;
  title_en?: string;
  title_fil?: string;
  links: string[];
}

export interface VolcanoDetailResponse {
  success: boolean;
  count: number;
  data: VolcanoDetail;
  error?: string;
}

const DETAIL_CACHE = new Map<string, { ts: number; payload: VolcanoDetailResponse }>();
const DETAIL_TTL = 10 * 60 * 1000;

function getDetailCached(url: string): VolcanoDetailResponse | null {
  const e = DETAIL_CACHE.get(url);
  if (!e) return null;
  if (Date.now() - e.ts > DETAIL_TTL) { DETAIL_CACHE.delete(url); return null; }
  return e.payload;
}
function setDetailCached(url: string, payload: VolcanoDetailResponse) {
  DETAIL_CACHE.set(url, { ts: Date.now(), payload });
}

// Minimal HTML -> VolcanoDetail parser for dev direct-fetch fallback (same as server)
function parseVolcanoDetailHtml(html: string, pageUrl: string): VolcanoDetail {
  const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  let stripped = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  const scopeMatch = stripped.match(/<div[^>]*class=["'][^"']*(?:bulletin|article|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  let scope: string = scopeMatch ? scopeMatch[1] : stripped;
  if (strip(scope).length < 200) scope = stripped;
  let title = '';
  const scopeText = strip(scope);
  const fullText = strip(stripped);
  const tm = /\b(BULKANG\s+[A-Z]+|MAYON\s+VOLCANO|TAAL\s+VOLCANO|KANLAON\s+VOLCANO|BULUSAN\s+VOLCANO|PINATUBO\s+VOLCANO)\b/i.exec(scopeText) || /\b(BULKANG\s+[A-Z]+|MAYON\s+VOLCANO|TAAL\s+VOLCANO|KANLAON\s+VOLCANO|BULUSAN\s+VOLCANO|PINATUBO\s+VOLCANO)\b/i.exec(fullText);
  if (tm) { title = tm[1].trim(); title = title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
  else { const tM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html); if (tM) title = strip(tM[1]); }
  const textFull = strip(scope).slice(0, 12000);
  const cap = (s: string, m: number) => s.length > m ? s.slice(0, m) + '…' : s;
  const text = cap(textFull, 12000);
  let alertLevel: number | null = null;
  const am = /ALERT LEVEL\s*([0-5])/i.exec(text) || /ANTAS NG ALERTO\s*([0-5])/i.exec(text);
  if (am) alertLevel = parseInt(am[1], 10);
  let issued = '';
  const im = /Petsa:\s*([^\n]{4,60}\d{4})/i.exec(text) || /Date:\s*([^\n]{4,60}\d{4})/i.exec(text) || /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Enero|Pebrero|Marso|Abril|Mayo|Hunyo|Hulyo|Agosto|Setyembre|Oktubre|Nobyembre|Disyembre)\s+\d{4}\b/i.exec(text);
  if (im) issued = (im[1] || im[0]).trim();
  const paramsSource = (() => { const i = text.search(/PARAMETERS/i); return i >= 0 ? text.slice(i) : text; })();
  const parametros: Record<string, string> = {};
  const labels: Record<string, RegExp> = {
    seismicity: /Seismicity\s*([^\n]+?)(?=\s*(?:Banaag|Crater glow|Sulfur|Plume|Ground|Earthquake Location|Total no\.|Rekomendasyon|RECOMMENDATION|Paalala|$))/is,
    craterGlow: /(?:Banaag|Crater glow)\s*([^\n]+?)(?=\s*(?:Sulfur|Plume|Ground|Earthquake Location|Rekomendasyon|RECOMMENDATION|Paalala|$))/is,
    so2: /Sulfur Dioxide Flux\s*([^\n]+?)(?=\s*(?:Plume|Ground|Earthquake Location|Rekomendasyon|RECOMMENDATION|Paalala|$))/is,
    plume: /Plume\s*([^\n]+?)(?=\s*(?:Ground Deformation|Ground|Earthquake Location|Rekomendasyon|RECOMMENDATION|Paalala|$))/is,
    groundDeformation: /Ground Deformation\s*([^\n]+?)(?=\s*(?:Earthquake Location|Total no\.|Rekomendasyon|RECOMMENDATION|Paalala|Lokasyon|Additional information|Department of Science|$))/is,
  };
  for (const [k, pat] of Object.entries(labels)) {
    const mm = pat.exec(paramsSource);
    if (mm) {
      let v = mm[1].trim().replace(/\s+/g, ' ');
      v = v.split(/Earthquake Location:/i)[0].trim();
      v = v.split(/Total no\. of volcanic earthquake/i)[0].trim();
      v = v.split(/RECOMMENDATION\/COMMENT/i)[0].trim();
      v = v.split(/Rekomendasyon/i)[0].trim();
      if (v.length < 2) continue;
      if (v.length > 240) v = v.slice(0, 240).trim() + '…';
      parametros[k] = v;
    }
  }
  const resolve = (href: string, base: string) => { try { return new URL(href, base).href; } catch { return href; } };
  const links: string[] = []; const seen = new Set<string>();
  const re = /<(?:a[^>]*href|img[^>]*src)=["']([^"']+)["']/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) {
    const raw = m[1]; const url = resolve(raw, pageUrl);
    if (!url || seen.has(url)) continue;
    if (/bulletinMap\//i.test(url) || /\.(jpg|png)(\?|#|$)/i.test(url)) { seen.add(url); links.push(url); }
    else if (/phivolcs/i.test(url) || /wovodat/i.test(url)) { seen.add(url); links.push(url); }
    if (links.length >= 20) break;
  }
  return { title: title.slice(0, 200), alertLevel, issued, text, parametros, links };
}

export async function fetchVolcanoDetail(bulletinUrl: string): Promise<VolcanoDetailResponse> {
  const cached = getDetailCached(bulletinUrl);
  if (cached) return cached;

  // 1) Native: deployed Pages function first, then the PHP detail endpoint,
  // then a direct WOVODAT scrape. A plain WebView fetch of the bulletin is
  // CORS-blocked, so those requests go through the native HTTP layer.
  if (IS_NATIVE) {
    try {
      const srvRes = await nativeHttpGet(apiUrl(`/api/volcano?detail=1&url=${encodeURIComponent(bulletinUrl)}`));
      if (srvRes.ok) {
        const ct = srvRes.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const j = await srvRes.json() as VolcanoDetailResponse;
          if (j.success) { setDetailCached(bulletinUrl, j); return j; }
        }
      }
    } catch (e) {
      console.warn('Serverless volcano detail failed on native:', e);
    }
    try {
      const res = await nativeHttpGetWithPhpFailover(volcanoDetailUrl(bulletinUrl));
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const j = await res.json() as VolcanoDetailResponse;
          if (j.success) { setDetailCached(bulletinUrl, j); return j; }
        }
        const html = await res.text();
        if (html) {
          const detail = parseVolcanoDetailHtml(html, bulletinUrl);
          if (detail.title || Object.keys(detail.parametros).length || detail.text) {
            const payload: VolcanoDetailResponse = { success: true, count: 1, data: detail };
            setDetailCached(bulletinUrl, payload);
            return payload;
          }
        }
      }
    } catch {}
    try {
      const res = await nativeHttpGet(bulletinUrl);
      if (res.ok) {
        const html = await res.text();
        if (html) {
          const detail = parseVolcanoDetailHtml(html, bulletinUrl);
          if (detail.title || Object.keys(detail.parametros).length || detail.text) {
            const payload: VolcanoDetailResponse = { success: true, count: 1, data: detail };
            setDetailCached(bulletinUrl, payload);
            return payload;
          }
        }
      }
    } catch {}
  }

  // 2) Shared fallbacks: serverless detail endpoint (works on native too via
  // the native HTTP plugin) and, on web, the direct /bulletin proxy.
  const candidates: string[] = [];
  if (!IS_NATIVE) {
    // Direct /bulletin proxy works in Vite dev (and preview if proxy available) — try FIRST
    try {
      const u = new URL(bulletinUrl);
      const directProxy = u.pathname + u.search;
      if (directProxy.startsWith('/bulletin/')) candidates.push(directProxy);
    } catch {}
  }
  // apiUrl() is absolute on native (the APK has no /api origin) and relative
  // on web, where Pages serves the same function.
  const detailPath = `/api/volcano?detail=1&url=${encodeURIComponent(bulletinUrl)}`;
  const serverlessUrl = apiUrl(detailPath);
  if (!candidates.includes(serverlessUrl)) candidates.push(serverlessUrl);
  const phpUrl = volcanoDetailUrl(bulletinUrl);
  for (const u of expandPhpFailoverUrls(phpUrl)) {
    if (!candidates.includes(u)) candidates.push(u);
  }

  let lastError: unknown = null;
  for (const url of candidates) {
    try {
      const isDirectHtml = url.startsWith('/bulletin/');
      const res = isDirectHtml ? await fetch(url) : await nativeHttpGetWithPhpFailover(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const j = await res.json() as VolcanoDetailResponse;
        // JSON success false with html fallback? try next
        if (j.success) { setDetailCached(bulletinUrl, j); return j; }
        lastError = new Error(j.error || 'API returned no data');
        continue;
      }
      const html = await res.text();
      // Detail pages must contain the bulletin header — hub does not. Reject hub/false positives.
      const isDetailHtml = html && /Summary of 24Hr Observation/i.test(html) && /ALERT LEVEL/i.test(html);
      const isHubHtml = html && /Alert Level Status:/i.test(html) && /Visitors:/i.test(html) && !isDetailHtml;
      if (isHubHtml) {
        lastError = new Error('Received hub instead of bulletin detail — wrong endpoint');
        continue;
      }
      if (isDetailHtml) {
        const detail = parseVolcanoDetailHtml(html, bulletinUrl);
        // Validate we got real detail (not empty hub parse)
        if (Object.keys(detail.parametros).length === 0 && !detail.text.includes('PARAMETERS')) {
          lastError = new Error('Detail parsed empty — upstream returned hub');
          continue;
        }
        const payload: VolcanoDetailResponse = { success: true, count: 1, data: detail };
        setDetailCached(bulletinUrl, payload);
        return payload;
      }
      // Fallback: try parse even if marker missing (e.g. Pinatubo minimal bulletin)
      if (html && /ALERT LEVEL|PARAMETERS/i.test(html)) {
        const detail = parseVolcanoDetailHtml(html, bulletinUrl);
        if (detail.title || Object.keys(detail.parametros).length) {
          const payload: VolcanoDetailResponse = { success: true, count: 1, data: detail };
          setDetailCached(bulletinUrl, payload);
          return payload;
        }
      }
      lastError = new Error('Unexpected response');
    } catch (e) {
      lastError = e;
      continue;
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError ?? 'Failed to load bulletin');
  return { success: false, count: 0, data: { title: '', alertLevel: null, issued: '', text: '', parametros: {}, links: [] }, error: msg };
}

export function alertColor(level: number | null): string {
  if (level === null) return '#6b7280';
  if (level === 0) return '#10b981';
  if (level === 1) return '#eab308';
  if (level === 2) return '#f97316';
  return '#ef4444';
}
export function alertLabel(level: number | null): string {
  if (level === null) return 'Unknown';
  return `Level ${level}`;
}
