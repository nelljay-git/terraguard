// APK update check. Reads the public releases repo so the app can tell when a
// newer APK exists. Web/PWA builds ignore this — they update via the service
// worker and use the in-build changelog modal instead.

import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

export const RELEASES_REPO = 'nellcorpio/terraguard-releases';
const LATEST_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
export const APK_DOWNLOAD_URL = `https://github.com/${RELEASES_REPO}/releases/latest/download/app-release.apk`;

export interface LatestRelease {
  version: string;
  name: string;
  notes: string;
  apkUrl: string;
  publishedAt: string;
}

function cleanVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

/** Compare dotted numeric versions (1.9 > 1.10 is false). */
export function isNewerVersion(latest: string, installed: string): boolean {
  const a = cleanVersion(latest).split('.').map((n) => parseInt(n, 10) || 0);
  const b = cleanVersion(installed).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

export async function fetchLatestRelease(timeoutMs = 8000): Promise<LatestRelease | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(LATEST_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;

    const data = await res.json() as {
      tag_name?: string;
      name?: string | null;
      body?: string | null;
      published_at?: string;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };
    const version = cleanVersion(data.tag_name ?? '');
    if (!version) return null;

    const apk = (data.assets ?? []).find((a) => /\.apk$/i.test(a.name ?? ''));
    return {
      version,
      name: data.name ?? '',
      notes: data.body ?? '',
      apkUrl: apk?.browser_download_url ?? APK_DOWNLOAD_URL,
      publishedAt: data.published_at ?? '',
    };
  } catch {
    return null;
  }
}

export async function getInstalledAppVersion(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const info = await CapacitorApp.getInfo();
    return cleanVersion(info.version ?? '');
  } catch {
    return null;
  }
}

/** Returns the latest release only when it is newer than the installed APK. */
export async function checkForApkUpdate(): Promise<LatestRelease | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const [latest, installed] = await Promise.all([fetchLatestRelease(), getInstalledAppVersion()]);
  if (!latest || !installed) return null;
  return isNewerVersion(latest.version, installed) ? latest : null;
}

/** Hand the APK URL to Android's browser/download manager for install. */
export function openApkDownload(url: string): void {
  const win = window.open(url, '_system') ?? window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    window.location.href = url;
  }
}
