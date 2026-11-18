// Client for the PHIVOLCS-TSUNAMI bulletin scraper (apiphp/tsunami.php).
//
// No public API exists, so the PHP hosts scrape https://tsunami.phivolcs.dost.gov.ph
// and serve clean JSON. The shape mirrors the PHP implementation:
//
//   events   GET .../tsunami.php?page=events           current-year event table
//   archive  GET .../tsunami.php?page=archive&year=Y   2020-2023 only (legacy pages
//                                                      for 2010-2019 are not parsed;
//                                                      2024+ archives not published yet)
//   detail   GET .../tsunami.php?detail=1&url=<advisory url>
//
// Rows contain everything the list view needs; the advisory *verdict*
// ("NO TSUNAMI THREAT" vs "TSUNAMI THREAT") only lives on the detail page.

import { tsunamiEventsUrl, tsunamiArchiveUrl, tsunamiDetailUrl } from '../lib/apiBase';
import { nativeHttpGetWithPhpFailover } from '../lib/nativeHttp';

export interface TsunamiAdvisory {
  label: string;
  url: string;
  isPdf: boolean;
  number: number | null;
  fileUtc?: string;
}

export interface TsunamiEvent {
  /** Raw PHIVOLCS cell, e.g. "26 Sep 2026 - 05:23 AM" (PST, UTC+8) */
  dateTimePST: string;
  /** ISO 8601 with +08:00 offset, e.g. "2026-09-26T05:23:00+08:00" */
  occurredAtPST: string;
  /** ISO 8601 UTC, e.g. "2026-09-25T21:23:00Z" */
  occurredAtUtc: string;
  latitude: number | null;
  longitude: number | null;
  depth: number | null;
  magnitude: number | null;
  location: string;
  advisories: TsunamiAdvisory[];
  link: string;
}

export interface TsunamiEventsResponse {
  success: boolean;
  page?: string;
  year?: number | null;
  source?: string;
  count: number;
  data: TsunamiEvent[];
  error?: string;
}

export type TsunamiThreat = 'none' | 'information' | 'threat' | 'warning' | 'cancelled' | (string & {});

export interface TsunamiAdvisoryDetail {
  number: number | null;
  headline: string;
  threat: TsunamiThreat;
  occurredAtUtc: string;
  issuedAt: string;
  issuedBy: string;
  latitude: number | null;
  longitude: number | null;
  depth: number | null;
  magnitude: number | null;
  location: string;
  evaluation: string;
  recommendedAction: string;
  important: string;
  url: string;
  isPdf: boolean;
  note?: string;
}

export interface TsunamiDetailResponse {
  success: boolean;
  count: number;
  data: TsunamiAdvisoryDetail;
  error?: string;
}

const EVENTS_CACHE_KEY = 'terraguard_tsunami_cache';
const ARCHIVE_CACHE_PREFIX = 'terraguard_tsunami_archive_';
const DETAIL_CACHE_PREFIX = 'terraguard_tsunami_detail_';
const CACHE_TTL = 10 * 60 * 1000;

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { timestamp: number; payload: T };
    if (Date.now() - parsed.timestamp > CACHE_TTL) return null;
    return parsed.payload;
  } catch { return null; }
}

function writeCache(key: string, payload: unknown): void {
  try { localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), payload })); } catch { /* private mode / quota — cache is best-effort */ }
}

/** Current-year tsunami events from PHIVOLCS. Stale cache is served when both PHP hosts are down. */
export async function fetchTsunamiEvents(): Promise<TsunamiEventsResponse> {
  const cached = readCache<TsunamiEventsResponse>(EVENTS_CACHE_KEY);
  try {
    const res = await nativeHttpGetWithPhpFailover(tsunamiEventsUrl());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as TsunamiEventsResponse;
    if (json.success) writeCache(EVENTS_CACHE_KEY, json);
    return json;
  } catch (e) {
    if (cached) return cached;
    return { success: false, count: 0, data: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Yearly archive (2020–2023). */
export async function fetchTsunamiArchive(year: number): Promise<TsunamiEventsResponse> {
  const cacheKey = `${ARCHIVE_CACHE_PREFIX}${year}`;
  const cached = readCache<TsunamiEventsResponse>(cacheKey);
  try {
    const res = await nativeHttpGetWithPhpFailover(tsunamiArchiveUrl(year));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as TsunamiEventsResponse;
    if (json.success) writeCache(cacheKey, json);
    return json;
  } catch (e) {
    if (cached) return cached;
    return { success: false, count: 0, data: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Full advisory bulletin text for one advisory URL from the event table. */
export async function fetchTsunamiDetail(url: string): Promise<TsunamiDetailResponse> {
  const cacheKey = `${DETAIL_CACHE_PREFIX}${url}`;
  const cached = readCache<TsunamiDetailResponse>(cacheKey);
  if (cached) return cached;
  try {
    const res = await nativeHttpGetWithPhpFailover(tsunamiDetailUrl(url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as TsunamiDetailResponse;
    if (json.success) writeCache(cacheKey, json);
    return json;
  } catch (e) {
    if (cached) return cached;
    return {
      success: false,
      count: 0,
      data: {
        number: null, headline: '', threat: 'information', occurredAtUtc: '',
        issuedAt: '', issuedBy: '', latitude: null, longitude: null, depth: null,
        magnitude: null, location: '', evaluation: '', recommendedAction: '',
        important: '', url, isPdf: /\.pdf$/i.test(url),
      },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function threatColor(threat: TsunamiThreat | null | undefined): string {
  switch ((threat || '').toLowerCase()) {
    case 'none': return '#22c55e';
    case 'information': return '#3b82f6';
    case 'threat': return '#f97316';
    case 'warning': return '#ef4444';
    case 'cancelled': return '#6b7280';
    default: return '#3b82f6';
  }
}

export function threatLabel(threat: TsunamiThreat | null | undefined): string {
  switch ((threat || '').toLowerCase()) {
    case 'none': return 'No Tsunami Threat';
    case 'information': return 'Tsunami Information';
    case 'threat': return 'Tsunami Threat';
    case 'warning': return 'Tsunami Warning';
    case 'cancelled': return 'Threat Cancelled';
    default: return 'Tsunami Information';
  }
}

/** True for verdicts that mean "get off the coast now". */
export function isDangerThreat(threat: TsunamiThreat | null | undefined): boolean {
  const t = (threat || '').toLowerCase();
  return t === 'warning' || t === 'threat';
}

export function formatCoordinates(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return '';
  const latStr = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lngStr = `${Math.abs(lng).toFixed(2)}° ${lng >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lngStr}`;
}
