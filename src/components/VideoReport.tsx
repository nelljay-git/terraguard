/* eslint-disable react-refresh/only-export-components --
   Pure render pieces in this file are intentionally shared with the free
   headless renderer (scripts/video-entry.ts: GitHub Actions + node-canvas
   + FFmpeg). The default export below is still the only component. */
import { useEffect, useRef, useState } from 'react';
import { X, Download, Clapperboard } from 'lucide-react';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import { estimateAffectedRadiusKm, estimateDamage, isKnownIntensity, type ShakeRow } from '../lib/videoMeta';
import type { DyfiPoint } from '../lib/dyfi';
import { fetchDyfiPoints } from '../lib/dyfi';
import { mmiColor } from '../lib/usgsOverlays';
import './VideoReport.css';

// Staged video export of the earthquake report, rendered + captured
// fully in-browser (canvas.captureStream + MediaRecorder — no server).
//
// Timeline (~20s): tight on the epicenter (slow push-in) with three
// anticipation rings across the 5s intro -> epicenter pop (5s) + tsunami
// toast when a real threat exists (5s slide-down, visible ~3s, slim strip
// after) -> shockwave spreading across the map (6-8.8s) -> 3s beat ->
// pull out to full context as sections cascade in (11.8-13s) -> DYFI felt
// responses fade in (2.5s) -> styled info cards fade/slide in (4s) -> idle
// drift until end.

export const W = 1080;
export const H = 1440;
export const FPS = 60;
export const DUR = 20;
export const MAP_T = 5; // epicenter appears (after the 5s intro)
export const WAVE_T = 6.0; // shockwave starts (1s after the epicenter)
export const WAVE_DUR = 2.8; // slow single wave
export const INFO_T = WAVE_T + WAVE_DUR + 0.5; // info cascade 0.5s after the shockwave finishes
// Staggered section intros (0.2s cascade, slide + fade over 0.6s each).
export const EVENT_T = INFO_T; // EVENT DATA from the left
export const IMPACT_T = INFO_T + 0.2; // IMPACT DATA from the right
export const SHAKE_T = INFO_T + 0.4; // SHAKE REPORT from the left
export const DAMAGE_T = INFO_T + 0.6; // DAMAGE ASSESSMENT from the right
export const SEC_DUR = 0.6; // per-section slide duration
export const TSU_T = 5.0; // tsunami toast slides down (same beat as the epicenter pop)
export const TSU_HOLD = 7.45; // toast starts sliding away (visible ~3s: 5.0 -> 8.0)
export const TSU_GONE = 8.0; // toast fully off-screen exactly as info cards land
export const MAJ_T = 1.0; // major/strong banner drops after a 1s intro, ahead of everything
export const MAJ_HOLD = 7.6;
export const MAJ_GONE = 8.1; // clears before the info cascade
export const MAJ_H = 124; // banner height (tsunami toast stacks below it)

// M7.0+ — the video's "major" threshold (matches severityWord).
export function isMajorQuake(magRaw: string): boolean {
  const m = parseFloat(magRaw);
  return !isNaN(m) && m >= 7;
}

// M6.0-6.9 — "strong" banner + sting (majors keep their own).
export function isStrongQuake(magRaw: string): boolean {
  const m = parseFloat(magRaw);
  return !isNaN(m) && m >= 6 && m < 7;
}
export const DYFI_T = WAVE_T + 0.5; // DYFI caption joins mid-wave; dots wipe in with the front itself
// Mosaic: 5 cols x 7 rows of 256px Esri tiles (same map as the app).
// ROWS is odd so the grid is symmetric around the epicenter (an even row
// count biases the epicenter off-center and breaks the dead-center shift).
// Epicenter lands at canvas center.
export const COLS = 5;
export const ROWS = 7;
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

// Global Web-Mercator tile px for a lat/lng at zoom z.
function tileGlobalPx(latRaw: string, lngRaw: string, z: number): { gx: number; gy: number } {
  const lat = parseFloat(latRaw);
  const lng = parseFloat(lngRaw);
  const n = 2 ** z;
  const rad = ((isNaN(lat) ? 0 : lat) * Math.PI) / 180;
  const gx = (((isNaN(lng) ? 0 : lng) + 180) / 360) * n * TILE;
  const gy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n * TILE;
  return { gx, gy };
}

// Top-left of the COLSxROWS mosaic in global tile px, for the quake's zoom.
function mosaicOrigin(eq: PhivolcsEarthquake): { x0: number; y0: number } {
  const z = zoomForMag(eq.magnitude);
  const { gx, gy } = tileGlobalPx(eq.latitude, eq.longitude, z);
  const cx = Math.floor(gx / TILE);
  const cy = Math.floor(gy / TILE);
  return {
    x0: (cx + Math.round(0 - (COLS - 1) / 2)) * TILE,
    y0: (cy + Math.round(0 - (ROWS - 1) / 2)) * TILE,
  };
}

// Epicenter position inside the COLSxROWS mosaic (tile px), for the
// zoom-about-point math in drawFrame.
export function epicenterMosaicPx(eq: PhivolcsEarthquake): { epx: number; epy: number } {
  const z = zoomForMag(eq.magnitude);
  const { gx, gy } = tileGlobalPx(eq.latitude, eq.longitude, z);
  const { x0, y0 } = mosaicOrigin(eq);
  return { epx: gx - x0, epy: gy - y0 };
}

// Any lat/lng -> canvas display px (same zoom + centering as the mosaic),
// so overlays like DYFI points land exactly on the map underneath.
export function latLngToDisplayPx(eq: PhivolcsEarthquake, lat: number, lng: number): { x: number; y: number } {
  const z = zoomForMag(eq.magnitude);
  const { gx, gy } = tileGlobalPx(String(lat), String(lng), z);
  const { x0, y0 } = mosaicOrigin(eq);
  return {
    x: (W - COLS * TILE * MOSAIC_D) / 2 + (gx - x0) * MOSAIC_D,
    y: (H - ROWS * TILE * MOSAIC_D) / 2 + (gy - y0) * MOSAIC_D,
  };
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

// 0 -> 1 slide/fade progress of an info section starting at `start`.
export function secP(t: number, start: number): number {
  return easeOutCubic(Math.min(Math.max((t - start) / SEC_DUR, 0), 1));
}

// True only for real tsunami threats — 'NONE'/'No Tsunami Threat'/'—'/empty
// never trigger the toast (or the headless alert sfx).
export function hasTsunamiThreat(label: string): boolean {
  const s = (label || '').trim();
  if (!s || s === '—' || s === '-') return false;
  if (/\bnone\b|\bno\b/i.test(s)) return false;
  return /warning|advisory|watch/i.test(s);
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

// Display scale for the mosaic on the 1080x1440 canvas, with 30% headroom
// so the frame can shift ±128 tile-px to center the epicenter exactly
// without ever exposing an edge (even at zoom 1.0).
export const MOSAIC_D = Math.max(W / (COLS * TILE), H / (ROWS * TILE)) * 1.3;

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  view: MosaicView | null,
  eq: PhivolcsEarthquake,
  intensity: string,
  threat: string,
  shakes: ShakeRow[],
  dyfi: DyfiPoint[],
  t: number,
  source?: string,
) {
  const p = Math.min(Math.max(t / DUR, 0), 1);
  // Open tight on the epicenter with a slow push-in while the map intro
  // (pop, wave, toast) plays, then pull out to full context as the info
  // sections step in — locked at 1.0 once data is on screen.
  const CLOSE_S = 2.0;
  const OUT_T = INFO_T;
  const OUT_END = INFO_T + 2.5;
  let s: number;
  if (t < OUT_T) {
    s = CLOSE_S + 0.03 * easeInOut(Math.min(Math.max(t / OUT_T, 0), 1));
  } else if (t < OUT_END) {
    // Ease-out only: the pull-out starts at full speed the instant the
    // sections step in (no sluggish ease-in), then settles gently.
    const u = easeOutCubic((t - OUT_T) / (OUT_END - OUT_T));
    s = CLOSE_S + 0.03 - (CLOSE_S + 0.03 - 1.0) * u;
  } else {
    // Done pulling out: drift slowly back in for the rest of the video.
    const v = easeInOut(Math.min((t - OUT_END) / (DUR - OUT_END), 1));
    s = 1.0 + 0.06 * v;
  }
  // Mini shake 0.5s right after the wave appears — watermark excluded.
  const shakeActive = t >= WAVE_T && t < WAVE_T + 0.5;
  let shakeX = 0, shakeY = 0;
  if (shakeActive) {
    const k = 1 - (t - WAVE_T) / 0.5; // decay 1 -> 0
    shakeX = Math.sin(t * 82) * 5 * k;
    shakeY = Math.cos(t * 97) * 4 * k;
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, W, H);
  // Epicenter sits dead-center: shift the whole map frame by the
  // epicenter's sub-tile offset (MOSAIC_D headroom keeps edges covered).
  const oExD = view ? view.exD : W / 2;
  const oEyD = view ? view.eyD : H / 2;
  const shX = W / 2 - oExD;
  const shY = H / 2 - oEyD;
  const dex = W / 2;
  const dey = H / 2;
  // Single pre-composited blit per frame (smooth even while encoding).
  if (view) {
    const { mosaic } = view;
    ctx.save();
    ctx.translate(dex, dey);
    ctx.scale(s, s);
    ctx.translate(-dex, -dey);
    ctx.drawImage(mosaic, (W - COLS * TILE * MOSAIC_D) / 2 + shX, (H - ROWS * TILE * MOSAIC_D) / 2 + shY, COLS * TILE * MOSAIC_D, ROWS * TILE * MOSAIC_D);
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
  // DYFI dots live UNDER glow/badge/wave/info so reports can never cover
  // the magnitude badge or text — same map-locked transform as the mosaic.
  // Reveal is a radial wipe synced to the shockwave front: each dot pops
  // as the wave passes over it (no white outline — clean filled dots).
  const dyfiA = dyfi.length > 0 && t >= DYFI_T ? easeOutCubic(Math.min((t - DYFI_T) / 0.8, 1)) : 0;
  const waveWt = (t - WAVE_T) / WAVE_DUR;
  const waveR = waveWt < 0 ? -1 : waveWt > 1 ? Infinity : 45 + easeOutCubic(waveWt) * 1140;
  if (dyfi.length > 0 && waveR > 0) {
    ctx.save();
    for (const p of dyfi) {
      const { x: bx, y: by } = latLngToDisplayPx(eq, p.lat, p.lng);
      const x = dex + (bx + shX - dex) * s;
      const y = dey + (by + shY - dey) * s;
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      const reveal = Math.min(Math.max((waveR - Math.hypot(x - dex, y - dey)) / 140, 0), 1);
      if (reveal <= 0) continue;
      ctx.globalAlpha = reveal;
      const rr = 7 * (0.3 + 0.7 * easeOutCubic(reveal));
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fillStyle = p.cdi != null ? mmiColor(p.cdi) : '#ffd166';
      ctx.fill();
      // subtle outer glow for visibility on dark map
      ctx.beginPath();
      ctx.arc(x, y, rr + 3, 0, Math.PI * 2);
      ctx.strokeStyle = p.cdi != null ? mmiColor(p.cdi) + '55' : 'rgba(255,209,102,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  if (shakeActive) ctx.restore();
  // Watermark: vertical "TERRA GUARD PH" on the right center, 50% opacity — not shaken.
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
  if (shakeActive) { ctx.save(); ctx.translate(shakeX, shakeY); }
  const magText = eq.magnitude || '?';
  const [sevWord, sevColor] = severityWord(eq.magnitude);
  // Breathing room under the persistent tsunami strip so the cascading
  // columns never sit squished against it. Zero when no threat exists.
  const topPad = hasTsunamiThreat(threat) ? 28 : 0;

  // Header bar removed per design (clean map opening).

  // Single pulsing glow: expand + fade, then 1s pause before next pulse.
  const GLOW_T = WAVE_T + WAVE_DUR;
  if (t >= GLOW_T) {
    const fade = Math.min((t - GLOW_T) / 1.0, 1);
    const pulseDur = 1.9;
    const gap = 1.0;
    const total = pulseDur + gap;
    const elapsed = (t - GLOW_T) % total;
    if (elapsed < pulseDur) {
      const phase = elapsed / pulseDur; // 0 -> 1
      ctx.save();
      ctx.fillStyle = sevColor;
      ctx.globalAlpha = fade * 0.70 * (1 - phase);
      ctx.beginPath();
      ctx.arc(dex, dey, 60 + easeOutCubic(phase) * 150, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Intro anticipation: three scaling + fading rings on the epicenter
  // across the first second, then the badge pops and takes over. The
  // intro sting plays only ONCE (t=0) — not per ring.
  const INTRO_N = 3;
  if (t >= 0 && t < MAP_T) {
    const pd = MAP_T / INTRO_N;
    const k = Math.min(Math.floor(t / pd), INTRO_N - 1);
    const phase = (t - k * pd) / pd; // 0 -> 1 for the active ring
    // Slow bloom (first three-quarters of the slot), gentle fade after —
    // total intro still spans the full 5s.
    const ex = easeOutCubic(Math.min(phase / 0.75, 1));
    const rr = 30 + ex * 225; // +50% spread
    const ra = 1.0 * (1 - phase);
    ctx.save();
    ctx.beginPath();
    ctx.arc(dex, dey, rr, 0, Math.PI * 2);
    ctx.strokeStyle = sevColor;
    ctx.globalAlpha = Math.max(ra, 0);
    ctx.lineWidth = 14 * (1 - ex) + 1;
    ctx.stroke();
    // Anchoring core dot, breathing with the same phase.
    ctx.beginPath();
    ctx.arc(dex, dey, 10 + 8 * phase, 0, Math.PI * 2);
    ctx.fillStyle = sevColor;
    ctx.globalAlpha = Math.max(0.9 * (1 - phase) + 0.1, 0);
    ctx.fill();
    ctx.restore();
  }

  // Magnitude badge on the epicenter (t>=MAP_T), severity-colored.
  if (t >= MAP_T) {
    const sc = easeOutBack(Math.min((t - MAP_T) / 0.4, 1));
    const badgeR = 54 * Math.max(sc, 0.01);
    ctx.beginPath();
    ctx.arc(dex, dey, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = sevColor;
    ctx.fill();
    if (sc > 0.6 && t >= MAP_T + 1) {
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

  // Shockwave: slow single front with inner gradient fading to center.
  {
    const wt = (t - WAVE_T) / WAVE_DUR;
    if (wt >= 0 && wt <= 1) {
      const r = 45 + easeOutCubic(wt) * 1140;
      const alpha = 0.85 * (1 - wt);
      // Inner radial fade — transparent at center, soft red toward the edge.
      const grad = ctx.createRadialGradient(dex, dey, r * 0.15, dex, dey, r);
      grad.addColorStop(0, 'rgba(239,68,68,0)');
      grad.addColorStop(0.55, `rgba(239,68,68,${(0.08 * alpha).toFixed(3)})`);
      grad.addColorStop(0.82, `rgba(239,68,68,${(0.22 * alpha).toFixed(3)})`);
      grad.addColorStop(1, `rgba(239,68,68,${(0.38 * alpha).toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(dex, dey, r, 0, Math.PI * 2);
      ctx.fill();
      // Crisp outer ring.
      ctx.beginPath();
      ctx.arc(dex, dey, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(239,68,68,${alpha.toFixed(3)})`;
      ctx.lineWidth = 9 * (1 - wt) + 2;
      ctx.stroke();
    }
  }

  // DYFI caption (dots are drawn up front, underneath everything).
  if (dyfiA > 0) {
    ctx.save();
    ctx.globalAlpha = dyfiA;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 15px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`\u25CF ${dyfi.length} DYFI FELT REPORTS`, W / 2, 60 + topPad);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // MAJOR / STRONG banner: bottom-anchored, slides up from below at MAJ_T
  // and sinks back down before the bottom-anchored cards arrive — so the
  // tsunami toast always keeps the top slot to itself, no coupling needed.
  // Violet for M7.0+, red for M6.0-6.9. Accent edge sits on top.
  const isMaj = isMajorQuake(eq.magnitude);
  const isStr = !isMaj && isStrongQuake(eq.magnitude);
  const showAlert = isMaj || isStr;
  const majOut = Math.min(Math.max((t - MAJ_HOLD) / (MAJ_GONE - MAJ_HOLD), 0), 1);
  if (showAlert) {
    const majColor = isMaj ? '#a78bfa' : '#ef4444';
    const mIn = Math.min(Math.max((t - MAJ_T) / 0.55, 0), 1);
    if (mIn > 0 && majOut < 1) {
      const yOff = H - MAJ_H + (1 - easeOutBack(mIn)) * (MAJ_H + 30) + easeInOut(majOut) * 40;
      const alpha = Math.min(mIn * 1.4, 1) * (1 - majOut);
      ctx.save();
      ctx.globalAlpha = Math.max(alpha, 0);
      ctx.translate(0, yOff);
      ctx.fillStyle = 'rgba(8,12,24,0.93)';
      ctx.fillRect(0, 0, W, MAJ_H);
      const parked = mIn >= 1 && majOut <= 0 ? 1 : 0;
      const pulse = 0.55 + 0.35 * Math.sin((t - MAJ_T) * 5.2);
      ctx.fillStyle = majColor;
      ctx.globalAlpha = Math.max(alpha, 0) * (parked ? pulse : 1);
      ctx.fillRect(0, 0, W, 7);
      ctx.globalAlpha = Math.max(alpha, 0);
      // Icon: violet disc with a bold "!" (no emoji font needed).
      const ix = 92, iy = MAJ_H / 2 - 4;
      ctx.beginPath();
      ctx.arc(ix, iy, 34, 0, Math.PI * 2);
      ctx.fillStyle = majColor;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 46px Oswald, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', ix, iy + 16);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 42px Oswald, Inter, sans-serif';
      ctx.fillText(isMaj ? 'MAJOR EARTHQUAKE' : 'STRONG EARTHQUAKE', 148, 62);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '400 21px Inter, sans-serif';
      ctx.fillText(
        isMaj
          ? 'Major seismic event — stay alert, follow official guidance'
          : 'Strong seismic event — stay alert, follow official guidance',
        148,
        96,
      );
      ctx.save();
      ctx.globalAlpha = Math.max(alpha, 0) * (parked ? pulse : 1);
      ctx.beginPath();
      ctx.arc(W - 92, MAJ_H / 2 - 4, 13, 0, Math.PI * 2);
      ctx.fillStyle = majColor;
      ctx.fill();
      ctx.restore();
      const shineT = (t - (MAJ_T + 0.55)) / 0.9;
      if (shineT >= 0 && shineT <= 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, MAJ_H);
        ctx.clip();
        const sx = -260 + easeOutCubic(shineT) * (W + 520);
        ctx.globalAlpha = Math.max(alpha, 0) * 0.12 * (1 - shineT);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx + 130, 0);
        ctx.lineTo(sx + 40, MAJ_H);
        ctx.lineTo(sx - 90, MAJ_H);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      ctx.textAlign = 'left';
    }
  }

  // Tsunami toast: notification banner that drops from the top at TSU_T
  // (same beat as the epicenter pop, different screen area), holds with a
  // pulsing alert edge + shine sweep, then hands off to a slim persistent
  // strip as the info cards land at INFO_T. Only for real threats
  // (warning/advisory/watch).
  if (hasTsunamiThreat(threat)) {
    const tsuColor = threatColor(threat.trim());
    const BH = 124; // banner height
    const slideIn = Math.min(Math.max((t - TSU_T) / 0.55, 0), 1);
    const slideOut = Math.min(Math.max((t - TSU_HOLD) / (TSU_GONE - TSU_HOLD), 0), 1);
    if (slideIn > 0 && slideOut < 1) {
      const yOff = (1 - easeOutBack(slideIn)) * -(BH + 30) - easeInOut(slideOut) * 40;
      const alpha = Math.min(slideIn * 1.4, 1) * (1 - slideOut);
      ctx.save();
      ctx.globalAlpha = Math.max(alpha, 0);
      ctx.translate(0, yOff);
      // Bar.
      ctx.fillStyle = 'rgba(8,12,24,0.93)';
      ctx.fillRect(0, 0, W, BH);
      // Alert edge with breathing glow (holds while the toast is parked).
      const parked = slideIn >= 1 && slideOut <= 0 ? 1 : 0;
      const pulse = 0.55 + 0.35 * Math.sin((t - TSU_T) * 5.2);
      ctx.fillStyle = tsuColor;
      ctx.globalAlpha = Math.max(alpha, 0) * (parked ? pulse : 1);
      ctx.fillRect(0, BH - 7, W, 7);
      ctx.globalAlpha = Math.max(alpha, 0);
      // Icon: threat-colored disc with a hand-drawn wave (no emoji font).
      const ix = 92, iy = BH / 2 - 4, ir = 34;
      ctx.beginPath();
      ctx.arc(ix, iy, ir, 0, Math.PI * 2);
      ctx.fillStyle = tsuColor;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      for (let row = 0; row < 2; row++) {
        ctx.beginPath();
        const wy = iy - 8 + row * 16;
        for (let x = -20; x <= 20; x += 4) {
          const y = wy + Math.sin((x / 20) * Math.PI * 1.4) * 6;
          if (x === -20) ctx.moveTo(ix + x, y);
          else ctx.lineTo(ix + x, y);
        }
        ctx.stroke();
      }
      // Title + subline.
      const title = threat.trim().toUpperCase().slice(0, 34);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 42px Oswald, Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(title, 148, 62);
      const sub = /warning/i.test(threat)
        ? 'Destructive waves possible — move away from shore'
        : 'Strong currents & waves possible — stay away from shore';
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '400 21px Inter, sans-serif';
      ctx.fillText(sub, 148, 96);
      // Alert dot, right side, pulsing with the edge.
      const dotA = parked ? pulse : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(alpha, 0) * dotA;
      ctx.beginPath();
      ctx.arc(W - 92, BH / 2 - 4, 13, 0, Math.PI * 2);
      ctx.fillStyle = tsuColor;
      ctx.fill();
      ctx.restore();
      // One shine sweep across the bar shortly after landing.
      const shineT = (t - (TSU_T + 0.55)) / 0.9;
      if (shineT >= 0 && shineT <= 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, BH);
        ctx.clip();
        const sx = -260 + easeOutCubic(shineT) * (W + 520);
        ctx.globalAlpha = Math.max(alpha, 0) * 0.12 * (1 - shineT);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx + 130, 0);
        ctx.lineTo(sx + 40, BH);
        ctx.lineTo(sx - 90, BH);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      ctx.textAlign = 'left';
    }
    // Slim persistent strip: fades/slides in while the banner leaves, then
    // stays for the rest of the video. 44px tall so the info-column
    // headers (y=60) clear it.
    if (t >= TSU_HOLD) {
      const si = easeOutCubic(Math.min((t - TSU_HOLD) / (TSU_GONE - TSU_HOLD), 1));
      if (si > 0) {
        const SH = 44;
        ctx.save();
        ctx.globalAlpha = si;
        ctx.translate(0, -(1 - si) * (SH + 10));
        ctx.fillStyle = 'rgba(8,12,24,0.93)';
        ctx.fillRect(0, 0, W, SH);
        const sPulse = 0.55 + 0.35 * Math.sin((t - TSU_T) * 5.2);
        ctx.fillStyle = tsuColor;
        ctx.globalAlpha = si * sPulse;
        ctx.fillRect(0, SH - 5, W, 5);
        ctx.globalAlpha = si;
        ctx.beginPath();
        ctx.arc(48, SH / 2, 10, 0, Math.PI * 2);
        ctx.fillStyle = tsuColor;
        ctx.fill();
        const sTitle = threat.trim().toUpperCase().slice(0, 24);
        const sAdvice = /warning/i.test(threat) ? 'move away from shore' : 'stay away from shore';
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 24px Oswald, Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${sTitle} — ${sAdvice}`, 70, 29);
        ctx.restore();
        ctx.textAlign = 'left';
      }
    }
  }

  // Broadcast data columns + callout + intensity scale — staggered
  // cascade: EVENT (left) -> IMPACT (right) -> SHAKE (left) -> DAMAGE
  // (right), 0.2s apart, each sliding + fading over SEC_DUR.
  if (t >= INFO_T) {
    const q = secP(t, EVENT_T);
    ctx.save();
    ctx.globalAlpha = q;
    // Side gradients behind the data containers — black at edges fading to
    // transparent toward the center, drawn before the columns so text stays crisp.
    {
      const leftW = W * 0.42;
      const lg = ctx.createLinearGradient(0, 0, leftW, 0);
      lg.addColorStop(0, 'rgba(0,0,0,0.44)'); // -30% then -20% more
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, leftW, H);
      const rightW = W * 0.42;
      const rg = ctx.createLinearGradient(W, 0, W - rightW, 0);
      rg.addColorStop(0, 'rgba(0,0,0,0.44)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(W - rightW, 0, rightW, H);
    }
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
    const threatText = !threat || threat.trim() === '—' ? 'None' : threat;

    const colTop = 60 + topPad;
    // Left column: EVENT DATA slides in from the left.
    const pEvent = secP(t, EVENT_T);
    if (pEvent > 0) {
    ctx.save();
    ctx.globalAlpha = pEvent;
    ctx.translate(-(1 - pEvent) * 200, 0);
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
    ly += 30;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 14px Inter, sans-serif';
    ctx.fillText('SOURCE', lx, ly);
    ly += 26;
    ctx.fillStyle = '#ffffff';
    ctx.font = '400 19px Inter, sans-serif';
    const rawSrc = (source ?? (eq as unknown as { source?: string }).source ?? '').toString().trim();
    const srcLabel = rawSrc ? rawSrc.toUpperCase() : 'PHIVOLCS';
    ctx.fillText(srcLabel === 'EMSC' ? 'EMSC-CSEM' : srcLabel, lx, ly);
    ctx.restore();
    }

    // Right column: IMPACT DATA slides in from the right.
    const pImpact = secP(t, IMPACT_T);
    if (pImpact > 0) {
    ctx.save();
    ctx.globalAlpha = pImpact;
    ctx.translate((1 - pImpact) * 200, 0);
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
    // Intensity badge — color-coded by level (was always dark red).
    ctx.fillStyle = (() => {
      const v = (intensity || '').trim().toUpperCase();
      if (!v || v === '—' || v === '-') return 'rgba(107,114,128,0.92)';
      return shakeChipColor(v);
    })();
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
      // PH locations rarely parse to a country, so we show LOCATION inline
      // instead of a dead COUNTRY row. When country *is* parseable we show
      // it and render the full location wrapped below.
      ...(country
        ? [['COUNTRY', country, '#ffffff'] as [string, string, string]]
        : [['LOCATION', (eq.location || '').slice(0, 26) || '—', '#ffffff'] as [string, string, string]]),
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
    // When COUNTRY was shown, render the full location wrapped under its
    // own LOCATION label (single label, not the empty duplicate before).
    if (country) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '400 13px Inter, sans-serif';
      ctx.fillText('LOCATION', re, ry);
      ry += 26;
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
    ctx.restore();
    }

    // SHAKE REPORT (bottom-left) slides in from the left: strongest felt
    // areas with intensity, bottom-anchored so the last row sits near the
    // progress bar. Falls back to the max intensity + epicenter location
    // when no per-area rows were parsed; with neither, a muted line holds
    // the slot.
    const shakeList: ShakeRow[] =
      shakes.length > 0
        ? shakes.slice(0, 5)
        : intensity
          ? [{ area: (eq.location || '').slice(0, 30) || 'Epicenter area', intensity }]
          : [];
    {
      const pShake = secP(t, SHAKE_T);
      if (pShake > 0) {
      ctx.save();
      ctx.globalAlpha = pShake;
      ctx.translate(-(1 - pShake) * 200, 0);
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
        // Fit the area name before the chip (chip starts at x=48+275):
        // drop whole trailing words + ellipsis, never cut mid-word.
        let area = row.area;
        const maxAreaW = 262;
        if (ctx.measureText(area).width > maxAreaW) {
          const words = area.split(/\s+/);
          area = '';
          for (const w of words) {
            const trial = area ? `${area} ${w}` : w;
            if (ctx.measureText(`${trial}…`).width <= maxAreaW || !area) area = trial;
            else break;
          }
          if (area.length < row.area.length) area += '…';
        }
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
      ctx.restore();
      }
    }

    // DAMAGE ASSESSMENT (bottom-right) slides in from the right: rough
    // heuristic estimates from magnitude + intensity — wide "~" ranges,
    // never precise figures. With no felt intensity to base on, every
    // value (including badges) reads Unknown instead of implying
    // knowledge. Bottom-anchored.
    const dmg = isKnownIntensity(intensity) ? estimateDamage(eq.magnitude, intensity) : null;
    const showUnknown = !dmg && !isNaN(parseFloat(eq.magnitude));
    if (dmg || showUnknown) {
      const pDamage = secP(t, DAMAGE_T);
      if (pDamage > 0) {
      ctx.save();
      ctx.globalAlpha = pDamage;
      ctx.translate((1 - pDamage) * 200, 0);
      const bWord = dmg ? sevWord : 'Unknown';
      const bColor = dmg ? sevColor : '#6b7280';
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
        const bw = Math.max(70, ctx.measureText(bWord).width + 22);
        const bx = dx0 + vw + 18;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx, baseY - 26, bw, 32);
        ctx.strokeStyle = bColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, baseY - 26, bw, 32);
        ctx.fillStyle = bColor;
        ctx.textAlign = 'center';
        ctx.fillText(bWord, bx + bw / 2, baseY - 4);
        ctx.textAlign = 'left';
      };
      ctx.fillStyle = '#9ca3af';
      ctx.font = '400 13px Inter, sans-serif';
      ctx.fillText('ECONOMIC LOSSES', dx0, ecoLblY);
      sevBadge(ecoValY, dmg ? dmg.losses : 'Unknown');
      ctx.fillStyle = '#9ca3af';
      ctx.font = '400 13px Inter, sans-serif';
      ctx.fillText('DAMAGE & FATALITIES', dx0, dmgLblY);
      sevBadge(dmgValY, dmg ? dmg.fatalities : 'Unknown');
      ctx.restore();
      }
    }

    ctx.restore();
  }

  // Bottom progress bar — hidden per design.
  void p;
  if (shakeActive) ctx.restore();
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
  usgsEventId,
  quakeSource,
  onClose,
}: {
  earthquake: PhivolcsEarthquake;
  intensity?: string;
  tsunamiThreat?: string;
  shakes?: ShakeRow[];
  usgsEventId?: string;
  quakeSource?: string;
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
  // DYFI felt responses load in the background (never block the preview
  // or recording); drawFrame reads the ref each frame, so points pop in
  // whenever they arrive.
  const dyfiRef = useRef<DyfiPoint[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchDyfiPoints({
      usgsEventId,
      datetime: earthquake.datetime,
      source: quakeSource,
      latitude: earthquake.latitude,
      longitude: earthquake.longitude,
    }).then((pts) => {
      if (!cancelled) dyfiRef.current = pts;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        const mctx = mosaic.getContext('2d', { colorSpace: 'srgb', alpha: false } as unknown as CanvasRenderingContext2DSettings);
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
    const ctx = canvas?.getContext('2d', { colorSpace: 'srgb', alpha: false, desynchronized: false } as unknown as CanvasRenderingContext2DSettings);
    if (!canvas || !ctx) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      if (phase === 'recording' && t >= DUR) {
        drawFrame(ctx, viewRef.current, earthquake, intensityRef.current, threatRef.current, shakesRef.current, dyfiRef.current, DUR, quakeSource);
        recRef.current?.stop();
        return;
      }
      drawFrame(ctx, viewRef.current, earthquake, intensityRef.current, threatRef.current, shakesRef.current, dyfiRef.current, phase === 'preview' ? t % (DUR + 1) : t, quakeSource);
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
    // Timed sound effects: the same MP3s the headless renderer mixes
    // (plus tsunami-notif with the toast when a real threat exists),
    // scheduled against the recording clock and captured through
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
        const files = ['intro.mp3', 'epicenter-appear.mp3', 'wave-spread.mp3', 'reports.mp3'];
        const at = [0.0, MAP_T, WAVE_T, INFO_T];
        const majorNow = isMajorQuake(earthquake.magnitude);
        const strongNow = !majorNow && isStrongQuake(earthquake.magnitude);
        if (majorNow) {
          // Major quake: alert sting INSTEAD of the regular intro voice.
          files.splice(1, 0, 'major-notification.mp3');
          at.splice(1, 0, MAJ_T);
        } else if (strongNow) {
          files.splice(1, 0, 'strong-notification.mp3');
          at.splice(1, 0, MAJ_T);
        } else {
          files.splice(1, 0, 'intro-tts-alert.mp3');
          at.splice(1, 0, 1.0);
        }
        if (hasTsunamiThreat(threatRef.current ?? '')) {
          files.splice(2, 0, 'tsunami-notif.mp3');
          at.splice(2, 0, TSU_T);
        }
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
            Video Report (20s)
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
