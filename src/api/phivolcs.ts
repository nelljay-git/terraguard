export interface PhivolcsEarthquake {
  datetime: string;
  latitude: string;
  longitude: string;
  depth: string;
  magnitude: string;
  location: string;
  link: string;
}

export interface PhivolcsResponse {
  success: boolean;
  count: number;
  data: PhivolcsEarthquake[];
  error?: string;
}

export type Earthquake = PhivolcsEarthquake | UsgsEarthquake;

export interface NormalizedEarthquake extends PhivolcsEarthquake {
  source: 'phivolcs' | 'usgs';
}

export function normalizeEarthquake(eq: Earthquake): NormalizedEarthquake {
  if ('properties' in eq) {
    return {
      source: 'usgs',
      datetime: format(new Date(eq.properties.time), "d MMMM yyyy - hh:mm a"),
      latitude: (Math.round(eq.geometry.coordinates[1] * 100) / 100).toFixed(2),
      longitude: (Math.round(eq.geometry.coordinates[0] * 100) / 100).toFixed(2),
      depth: String(Math.round(eq.geometry.coordinates[2])),
      magnitude: (Math.round(eq.properties.mag * 10) / 10).toFixed(1),
      location: eq.properties.place,
      link: eq.properties.url,
    };
  }
  return { source: 'phivolcs', ...eq };
}

export function normalizeEarthquakes(list: Earthquake[]): NormalizedEarthquake[] {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeEarthquake);
}

export interface EarthquakeDetails {
  origin: string;
  reportedIntensities: string;
  instrumentalIntensities: string;
  note: string;
  mapUrl: string;
}

export interface BulletinRef {
  no: number;
  final: boolean;
  url: string;
}

import { apiUrl } from '../lib/apiBase';
import { nativeHttpGet, IS_NATIVE } from '../lib/nativeHttp';
import { type UsgsEarthquake, fetchUsgsData, getCachedUsgsData, fetchUsgsArchiveData } from './usgs';
import { getPreferredApi } from '../lib/apiPreference';
import { format } from 'date-fns';

const PHIVOLCS_BASE = 'https://earthquake.phivolcs.dost.gov.ph';

const PHIVOLCS_CACHE_KEY = 'terraguard_phivolcs_cache';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;
const FETCH_TIMEOUT_MS = 8000;

export function getCachedPhivolcsData(): PhivolcsResponse | null {
  try {
    const cached = localStorage.getItem(PHIVOLCS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as PhivolcsResponse;
      if (Array.isArray(parsed.data)) return parsed;
    }
  } catch { /* ignore parse errors */ }
  return null;
}

function setPhivolcsCachedData(data: PhivolcsResponse): void {
  try {
    localStorage.setItem(PHIVOLCS_CACHE_KEY, JSON.stringify(data));
  } catch { /* ignore storage errors */ }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function fetchPhivolcsOnce(): Promise<PhivolcsResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Native: scrape PHIVOLCS directly (no CORS-blocking proxy needed).
    // Web/dev: use the local Vite proxy.
    const url = IS_NATIVE ? `${PHIVOLCS_BASE}/` : '/api/phivolcs';
    const res = await nativeHttpGet(url);
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Failed to fetch from proxy (${res.status})`);
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const json = (await res.json()) as PhivolcsResponse;
      if (json.success === false && json.data?.length === 0) {
        throw new Error(json.error || 'PHIVOLCS returned no data');
      }
      return json;
    }

    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const rows = doc.querySelectorAll("table tr");
    const earthquakes: PhivolcsEarthquake[] = [];

    rows.forEach((row) => {
      const cols = row.querySelectorAll("td");
      if (cols.length >= 6) {
        const aTag = cols[0].querySelector('a');
        let link = aTag?.getAttribute('href') || '';
        if (link && !link.startsWith('http')) {
          link = link.replace(/\\/g, '/');
          link = new URL(link, 'https://earthquake.phivolcs.dost.gov.ph/').href;
        }

        earthquakes.push({
          datetime: cols[0].textContent?.trim() || "",
          latitude: cols[1].textContent?.trim() || "",
          longitude: cols[2].textContent?.trim() || "",
          depth: cols[3].textContent?.trim() || "",
          magnitude: cols[4].textContent?.trim() || "",
          location: cols[5].textContent?.trim() || "",
          link: link
        });
      }
    });

    return {
      success: true,
      count: earthquakes.length,
      data: earthquakes
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchPhivolcsData(): Promise<PhivolcsResponse> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fetchPhivolcsOnce();
      setPhivolcsCachedData(result);
      return result;
    } catch (error) {
      console.warn(`PHIVOLCS fetch attempt ${attempt}/${MAX_RETRIES} failed:`, error);
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }

  const cached = getCachedPhivolcsData();
  if (cached && cached.data.length > 0) {
    console.info('Using cached PHIVOLCS data');
    return cached;
  }

  return { success: false, count: 0, data: [] };
}

export async function fetchEarthquakeData(): Promise<
  PhivolcsResponse | { success: boolean; count: number; data: UsgsEarthquake[] }
> {
  if (getPreferredApi() === 'usgs') {
    const usgsData = await fetchUsgsData();
    return { success: true, count: usgsData.length, data: usgsData };
  }
  return fetchPhivolcsData();
}

export function getCachedData(): PhivolcsResponse | { success: boolean; count: number; data: UsgsEarthquake[] } | null {
  if (getPreferredApi() === 'usgs') {
    const usgsData = getCachedUsgsData();
    return { success: true, count: usgsData.length, data: usgsData };
  }
  return getCachedPhivolcsData();
}

export async function fetchArchiveData(
  year: number,
  monthName: string
): Promise<PhivolcsResponse | { success: boolean; count: number; data: UsgsEarthquake[] }> {
  if (getPreferredApi() === 'usgs') {
    const usgsData = await fetchUsgsArchiveData(year, monthName);
    return { success: true, count: usgsData.length, data: usgsData };
  }
  return fetchPhivolcsArchiveData(year, monthName);
}

export async function fetchPhivolcsArchiveData(year: number, monthName: string): Promise<PhivolcsResponse> {
  const path = `EQLatest-Monthly/${year}/${year}_${monthName}.html`;
  // Native: scrape the archive page directly from PHIVOLCS.
  // Dev: Vite proxy handles the path routing. Prod web: Vercel serverless function (?path=).
  const url = IS_NATIVE
    ? `${PHIVOLCS_BASE}/${path}`
    : import.meta.env?.DEV
      ? `/api/phivolcs/${path}`
      : apiUrl(`/api/phivolcs?path=${encodeURIComponent(path)}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await nativeHttpGet(url);
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Failed to fetch archive from proxy (${res.status})`);
    
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as PhivolcsResponse;
      if (json.success === false && json.data?.length === 0) {
        throw new Error(json.error || 'PHIVOLCS returned no data');
      }
      return json;
    }

    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const rows = doc.querySelectorAll("table tr");
    const earthquakes: PhivolcsEarthquake[] = [];

    rows.forEach((row) => {
      const cols = row.querySelectorAll("td");
      if (cols.length >= 6) {
        const aTag = cols[0].querySelector('a');
        let link = aTag?.getAttribute('href') || '';
        if (link && !link.startsWith('http')) {
          link = link.replace(/\\/g, '/');
          const baseUrl = `https://earthquake.phivolcs.dost.gov.ph/EQLatest-Monthly/${year}/`;
          link = new URL(link, baseUrl).href;
        }

        earthquakes.push({
          datetime: cols[0].textContent?.trim() || "",
          latitude: cols[1].textContent?.trim() || "",
          longitude: cols[2].textContent?.trim() || "",
          depth: cols[3].textContent?.trim() || "",
          magnitude: cols[4].textContent?.trim() || "",
          location: cols[5].textContent?.trim() || "",
          link: link
        });
      }
    });

    return {
      success: true,
      count: earthquakes.length,
      data: earthquakes
    };
  } catch (error) {
    console.warn(`PHIVOLCS archive fetch failed for ${year} ${monthName}:`, error);
    return { success: false, count: 0, data: [] };
  } finally {
    clearTimeout(timeout);
  }
}

export function getSignificantEarthquakes<T extends Earthquake>(data: T[]): T[] {
  return data.filter(eq => {
    if ('magnitude' in eq) {
      return parseFloat(eq.magnitude) >= 4.5;
    } else if ('properties' in eq) {
      return eq.properties.mag >= 4.5;
    }
    return false;
  });
}

// Discover all bulletins (Information No. 1, 2, ... Final) PHIVOLCS published for
// the same earthquake sequence by probing candidate URLs derived from the link.
export async function fetchBulletins(link: string): Promise<BulletinRef[]> {
  const m = /^(.+)_B(\d+)(F)?\.html$/i.exec(link);
  if (!m) return [];

  const prefix = m[1];
  const build = (n: number, final: boolean) => `${prefix}_B${n}${final ? 'F' : ''}.html`;

  // In a native shell, probe candidate URLs by scraping PHIVOLCS directly (CORS-free).
  if (IS_NATIVE) {
    const exists = async (url: string): Promise<boolean> => {
      try {
        const res = await nativeHttpGet(url);
        if (!res.ok) return false;
        const html = await res.text();
        return /EARTHQUAKE INFORMATION/i.test(html);
      } catch {
        return false;
      }
    };

    const results: BulletinRef[] = [];
    for (let n = 1; n <= 8; n++) {
      const [plain, final] = await Promise.all([exists(build(n, false)), exists(build(n, true))]);
      if (!plain && !final) break;
      if (plain) results.push({ no: n, final: false, url: build(n, false) });
      if (final) results.push({ no: n, final: true, url: build(n, true) });
    }
    return results;
  }

  // In production web, let the serverless function do the probing (no CORS / rate limits).
  if (!import.meta.env?.DEV) {
    try {
      const res = await fetch(apiUrl(`/api/bulletins?url=${encodeURIComponent(link)}`));
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) return json.data as BulletinRef[];
      }
    } catch (e) {
      console.warn('Failed to fetch bulletins from API', e);
    }
    return [];
  }

  // In dev, probe candidate URLs through the Vite PHIVOLCS proxy.
  const exists = async (url: string): Promise<boolean> => {
    try {
      const local = url.replace('https://earthquake.phivolcs.dost.gov.ph', '/api/phivolcs');
      const res = await fetch(local);
      if (!res.ok) return false;
      const html = await res.text();
      return /EARTHQUAKE INFORMATION/i.test(html);
    } catch {
      return false;
    }
  };

  const results: BulletinRef[] = [];
  for (let n = 1; n <= 8; n++) {
    const [plain, final] = await Promise.all([exists(build(n, false)), exists(build(n, true))]);
    if (!plain && !final) break;
    if (plain) results.push({ no: n, final: false, url: build(n, false) });
    if (final) results.push({ no: n, final: true, url: build(n, true) });
  }
  return results;
}

const USGS_ROMAN_LEVELS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function usgsRomanIntensity(value: number): string {
  const level = Math.max(1, Math.min(12, Math.round(value)));
  return USGS_ROMAN_LEVELS[level - 1];
}

async function fetchUsgsProductJson(
  product: { contents?: Record<string, { url: string }> } | undefined,
  fileName: string
): Promise<any> {
  const url = product?.contents?.[fileName]?.url;
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.warn(`Failed to fetch USGS product ${fileName}:`, error);
    return null;
  }
}

function cleanUsgsIntensityName(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/UTM:\([^)]*\)/g, '')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/^[,\s;]+|[,\s;]+$/g, '')
    .trim();
}

function cleanUsgsStationName(raw: string, code?: string): string {
  const cleaned = cleanUsgsIntensityName(raw);
  if (cleaned) {
    return cleaned.replace(/^(GEOFON Station\s*)+/i, 'GEOFON Station ').trim();
  }
  return code || '';
}

function buildUsgsIntensityList(
  rows: { name?: string; level: number; extra?: string }[],
  perLineCap = 12
): string {
  const groups = new Map<number, { names: string[]; dropped: number }>();
  for (const row of rows) {
    if (!row.name) continue;
    const level = Math.max(1, Math.min(12, Math.round(row.level)));
    if (!groups.has(level)) groups.set(level, { names: [], dropped: 0 });
    const group = groups.get(level)!;
    if (group.names.length < perLineCap) {
      group.names.push(row.extra ? `${row.name} (${row.extra})` : row.name);
    } else {
      group.dropped += 1;
    }
  }
  return [...groups.keys()]
    .sort((a, b) => b - a)
    .map((level) => {
      const group = groups.get(level)!;
      const tail = group.dropped > 0 ? ` and ${group.dropped} more` : '';
      return `Intensity ${usgsRomanIntensity(level)} - ${group.names.join(', ')}${tail}`;
    })
    .join('\n');
}

async function buildUsgsReportedIntensities(dyfi: any, p: any): Promise<string> {
  const geo = await fetchUsgsProductJson(dyfi, 'dyfi_geo_10km.geojson');
  if (geo?.features?.length) {
    const rows = geo.features
      .filter((f: any) => f?.properties?.cdi != null && f.properties.name)
      .map((f: any) => ({
        name: cleanUsgsIntensityName(f.properties.name),
        level: f.properties.cdi,
        extra:
          f.properties.nresp != null
            ? `${f.properties.nresp} ${f.properties.nresp === 1 ? 'response' : 'responses'}`
            : undefined,
      }));
    const lines = buildUsgsIntensityList(rows);
    if (lines) return lines;
  }
  if (p?.cdi != null) {
    const felt =
      typeof p.felt === 'number'
        ? ` (${p.felt.toLocaleString()} felt ${p.felt === 1 ? 'report' : 'reports'})`
        : '';
    return `Intensity ${usgsRomanIntensity(p.cdi)} - Reported intensity via Did You Feel It?${felt}`;
  }
  return '';
}

function formatUsgsPopulationK(pop: number): string {
  if (!pop || pop < 0) return '';
  return Math.round(pop / 1000).toLocaleString('en-US');
}

async function buildUsgsPagerCities(losspager: any): Promise<string> {
  const cities = await fetchUsgsProductJson(losspager, 'cities.json');
  const list = cities?.all_cities;
  if (!Array.isArray(list) || list.length === 0) return '';
  const lines: string[] = [];
  for (const c of list) {
    if (!c?.name || c?.mmi == null || isNaN(Number(c.mmi))) continue;
    const pop = formatUsgsPopulationK(c.pop);
    lines.push(
      `Intensity ${usgsRomanIntensity(Number(c.mmi))} - ${c.name}${pop ? ` (${pop} k)` : ''}`
    );
  }
  return lines.join('\n');
}

function cleanUsgsHtmlText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildUsgsOrigin(products: any, p: any): string {
  const generalText = products?.['general-text']?.[0];
  if (generalText?.contents) {
    const entry = Object.values<any>(generalText.contents).find(
      (c: any) => typeof c?.bytes === 'string' && c.bytes.includes('Tectonic Summary')
    );
    if (entry) {
      const sectionStart = entry.bytes.indexOf('Tectonic Summary');
      const afterHeading = entry.bytes.slice(sectionStart + 'Tectonic Summary'.length);
      const nextHeading = afterHeading.search(/<h2/i);
      const section = nextHeading > 0 ? afterHeading.slice(0, nextHeading) : afterHeading;
      const firstParagraph = section.split(/<\/p>/i)[0] || section;
      const text = cleanUsgsHtmlText(firstParagraph);
      if (text) return text;
    }
  }
  if (p?.type) {
    const originTypes: Record<string, string> = {
      earthquake: 'Tectonic (fault movement)',
      'quarry blast': 'Quarry blast',
      'nuclear explosion': 'Nuclear explosion',
      'volcanic eruption': 'Volcanic eruption',
      'ice quake': 'Ice quake',
      'induced or triggered event': 'Induced or triggered event',
    };
    return originTypes[p.type] || p.type;
  }
  return 'Unknown';
}

function buildUsgsMapUrl(products: any, p: any): string {
  const dyfi = products?.dyfi?.[0];
  if (dyfi?.contents) {
    const entries = Object.values<any>(dyfi.contents);
    const geo = entries.find((c: any) => /_ciim_geo\.jpg$/i.test(c?.url || ''));
    const plain = entries.find((c: any) => /_ciim\.jpg$/i.test(c?.url || ''));
    const url = (geo || plain)?.url;
    if (url) return url;
  }
  const shakemap = products?.shakemap?.[0];
  if (shakemap?.contents) {
    const intensity = Object.values<any>(shakemap.contents).find((c: any) =>
      /download\/intensity\.(jpg|png)$/i.test(c?.url || '')
    );
    if (intensity?.url) return intensity.url;
  }
  return p?.url || '';
}

async function buildUsgsInstrumentalIntensities(shakemap: any, losspager: any, p: any): Promise<string> {
  const pagerCities = await buildUsgsPagerCities(losspager);
  if (pagerCities) return pagerCities;

  const stations = await fetchUsgsProductJson(shakemap, 'download/stationlist.json');
  if (stations?.features?.length) {
    const rows = stations.features
      .filter((f: any) => {
        const value = f?.properties?.intensity;
        return value != null && value !== 'null' && !isNaN(Number(value));
      })
      .map((f: any) => ({
        name: cleanUsgsStationName(f.properties.name, f.properties.code),
        level: Number(f.properties.intensity),
      }));
    const lines = buildUsgsIntensityList(rows);
    if (lines) return lines;
  }
  if (p?.mmi != null) {
    return `Intensity ${usgsRomanIntensity(p.mmi)} - Estimated instrumental intensity (ShakeMap)`;
  }
  return '';
}

export async function fetchEarthquakeDetails(url: string): Promise<EarthquakeDetails | null> {
  // USGS event links don't map to PHIVOLCS pages; pull the event from the USGS
  // GeoJSON API instead (CORS is open on the USGS feeds).
  if (/earthquake\.usgs\.gov/.test(url)) {
    try {
      const idMatch = /eventpage\/([^/?#]+)/.exec(url);
      if (idMatch) {
        const res = await fetch(
          `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(idMatch[1])}`
        );
        if (res.ok) {
          const feature = await res.json();
          const p = feature?.properties;
          if (p) {
            const products = p.products || {};
            const [reported, instrumental] = await Promise.all([
              buildUsgsReportedIntensities(products.dyfi?.[0], p),
              buildUsgsInstrumentalIntensities(
                products.shakemap?.[0],
                products.losspager?.[0],
                p
              ),
            ]);
            const bits: string[] = [];
            if (typeof p.felt === 'number') {
              bits.push(`${p.felt.toLocaleString()} felt ${p.felt === 1 ? 'report' : 'reports'}`);
            }
            if (p.alert) bits.push(`Alert level: ${p.alert}`);
            return {
              origin: buildUsgsOrigin(products, p),
              reportedIntensities: reported,
              instrumentalIntensities: instrumental,
              note: bits.join(' \u00b7 '),
              mapUrl: buildUsgsMapUrl(products, p),
            };
          }
        }
      }
    } catch (error) {
      console.warn('Failed to fetch USGS details:', error);
    }
    return null;
  }

  try {
    // In a native shell, scrape the details page directly from PHIVOLCS (CORS-free).
    if (IS_NATIVE) {
      const htmlRes = await nativeHttpGet(url);
      if (!htmlRes.ok) throw new Error('Failed to fetch details HTML');
      const html = await htmlRes.text();
      return parseDetailsHtml(html, url);
    }

    // Try Vercel serverless function only in production web
    // This prevents Vite from erroneously trying to compile api/details.ts
    if (!import.meta.env?.DEV) {
      const res = await fetch(apiUrl(`/api/details?url=${encodeURIComponent(url)}`));
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          if (json.success) return json.data;
        }
      }
    }

    // Fallback for local Vite dev environment
    // Use the Vite proxy to fetch the HTML directly
    const localProxyUrl = url.replace('https://earthquake.phivolcs.dost.gov.ph', '/api/phivolcs');
    const htmlRes = await fetch(localProxyUrl);
    if (!htmlRes.ok) throw new Error('Failed to fetch details HTML');
    const html = await htmlRes.text();
    return parseDetailsHtml(html, url);
  } catch (error) {
    console.warn('Failed to fetch earthquake details:', error);
  }
  return null;
}

function parseDetailsHtml(html: string, url: string): EarthquakeDetails {
  const cleanText = html
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const originMatch = /Origin\s*:\s*(.*?)\s*Magnitude/i.exec(cleanText);
  const origin = originMatch ? originMatch[1].trim() : 'Unknown';

  const reportedMatch = /Reported Intensities\s*:\s*(.*?)(?:Instrumental Intensities|This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
  const reported = reportedMatch ? reportedMatch[1].replace(/^[a-zA-Z0-9_.\s]+Intensity/i, 'Intensity').trim() : '';

  const instrumentalMatch = /Instrumental Intensities\s*:?\s*(.*?)(?:This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
  const instrumental = instrumentalMatch ? instrumentalMatch[1].trim() : '';

  const noteMatch = /(This is an aftershock.*?)(?:Expecting Damage|$)/i.exec(cleanText);
  const note = noteMatch ? noteMatch[1].trim() : '';

  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let imgMatch;
  let mapUrl = '';
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const src = imgMatch[1].trim();
    if (!src.toLowerCase().includes('logo') && !src.toLowerCase().includes('header')) {
      mapUrl = src;
      break;
    }
  }

  if (mapUrl && !mapUrl.startsWith('http')) {
    const urlObj = new URL(url);
    mapUrl = urlObj.origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1) + mapUrl;
  }

  return {
    origin,
    reportedIntensities: reported,
    instrumentalIntensities: instrumental,
    note,
    mapUrl
  };
}

