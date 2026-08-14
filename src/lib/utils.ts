import { type ClassValue, clsx } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatMagnitude(mag: number): string {
  return mag.toFixed(1);
}

export function getSeverityColor(mag: number): string {
  if (mag < 3.0) return "var(--color-micro)";
  if (mag < 4.0) return "var(--color-minor)";
  if (mag < 5.0) return "var(--color-light)";
  if (mag < 6.0) return "var(--color-moderate)";
  if (mag < 7.0) return "var(--color-strong)";
  return "var(--color-major)";
}

export function getSeverityLabel(mag: number): string {
  if (mag < 3.0) return "Micro";
  if (mag < 4.0) return "Minor";
  if (mag < 5.0) return "Light";
  if (mag < 6.0) return "Moderate";
  if (mag < 7.0) return "Strong";
  return "Major";
}

// Great-circle distance in km between two lat/lng points.
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Compact relative time for an event's origin time, e.g. "3d 4h ago". Returns
// an empty string when the timestamp can't be parsed. Pass `now` to make the
// label live-update without relying on Date.now() at render time.
export function timeAgo(date: Date | null, now: number = Date.now()): string {
  if (!date) return '';
  const diffMs = now - date.getTime();
  if (diffMs < 0 || diffMs < 60_000) return 'Just now';

  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ${hours % 24}h ago`;

  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}w ${days % 7}d ago`;

  const months = Math.floor(days / 30);
  if (days < 365) return `${months}mo ${days % 30}d ago`;

  const years = Math.floor(days / 365);
  return `${years}y ${Math.floor((days % 365) / 30)}mo ago`;
}
