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

export interface EarthquakeDetails {
  origin: string;
  reportedIntensities: string;
  instrumentalIntensities: string;
  note: string;
  mapUrl: string;
}

const CACHE_KEY = 'terraguard_phivolcs_cache';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;
const FETCH_TIMEOUT_MS = 8000;

export function getCachedData(): PhivolcsResponse | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as PhivolcsResponse;
    }
  } catch { /* ignore parse errors */ }
  return null;
}

function setCachedData(data: PhivolcsResponse): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* ignore storage errors */ }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchOnce(): Promise<PhivolcsResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch('/api/phivolcs', { signal: controller.signal });
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
      const result = await fetchOnce();
      setCachedData(result);
      return result;
    } catch (error) {
      console.warn(`PHIVOLCS fetch attempt ${attempt}/${MAX_RETRIES} failed:`, error);
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }

  const cached = getCachedData();
  if (cached && cached.data.length > 0) {
    console.info('Using cached PHIVOLCS data');
    return cached;
  }

  return { success: false, count: 0, data: [] };
}

export async function fetchPhivolcsArchiveData(year: number, monthName: string): Promise<PhivolcsResponse> {
  const path = `EQLatest-Monthly/${year}/${year}_${monthName}.html`;
  // In dev, Vite proxy handles the path routing. In prod, Vercel serverless function expects a ?path= query.
  const url = import.meta.env?.DEV 
    ? `/api/phivolcs/${path}` 
    : `/api/phivolcs?path=${encodeURIComponent(path)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
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

export function getSignificantEarthquakes(data: PhivolcsEarthquake[]): PhivolcsEarthquake[] {
  return data.filter(eq => parseFloat(eq.magnitude) >= 4.5);
}

export async function fetchEarthquakeDetails(url: string): Promise<EarthquakeDetails | null> {
  try {
    // Try Vercel serverless function only in production
    // This prevents Vite from erroneously trying to compile api/details.ts
    if (!import.meta.env?.DEV) {
      const res = await fetch(`/api/details?url=${encodeURIComponent(url)}`);
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
    
    const cleanText = html
      .replace(/&nbsp;/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const originMatch = /Origin\s*:\s*(.*?)\s*Magnitude/i.exec(cleanText);
    const origin = originMatch ? originMatch[1].trim() : 'Unknown';

    const reportedMatch = /Reported Intensities\s*:\s*(.*?)(?:Instrumental Intensities|This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
    let reported = reportedMatch ? reportedMatch[1].replace(/^[a-zA-Z0-9_.\s]+Intensity/i, 'Intensity').trim() : '';

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
  } catch (error) {
    console.warn('Failed to fetch earthquake details:', error);
  }
  return null;
}

