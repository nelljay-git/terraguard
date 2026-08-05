export interface UsgsEarthquake {
  id: string;
  properties: {
    mag: number;
    place: string;
    time: number;
    updated: number;
    tz: number;
    url: string;
    detail: string;
    felt: number | null;
    cdi: number | null;
    mmi: number | null;
    alert: string | null;
    status: string;
    tsunami: number;
    sig: number;
    net: string;
    code: string;
    ids: string;
    sources: string;
    types: string;
    nst: number | null;
    dmin: number | null;
    rms: number;
    gap: number | null;
    magType: string;
    type: string;
    title: string;
  };
  geometry: {
    type: string;
    coordinates: [number, number, number]; // [longitude, latitude, depth]
  };
  type: string;
}

interface UsgsFeature {
  id: string;
  type: string;
  properties: UsgsEarthquake['properties'];
  geometry: UsgsEarthquake['geometry'];
}

interface UsgsResponse {
  features: UsgsFeature[];
}

const USGS_BASE_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary';
const CACHE_KEY = 'terraguard_usgs_cache';
const FETCH_TIMEOUT_MS = 10000;

export async function fetchUsgsData(): Promise<UsgsEarthquake[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${USGS_BASE_URL}/all_day.geojson`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`USGS API responded with status ${response.status}`);
    }
    const data = (await response.json()) as UsgsResponse;
    const earthquakes: UsgsEarthquake[] = (data.features ?? []).map((feature) => ({
      id: feature.id,
      properties: feature.properties,
      geometry: feature.geometry,
      type: feature.type,
    }));

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(earthquakes));
    } catch { /* ignore storage errors */ }

    return earthquakes;
  } catch (error) {
    console.error('Error fetching USGS data:', error);
    let cachedData: string | null = null;
    try {
      cachedData = localStorage.getItem(CACHE_KEY);
    } catch { /* ignore storage errors */ }
    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData) as unknown;
        if (Array.isArray(parsed)) return parsed as UsgsEarthquake[];
      } catch { /* ignore parse errors */ }
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export function getCachedUsgsData(): UsgsEarthquake[] {
  let cachedData: string | null = null;
  try {
    cachedData = localStorage.getItem(CACHE_KEY);
  } catch { /* ignore storage errors */ }
  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData) as unknown;
      if (Array.isArray(parsed)) return parsed as UsgsEarthquake[];
    } catch { /* ignore parse errors */ }
  }
  return [];
}

const ARCHIVE_QUERY_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export async function fetchUsgsArchiveData(year: number, monthName: string): Promise<UsgsEarthquake[]> {
  const monthIndex = MONTHS.indexOf(monthName);
  if (monthIndex < 0) return [];

  const startDate = new Date(Date.UTC(year, monthIndex, 1));
  const endDate = new Date(Date.UTC(year, monthIndex + 1, 1));
  const params = new URLSearchParams({
    format: 'geojson',
    starttime: startDate.toISOString(),
    endtime: endDate.toISOString(),
    orderby: 'time',
    limit: '20000',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${ARCHIVE_QUERY_URL}?${params}`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`USGS archive API responded with status ${response.status}`);
    }
    const data = (await response.json()) as UsgsResponse;
    return (data.features ?? []).map((feature) => ({
      id: feature.id,
      properties: feature.properties,
      geometry: feature.geometry,
      type: feature.type,
    }));
  } catch (error) {
    console.error('Error fetching USGS archive data:', error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
