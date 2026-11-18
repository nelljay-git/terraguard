// Opt-in, on-device-only "distance from me" support.
// Coordinates are stored in localStorage (never sent anywhere) and only used
// to compute haversine distances to earthquakes for display.

import { haversineKm } from './utils';

export interface UserCoords {
  lat: number;
  lng: number;
}

const STORAGE_KEY = 'terraguard_user_location';

export function getStoredUserCoords(): UserCoords | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserCoords> | null;
    if (
      parsed != null &&
      typeof parsed.lat === 'number' &&
      typeof parsed.lng === 'number' &&
      Math.abs(parsed.lat) <= 90 &&
      Math.abs(parsed.lng) <= 180
    ) {
      return { lat: parsed.lat, lng: parsed.lng };
    }
    return null;
  } catch {
    return null;
  }
}

export function storeUserCoords(coords: UserCoords): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(coords));
  } catch {
    /* private mode — distance chips just won't survive reload */
  }
}

export function clearUserCoords(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Ask the browser for a one-off position (10s timeout, low accuracy by design). */
export function requestUserCoords(): Promise<UserCoords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('Geolocation is not available on this device'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission denied — allow location access in your browser to see distances'
              : 'Unable to determine your location'
          )
        ),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

/** Distance between the user and a quake given as string/number coords. null when unparsable. */
export function distanceKm(user: UserCoords, latRaw: string | number, lngRaw: string | number): number | null {
  const lat = typeof latRaw === 'string' ? Number.parseFloat(latRaw) : latRaw;
  const lng = typeof lngRaw === 'string' ? Number.parseFloat(lngRaw) : lngRaw;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return haversineKm(user.lat, user.lng, lat, lng);
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return '<1 km';
  return `${Math.round(km).toLocaleString()} km`;
}
