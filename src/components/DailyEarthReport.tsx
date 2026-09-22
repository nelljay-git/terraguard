/* eslint-disable react-refresh/only-export-components --
   Pure render pieces shared with the headless daily renderer
   (scripts/daily-video-entry.ts : GitHub Actions + node-canvas + FFmpeg).
   The default export is the browser preview/record component. */
import { useEffect, useRef, useState } from 'react';
import { X, Download, Clapperboard } from 'lucide-react';
import type { EmscEarthquake } from '../api/emsc';
import { fetchEmscData } from '../api/emsc';
import './VideoReport.css';

// Timeline: no intro per request — wipe starts at 0
export const DAILY_W = 1080;
export const DAILY_H = 1440;
export const DAILY_FPS = 60;
export const DAILY_DUR = 26; // 1 delay +12 wipe +5 highlight +3 hold +5 panel
export const DAILY_INTRO = 0;
export const DAILY_FADE = 0;
export const DAILY_PAUSE = 0;
export const DAILY_WIPE_START = 1; // 1s start delay
export const DAILY_WIPE_DUR = 12; // slower left->right scan (base)
export const DAILY_HIGHLIGHT_DUR = 5; // freeze on top1 for 5s with modal
export const DAILY_INFO_DELAY = 3; // wipe done → 3s hold before panel
export const DAILY_INFO_START = DAILY_WIPE_START + DAILY_WIPE_DUR + DAILY_HIGHLIGHT_DUR + DAILY_INFO_DELAY; // 21
export const DAILY_PANEL_VISIBLE = 5;

export const DAILY_COLS = 4;
export const DAILY_ROWS = 4;
export const DAILY_TILE = 256;
export const DAILY_Z = 2;
export const DAILY_MOSAIC_D = Math.min(
  DAILY_W / (DAILY_COLS * DAILY_TILE),
  DAILY_H / (DAILY_ROWS * DAILY_TILE),
);

const UTC_MONTHS = [
  'January','February','March','April','May','June','July','August','September','October','November','December'
];

function formatUtcFromMs(ms: number): string {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const month = UTC_MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const h = String(d.getUTCHours()).padStart(2,'0');
  const m = String(d.getUTCMinutes()).padStart(2,'0');
  const s = String(d.getUTCSeconds()).padStart(2,'0');
  return `${day} ${month} ${year} - ${h}:${m}:${s} UTC`;
}

export function formatEmscUtc(iso: string): string {
  const ms = Date.parse(iso);
  if (isNaN(ms)) return String(iso);
  return formatUtcFromMs(ms);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeOutBack(t: number): number {
  const c1 = 2.9; // stronger overshoot for visible pop (was 1.70158)
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function severityColor(mag: number): string {
  if (mag < 3) return '#10b981'; // <3.0 green
  if (mag < 4) return '#3b82f6'; // 3.0-3.9 blue
  if (mag < 5) return '#eab308'; // 4.0-4.9 yellow
  if (mag < 6) return '#f97316'; // 5.0-5.9 orange
  if (mag < 7) return '#ef4444'; // 6.0-6.9 red
  return '#8b5cf6'; // 7.0+ violet
}
function magnitudeRadius(mag: number): number {
  if (mag < 2) return 6;
  if (mag < 3) return 7;
  if (mag < 4) return 9;
  if (mag < 5) return 12;
  if (mag < 6) return 15;
  return 18;
}

// Global Mercator helpers (same math as VideoReport)
export function dailyEsriTileUrls(): string[] {
  const z = DAILY_Z;
  const urls: string[] = [];
  for (let r = 0; r < DAILY_ROWS; r++) {
    for (let c = 0; c < DAILY_COLS; c++) {
      const x = c;
      const y = r;
      urls.push(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`);
    }
  }
  return urls;
}
function dailyTileUrls(): string[] {
  return dailyEsriTileUrls().map((u) => `/api/tile?src=${encodeURIComponent(u)}`);
}

export function dailyLatLngToDisplayPx(lat: number, lon: number): { x:number; y:number } {
  const z = DAILY_Z;
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const gx = ((lon + 180) / 360) * n * DAILY_TILE;
  // Clamp mercator for poles
  const mercN = Math.log(Math.tan(rad) + 1 / Math.cos(rad));
  const gy = ((1 - mercN / Math.PI) / 2) * n * DAILY_TILE;
  const D = DAILY_MOSAIC_D;
  const offsetX = (DAILY_W - DAILY_COLS * DAILY_TILE * D) / 2;
  const offsetY = (DAILY_H - DAILY_ROWS * DAILY_TILE * D) / 2;
  return { x: offsetX + gx * D, y: offsetY + gy * D };
}
export function dailyLonToDisplayX(lon: number): number {
  const z = DAILY_Z;
  const n = 2 ** z;
  const gx = ((lon + 180) / 360) * n * DAILY_TILE;
  const D = DAILY_MOSAIC_D;
  const offsetX = (DAILY_W - DAILY_COLS * DAILY_TILE * D) / 2;
  return offsetX + gx * D;
}

export interface DailyMosaicView {
  mosaic: HTMLCanvasElement;
  offsetX: number;
  offsetY: number;
  D: number;
}

function buildDailyMosaicView(mosaic: HTMLCanvasElement): DailyMosaicView {
  const D = DAILY_MOSAIC_D;
  const offsetX = (DAILY_W - DAILY_COLS * DAILY_TILE * D) / 2;
  const offsetY = (DAILY_H - DAILY_ROWS * DAILY_TILE * D) / 2;
  return { mosaic, offsetX, offsetY, D };
}

function loadImage(src: string): Promise<{ img: HTMLImageElement | null; status: string }> {
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

// ---------- DRAW FRAME (shared with headless) ----------
export function drawDailyFrame(
  ctx: CanvasRenderingContext2D,
  view: DailyMosaicView | null,
  events: EmscEarthquake[],
  t: number,
  reportDateMs?: number,
) {
  // Background
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, DAILY_W, DAILY_H);

  const hasView = !!view;

  // --- MAP INTRO / FADE / PAUSE / WIPE ---
  if (hasView && view) {
    const { mosaic, offsetX, offsetY, D } = view;
    const sw = DAILY_COLS * DAILY_TILE * D;
    const sh = DAILY_ROWS * DAILY_TILE * D;
    // Blurred scaled background fills black bars (letterbox)
    {
      const D_bg = Math.max(DAILY_W / (DAILY_COLS * DAILY_TILE), DAILY_H / (DAILY_ROWS * DAILY_TILE));
      const sw_bg = DAILY_COLS * DAILY_TILE * D_bg;
      const sh_bg = DAILY_ROWS * DAILY_TILE * D_bg;
      const offX_bg = (DAILY_W - sw_bg) / 2;
      const offY_bg = (DAILY_H - sh_bg) / 2;
      ctx.save();
      try { (ctx as unknown as { filter: string }).filter = 'blur(18px) brightness(0.72) saturate(1.05)'; } catch {}
      ctx.drawImage(mosaic, offX_bg, offY_bg, sw_bg, sh_bg);
      try { (ctx as unknown as { filter: string }).filter = 'none'; } catch {}
      ctx.fillStyle = 'rgba(0,0,0,0.24)';
      ctx.fillRect(0, 0, DAILY_W, DAILY_H);
      ctx.restore();
    }

    if (t < DAILY_INTRO) {
      // 0-4s clean global map, no markers
      ctx.globalAlpha = 1;
      ctx.drawImage(mosaic, offsetX, offsetY, sw, sh);
      ctx.globalAlpha = 1;
      // Watermark even during intro
      drawWatermark(ctx);
      // Subtle header label during intro
      drawTopLabel(ctx, 0.85);
      // vignette
      drawVignette(ctx);
      return;
    }
    if (t < DAILY_INTRO + DAILY_FADE) {
      const f = (t - DAILY_INTRO) / DAILY_FADE;
      const a = 1 - f;
      ctx.globalAlpha = a;
      ctx.drawImage(mosaic, offsetX, offsetY, sw, sh);
      ctx.globalAlpha = 1;
      drawWatermark(ctx);
      drawVignetteWithAlpha(ctx, a * 0.9);
      return;
    }
    if (t < DAILY_WIPE_START) {
      // 1s start delay — clean global map, no markers
      ctx.globalAlpha = 1;
      ctx.drawImage(mosaic, offsetX, offsetY, sw, sh);
      drawVignette(ctx);
      drawWatermark(ctx);
      drawTopLabel(ctx, 0.9);
      return;
    }
    // WIPE phase onward: map visible
    ctx.globalAlpha = 1;
    ctx.drawImage(mosaic, offsetX, offsetY, sw, sh);
    drawVignette(ctx);
    drawWatermark(ctx);
    drawTopLabel(ctx, 1);

    // Compute wipe progress with 5s freeze on top1 strongest
    let wP: number, currentLng: number, isHighlight = false, highlightT = 0;
    let top1: EmscEarthquake | null = null;
    let topPos: { x:number; y:number } | null = null;
    if (events.length > 0) {
      top1 = [...events].sort((a,b)=> b.properties.mag - a.properties.mag)[0];
      const topLon = top1.properties.lon;
      const topLat = top1.properties.lat;
      topPos = dailyLatLngToDisplayPx(topLat, topLon);
      const revealF = (topLon + 180) / 360;
      const revealT = DAILY_WIPE_START + revealF * DAILY_WIPE_DUR;
      const holdEnd = revealT + DAILY_HIGHLIGHT_DUR;
      if (t < revealT) {
        wP = (t - DAILY_WIPE_START) / DAILY_WIPE_DUR;
      } else if (t < holdEnd) {
        wP = revealF;
        isHighlight = true;
        highlightT = t - revealT;
      } else {
        wP = (t - DAILY_HIGHLIGHT_DUR - DAILY_WIPE_START) / DAILY_WIPE_DUR;
      }
      wP = Math.min(Math.max(wP, 0), 1);
      currentLng = -180 + wP * 360;
    } else {
      wP = Math.min(Math.max((t - DAILY_WIPE_START) / DAILY_WIPE_DUR, 0), 1);
      currentLng = -180 + wP * 360;
    }
    const wipeX = dailyLonToDisplayX(currentLng);

    // Processed area + gradient + line — all fade 1s after job done (17→18s), dim during highlight so connector pops
    const wipeEnd = DAILY_WIPE_START + DAILY_WIPE_DUR + DAILY_HIGHLIGHT_DUR;
    let wipeFade = t >= wipeEnd ? 1 - Math.min(Math.max((t - wipeEnd) / 1, 0), 1) : 1;
    if (isHighlight) wipeFade *= 0.32;
    if (wipeFade > 0.01) {
      ctx.save();
      ctx.globalAlpha = wipeFade;
      ctx.fillStyle = 'rgba(239,68,68,0.08)';
      ctx.fillRect(0, 0, wipeX, DAILY_H);
      const grad = ctx.createLinearGradient(Math.max(0, wipeX - 120), 0, wipeX, 0);
      grad.addColorStop(0, 'rgba(239,68,68,0)');
      grad.addColorStop(1, 'rgba(239,68,68,0.18)');
      ctx.fillStyle = grad;
      ctx.fillRect(Math.max(0, wipeX - 120), 0, Math.min(120, wipeX), DAILY_H);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = wipeFade;
      ctx.shadowColor = 'rgba(239,68,68,0.95)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(wipeX - 1.5, 0, 3, DAILY_H);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.88 * wipeFade;
      ctx.fillRect(wipeX - 0.5, 0, 1, DAILY_H);
      ctx.restore();
    }

    // --- Earthquake markers: reveal when lon <= currentLng ---
    const sorted = [...events].sort((a,b) => a.properties.lon - b.properties.lon);
    for (const ev of sorted) {
      const lon = ev.properties.lon;
      const lat = ev.properties.lat;
      if (lon > currentLng) continue;
      const { x, y } = dailyLatLngToDisplayPx(lat, lon);
      if (x < -30 || y < -30 || x > DAILY_W + 30 || y > DAILY_H + 30) continue;
      // reveal time accounts for 5s freeze on top1 (east of top1 delayed)
      let baseReveal = DAILY_WIPE_START + ((lon + 180) / 360) * DAILY_WIPE_DUR;
      if (top1 && lon > top1.properties.lon) baseReveal += DAILY_HIGHLIGHT_DUR;
      const dt = t - baseReveal;
      if (dt < 0) continue;
      const animP = Math.min(Math.max(dt / 0.38, 0), 1);
      const pop0 = easeOutBack(animP);
      // keep pop visible after freeze: gentle looping breathe so freeze doesn't look dead
      const loopScale = 1 + Math.sin(dt * 1.9) * 0.045;
      const scale = pop0 < 1 ? pop0 : loopScale;
      const alpha = easeOutCubic(Math.min(Math.max(dt / 0.22, 0), 1));
      const mag = ev.properties.mag;
      const rBase = magnitudeRadius(mag);
      const r = rBase * Math.max(scale, 0.01);
      const popY = (1 - pop0) * 28;

      // Expanding shock ripple — loops every 2.2s so pops stay alive through 5s freeze
      const cycle = dt % 2.2;
      if (cycle < 0.9) {
        const rp = cycle / 0.9;
        const ringR = r + 8 + rp * 38;
        const ringA = (1 - rp) * 0.55;
        ctx.save();
        ctx.globalAlpha = ringA;
        ctx.beginPath();
        ctx.arc(x, y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = severityColor(mag);
        ctx.lineWidth = 2.5 * (1 - rp) + 1.2;
        ctx.stroke();
        ctx.restore();
        // inner fill flash
        const flashA = (1 - rp) * 0.22;
        ctx.save();
        ctx.globalAlpha = flashA;
        ctx.beginPath();
        ctx.arc(x, y, ringR * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = severityColor(mag);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      // drop shadow that shrinks as it pops (reinforces pop-up)
      if (dt < 0.55) {
        const shA = (1 - animP) * 0.32;
        ctx.fillStyle = `rgba(0,0,0,${shA.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(x, y + r*0.9 + popY*0.3, r*1.05, r*0.42, 0, 0, Math.PI*2);
        ctx.fill();
      }
      // outer glow — strong breathe 1.4s then gentle continuous pulse so freeze doesn't look dead
      if (dt < 1.4) {
        const pulse = 0.5 + 0.5 * Math.sin(dt * 12);
        const glowA = (1 - dt / 1.4) * 0.28 + 0.08;
        ctx.beginPath();
        ctx.arc(x, y - popY, r + 6 + pulse * 4, 0, Math.PI * 2);
        ctx.fillStyle = severityColor(mag) + '33';
        ctx.globalAlpha = alpha * glowA * 1.6;
        ctx.fill();
        ctx.globalAlpha = alpha;
      } else {
        const pulse2 = 0.5 + 0.5 * Math.sin(dt * 2.2);
        ctx.beginPath();
        ctx.arc(x, y, r + 4 + pulse2 * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = severityColor(mag) + '22';
        ctx.globalAlpha = alpha * 0.9;
        ctx.fill();
        ctx.globalAlpha = alpha;
        // subtle breathing scale
        const breathe = 1 + Math.sin(dt * 2.0) * 0.035;
        // apply via r already includes scale, add tiny extra via shadow? just keep glow pulsing
        void breathe;
      }
      // main circle with pop-up lift + scale
      ctx.translate(0, -popY);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = severityColor(mag);
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = 'rgba(255,255,255,0.97)';
      ctx.stroke();
      // bright pop flash
      if (dt < 0.28) {
        const fA = (1 - dt/0.28) * 0.72;
        ctx.fillStyle = `rgba(255,255,255,${fA.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.96, 0, Math.PI*2);
        ctx.fill();
      }
      // inner specular dot
      if (r >= 9) {
        ctx.beginPath();
        ctx.arc(x - r*0.22, y - r*0.22, Math.max(1.5, r*0.18), 0, Math.PI*2);
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.fill();
      }
      if (r >= 11) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(mag.toFixed(1), x, y + 4);
        ctx.textAlign = 'left';
      }
      ctx.restore();
    }

    // Highest-recorded highlight (5s freeze on top1)
    if (isHighlight && top1 && topPos) {
      drawHighestModal(ctx, top1, topPos, highlightT);
    }
    // Info panel fade-in
    if (t >= DAILY_INFO_START) {
      const q = easeOutCubic(Math.min((t - DAILY_INFO_START) / 0.7, 1));
      drawInfoPanel(ctx, events, reportDateMs, q);
    } else if (wP > 0.02 && !isHighlight) {
      // During wipe, show small progress header (hidden while highlight modal is up)
      drawWipeHeader(ctx, wP, events.filter(e => e.properties.lon <= currentLng).length, events.length);
    }

  } else {
    // No tiles fallback: solid background with wipe line still
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0,0,DAILY_W, DAILY_H);
    drawWatermark(ctx);
    if (t >= DAILY_WIPE_START) {
      const wP = Math.min(Math.max((t - DAILY_WIPE_START) / DAILY_WIPE_DUR, 0), 1);
      const currentLng = -180 + wP * 360;
      const wipeX = (wP) * DAILY_W;
      const wipeEnd = DAILY_WIPE_START + DAILY_WIPE_DUR;
      const wipeFade2 = t >= wipeEnd ? 1 - Math.min(Math.max((t - wipeEnd) / 1, 0), 1) : 1;
      if (wipeFade2 > 0.01) {
        ctx.save();
        ctx.globalAlpha = wipeFade2;
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(wipeX - 1.5, 0, 3, DAILY_H);
        ctx.restore();
      }
      for (const ev of events) {
        if (ev.properties.lon > currentLng) continue;
        const { x, y } = dailyLatLngToDisplayPx(ev.properties.lat, ev.properties.lon);
        const r = magnitudeRadius(ev.properties.mag);
        ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fillStyle=severityColor(ev.properties.mag); ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
      }
      if (t >= DAILY_INFO_START) {
        const q = easeOutCubic(Math.min((t - DAILY_INFO_START)/0.7,1));
        drawInfoPanel(ctx, events, reportDateMs, q);
      }
    }
  }
}

function drawWatermark(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.translate(DAILY_W - 44, DAILY_H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 24px Oswald, Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TERRA GUARD PH', 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';
}

function drawTopLabel(ctx: CanvasRenderingContext2D, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#fbbf24';
  ctx.font = '400 13px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('GLOBAL SEISMIC MONITORING  •  EMSC  •  UTC', DAILY_W/2, 42);
  ctx.restore();
  ctx.textAlign = 'left';
}

function drawVignette(ctx: CanvasRenderingContext2D) {
  drawVignetteWithAlpha(ctx, 1);
}
function drawVignetteWithAlpha(ctx: CanvasRenderingContext2D, a: number) {
  const vg = ctx.createRadialGradient(DAILY_W/2, DAILY_H/2, Math.min(DAILY_W, DAILY_H)*0.28, DAILY_W/2, DAILY_H/2, Math.max(DAILY_W, DAILY_H)*0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.55, `rgba(0,0,0,${(0.28*a).toFixed(3)})`);
  vg.addColorStop(1, `rgba(0,0,0,${(0.72*a).toFixed(3)})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0,0,DAILY_W, DAILY_H);
}

function drawWipeHeader(ctx: CanvasRenderingContext2D, progress: number, revealed: number, total: number) {
  const pct = Math.round(progress * 100);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    // @ts-ignore
    ctx.roundRect(DAILY_W/2 - 160, 64, 320, 34, 8);
    ctx.fill();
  } else {
    ctx.fillRect(DAILY_W/2 - 160, 64, 320, 34);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = '400 13px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`SCANNING  ${revealed}/${total}  •  ${pct}%`, DAILY_W/2, 86);
  ctx.restore();
  ctx.textAlign = 'left';
}

function drawHighestModal(
  ctx: CanvasRenderingContext2D,
  ev: EmscEarthquake,
  circle: { x:number; y:number },
  t: number,
) {
  const a = Math.min(Math.max(t / 0.35, 0), 1) * (t > 4.65 ? 1 - Math.min((t-4.65)/0.35,1) : 1);
  const ease = easeOutCubic(a);
  ctx.save();
  ctx.globalAlpha = ease;
  // connector line from circle to modal — offset 16px left of wipe to stay visible, plus white outer glow
  const mx = DAILY_W/2, my = 210;
  const mw = 760, mh = 220;
  const mx0 = mx - mw/2, my0 = my - mh/2;
  const lineX = Math.max(12, Math.min(DAILY_W - 12, circle.x - 16)); // offset west of wipe line (wipe is at circle.x)
  // outer glow for visibility over red wipe
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 4.5;
  ctx.setLineDash([6,4]);
  ctx.beginPath();
  ctx.moveTo(lineX, circle.y);
  const midY = my0 + mh + 12;
  ctx.lineTo(lineX, midY);
  ctx.lineTo(mx, midY);
  ctx.lineTo(mx, my0);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#facc15'; // yellow stands out over red
  ctx.lineWidth = 2.4;
  ctx.setLineDash([6,4]);
  ctx.beginPath();
  ctx.moveTo(lineX, circle.y);
  ctx.lineTo(lineX, midY);
  ctx.lineTo(mx, midY);
  ctx.lineTo(mx, my0);
  ctx.stroke();
  ctx.setLineDash([]);
  // glow at circle end
  ctx.fillStyle = '#facc15';
  ctx.shadowColor = 'rgba(250,204,21,0.9)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(circle.x, circle.y, 5, 0, Math.PI*2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // modal bg
  ctx.fillStyle = 'rgba(16,20,32,0.97)';
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    // @ts-ignore
    ctx.roundRect(mx0, my0, mw, mh, 14);
    ctx.fill();
  } else ctx.fillRect(mx0, my0, mw, mh);
  ctx.strokeStyle = 'rgba(239,68,68,0.45)';
  ctx.lineWidth = 1.4;
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    // @ts-ignore
    ctx.roundRect(mx0, my0, mw, mh, 14);
    ctx.stroke();
  } else ctx.strokeRect(mx0, my0, mw, mh);
  // header
  ctx.fillStyle = '#ef4444';
  ctx.font = '700 13px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('★ HIGHEST RECORDED', mx, my0 + 26);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 22px Oswald, Inter, sans-serif';
  ctx.fillText(`M${ev.properties.mag.toFixed(1)} — ${ev.properties.flynn_region.slice(0,38)}`, mx, my0 + 54);
  // details grid
  const d = new Date(ev.properties.time);
  const dateStr = isNaN(d.getTime()) ? ev.properties.time : `${String(d.getUTCDate()).padStart(2,'0')} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} • ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}:${String(d.getUTCSeconds()).padStart(2,'0')} UTC`;
  ctx.font = '500 12px Inter, sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'left';
  const leftX = mx0 + 22;
  const rightX = mx + 10;
  const y1 = my0 + 84, y2 = my0 + 108, y3 = my0 + 132;
  ctx.fillText('EPICENTER', leftX, y1);
  ctx.fillText('TIME (UTC)', leftX, y2);
  ctx.fillText('DEPTH', leftX, y3);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText(`${ev.properties.lat.toFixed(2)}°${ev.properties.lat>=0?'N':'S'}, ${ev.properties.lon.toFixed(2)}°${ev.properties.lon>=0?'E':'W'}`, leftX + 84, y1);
  ctx.fillText(dateStr, leftX + 84, y2);
  ctx.fillText(`${Math.round(ev.properties.depth)} km`, leftX + 84, y3);
  ctx.fillStyle = '#9ca3af';
  ctx.font = '500 12px Inter, sans-serif';
  ctx.fillText('LOCATION', rightX, y1);
  ctx.fillText('MAG', rightX, y2);
  ctx.fillText('ID', rightX, y3);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText(ev.properties.flynn_region.slice(0,28), rightX + 62, y1);
  ctx.fillStyle = severityColor(ev.properties.mag);
  ctx.font = '700 13px Inter, sans-serif';
  ctx.fillText(ev.properties.mag.toFixed(1), rightX + 62, y2);
  ctx.fillStyle = '#9ca3af';
  ctx.font = '500 11px Inter, sans-serif';
  ctx.fillText(ev.properties.unid, rightX + 62, y3);
  ctx.restore();
  ctx.textAlign = 'left';
}

function drawInfoPanel(
  ctx: CanvasRenderingContext2D,
  events: EmscEarthquake[],
  reportDateMs: number | undefined,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;

  // Panel background — 20px bottom margin, extra room so footer rows aren't squished
  const panelH = 470;
  const panelY = DAILY_H - panelH - 20;
  ctx.fillStyle = 'rgba(12,16,24,0.96)';
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    // @ts-ignore
    ctx.roundRect(16, panelY, DAILY_W - 32, panelH, 18);
    ctx.fill();
  } else {
    ctx.fillRect(16, panelY, DAILY_W - 32, panelH);
  }
  ctx.strokeStyle = 'rgba(239,68,68,0.38)';
  ctx.lineWidth = 1.4;
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    // @ts-ignore
    ctx.roundRect(16, panelY, DAILY_W - 32, panelH, 18);
    ctx.stroke();
  } else {
    ctx.strokeRect(16, panelY, DAILY_W - 32, panelH);
  }

  // Header — title centered, date centered below
  let y = panelY + 46;
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 26px Oswald, Inter, sans-serif';
  ctx.textAlign = 'center';
  const title = 'DAILY EARTH REPORT';
  const tW = ctx.measureText(title).width;
  // red dot left of centered title
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(DAILY_W/2 - tW/2 - 14, y - 7, 6, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, DAILY_W/2, y);
  const d = reportDateMs ? new Date(reportDateMs) : new Date();
  const utcDateStr = `${String(d.getUTCDate()).padStart(2,'0')} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} • UTC`;
  ctx.fillStyle = '#9ca3af';
  ctx.font = '400 15px Inter, sans-serif';
  ctx.fillText(utcDateStr, DAILY_W/2, y + 22);
  ctx.textAlign = 'left';
  y += 22;
  // EMSC badge bigger
  ctx.fillStyle = 'rgba(239,68,68,0.20)';
  const badgeW = 96;
  const bx = DAILY_W - 32 - badgeW - 14;
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    // @ts-ignore
    ctx.roundRect(bx, y - 26, badgeW, 30, 8);
    ctx.fill();
  } else {
    ctx.fillRect(bx, y - 26, badgeW, 30);
  }
  ctx.fillStyle = '#ef4444';
  ctx.font = '700 13px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('EMSC • UTC', bx + badgeW/2, y - 5);
  ctx.textAlign = 'left';

  y += 30;
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(28, y);
  ctx.lineTo(DAILY_W - 28, y);
  ctx.stroke();

  y += 26;
  const total = events.length;
  const strongest = events.length ? [...events].sort((a,b)=>b.properties.mag - a.properties.mag)[0] : null;
  ctx.fillStyle = '#9ca3af';
  ctx.font = '700 13px Inter, sans-serif';
  ctx.fillText(`${total} EARTHQUAKES (24H • M1.0+) — TOP 5 STRONGEST`, 28, y);
  if (strongest) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 13px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`MAX M${strongest.properties.mag.toFixed(1)} • ${strongest.properties.flynn_region.slice(0,28)}`, DAILY_W - 28, y);
    ctx.textAlign = 'left';
  }
  y += 26;

  // Column headers — larger
  ctx.fillStyle = '#9ca3af';
  ctx.font = '700 12px Inter, sans-serif';
  ctx.fillText('TIME (UTC)', 28, y);
  ctx.fillText('MAG', 212, y);
  ctx.fillText('DEPTH', 286, y);
  ctx.fillText('EPICENTER', 384, y);
  ctx.fillText('COORDINATES', 760, y);
  y += 16;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.moveTo(28, y);
  ctx.lineTo(DAILY_W - 28, y);
  ctx.stroke();
  y += 22;

  // Top 5 strongest — larger rows/fonts
  const sortedStrongest = [...events].sort((a,b)=> b.properties.mag - a.properties.mag);
  const maxRows = 5;
  const rows = sortedStrongest.slice(0, maxRows);
  for (let i=0;i<rows.length;i++) {
    const ev = rows[i];
    const ms = Date.parse(ev.properties.time);
    const timeStr = isNaN(ms) ? ev.properties.time.slice(0,19).replace('T',' ') : (()=>{ const d2=new Date(ms); return `${String(d2.getUTCHours()).padStart(2,'0')}:${String(d2.getUTCMinutes()).padStart(2,'0')}:${String(d2.getUTCSeconds()).padStart(2,'0')}`})() + ' UTC';
    const lat = ev.properties.lat;
    const lon = ev.properties.lon;
    const mag = ev.properties.mag.toFixed(1);
    const depth = `${Math.round(ev.properties.depth)} km`;
    const region = ev.properties.flynn_region.slice(0, 38);
    const coords = `${lat.toFixed(2)}°${lat>=0?'N':'S'}, ${lon.toFixed(2)}°${lon>=0?'E':'W'}`;
    const rowBg = i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)';
    ctx.fillStyle = rowBg;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      // @ts-ignore
      ctx.roundRect(24, y - 18, DAILY_W - 48, 44, 10);
      ctx.fill();
    } else {
      ctx.fillRect(24, y - 18, DAILY_W - 48, 44);
    }
    ctx.fillStyle = '#e5e7eb';
    ctx.font = '600 14px Inter, sans-serif';
    ctx.fillText(timeStr, 28, y+6);
    const mNum = parseFloat(mag);
    ctx.fillStyle = severityColor(mNum);
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      // @ts-ignore
      ctx.roundRect(208, y - 14, 56, 26, 7);
      ctx.fill();
    } else {
      ctx.fillRect(208, y - 14, 56, 26);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 15px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(mag, 236, y+6);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e5e7eb';
    ctx.font = '600 14px Inter, sans-serif';
    ctx.fillText(depth, 286, y+6);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 15px Inter, sans-serif';
    ctx.fillText(region, 384, y+6);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '500 12px Inter, sans-serif';
    ctx.fillText(coords, 760, y+6);
    y += 50;
  }

  if (events.length > maxRows) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '500 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`+ ${events.length - maxRows} more • full list at terraguard-ph.pages.dev`, DAILY_W/2, panelY + panelH - 18);
    ctx.textAlign = 'left';
  } else if (events.length === 0) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '600 16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No EMSC events in the last 24 hours (M1.0+)', DAILY_W/2, y+24);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '500 10px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ALL TIMES IN UTC  •  SOURCE: EMSC-CSEM (SEISMICPORTAL.EU)  •  MAP: ESRI WORLD IMAGERY', DAILY_W/2, DAILY_H - 10);
  ctx.textAlign = 'left';

  ctx.restore();
}

// ---------- Browser component ----------
type Phase = 'loading' | 'preview' | 'recording' | 'done' | 'unsupported';

export function DailyEarthReportModal({
  events: externalEvents,
  onClose,
}: {
  events?: EmscEarthquake[];
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const viewRef = useRef<DailyMosaicView | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const circleBufRef = useRef<AudioBuffer | null>(null);
  const dailyBufRef = useRef<AudioBuffer | null>(null);
  const highestBufRef = useRef<AudioBuffer | null>(null);
  const playedRef = useRef<Set<string>>(new Set());
  const dailyPlayedRef = useRef<boolean>(false);
  const highestPlayedRef = useRef<boolean>(false);
  const prevHighlightRef = useRef<boolean>(false);
  const lastLoopTRef = useRef<number>(0);
  const eventsRef = useRef<EmscEarthquake[]>(externalEvents ?? []);
  const [events, setEvents] = useState<EmscEarthquake[]>(externalEvents ?? []);
  const [phase, setPhase] = useState<Phase>('loading');
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [mime, setMime] = useState<string>('');
  const [mapError, setMapError] = useState<string>('');

  // keep refs synced
  useEffect(() => { eventsRef.current = events; }, [events]);

  // fetch EMSC if not provided
  useEffect(() => {
    if (externalEvents && externalEvents.length > 0) {
      setEvents(externalEvents);
      eventsRef.current = externalEvents;
      return;
    }
    let cancelled = false;
    (async()=>{
      try{
        const now = new Date();
        const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        if (now.getUTCHours() < 3) target.setUTCDate(target.getUTCDate() - 1);
        const dayStart = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(),0,0,0,0));
        const dayEnd = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(),23,59,59,999));
        const params = new URLSearchParams({
          format: 'json', limit: '20000', orderby: 'time', minmag: '1.0',
          starttime: dayStart.toISOString(), endtime: dayEnd.toISOString(),
        });
        const res = await fetch(`https://www.seismicportal.eu/fdsnws/event/1/query?${params}`);
        if (!res.ok) throw new Error(`EMSC ${res.status}`);
        const j = await res.json() as { features: Array<{ id:string; properties: EmscEarthquake['properties']; geometry: EmscEarthquake['geometry']; type:string }> };
        let daily: EmscEarthquake[] = (j.features??[]).map((f)=> ({ id:f.id, properties:f.properties, geometry:f.geometry, type:f.type } as EmscEarthquake));
        if (daily.length===0) {
          const fb = await fetchEmscData();
          daily = fb;
        }
        if (cancelled) return;
        setEvents(daily);
        eventsRef.current = daily;
      }catch{
        try{
          const fb2 = await fetchEmscData();
          if (!cancelled) { setEvents(fb2); eventsRef.current = fb2; }
        }catch{}
      }
    })();
    return ()=>{ cancelled=true; };
  }, [externalEvents]);

  // load tiles once
  useEffect(() => {
    let cancelled = false;
    try {
      const fonts = (document as Document).fonts;
      fonts?.load?.('700 24px Oswald').catch(()=>{});
      fonts?.load?.('400 13px Inter').catch(()=>{});
    } catch {}
    const urls = dailyTileUrls();
    Promise.all(urls.map(loadImage)).then((results)=>{
      if (cancelled) return;
      const failures = results.filter(r=>!r.img);
      if (failures.length === results.length) {
        setMapError('Map tiles failed to load. Is /api/tile deployed? Plain vite dev has no /api/* .');
        viewRef.current = null;
      } else {
        const mosaic = document.createElement('canvas');
        mosaic.width = DAILY_COLS * DAILY_TILE;
        mosaic.height = DAILY_ROWS * DAILY_TILE;
        const mctx = mosaic.getContext('2d', { alpha:false } as unknown as CanvasRenderingContext2DSettings);
        if (mctx) {
          mctx.fillStyle = '#0a0d12';
          mctx.fillRect(0,0,mosaic.width, mosaic.height);
          results.forEach((r,i)=>{
            if (!r.img) return;
            const c = i % DAILY_COLS;
            const rr = Math.floor(i / DAILY_COLS);
            mctx.drawImage(r.img, c * DAILY_TILE, rr * DAILY_TILE, DAILY_TILE, DAILY_TILE);
          });
        }
        viewRef.current = buildDailyMosaicView(mosaic);
      }
      setPhase('preview');
    });
    return ()=>{ cancelled=true; };
  }, []);

  // preload sounds
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const AC = (window as unknown as { AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }).AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      try{
        const res = await fetch('/sounds/circle-appear.mp3');
        if (res.ok && AC) {
          const arr = await res.arrayBuffer();
          const tmp = new AC();
          try{
            const buf = await tmp.decodeAudioData(arr.slice(0));
            if (!cancelled) circleBufRef.current = buf;
          }finally{ tmp.close().catch(()=>{}); }
        }
      }catch{}
      try{
        const res2 = await fetch('/sounds/daily-report.mp3');
        if (res2.ok && AC) {
          const arr2 = await res2.arrayBuffer();
          const tmp2 = new AC();
          try{
            const buf2 = await tmp2.decodeAudioData(arr2.slice(0));
            if (!cancelled) dailyBufRef.current = buf2;
          }finally{ tmp2.close().catch(()=>{}); }
        }
      }catch{}
      try{
        const res3 = await fetch('/sounds/highest-recorded.mp3');
        if (res3.ok && AC) {
          const arr3 = await res3.arrayBuffer();
          const tmp3 = new AC();
          try{
            const buf3 = await tmp3.decodeAudioData(arr3.slice(0));
            if (!cancelled) highestBufRef.current = buf3;
          }finally{ tmp3.close().catch(()=>{}); }
        }
      }catch{}
    })();
    return ()=>{ cancelled=true; };
  },[]);

  function getAudioCtx(): AudioContext | null {
    if (audioCtxRef.current) return audioCtxRef.current;
    const AC = (window as unknown as { AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }).AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ac = new AC({ sampleRate: 48000 } as AudioContextOptions);
    audioCtxRef.current = ac;
    return ac;
  }
  // unlock audio on first user gesture (preview starts without click otherwise blocked)
  useEffect(()=>{
    const unlock = ()=>{ if (audioCtxRef.current?.state==='suspended') audioCtxRef.current.resume().catch(()=>{}); };
    window.addEventListener('click', unlock, { once:true });
    window.addEventListener('keydown', unlock, { once:true });
    return ()=>{ window.removeEventListener('click', unlock); window.removeEventListener('keydown', unlock); };
  },[]);
  function playCircleNow(){
    // Use HTMLAudio clone for overlapping per-circle pops (more reliable than buffer resume timing)
    try{
      const a = new Audio('/sounds/circle-appear.mp3');
      a.volume = 0.92;
      a.play().catch(()=>{
        // fallback to buffer
        const ac = getAudioCtx();
        const buf = circleBufRef.current;
        if (!ac || !buf) return;
        if (ac.state === 'suspended') ac.resume().catch(()=>{});
        const src = ac.createBufferSource();
        src.buffer = buf;
        const g = ac.createGain();
        g.gain.value = 0.92;
        src.connect(g);
        g.connect(ac.destination);
        try{ src.start(); }catch{}
      });
    }catch{
      const ac = getAudioCtx();
      const buf = circleBufRef.current;
      if (!ac || !buf) return;
      if (ac.state === 'suspended') ac.resume().catch(()=>{});
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g = ac.createGain();
      g.gain.value = 0.92;
      src.connect(g);
      g.connect(ac.destination);
      try{ src.start(); }catch{}
    }
  }
  function playHighestNow(){
    try{
      const a = new Audio('/sounds/highest-recorded.mp3');
      a.volume = 0.95;
      a.play().catch(()=>{
        const ac = getAudioCtx();
        const buf = highestBufRef.current;
        if (!ac || !buf) return;
        if (ac.state === 'suspended') ac.resume().catch(()=>{});
        const src = ac.createBufferSource();
        src.buffer = buf;
        const g = ac.createGain();
        g.gain.value = 0.95;
        src.connect(g);
        g.connect(ac.destination);
        try{ src.start(); }catch{}
      });
    }catch{
      const ac = getAudioCtx();
      const buf = highestBufRef.current;
      if (!ac || !buf) return;
      if (ac.state === 'suspended') ac.resume().catch(()=>{});
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g = ac.createGain();
      g.gain.value = 0.95;
      src.connect(g);
      g.connect(ac.destination);
      try{ src.start(); }catch{}
    }
  }
  function playDailyNow(){
    try{
      const a = new Audio('/sounds/daily-report.mp3');
      a.volume = 0.95;
      a.play().catch(()=>{
        const ac = getAudioCtx();
        const buf = dailyBufRef.current;
        if (!ac || !buf) return;
        if (ac.state === 'suspended') ac.resume().catch(()=>{});
        const src = ac.createBufferSource();
        src.buffer = buf;
        const g = ac.createGain();
        g.gain.value = 0.95;
        src.connect(g);
        g.connect(ac.destination);
        try{ src.start(); }catch{}
      });
    }catch{
      const ac = getAudioCtx();
      const buf = dailyBufRef.current;
      if (!ac || !buf) return;
      if (ac.state === 'suspended') ac.resume().catch(()=>{});
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g = ac.createGain();
      g.gain.value = 0.95;
      src.connect(g);
      g.connect(ac.destination);
      try{ src.start(); }catch{}
    }
  }

  // render loop — also triggers per-circle pop sound when wipe passes lon
  useEffect(()=>{
    if (phase!=='preview' && phase!=='recording') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { colorSpace:'srgb', alpha:false, desynchronized:false } as unknown as CanvasRenderingContext2DSettings);
    if (!canvas || !ctx) return;
    const t0 = performance.now();
    const tick = (now:number)=>{
      const t = (now - t0)/1000;
      if (phase==='recording' && t >= DAILY_DUR) {
        drawDailyFrame(ctx as unknown as CanvasRenderingContext2D, viewRef.current, eventsRef.current, DAILY_DUR, Date.now());
        recRef.current?.stop();
        return;
      }
      const loopT = phase==='preview' ? t % (DAILY_DUR+1) : t;
      drawDailyFrame(ctx as unknown as CanvasRenderingContext2D, viewRef.current, eventsRef.current, loopT, Date.now());
      // per-circle + daily + highest sounds in preview — highlight-aware wipe
      if (phase==='preview') {
        if (loopT < lastLoopTRef.current - 0.5) { playedRef.current.clear(); dailyPlayedRef.current=false; highestPlayedRef.current=false; prevHighlightRef.current=false; }
        lastLoopTRef.current = loopT;
        let wP: number, curLng: number, isHighNow=false;
        if (eventsRef.current.length>0) {
          const topP = [...eventsRef.current].sort((a,b)=> b.properties.mag - a.properties.mag)[0];
          const tLon = topP.properties.lon;
          const rF = (tLon+180)/360;
          const rT = DAILY_WIPE_START + rF*DAILY_WIPE_DUR;
          const hEnd = rT + DAILY_HIGHLIGHT_DUR;
          if (loopT < rT) { wP = (loopT - DAILY_WIPE_START)/DAILY_WIPE_DUR; isHighNow=false; }
          else if (loopT < hEnd) { wP = rF; isHighNow=true; }
          else { wP = (loopT - DAILY_HIGHLIGHT_DUR - DAILY_WIPE_START)/DAILY_WIPE_DUR; isHighNow=false; }
          wP = Math.min(Math.max(wP,0),1);
          curLng = -180 + wP*360;
        } else {
          wP = Math.min(Math.max((loopT - DAILY_WIPE_START)/DAILY_WIPE_DUR,0),1);
          curLng = -180 + wP*360;
          isHighNow=false;
        }
        let newly: typeof eventsRef.current = [];
        if (wP > 0 && wP < 1) {
          for (const ev of eventsRef.current) {
            if (ev.properties.lon <= curLng && !playedRef.current.has(ev.id)) {
              playedRef.current.add(ev.id);
              newly.push(ev);
            }
          }
        } else if (wP >= 1) {
          for (const ev of eventsRef.current) if (!playedRef.current.has(ev.id)) { playedRef.current.add(ev.id); newly.push(ev); }
        }
        newly.forEach((_, idx)=> setTimeout(()=> playCircleNow(), idx * 200));
        if (isHighNow && !prevHighlightRef.current && !highestPlayedRef.current) {
          highestPlayedRef.current = true;
          playHighestNow();
        }
        prevHighlightRef.current = isHighNow;
        if (!dailyPlayedRef.current && loopT >= DAILY_INFO_START) {
          dailyPlayedRef.current = true;
          playDailyNow();
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return ()=> cancelAnimationFrame(rafRef.current);
  }, [phase]);

  // cleanup
  useEffect(()=>{
    return ()=>{
      cancelAnimationFrame(rafRef.current);
      if (recRef.current && recRef.current.state!=='inactive') { try{recRef.current.stop();}catch{}}
      if (audioCtxRef.current) { audioCtxRef.current.close().catch(()=>{}); audioCtxRef.current=null; }
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  function pickMime(): string {
    const cands = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
    if (typeof MediaRecorder==='undefined') return '';
    for (const c of cands) { try{ if (MediaRecorder.isTypeSupported(c)) return c; }catch{}}
    return '';
  }

  const startRecording = async ()=>{
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stream = typeof canvas.captureStream==='function' ? canvas.captureStream(DAILY_FPS) : null;
    if (!stream) { setPhase('unsupported'); return; }
    const type = pickMime();
    if (!type) { setPhase('unsupported'); return; }

    // Per-circle + daily-report sounds — schedule and capture via MediaStreamDestination
    let recordStream: MediaStream = stream;
    let recAc: AudioContext | null = null;
    try{
      // ensure buffers loaded
      if (!circleBufRef.current) {
        try{
          const res = await fetch('/sounds/circle-appear.mp3');
          if (res.ok) {
            const arr = await res.arrayBuffer();
            const AC2 = (window as unknown as { AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }).AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (AC2) {
              const tmp = new AC2();
              const decoded = await tmp.decodeAudioData(arr.slice(0));
              circleBufRef.current = decoded;
              tmp.close().catch(()=>{});
            }
          }
        }catch{}
      }
      if (!dailyBufRef.current) {
        try{
          const res2 = await fetch('/sounds/daily-report.mp3');
          if (res2.ok) {
            const arr2 = await res2.arrayBuffer();
            const AC3 = (window as unknown as { AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }).AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (AC3) {
              const tmp3 = new AC3();
              const decoded2 = await tmp3.decodeAudioData(arr2.slice(0));
              dailyBufRef.current = decoded2;
              tmp3.close().catch(()=>{});
            }
          }
        }catch{}
      }
      if (!highestBufRef.current) {
        try{
          const resH = await fetch('/sounds/highest-recorded.mp3');
          if (resH.ok) {
            const arrH = await resH.arrayBuffer();
            const ACH = (window as unknown as { AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }).AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (ACH) {
              const tmpH = new ACH();
              const decodedH = await tmpH.decodeAudioData(arrH.slice(0));
              highestBufRef.current = decodedH;
              tmpH.close().catch(()=>{});
            }
          }
        }catch{}
      }
      const finalCircle = circleBufRef.current;
      const finalDaily = dailyBufRef.current;
      const finalHighest = highestBufRef.current;
      if (finalCircle || finalDaily || finalHighest) {
        const AC = (window as unknown as { AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }).AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) {
          recAc = new AC({ sampleRate: 48000 } as AudioContextOptions);
          audioCtxRef.current = recAc;
          await recAc.resume().catch(()=>{});
          const dest = recAc.createMediaStreamDestination();
          const t0 = recAc.currentTime + 0.06;
          if (finalCircle) {
            const topRec = [...eventsRef.current].sort((a,b)=> b.properties.mag - a.properties.mag)[0];
            const topLonRec = topRec?.properties.lon ?? 180;
            for (const ev of eventsRef.current) {
              let revealT = DAILY_WIPE_START + ((ev.properties.lon + 180) / 360) * DAILY_WIPE_DUR;
              if (ev.properties.lon > topLonRec) revealT += DAILY_HIGHLIGHT_DUR;
              if (revealT < 0 || revealT > DAILY_DUR) continue;
              const src = recAc.createBufferSource();
              src.buffer = finalCircle;
              const g = recAc.createGain();
              g.gain.value = 0.92;
              src.connect(g);
              g.connect(dest);
              g.connect(recAc.destination);
              try{ src.start(t0 + revealT); }catch{}
            }
          }
          if (finalHighest) {
            const topH = [...eventsRef.current].sort((a,b)=> b.properties.mag - a.properties.mag)[0];
            if (topH) {
              const tLon = topH.properties.lon;
              const revealTH = DAILY_WIPE_START + ((tLon+180)/360)*DAILY_WIPE_DUR;
              const srcH = recAc.createBufferSource();
              srcH.buffer = finalHighest;
              const gH = recAc.createGain();
              gH.gain.value = 0.96;
              srcH.connect(gH);
              gH.connect(dest);
              gH.connect(recAc.destination);
              try{ srcH.start(t0 + revealTH); }catch{}
            }
          }
          if (finalDaily) {
            const srcD = recAc.createBufferSource();
            srcD.buffer = finalDaily;
            const gD = recAc.createGain();
            gD.gain.value = 0.95;
            srcD.connect(gD);
            gD.connect(dest);
            gD.connect(recAc.destination);
            try{ srcD.start(t0 + DAILY_INFO_START); }catch{}
          }
          const aTracks = dest.stream.getAudioTracks();
          if (aTracks.length>0) recordStream = new MediaStream([...stream.getVideoTracks(), ...aTracks]);
        }
      }
    }catch(e){ console.error('[DailyReport] sound schedule failed', e); }

    const chunks: Blob[] = [];
    const rec = new MediaRecorder(recordStream, { mimeType:type, videoBitsPerSecond:24_000_000, audioBitsPerSecond:128_000 });
    rec.ondataavailable=(e:BlobEvent)=>{ if(e.data&&e.data.size>0) chunks.push(e.data); };
    rec.onstop =()=>{
      stream.getTracks().forEach(t=>t.stop());
      if (recAc) { recAc.close().catch(()=>{}); if (audioCtxRef.current===recAc) audioCtxRef.current=null; }
      else if (audioCtxRef.current) { audioCtxRef.current.close().catch(()=>{}); audioCtxRef.current=null; }
      const blob = new Blob(chunks, { type:type.split(';')[0] });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(blob));
      setPhase('done');
    };
    recRef.current=rec;
    setMime(type);
    setPhase('recording');
    rec.start(250);
  };

  const ext = mime.includes('mp4')?'mp4':'webm';

  return (
    <div className="video-modal-backdrop" onClick={onClose}>
      <div className="video-modal glass" onClick={(e)=>e.stopPropagation()} style={{maxWidth: 460}}>
        <div className="video-modal-head">
          <span className="flex-center" style={{gap:'8px'}}>
            <Clapperboard size={18}/>
            Daily Earth Report — EMSC • UTC ({DAILY_DUR}s)
          </span>
          <button type="button" className="action-btn glass flex-center" onClick={onClose} aria-label="Close"><X size={16}/></button>
        </div>
        {phase==='loading' && <p className="text-muted">Loading global map…</p>}
        {mapError && (phase==='preview'||phase==='done') && <p className="text-muted" style={{color:'#f59e0b'}}>No map tiles: {mapError}</p>}
        {phase==='unsupported' && <p className="text-muted">Video recording not supported in this browser.</p>}
        <canvas ref={canvasRef} width={DAILY_W} height={DAILY_H} className="video-canvas" />
        {events.length>0 && (
          <p className="text-muted" style={{fontSize:'0.78rem', textAlign:'center'}}>
            {events.length} EMSC events • UTC • wipe reveals west → east (lon ≤ scan)
          </p>
        )}
        {phase==='preview' && <button type="button" className="action-btn glass flex-center" onClick={startRecording}><Clapperboard size={16}/><span>Record daily video</span></button>}
        {phase==='recording' && <p className="text-muted">Recording… keep this tab visible.</p>}
        {phase==='done' && videoUrl && (
          <div className="video-result">
            <video src={videoUrl} controls playsInline className="video-preview" />
            <a className="action-btn glass flex-center" href={videoUrl} download={`terraguard-daily-${new Date().toISOString().slice(0,10)}.webm`}>
              <Download size={16}/><span>Download .{ext}</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default DailyEarthReportModal;
