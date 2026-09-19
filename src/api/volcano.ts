import { volcanoListUrl } from '../lib/apiBase';
import { nativeHttpGet, IS_NATIVE } from '../lib/nativeHttp';

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
  // Try cache first for instant paint
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = IS_NATIVE ? 'https://wovodat.phivolcs.dost.gov.ph/bulletin/list-of-bulletin' : volcanoListUrl();
    // Native fetches hub directly; web goes via PHP
    const res = IS_NATIVE ? await fetch(url, { signal: controller.signal }) : await nativeHttpGet(url);
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const json = await res.json() as VolcanoHubResponse;
      if (json.success) setCache(json);
      return json;
    }
    // Fallback: if native got HTML, parse minimal (should not happen via PHP)
    return { success: false, page: 'hub', source: url, issued: '', count: 0, data: [], error: 'Unexpected HTML response' };
  } catch (e) {
    clearTimeout(timeout);
    const cached = getCached();
    if (cached) return cached;
    return { success: false, page: 'hub', source: '', issued: '', count: 0, data: [], error: e instanceof Error ? e.message : String(e) };
  }
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
