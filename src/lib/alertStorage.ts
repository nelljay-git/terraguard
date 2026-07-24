import type { AlertZone, AlertSettings, NotifiedEvent } from '../types/alerts';
import { DEFAULT_ALERT_SETTINGS } from '../types/alerts';

const ZONES_KEY = 'terraguard_alert_zones';
const SETTINGS_KEY = 'terraguard_alert_settings';
const NOTIFIED_KEY = 'terraguard_notified_events';
const NOTIFIED_TTL_MS = 24 * 60 * 60 * 1000;

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded or storage error — silently ignore
  }
}

export function getAlertZones(): AlertZone[] {
  return safeGet<AlertZone[]>(ZONES_KEY, []);
}

export function saveAlertZones(zones: AlertZone[]): void {
  safeSet(ZONES_KEY, zones);
}

export function addAlertZone(zone: AlertZone): void {
  const zones = getAlertZones();
  zones.push(zone);
  saveAlertZones(zones);
}

export function updateAlertZone(id: string, updates: Partial<AlertZone>): void {
  const zones = getAlertZones();
  const idx = zones.findIndex(z => z.id === id);
  if (idx !== -1) {
    zones[idx] = { ...zones[idx], ...updates };
    saveAlertZones(zones);
  }
}

export function deleteAlertZone(id: string): void {
  const zones = getAlertZones().filter(z => z.id !== id);
  saveAlertZones(zones);
}

export function getAlertSettings(): AlertSettings {
  return safeGet<AlertSettings>(SETTINGS_KEY, DEFAULT_ALERT_SETTINGS);
}

export function saveAlertSettings(settings: AlertSettings): void {
  safeSet(SETTINGS_KEY, settings);
}

export function getNotifiedEvents(): NotifiedEvent[] {
  return safeGet<NotifiedEvent[]>(NOTIFIED_KEY, []);
}

export function purgeStaleNotifications(): void {
  const now = Date.now();
  const events = getNotifiedEvents().filter(e => now - e.timestamp < NOTIFIED_TTL_MS);
  safeSet(NOTIFIED_KEY, events);
}

export function wasAlreadyNotified(key: string): boolean {
  return getNotifiedEvents().some(e => e.key === key && Date.now() - e.timestamp < NOTIFIED_TTL_MS);
}

export function markAsNotified(key: string): void {
  const events = getNotifiedEvents();
  events.push({ key, timestamp: Date.now() });
  safeSet(NOTIFIED_KEY, events);
}
