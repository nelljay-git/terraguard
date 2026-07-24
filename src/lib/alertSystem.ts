import type { PhivolcsEarthquake } from '../api/phivolcs';
import type { AlertZone } from '../types/alerts';
import {
  getAlertZones,
  getAlertSettings,
  wasAlreadyNotified,
  markAsNotified,
  purgeStaleNotifications,
} from './alertStorage';
import { isQuietHours, sendNotification } from './notifications';
import { getSeverityLabel } from './utils';

const EARTH_RADIUS_KM = 6371;

export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function makeEarthquakeKey(eq: PhivolcsEarthquake): string {
  return `${eq.datetime}|${eq.latitude}|${eq.longitude}`;
}

export function buildNotificationPayload(
  eq: PhivolcsEarthquake,
  zone: AlertZone,
): { title: string; body: string; tag: string } {
  const mag = parseFloat(eq.magnitude);
  const label = getSeverityLabel(mag);
  return {
    title: `M${eq.magnitude} ${label} Earthquake`,
    body: `${eq.location} — ${eq.datetime}. Depth: ${eq.depth} km. Matched zone: ${zone.name}`,
    tag: `eq-${makeEarthquakeKey(eq)}`,
  };
}

export function checkAlerts(earthquakes: PhivolcsEarthquake[]): void {
  const zones = getAlertZones();
  const settings = getAlertSettings();

  if (!settings.notificationsEnabled || zones.length === 0) return;
  if (isQuietHours(settings.quietHoursStart, settings.quietHoursEnd)) return;

  purgeStaleNotifications();

  for (const eq of earthquakes) {
    const mag = parseFloat(eq.magnitude);
    const lat = parseFloat(eq.latitude);
    const lng = parseFloat(eq.longitude);
    if (isNaN(mag) || isNaN(lat) || isNaN(lng)) continue;

    const key = makeEarthquakeKey(eq);
    if (wasAlreadyNotified(key)) continue;

    for (const zone of zones) {
      if (!zone.enabled) continue;
      if (mag < zone.magnitudeThreshold) continue;

      const dist = haversineDistance(zone.latitude, zone.longitude, lat, lng);
      if (dist <= zone.radiusKm) {
        const payload = buildNotificationPayload(eq, zone);
        sendNotification(payload.title, {
          body: payload.body,
          tag: payload.tag,
        });
        markAsNotified(key);
        break;
      }
    }
  }
}
