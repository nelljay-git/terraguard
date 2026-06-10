export interface PhivolcsEarthquake {
  datetime: string;
  latitude: string;
  longitude: string;
  depth: string;
  magnitude: string;
  location: string;
}

export interface PhivolcsResponse {
  success: boolean;
  count: number;
  data: PhivolcsEarthquake[];
  error?: string;
}

const CACHE_KEY = 'terraguard_phivolcs_cache';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

function getCachedData(): PhivolcsResponse | null {
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
  const res = await fetch('/api/phivolcs');
  if (!res.ok) throw new Error(`Failed to fetch from proxy (${res.status})`);
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const json = (await res.json()) as PhivolcsResponse;
    // API may return 200 with success: false when PHIVOLCS is down
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
      earthquakes.push({
        datetime: cols[0].textContent?.trim() || "",
        latitude: cols[1].textContent?.trim() || "",
        longitude: cols[2].textContent?.trim() || "",
        depth: cols[3].textContent?.trim() || "",
        magnitude: cols[4].textContent?.trim() || "",
        location: cols[5].textContent?.trim() || ""
      });
    }
  });

  return {
    success: true,
    count: earthquakes.length,
    data: earthquakes
  };
}

export async function fetchPhivolcsData(): Promise<PhivolcsResponse> {
  // Try fetching with retries
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fetchOnce();
      // Cache on success
      setCachedData(result);
      return result;
    } catch (error) {
      console.warn(`PHIVOLCS fetch attempt ${attempt}/${MAX_RETRIES} failed:`, error);
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }

  // All retries failed — return cached data if available
  const cached = getCachedData();
  if (cached && cached.data.length > 0) {
    console.info('Using cached PHIVOLCS data');
    return cached;
  }

  // No cache either — return empty data (never throw)
  return { success: false, count: 0, data: [] };
}

export function getSignificantEarthquakes(data: PhivolcsEarthquake[]): PhivolcsEarthquake[] {
  return data.filter(eq => parseFloat(eq.magnitude) >= 4.5);
}

