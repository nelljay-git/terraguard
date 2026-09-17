// USGS "Did You Feel It?" response points for the video report.
//
// Two entry paths, both DOM-free so the browser modal and the headless
// node renderer share them:
//   1. usgsEventId known (USGS-source events) -> straight to the event.
//   2. otherwise -> match the quake against the ComCat catalog by time +
//      coordinates (same ±36h / ±2° window + scoring the Details page uses),
//      then load that event's DYFI product.
//
// The stations file (dyfi_geo.geojson) holds individual felt responses as
// Point features with a `cdi` property. Events without DYFI data (most
// non-US quakes) resolve to [], and the video simply draws nothing.
// Every failure path returns [] — DYFI must never block a render.

export interface DyfiPoint {
  lat: number;
  lng: number;
  cdi: number | null;
}

export interface DyfiQuery {
  usgsEventId?: string;
  datetime?: string;
  source?: string;
  latitude?: string;
  longitude?: string;
}

const USGS_QUERY = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
// Canvas arcs are cheap, but a big US event can ship 10k+ responses;
// stride-sample down to this cap while keeping spatial spread.
const MAX_POINTS = 600;

function parseComponentsAsUtcMs(s: string): number | null {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*-\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s.trim());
  if (!m) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mi = months.indexOf(m[2].slice(0, 3).toLowerCase());
  if (mi === -1) return null;
  let hour = parseInt(m[4], 10);
  const ap = (m[7] || '').toUpperCase();
  if (ap === 'PM' && hour < 12) hour += 12;
  if (ap === 'AM' && hour === 12) hour = 0;
  const t = Date.UTC(parseInt(m[3], 10), mi, parseInt(m[1], 10), hour, parseInt(m[5], 10), m[6] ? parseInt(m[6], 10) : 0);
  return isNaN(t) ? null : t;
}

// Normalized USGS/EMSC datetimes are UTC strings; PHIVOLCS keeps the
// Philippine-Time source string, so shift -8h (mirrors Details.tsx).
export function quakeTimeToUtcMs(datetime: string | undefined, source: string | undefined): number | null {
  if (!datetime) return null;
  const ms = parseComponentsAsUtcMs(datetime);
  if (ms == null) return null;
  if (/UTC/i.test(datetime)) return ms;
  return source === 'phivolcs' ? ms - 8 * 3600 * 1000 : ms;
}

async function fetchJson(url: string, timeoutMs: number): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function resolveEventId(utcMs: number, lat: number, lng: number, timeoutMs: number): Promise<string | null> {
  const params = new URLSearchParams({
    format: 'geojson',
    starttime: new Date(utcMs - 36 * 3600 * 1000).toISOString(),
    endtime: new Date(utcMs + 36 * 3600 * 1000).toISOString(),
    minlatitude: String(lat - 2),
    maxlatitude: String(lat + 2),
    minlongitude: String(lng - 2),
    maxlongitude: String(lng + 2),
    orderby: 'time',
    limit: '200',
  });
  const data = await fetchJson(`${USGS_QUERY}?${params}`, timeoutMs);
  const features: any[] = data?.features ?? [];
  let bestId: string | null = null;
  let bestScore = Infinity;
  for (const f of features) {
    const t = f?.properties?.time;
    const c = f?.geometry?.coordinates;
    if (typeof t !== 'number' || !Array.isArray(c)) continue;
    const timeDiffH = Math.abs(t - utcMs) / 3600000;
    const coordDist = Math.hypot(c[1] - lat, c[0] - lng);
    // Tight gate: a loose PHT/UTC mixup must never match a neighbor event.
    if (timeDiffH > 12 || coordDist > 2) continue;
    const score = timeDiffH * 2 + coordDist;
    if (score < bestScore) {
      bestScore = score;
      bestId = typeof f.id === 'string' ? f.id : null;
    }
  }
  return bestId;
}

export async function fetchDyfiPoints(q: DyfiQuery, timeoutMs = 9000): Promise<DyfiPoint[]> {
  try {
    let eventId = q.usgsEventId;
    if (!eventId) {
      const utcMs = quakeTimeToUtcMs(q.datetime, q.source);
      const lat = parseFloat(q.latitude || '');
      const lng = parseFloat(q.longitude || '');
      if (utcMs == null || isNaN(lat) || isNaN(lng)) return [];
      eventId = (await resolveEventId(utcMs, lat, lng, timeoutMs)) ?? undefined;
      if (!eventId) return [];
    }
    const detail = await fetchJson(`${USGS_QUERY}?format=geojson&eventid=${encodeURIComponent(eventId)}`, timeoutMs);
    const url = detail?.properties?.products?.dyfi?.[0]?.contents?.['dyfi_geo.geojson']?.url;
    if (typeof url !== 'string' || !url) return [];
    const gj = await fetchJson(url, timeoutMs);
    const feats: any[] = gj?.features ?? [];
    const pts: DyfiPoint[] = [];
    for (const f of feats) {
      if (f?.geometry?.type !== 'Point') continue;
      const c = f.geometry.coordinates;
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
      const cdiRaw = typeof f?.properties?.cdi === 'number' ? f.properties.cdi : parseFloat(f?.properties?.cdi);
      pts.push({ lat: c[1], lng: c[0], cdi: isNaN(cdiRaw) ? null : cdiRaw });
    }
    if (pts.length > MAX_POINTS) {
      const stride = pts.length / MAX_POINTS;
      const sampled: DyfiPoint[] = [];
      for (let i = 0; i < MAX_POINTS; i++) sampled.push(pts[Math.floor(i * stride)]);
      return sampled;
    }
    return pts;
  } catch {
    return [];
  }
}
