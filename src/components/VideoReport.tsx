/* eslint-disable react-refresh/only-export-components --
   Pure render pieces in this file are intentionally shared with the free
   headless renderer (scripts/video-entry.ts: GitHub Actions + node-canvas
   + FFmpeg). The default export below is still the only component. */
import { useEffect, useRef, useState } from 'react';
import { X, Download, Clapperboard } from 'lucide-react';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import { estimateAffectedRadiusKm, estimateDamage, type ShakeRow } from '../lib/videoMeta';
import './VideoReport.css';

// Staged video export of the earthquake report, rendered + captured
// fully in-browser (canvas.captureStream + MediaRecorder — no server).
//
// Timeline (~14s): plain map (0-1s) -> epicenter pop (1s) -> shockwave
// spreading across the map (3s, ~1s) -> styled info cards fade/slide in
// (4s) -> idle drift until the end.

export const W = 1080;
export const H = 1440;
export const FPS = 60;
export const DUR = 14;
export const MAP_T = 1; // epicenter appears
export const WAVE_T = 3; // shockwave starts
export const WAVE_DUR = 0.9;
export const INFO_T = 4; // info cards appear
// Mosaic: 5 cols x 6 rows of 256px Esri tiles (same map as the app),
// covering the canvas with a slight crop. Epicenter lands at canvas center.
export const COLS = 5;
export const ROWS = 6;
export const TILE = 256;

function zoomForMag(magRaw: string): number {
  const m = parseFloat(magRaw);
  if (isNaN(m)) return 7;
  if (m >= 7) return 6;
  if (m >= 6) return 7;
  return 8;
}

// Direct Esri tile URLs (no proxy). Shared with the headless renderer;
// the browser component wraps these in /api/tile?src= for CORS.
export function esriTileUrls(eq: PhivolcsEarthquake): string[] {
  const lat = parseFloat(eq.latitude);
  const lng = parseFloat(eq.longitude);
  const z = zoomForMag(eq.magnitude);
  const n = 2 ** z;
  const rad = ((isNaN(lat) ? 0 : lat) * Math.PI) / 180;
  const gx = (((isNaN(lng) ? 0 : lng) + 180) / 360) * n;
  const gy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const cx = Math.floor(gx);
  const cy = Math.floor(gy);
  const urls: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    const y = Math.max(0, Math.min(n - 1, cy + Math.round(r - (ROWS - 1) / 2)));
    for (let c = 0; c < COLS; c++) {
      const x = (((cx + Math.round(c - (COLS - 1) / 2)) % n) + n) % n;
      const esri = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      urls.push(esri);
    }
  }
  return urls;
}

function tileUrls(eq: PhivolcsEarthquake): string[] {
  return esriTileUrls(eq).map((u) => `/api/tile?src=${encodeURIComponent(u)}`);
}

// Epicenter position inside the COLSxROWS mosaic (tile px), for the
// zoom-about-point math in drawFrame.
export function epicenterMosaicPx(eq: PhivolcsEarthquake): { epx: number; epy: number } {
  const lat = parseFloat(eq.latitude);
  const lng = parseFloat(eq.longitude);
  const z = zoomForMag(eq.magnitude);
  const n = 2 ** z;
  const rad = ((isNaN(lat) ? 0 : lat) * Math.PI) / 180;
  const gx = (((isNaN(lng) ? 0 : lng) + 180) / 360) * n * TILE;
  const gy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n * TILE;
  const cx = Math.floor(gx / TILE);
  const cy = Math.floor(gy / TILE);
  const x0 = (cx + Math.round(0 - (COLS - 1) / 2)) * TILE;
  const y0 = (cy + Math.round(0 - (ROWS - 1) / 2)) * TILE;
  return { epx: gx - x0, epy: gy - y0 };
}

function loadImage(src: string): Promise<{ img: HTMLImageElement | null; status: string }> {
  // Fetch first (same-origin proxy) so failures carry an HTTP status for
  // diagnostics; an <img> error event alone tells us nothing.
  return fetch(src)
    .then(async (res) => {
      if (!res.ok) return { img: null, status: `HTTP ${res.status}` };
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      return new Promise<{ img: HTMLImageElement | null; status: string }>((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ img: image, status: 'ok' });
        image.onerror = () => {
          URL.revokeObjectURL(objUrl);
          resolve({ img: null, status: 'decode-failed' });
        };
        image.src = objUrl;
      });
    })
    .catch((e: unknown) => ({ img: null, status: e instanceof Error ? e.message : 'network-failed' }));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function severityWord(magRaw: string): [string, string] {
  const m = parseFloat(magRaw);
  if (isNaN(m)) return ['Unknown', '#9ca3af'];
  if (m < 3) return ['Micro', '#22c55e'];
  if (m < 4) return ['Minor', '#60a5fa'];
  if (m < 5) return ['Light', '#eab308'];
  if (m < 6) return ['Moderate', '#f97316'];
  if (m < 7) return ['Strong', '#ef4444'];
  return ['Major', '#a78bfa'];
}

function countryOf(location: string): string {
  const loc = (location || '').trim();
  if (!loc) return '';
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  const raw = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  const clean = raw.replace(/\(.*?\)/g, ' ').trim();
  if (!clean || clean.length > 30 || clean.split(/\s+/).length > 3) return '';
  return clean
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function threatColor(label: string): string {
  if (!label) return '#9ca3af';
  const s = label.toLowerCase();
  if (/no|none/.test(s)) return '#22c55e';
  if (/warning/.test(s)) return '#ef4444';
  if (/advisory|watch/.test(s)) return '#fbbf24';
  return '#ffffff';
}

function shakeChipColor(intensity: string): string {
  switch (intensity.toUpperCase()) {
    case 'I':
    case 'II':
      return '#16a34a';
    case 'III':
    case 'IV':
      return '#ca8a04';
    case 'V':
    case 'VI':
      return '#ea580c';
    default:
      return '#dc2626';
  }
}

export interface MosaicView {
  mosaic: HTMLCanvasElement;
  /** Epicenter display point (canvas px, zoom pivot). */
  exD: number;
  eyD: number;
}

// Display scale for the 1280x1536 mosaic on the 1080x1440 canvas.
export const MOSAIC_D = Math.max(W / (COLS * TILE), H / (ROWS * TILE));

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  view: MosaicView | null,
  eq: PhivolcsEarthquake,
  intensity: string,
  threat: string,
  shakes: ShakeRow[],
  t: number,
) {
  const p = Math.min(Math.max(t / DUR, 0), 1);
  // Slow zoom 1.0 -> 1.08 around the epicenter display point.
  const s = 1 + 0.08 * easeInOut(p);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, W, H);
  // Single pre-composited blit per frame (smooth even while encoding).
  if (view) {
    const { mosaic, exD, eyD } = view;
    ctx.save();
    ctx.translate(exD, eyD);
    ctx.scale(s, s);
    ctx.translate(-exD, -eyD);
    ctx.drawImage(mosaic, (W - COLS * TILE * MOSAIC_D) / 2, (H - ROWS * TILE * MOSAIC_D) / 2, COLS * TILE * MOSAIC_D, ROWS * TILE * MOSAIC_D);
    ctx.restore();
  } else {
    // No map tiles: keep the backdrop dark. Overlays (epicenter, info)
    // still draw below, so the video stays usable.
  }
  // Cinematic map vignette: clear center, darkened corners/edges. Always
  // on, part of the map look (not tied to the info reveal).
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  vg.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // Watermark: vertical "TERRA GUARD PH" on the right center, 50% opacity.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.translate(W - 44, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 24px Oswald, Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TERRA GUARD PH', 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';
  const dex = view ? view.exD : W / 2;
  const dey = view ? view.eyD : H / 2;
  const magText = eq.magnitude || '?';
  const [sevWord, sevColor] = severityWord(eq.magnitude);

  // Header bar removed per design (clean map opening).

  // Expanding solid glow behind the epicenter: discs scale up and fade
  // out, then loop. Starts after the shockwave with a 1s fade-in.
  const GLOW_T = WAVE_T + WAVE_DUR;
  if (t >= GLOW_T) {
    const fade = Math.min((t - GLOW_T) / 1.0, 1);
    ctx.save();
    ctx.fillStyle = sevColor;
    for (let k = 0; k < 2; k++) {
      const phase = ((((t - GLOW_T) * 0.45 + k / 2) % 1) + 1) % 1;
      ctx.globalAlpha = fade * 0.28 * (1 - phase);
      ctx.beginPath();
      ctx.arc(dex, dey, 60 + phase * 150, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Magnitude badge on the epicenter (t>=2), severity-colored.
  if (t >= MAP_T) {
    const sc = easeOutBack(Math.min((t - MAP_T) / 0.4, 1));
    const badgeR = 54 * Math.max(sc, 0.01);
    ctx.beginPath();
    ctx.arc(dex, dey, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = sevColor;
    ctx.fill();
    if (sc > 0.6 && t >= INFO_T) {
      ctx.save();
      ctx.globalAlpha = Math.min((t - INFO_T) / 0.3, 1);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 44px Oswald, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(magText, dex, dey + 15 * Math.min(sc, 1));
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }

  // Shockwave: fast expanding front(s) right after the epicenter shows.
  for (const delay of [0, 0.16]) {
    const wt = (t - WAVE_T - delay) / WAVE_DUR;
    if (wt < 0 || wt > 1) continue;
    const r = 45 + easeOutCubic(wt) * 1140;
    ctx.beginPath();
    ctx.arc(dex, dey, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(239,68,68,${(0.85 * (1 - wt)).toFixed(3)})`;
    ctx.lineWidth = 9 * (1 - wt) + 2;
    ctx.stroke();
  }

  // Broadcast data columns + callout + intensity scale (t>=INFO_T).
  if (t >= INFO_T) {
    const q = easeOutCubic(Math.min((t - INFO_T) / 0.7, 1));
    ctx.save();
    ctx.globalAlpha = q;
    ctx.textAlign = 'left';

    const depthNum = eq.depth || '?';
    const depthTag = (() => {
      const d = parseFloat(eq.depth);
      return !isNaN(d) && d >= 70 ? 'Deep' : 'Shallow';
    })();
    const coordsText = `${eq.latitude || '?'}°N, ${eq.longitude || '?'}°E`;
    const timeText = (eq.datetime || '').slice(0, 44);
    const country = countryOf(eq.location);
    const radius = estimateAffectedRadiusKm(eq.magnitude) || '—';
    const threatText = threat || '—';

    const colTop = 60;
    // Left column: EVENT DATA (drawn at 64% scale).
    const lx = 48;
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(lx, colTop - 7, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.font = '400 15px Inter, sans-serif';
    ctx.fillText('EVENT DATA', lx + 18, colTop);
    let ly = colTop + 35;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 14px Inter, sans-serif';
    ctx.fillText('MAGNITUDE', lx, ly);
    ly += 58;
    ctx.fillStyle = sevColor;
    ctx.font = '700 56px Oswald, Inter, sans-serif';
    ctx.fillText(magText, lx, ly);
    const magW = ctx.measureText(magText).width;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 18px Inter, sans-serif';
    ctx.fillText(sevWord, lx + magW + 10, ly);
    ly += 36;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 14px Inter, sans-serif';
    ctx.fillText('DEPTH', lx, ly);
    ly += 26;
    ctx.fillStyle = '#ffffff';
    ctx.font = '400 19px Inter, sans-serif';
    ctx.fillText(`${depthNum} km`, lx, ly);
    ly += 24;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 17px Inter, sans-serif';
    ctx.fillText(`(${depthTag})`, lx, ly);
    ly += 30;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 14px Inter, sans-serif';
    ctx.fillText('COORDINATES', lx, ly);
    ly += 26;
    ctx.fillStyle = '#ffffff';
    ctx.font = '400 19px Inter, sans-serif';
    ctx.fillText(coordsText, lx, ly);
    ly += 30;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 14px Inter, sans-serif';
    ctx.fillText('DATE & TIME', lx, ly);
    ly += 26;
    ctx.fillStyle = '#ffffff';
    ctx.font = '400 19px Inter, sans-serif';
    ctx.fillText(timeText.slice(0, 34), lx, ly);

    // Right column: IMPACT DATA (drawn at 64% scale, right-aligned).
    const re = W - 64; // right edge of the column (clears the watermark)
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fbbf24';
    ctx.font = '400 15px Inter, sans-serif';
    ctx.fillText('IMPACT DATA', re, colTop);
    const impactW = ctx.measureText('IMPACT DATA').width;
    ctx.beginPath();
    ctx.arc(re - impactW - 18, colTop - 7, 5, 0, Math.PI * 2);
    ctx.fill();
    let ry = colTop + 35;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 13px Inter, sans-serif';
    ctx.fillText('MAX INTENSITY', re, ry);
    ry += 40;
    // Intensity badge.
    ctx.fillStyle = 'rgba(127,29,29,0.92)';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(re - 77, ry - 26, 77, 34, 6);
      ctx.fill();
    } else {
      ctx.fillRect(re - 77, ry - 26, 77, 34);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 19px Oswald, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(intensity || '—', re - 38, ry);
    ctx.textAlign = 'right';
    ry += 34;
    const rightRows: Array<[string, string, string]> = [
      ['TSUNAMI THREAT', threatText, threatColor(threatText)],
      ['EVENT TYPE', 'Earthquake', '#60a5fa'],
      ['COUNTRY', country || '—', '#ffffff'],
      ['LOCATION', '', '#ffffff'],
    ];
    for (const [label, value, color] of rightRows) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '400 13px Inter, sans-serif';
      ctx.fillText(label, re, ry);
      ry += 26;
      if (value) {
        ctx.fillStyle = color;
        ctx.font = '400 19px Inter, sans-serif';
        ctx.fillText(value.slice(0, 26), re, ry);
        ry += 28;
      }
    }
    // Location can wrap to two lines.
    const locWords = (eq.location || '').split(/\s+/).filter(Boolean);
    const locLines: string[] = [];
    let locCur = '';
    ctx.font = '400 19px Inter, sans-serif';
    for (const w of locWords) {
      const trial = locCur ? `${locCur} ${w}` : w;
      if (ctx.measureText(trial).width <= 230 || !locCur) {
        locCur = trial;
      } else {
        locLines.push(locCur);
        if (locLines.length >= 2) {
          locCur = '';
          break;
        }
        locCur = w;
      }
    }
    if (locCur && locLines.length < 2) locLines.push(locCur);
    ctx.fillStyle = '#ffffff';
    for (const line of locLines.slice(0, 2)) {
      ctx.fillText(line, re, ry);
      ry += 26;
    }
    // Affected radius caps the column.
    ry += 4;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 13px Inter, sans-serif';
    ctx.fillText('AFFECTED RADIUS', re, ry);
    ry += 26;
    ctx.fillStyle = '#ffffff';
    ctx.font = '400 19px Inter, sans-serif';
    ctx.fillText(radius, re, ry);
    ctx.textAlign = 'left';

    // SHAKE REPORT (bottom-left): strongest felt areas with intensity,
    // bottom-anchored so the last row sits near the progress bar. Falls
    // back to the max intensity + epicenter location when no per-area
    // rows were parsed; with neither, a muted line holds the slot.
    const shakeList: ShakeRow[] =
      shakes.length > 0
        ? shakes.slice(0, 4)
        : intensity
          ? [{ area: (eq.location || '').slice(0, 30) || 'Epicenter area', intensity }]
          : [];
    {
      const rows = shakeList.length > 0 ? shakeList.length : 1;
      const lastBaseline = 1360;
      const firstBaseline = lastBaseline - (rows - 1) * 38;
      const headY = firstBaseline - 40;
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(48, headY - 7, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.font = '400 15px Inter, sans-serif';
      ctx.fillText('SHAKE REPORT', 66, headY);
      ctx.font = '400 19px Inter, sans-serif';
      let sy = firstBaseline;
      if (shakeList.length === 0) {
        ctx.fillStyle = '#6b7280';
        ctx.fillText('No official data yet', 48, sy);
      }
      for (const row of shakeList) {
        ctx.fillStyle = '#ffffff';
        const area = row.area.slice(0, 28);
        ctx.fillText(area, 48, sy);
        const chipLabel = row.intensity || '?';
      ctx.font = '700 16px Oswald, Inter, sans-serif';
      const chipW = Math.max(35, ctx.measureText(chipLabel).width + 20);
      const bx = 48 + 275;
        ctx.fillStyle = shakeChipColor(row.intensity);
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(bx, sy - 24, chipW, 29, 6);
          ctx.fill();
        } else {
          ctx.fillRect(bx, sy - 24, chipW, 29);
        }
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(chipLabel, bx + chipW / 2, sy - 3);
        ctx.textAlign = 'left';
        ctx.font = '400 19px Inter, sans-serif';
        sy += 38;
      }
    }

    // DAMAGE ASSESSMENT (bottom-right): rough heuristic estimates from
    // magnitude — wide "~" ranges, never precise figures. Bottom-anchored.
    const dmg = estimateDamage(eq.magnitude, intensity);
    if (dmg) {
      const dx0 = 648;
      const dmgValY = 1360;
      const dmgLblY = dmgValY - 34;
      const ecoValY = dmgValY - 68;
      const ecoLblY = ecoValY - 34;
      const dmgHeadY = ecoLblY - 40;
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(dx0, dmgHeadY - 7, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.font = '400 15px Inter, sans-serif';
      ctx.fillText('DAMAGE ASSESSMENT', dx0 + 18, dmgHeadY);
      const sevBadge = (baseY: number, value: string) => {
        ctx.fillStyle = '#ffffff';
        ctx.font = '400 24px Inter, sans-serif';
        ctx.fillText(value, dx0, baseY);
        const vw = ctx.measureText(value).width;
        ctx.font = '700 16px Oswald, Inter, sans-serif';
        const bw = Math.max(70, ctx.measureText(sevWord).width + 22);
        const bx = dx0 + vw + 18;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx, baseY - 26, bw, 32);
        ctx.strokeStyle = sevColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, baseY - 26, bw, 32);
        ctx.fillStyle = sevColor;
        ctx.textAlign = 'center';
        ctx.fillText(sevWord, bx + bw / 2, baseY - 4);
        ctx.textAlign = 'left';
      };
      ctx.fillStyle = '#9ca3af';
      ctx.font = '400 13px Inter, sans-serif';
      ctx.fillText('ECONOMIC LOSSES', dx0, ecoLblY);
      sevBadge(ecoValY, dmg.losses);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '400 13px Inter, sans-serif';
      ctx.fillText('DAMAGE & FATALITIES', dx0, dmgLblY);
      sevBadge(dmgValY, dmg.fatalities);
    }

    ctx.restore();
  }

  // Bottom progress bar.
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(0, H - 12, W, 12);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(0, H - 12, W * p, 12);
}

function pickMime(): string {
  const cands = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const c of cands) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return '';
}

type Phase = 'loading' | 'preview' | 'recording' | 'done' | 'unsupported';

export function VideoReportModal({
  earthquake,
  intensity,
  tsunamiThreat,
  shakes,
  onClose,
}: {
  earthquake: PhivolcsEarthquake;
  intensity?: string;
  tsunamiThreat?: string;
  shakes?: ShakeRow[];
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const viewRef = useRef<MosaicView | null>(null);
  const intensityRef = useRef<string>(intensity ?? '');
  useEffect(() => {
    intensityRef.current = intensity ?? '';
  }, [intensity]);
  const threatRef = useRef<string>(tsunamiThreat ?? '');
  useEffect(() => {
    threatRef.current = tsunamiThreat ?? '';
  }, [tsunamiThreat]);
  const shakesRef = useRef<ShakeRow[]>(shakes ?? []);
  useEffect(() => {
    shakesRef.current = shakes ?? [];
  }, [shakes]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [mime, setMime] = useState<string>('');
  const [mapError, setMapError] = useState<string>('');

  // Load map tiles once.
  useEffect(() => {
    let cancelled = false;
    try {
      const fonts = (document as Document).fonts;
      fonts?.load?.('700 120px Oswald').catch(() => {});
      fonts?.load?.('400 30px Inter').catch(() => {});
    } catch {
      /* ignore */
    }
    const urls = tileUrls(earthquake);
    Promise.all(urls.map(loadImage)).then((results) => {
      if (cancelled) return;
      const failures = results
        .map((r, i) => ({ ...r, i }))
        .filter((r) => !r.img)
        .map((r) => `tile${r.i}:${r.status}`);
      if (failures.length > 0) {
        console.error('[VideoReport] tile load failures:', failures.join(' '), '— is /api/tile deployed? Plain `vite` dev does not serve functions/.');
      }
      if (failures.length === results.length) {
        setMapError('Map tiles failed to load. Deploy the site (functions require the Pages runtime — plain vite dev has no /api/*) and retry.');
        viewRef.current = null;
      } else {
        // Pre-composite once: per-frame work drops to a single blit,
        // which keeps recording smooth while the encoder runs hot.
        const mosaic = document.createElement('canvas');
        mosaic.width = COLS * TILE;
        mosaic.height = ROWS * TILE;
        const mctx = mosaic.getContext('2d');
        if (mctx) {
          mctx.fillStyle = '#0a0d12';
          mctx.fillRect(0, 0, mosaic.width, mosaic.height);
          results.forEach((r, i) => {
            if (!r.img) return;
            const c = i % COLS;
            const rr2 = Math.floor(i / COLS);
            mctx.drawImage(r.img, c * TILE, rr2 * TILE, TILE, TILE);
          });
        }
        const { epx, epy } = epicenterMosaicPx(earthquake);
        viewRef.current = {
          mosaic,
          exD: (W - COLS * TILE * MOSAIC_D) / 2 + epx * MOSAIC_D,
          eyD: (H - ROWS * TILE * MOSAIC_D) / 2 + epy * MOSAIC_D,
        };
      }
      setPhase('preview');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render loop: preview loops forever; recording runs once then stops.
  useEffect(() => {
    if (phase !== 'preview' && phase !== 'recording') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      if (phase === 'recording' && t >= DUR) {
        drawFrame(ctx, viewRef.current, earthquake, intensityRef.current, threatRef.current, shakesRef.current, DUR);
        recRef.current?.stop();
        return;
      }
      drawFrame(ctx, viewRef.current, earthquake, intensityRef.current, threatRef.current, shakesRef.current, phase === 'preview' ? t % (DUR + 1) : t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Cleanup recorder + audio context + object URL on unmount.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (recRef.current && recRef.current.state !== 'inactive') {
        try {
          recRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stream = typeof canvas.captureStream === 'function' ? canvas.captureStream(FPS) : null;
    if (!stream) {
      setPhase('unsupported');
      return;
    }
    const type = pickMime();
    if (!type) {
      setPhase('unsupported');
      return;
    }
    // Timed sound effects: the same three MP3s the headless renderer
    // mixes, scheduled against the recording clock and captured through
    // a MediaStreamDestination (plus live monitor so you hear it too).
    // Created here (user gesture) so autoplay policy allows playback.
    // Any failure degrades to the previous silent recording.
    let recordStream: MediaStream = stream;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        const actx = new AC({ sampleRate: 48000 });
        audioCtxRef.current = actx;
        await actx.resume().catch(() => {});
        const files = ['epicenter-appear.mp3', 'wave-spread.mp3', 'reports.mp3'];
        const at = [1.0, 3.0, 4.0];
        const dest = actx.createMediaStreamDestination();
        const t0 = actx.currentTime + 0.05;
        await Promise.all(
          files.map(async (f, i) => {
            const res = await fetch(`/sounds/${f}`);
            if (!res.ok) return;
            const buf = await actx.decodeAudioData(await res.arrayBuffer());
            const src = actx.createBufferSource();
            src.buffer = buf;
            const g = actx.createGain();
            g.gain.value = 1.0;
            src.connect(g);
            g.connect(dest);
            g.connect(actx.destination);
            src.start(t0 + at[i]);
          }),
        );
        const audioTracks = dest.stream.getAudioTracks();
        if (audioTracks.length > 0) {
          recordStream = new MediaStream([...stream.getVideoTracks(), ...audioTracks]);
        }
      }
    } catch (e) {
      console.error('[VideoReport] sound setup failed, recording silent:', e instanceof Error ? e.message : e);
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(recordStream, { mimeType: type, videoBitsPerSecond: 24_000_000, audioBitsPerSecond: 128_000 });
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(blob));
      setPhase('done');
    };
    recRef.current = rec;
    setMime(type);
    setPhase('recording');
    rec.start(250);
  };

  const ext = mime.includes('mp4') ? 'mp4' : 'webm';

  return (
    <div className="video-modal-backdrop" onClick={onClose}>
      <div className="video-modal glass" onClick={(e) => e.stopPropagation()}>
        <div className="video-modal-head">
          <span className="flex-center" style={{ gap: '8px' }}>
            <Clapperboard size={18} />
            Video Report (~14s)
          </span>
          <button type="button" className="action-btn glass flex-center" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {phase === 'loading' && <p className="text-muted">Loading map…</p>}
        {mapError && (phase === 'preview' || phase === 'done') && (
          <p className="text-muted" style={{ color: '#f59e0b' }}>
            No map tiles: {mapError}
          </p>
        )}
        {phase === 'unsupported' && <p className="text-muted">Video recording is not supported in this browser.</p>}
        <canvas ref={canvasRef} width={W} height={H} className="video-canvas" />
        {phase === 'preview' && (
          <button type="button" className="action-btn glass flex-center" onClick={startRecording}>
            <Clapperboard size={16} />
            <span>Record video</span>
          </button>
        )}
        {phase === 'recording' && <p className="text-muted">Recording… keep this tab visible.</p>}
        {phase === 'done' && videoUrl && (
          <div className="video-result">
            <video src={videoUrl} controls playsInline className="video-preview" />
            <a className="action-btn glass flex-center" href={videoUrl} download={`terraguard-report.${ext}`}>
              <Download size={16} />
              <span>Download .{ext}</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
