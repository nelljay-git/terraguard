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
