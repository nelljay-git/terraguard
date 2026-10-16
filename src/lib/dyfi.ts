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

// Pick the DYFI responses geojson from a product's contents map. Current
// events publish exactly 'dyfi_geo.geojson'; older ones (e.g. 2017
// Tehuantepec) only carry variants like 'dyfi_geo_10km.geojson' — an
// exact-key lookup silently yields zero dots for those.
export function pickDyfiGeojsonUrl(contents: unknown): string | null {
  if (!contents || typeof contents !== 'object') return null;
  const keys = Object.keys(contents as Record<string, unknown>);
  const rank = (k: string): number => {
    if (k === 'dyfi_geo.geojson') return 0;
    if (/dyfi.*10km.*\.geojson$/i.test(k)) return 1;
    if (/dyfi.*\.geojson$/i.test(k)) return 2;
    return 3;
  };
  const cands = keys
    .filter((k) => /\.geojson$/i.test(k) && /dyfi/i.test(k))
    .sort((a, b) => rank(a) - rank(b));
  if (cands.length === 0) return null;
  const entry = (contents as Record<string, { url?: unknown }>)[cands[0]];
  return typeof entry?.url === 'string' ? entry.url : null;
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

const ROMAN_1_TO_12 = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function romanIntensity(value: number): string {
  const level = Math.max(1, Math.min(12, Math.round(value)));
  return ROMAN_1_TO_12[level];
}

// "UTM:(15P 056 164 10000)<br>Mazatán" -> "Mazatán" (mirrors the
// Details-page builder so headless rows read identically).
function cleanIntensityName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  return raw
    .replace(/UTM:\([^)]*\)/g, '')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/^[,\s;]+|[,\s;]+$/g, '')
    .trim();
}

// Felt-report TEXT in the exact "Intensity V - Name (2 responses)" format
// the Details page builds, so the headless auto renderer lists the same
// rows the manual modal shows. Empty string when unavailable (never throws).
export async function fetchDyfiShakeText(usgsEventId: string, timeoutMs = 9000): Promise<string> {
  try {
    if (!usgsEventId) return '';
    const detail = await fetchJson(`${USGS_QUERY}?format=geojson&eventid=${encodeURIComponent(usgsEventId)}`, timeoutMs);
    const url = pickDyfiGeojsonUrl(detail?.properties?.products?.dyfi?.[0]?.contents);
    if (!url) return '';
    const gj = await fetchJson(url, timeoutMs);
    const feats: any[] = gj?.features ?? [];
    const groups = new Map<number, { names: string[]; dropped: number }>();
    for (const f of feats) {
      const name = cleanIntensityName(f?.properties?.name);
      const cdiRaw = typeof f?.properties?.cdi === 'number' ? f.properties.cdi : parseFloat(f?.properties?.cdi);
      if (!name || isNaN(cdiRaw)) continue;
      const level = Math.max(1, Math.min(12, Math.round(cdiRaw)));
      if (!groups.has(level)) groups.set(level, { names: [], dropped: 0 });
      const group = groups.get(level)!;
      const nresp = f?.properties?.nresp;
      const extra =
        typeof nresp === 'number' ? `${nresp} ${nresp === 1 ? 'response' : 'responses'}` : undefined;
      if (group.names.length < 12) {
        group.names.push(extra ? `${name} (${extra})` : name);
      } else {
        group.dropped += 1;
      }
    }
    return [...groups.keys()]
      .sort((a, b) => b - a)
      .map((level) => {
        const group = groups.get(level)!;
        const tail = group.dropped > 0 ? ` and ${group.dropped} more` : '';
        return `Intensity ${romanIntensity(level)} - ${group.names.join(', ')}${tail}`;
      })
      .join('\n');
  } catch {
    return '';
  }
}

// Instrumental felt text from PAGER cities.json in the exact
// "Intensity V - Name (2 k)" format the Details page builds (pop shown in
// thousands). Empty string when unavailable (never throws).
export async function fetchUsgsCityShakeText(usgsEventId: string, timeoutMs = 9000): Promise<string> {
  try {
    if (!usgsEventId) return '';
    const detail = await fetchJson(`${USGS_QUERY}?format=geojson&eventid=${encodeURIComponent(usgsEventId)}`, timeoutMs);
    const products = detail?.properties?.products ?? {};
    const pager = Array.isArray(products.losspager) ? products.losspager[0] : undefined;
    const contents = pager?.contents ?? {};
    const entry = contents['cities.json'] ?? contents['json/cities.json'];
    const url = typeof entry?.url === 'string' ? entry.url : null;
    if (!url) return '';
    const cities = await fetchJson(url, timeoutMs);
    const list = cities?.all_cities;
    if (!Array.isArray(list) || list.length === 0) return '';
    const lines: string[] = [];
    for (const c of list) {
      if (!c?.name || c?.mmi == null || isNaN(Number(c.mmi))) continue;
      const pop = typeof c.pop === 'number' && c.pop > 0 ? Math.round(c.pop / 1000).toLocaleString('en-US') : '';
      lines.push(`Intensity ${romanIntensity(Number(c.mmi))} - ${c.name}${pop ? ` (${pop} k)` : ''}`);
    }
    return lines.join('\n');
  } catch {
    return '';
  }
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
    const url = pickDyfiGeojsonUrl(detail?.properties?.products?.dyfi?.[0]?.contents);
    if (!url) return [];
    const gj = await fetchJson(url, timeoutMs);
    const feats: any[] = gj?.features ?? [];
    const pts: DyfiPoint[] = [];
    // Centroid of a Polygon exterior ring (gridded products like
    // dyfi_geo_10km.geojson aggregate responses into cells).
    const centroid = (rings: unknown): [number, number] | null => {
      const outer = Array.isArray(rings) ? (rings as unknown[])[0] : null;
      if (!Array.isArray(outer) || outer.length === 0) return null;
      let sx = 0, sy = 0, n = 0;
      for (const p of outer as unknown[]) {
        const q = p as unknown[];
        if (Array.isArray(q) && typeof q[0] === 'number' && typeof q[1] === 'number') {
          sx += q[0] as number;
          sy += q[1] as number;
          n++;
        }
      }
      return n > 0 ? [sx / n, sy / n] : null;
    };
    for (const f of feats) {
      const gtype = f?.geometry?.type;
      let lng: number | null = null;
      let lat: number | null = null;
      if (gtype === 'Point') {
        const c = f.geometry.coordinates;
        if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
          lng = c[0];
          lat = c[1];
        }
      } else if (gtype === 'Polygon') {
        const cc = centroid(f.geometry.coordinates);
        if (cc) {
          lng = cc[0];
          lat = cc[1];
        }
      } else {
        continue;
      }
      if (lng == null || lat == null) continue;
      const cdiRaw = typeof f?.properties?.cdi === 'number' ? f.properties.cdi : parseFloat(f?.properties?.cdi);
      pts.push({ lat, lng, cdi: isNaN(cdiRaw) ? null : cdiRaw });
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
