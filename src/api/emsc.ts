/**
 * EMSC (Euro-Mediterranean Seismological Centre) via SeismicPortal FDSNWS
 * Docs: https://www.seismicportal.eu/fdsn-wsevent.html
 * Verified live 2026-09-07: https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=1
 * No auth, CORS enabled, limit max 20000, 204 nodata when empty.
 */

export interface EmscEarthquake {
  id: string; // unid e.g. 20260907_0000152
  properties: {
    unid: string;
    source_id: string;
    source_catalog: string; // EMSC-RTS, EMSC-EMB
    time: string; // ISO8601 UTC "2026-09-07T13:17:15.454784Z"
    lastupdate: string;
    lat: number;
    lon: number;
    depth: number; // km, positive
    mag: number;
    magtype: string;
    flynn_region: string;
    auth: string;
    evtype: string;
  };
  geometry: {
    type: string;
    coordinates: [number, number, number]; // [lon, lat, depth_m] depth negative metres!
  };
  type: string;
}

interface EmscFeature {
  id: string;
  type: string;
  properties: EmscEarthquake["properties"];
  geometry: EmscEarthquake["geometry"];
}

interface EmscResponse {
  type: string;
  features: EmscFeature[];
}

const EMSC_BASE = "https://www.seismicportal.eu/fdsnws/event/1/query";
const CACHE_KEY = "terraguard_emsc_cache";
const FETCH_TIMEOUT_MS = 10000;

export async function fetchEmscData(): Promise<EmscEarthquake[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Live: full UTC day (no 100 cap) — if today is 00:05 Sept 23 UTC, shows Sept 22; otherwise today
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (now.getUTCHours() < 3) target.setUTCDate(target.getUTCDate() - 1);
    const dayStart = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(),0,0,0,0));
    const dayEnd = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(),23,59,59,999));
    const params = new URLSearchParams({
      format: 'json',
      limit: '20000',
      orderby: 'time',
      minmag: '1.0',
      starttime: dayStart.toISOString(),
      endtime: dayEnd.toISOString(),
    });
    const url = `${EMSC_BASE}?${params}`;
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`EMSC ${res.status}`);
    const data = (await res.json()) as EmscResponse;
    const eqs: EmscEarthquake[] = (data.features ?? []).map((f) => ({
      id: f.id,
      properties: f.properties,
      geometry: f.geometry,
      type: f.type,
    }));
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(eqs)); } catch {}
    return eqs;
  } catch (e) {
    console.error("EMSC fetch failed", e);
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as unknown;
        if (Array.isArray(parsed)) return parsed as EmscEarthquake[];
      }
    } catch {}
    return [];
  } finally { clearTimeout(timeout); }
}

export function getCachedEmscData(): EmscEarthquake[] {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as unknown;
      if (Array.isArray(parsed)) return parsed as EmscEarthquake[];
    }
  } catch {}
  return [];
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export async function fetchEmscArchiveData(year: number, monthName: string): Promise<EmscEarthquake[]> {
  const mi = MONTHS.indexOf(monthName);
  if (mi < 0) return [];
  const start = new Date(Date.UTC(year, mi, 1));
  const end = new Date(Date.UTC(year, mi + 1, 1));
  const params = new URLSearchParams({
    format: "json",
    starttime: start.toISOString(),
    endtime: end.toISOString(),
    orderby: "time",
    limit: "20000",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${EMSC_BASE}?${params}`, { signal: controller.signal });
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`EMSC archive ${res.status}`);
    const data = (await res.json()) as EmscResponse;
    return (data.features ?? []).map((f) => ({
      id: f.id,
      properties: f.properties,
      geometry: f.geometry,
      type: f.type,
    }));
  } catch (e) {
    console.error("EMSC archive failed", e);
    return [];
  } finally { clearTimeout(timeout); }
}
