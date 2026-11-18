/* eslint-disable react-refresh/only-export-components --
   Pure render pieces shared with the free headless renderer
   (scripts/remembering-video-entry.ts). */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
import {
  W,
  H,
  COLS,
  ROWS,
  TILE,
  MOSAIC_D,
} from './VideoReport';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import type { DyfiPoint, MmiContour, RuptureData } from '../lib/dyfi';
import { mmiColor } from '../lib/usgsOverlays';
import { latLngToDisplayPx, severityWord, countryOf, threatColor, shakeChipColor } from './VideoReport';
import { estimateAffectedRadiusKm, estimateDamage, isKnownIntensity } from '../lib/videoMeta';
import type { ShakeRow } from '../lib/videoMeta';

export const DUR = 20;
export const WAVE_T = 6.0;
export const CIRCLE_T = 6.5;
export const PULSE_PERIOD = 1.0;
// Info sections (EVENT / IMPACT / SHAKE / DAMAGE) fade in 4s after the
// epicenter appears.
export const SECTIONS_T = CIRCLE_T + 4;
const SECTION_FADE = 0.6;

export interface RememberingInfo {
  intensity?: string;
  threat?: string;
  source?: string;
  /** Reported felt intensities, strongest first (SHAKE REPORT rows). */
  shakes?: ShakeRow[];
}

export interface RememberingView {
  mosaic: HTMLCanvasElement;
  exD: number;
  eyD: number;
}

// Re-export shared constants/helpers from VideoReport for the headless renderer and debug page.
export { W, H, FPS, COLS, ROWS, TILE, MOSAIC_D, esriTileUrls, epicenterMosaicPx } from './VideoReport';

function magColor(magRaw: string): string {
  const m = parseFloat(magRaw);
  if (isNaN(m)) return '#9ca3af';
  if (m >= 7) return '#a78bfa';
  if (m >= 6) return '#ef4444';
  if (m >= 5) return '#f97316';
  if (m >= 4) return '#eab308';
  if (m >= 3) return '#60a5fa';
  return '#22c55e';
}

export function drawRememberingFrame(
  ctx: CanvasRenderingContext2D,
  view: RememberingView | null,
  eq: PhivolcsEarthquake,
  dyfi: DyfiPoint[],
  contours: MmiContour[],
  rupture: RuptureData | null,
  info: RememberingInfo | null,
  t: number,
) {
  const clamped = Math.min(Math.max(t, 0), DUR);
  // The mosaic is drawn with an epi-centering shift so the epicenter lands at
  // the canvas center. latLngToDisplayPx() does NOT include that shift, so
  // every overlay must add it back or it drifts off the map underneath.
  const oExD = view ? view.exD : W / 2;
  const oEyD = view ? view.eyD : H / 2;
  const shX = W / 2 - oExD;
  const shY = H / 2 - oEyD;
  const dex = W / 2;
  const dey = H / 2;
  const toPx = (lat: number, lng: number) => {
    const { x, y } = latLngToDisplayPx(eq, lat, lng);
    return { x: x + shX, y: y + shY };
  };
  let pivotX = dex;
  let pivotY = dey;
  if (contours && contours.length > 0) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const c of contours) {
      for (const line of c.coords) {
        for (const pt of line) {
          const { x, y } = toPx(pt[1], pt[0]);
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    if (n > 0) {
      pivotX = sx / n;
      pivotY = sy / n;
    }
  }
  const shakeActive = clamped >= WAVE_T && clamped < WAVE_T + 0.5;
  let shakeX = 0;
  let shakeY = 0;
  if (shakeActive) {
    const k = 1 - (clamped - WAVE_T) / 0.5;
    shakeX = Math.sin(clamped * 82) * 5 * k;
    shakeY = Math.cos(clamped * 97) * 4 * k;
  }
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, W, H);
  if (shakeActive) {
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }

  // Zoom: far -> close over the first 5s, then hold until the SHAKE REPORT /
  // DAMAGE ASSESSMENT panels appear (SECTIONS_T), then a slow extra push
  // toward the center until the end.
  const ZOOM_BASE = 2.0;
  const ZOOM_EXTRA = 0.25;
  let zoom = ZOOM_BASE;
  if (clamped < 5) {
    zoom = 1.0 + (ZOOM_BASE - 1.0) * easeInOut(clamped / 5);
  } else if (clamped >= CIRCLE_T) {
    // Slow zoom that ACCELERATES toward the end (ease-in cubic) and keeps
    // going even past the end of the video (duration longer than the
    // remaining runtime) so it never stops/plateaus.
    const p = Math.min(Math.max((clamped - CIRCLE_T) / 15, 0), 1);
    const eased = p * p * p;
    zoom = ZOOM_BASE + ZOOM_EXTRA * eased;
  }
  // Keep annotations at their original 1.3x visual size; only the map camera
  // moves closer, so dots/contours/marker don't balloon with the zoom.
  const ZOOM_REF = 1.3;
  const sizeScale = ZOOM_REF / zoom;

  if (view) {
    const { mosaic } = view;
    const mapX = (W - COLS * TILE * MOSAIC_D) / 2 + shX;
    const mapY = (H - ROWS * TILE * MOSAIC_D) / 2 + shY;
    const mapW = COLS * TILE * MOSAIC_D;
    const mapH = ROWS * TILE * MOSAIC_D;
    let pR = 0;
    if (clamped >= WAVE_T) {
      const age = clamped - WAVE_T;
      pR = Math.min(age * 900, Math.max(W, H) * 1.1);
    }
    // Grayscale base everywhere (black & white from the start).
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.scale(zoom, zoom);
    ctx.translate(-pivotX, -pivotY);
    ctx.filter = 'grayscale(1) brightness(0.3)';
    ctx.drawImage(mosaic, mapX, mapY, mapW, mapH);
    ctx.restore();
    // Color returns inside the expanding P-wave.
    if (clamped >= WAVE_T && pR > 0) {
      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.scale(zoom, zoom);
      ctx.translate(-pivotX, -pivotY);
      ctx.beginPath();
      ctx.arc(dex, dey, pR, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(mosaic, mapX, mapY, mapW, mapH);
      ctx.restore();
    }
  }

  // Vignette.
  const vg = ctx.createRadialGradient(
    W / 2,
    H / 2,
    Math.min(W, H) * 0.3,
    W / 2,
    H / 2,
    Math.max(W, H) * 0.72,
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  vg.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // Anticipation pulse from the start until the P/S waves appear: a scaling
  // circle that grows from 0 to full size and fades out, repeating every 1s.
  if (clamped >= 0 && clamped < WAVE_T) {
    const phase = clamped % 1;
    const maxR = 160;
    const r = maxR * phase; // 0 -> 100% scale up
    const alpha = (1 - phase) * 0.85; // fade out while scaling up
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.scale(zoom, zoom);
    ctx.translate(-pivotX, -pivotY);
    ctx.globalAlpha = alpha;
    // Filled circle with a radial gradient so it reads as a soft pulse.
    const grad = ctx.createRadialGradient(dex, dey, 0, dex, dey, Math.max(r, 1));
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(dex, dey, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    // Crisp outer ring.
    ctx.beginPath();
    ctx.arc(dex, dey, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  // Seismic wave explosion from 6s: P (fast) + S (slower).
  let sWaveR = 0;
  if (clamped >= WAVE_T) {
    const age = clamped - WAVE_T;
    const maxR = Math.max(W, H) * 1.1;
    const pR = Math.min(age * 900, maxR);
    const sR = Math.min(age * 520, maxR);
    sWaveR = sR;
    const alpha = Math.max(0, 1 - age / 3.5);
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.scale(zoom, zoom);
    ctx.translate(-pivotX, -pivotY);
    ctx.globalAlpha = alpha;
    // P wave
    ctx.beginPath();
    ctx.arc(dex, dey, pR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56,189,248,0.9)';
    ctx.lineWidth = 6;
    ctx.stroke();
    // P-wave inner radial gradient (fades to center).
    const pGrad = ctx.createRadialGradient(dex, dey, pR * 0.6, dex, dey, pR);
    pGrad.addColorStop(0, 'rgba(56,189,248,0)');
    pGrad.addColorStop(1, 'rgba(56,189,248,0.35)');
    ctx.fillStyle = pGrad;
    ctx.beginPath();
    ctx.arc(dex, dey, pR, 0, Math.PI * 2);
    ctx.fill();
    // S wave
    ctx.beginPath();
    ctx.arc(dex, dey, sR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(248,113,113,0.85)';
    ctx.lineWidth = 8;
    ctx.stroke();
    // S-wave inner radial gradient (fades to center).
    const sGrad = ctx.createRadialGradient(dex, dey, sR * 0.6, dex, dey, sR);
    sGrad.addColorStop(0, 'rgba(248,113,113,0)');
    sGrad.addColorStop(1, 'rgba(248,113,113,0.3)');
    ctx.fillStyle = sGrad;
    ctx.beginPath();
    ctx.arc(dex, dey, sR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // DYFI felt responses revealed by the S-wave front.
  if (dyfi && dyfi.length > 0 && sWaveR > 0) {
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.scale(zoom, zoom);
    ctx.translate(-pivotX, -pivotY);
    for (const p of dyfi) {
      const { x: bx, y: by } = toPx(p.lat, p.lng);
      const dist = Math.hypot(bx - dex, by - dey);
      if (dist > sWaveR) continue;
      const reveal = Math.min(Math.max((sWaveR - dist) / 140, 0), 1);
      if (reveal <= 0) continue;
      ctx.globalAlpha = reveal;
      const rr = 4.5 * (0.3 + 0.7 * reveal) * sizeScale;
      ctx.beginPath();
      ctx.arc(bx, by, rr, 0, Math.PI * 2);
      ctx.fillStyle = p.cdi != null ? mmiColor(p.cdi) : '#ffd166';
      ctx.fill();
    }
    ctx.restore();
  }

  // Finite fault (rupture extent) revealed by the S-wave front, plain red.
  if (rupture && sWaveR > 0) {
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.scale(zoom, zoom);
    ctx.translate(-pivotX, -pivotY);
    ctx.beginPath();
    ctx.arc(dex, dey, sWaveR, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(220,38,38,0.45)';
    for (const poly of rupture.coords) {
      for (const ring of poly) {
        ctx.beginPath();
        ring.forEach((pt, i) => {
          const { x, y } = toPx(pt[1], pt[0]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // MMI contours revealed by the S-wave front (radial wipe).
  if (contours && contours.length > 0 && sWaveR > 0) {
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.scale(zoom, zoom);
    ctx.translate(-pivotX, -pivotY);
    ctx.beginPath();
    ctx.arc(dex, dey, sWaveR, 0, Math.PI * 2);
    ctx.clip();
    for (const c of contours) {
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 2 * sizeScale;
      for (const line of c.coords) {
        ctx.beginPath();
        line.forEach((pt, i) => {
          const { x, y } = toPx(pt[1], pt[0]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Radar pulse BEHIND the epicenter circle: a plain filled disk that scales
  // from 0 to full size and fades out, repeating every 1s, starting when the
  // epicenter appears. Drawn first so the circle sits on top of it.
  if (clamped >= CIRCLE_T) {
    const phase = (clamped - CIRCLE_T) % 1;
    const maxR = 220;
    const r = Math.max(maxR * phase, 1);
    const alpha = (1 - phase) * 0.9;
    const appear = Math.min(Math.max((clamped - CIRCLE_T) / 2, 0), 1);
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.scale(zoom, zoom);
    ctx.translate(-pivotX, -pivotY);
    ctx.globalAlpha = alpha * appear;
    const grad = ctx.createRadialGradient(dex, dey, 0, dex, dey, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.45)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(dex, dey, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  // Epicenter circle + magnitude from 6.5s: plain solid circle, color by magnitude.
  if (clamped >= CIRCLE_T) {
    const color = magColor(eq.magnitude);
    const appear = Math.min(Math.max((clamped - CIRCLE_T) / 2, 0), 1);
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.scale(zoom, zoom);
    ctx.translate(-pivotX, -pivotY);
    ctx.globalAlpha = appear;
    ctx.beginPath();
    ctx.arc(dex, dey, 44 * sizeScale, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    // Magnitude number.
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${34 * sizeScale}px Oswald, Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${eq.magnitude || '?'}`, dex, dey);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.restore();
  }

  if (shakeActive) ctx.restore();

  // Broadcast data sections fade in 4s after the epicenter appears.
  drawInfoSections(ctx, eq, info, clamped);

  // "ON THIS DAY" caption near the bottom center, fades in at 2s.
  // The caption starts near the bottom edge. It only begins moving up once the
  // SHAKE REPORT / DAMAGE ASSESSMENT panels have started appearing, so it
  // stays near the bottom during the first half of the video and then glides
  // up to its final position as they settle in.
  const CAPTION_LIFT_MAX = Math.round(H * 0.18);
  const CAPTION_MOVE_T = SECTIONS_T;
  const CAPTION_MOVE_DUR = 0.6;
  const captionP = Math.min(Math.max((clamped - CAPTION_MOVE_T) / CAPTION_MOVE_DUR, 0), 1);
  const CAPTION_LIFT = CAPTION_LIFT_MAX * easeOutCubic(captionP);
  // Fonts trimmed 3% from the approved 32px / 40px sizes.
  const CAPTION_FONT_SCALE = 0.97;
  if (clamped >= 2) {
    const a = Math.min(Math.max((clamped - 2) / 0.5, 0), 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${32 * CAPTION_FONT_SCALE}px Oswald, Inter, sans-serif`;
    ctx.textAlign = 'center';
    // Soft drop shadow so the caption stays legible over bright map areas.
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 5;
    ctx.fillText('ON THIS DAY', W / 2, H - 160 - CAPTION_LIFT);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // Earthquake name below "ON THIS DAY", appears 2s after the epicenter.
  if (clamped >= CIRCLE_T + 2) {
    const a = Math.min(Math.max((clamped - (CIRCLE_T + 2)) / 0.5, 0), 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${40 * CAPTION_FONT_SCALE}px Oswald, Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;
    ctx.fillText(eq.location || '', W / 2, H - 110 - CAPTION_LIFT);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // Watermark.
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
}

// Broadcast data sections: EVENT DATA (top-left), IMPACT DATA (top-right),
// SHAKE REPORT (bottom-left) and DAMAGE ASSESSMENT (bottom-right). Pure
// fade-in (no slide) starting at SECTIONS_T.
function drawInfoSections(
  ctx: CanvasRenderingContext2D,
  eq: PhivolcsEarthquake,
  info: RememberingInfo | null,
  t: number,
) {
  const p = Math.min(Math.max((t - SECTIONS_T) / SECTION_FADE, 0), 1);
  if (p <= 0) return;

  const intensity = (info?.intensity ?? '').trim();
  const threatRaw = (info?.threat ?? '').trim();
  const threat = !threatRaw || threatRaw === '—' || threatRaw === '-' ? 'None' : threatRaw;
  const shakes = info?.shakes ?? [];
  const srcRaw = ((info?.source ?? (eq as { source?: string }).source) ?? '').toString().trim();
  const srcLabel = srcRaw ? srcRaw.toUpperCase() : 'USGS';

  const magText = eq.magnitude || '?';
  const [sevWord, sevColor] = severityWord(eq.magnitude);
  const depthNum = eq.depth || '?';
  const depthTag = (() => {
    const d = parseFloat(eq.depth);
    return !isNaN(d) && d >= 70 ? 'Deep' : 'Shallow';
  })();
  const coordsText = `${eq.latitude || '?'}\u00B0N, ${eq.longitude || '?'}\u00B0E`;
  const timeText = (eq.datetime || '').slice(0, 44);
  const country = countryOf(eq.location);
  const radius = estimateAffectedRadiusKm(eq.magnitude) || '\u2014';
  const colTop = 64;

  ctx.save();
  ctx.globalAlpha = p;

  // Side scrims so the columns stay legible over the imagery.
  {
    const leftW = W * 0.42;
    const lg = ctx.createLinearGradient(0, 0, leftW, 0);
    lg.addColorStop(0, 'rgba(0,0,0,0.44)');
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

  ctx.textAlign = 'left';

  // EVENT DATA (top-left).
  {
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
    ctx.fillText(srcLabel === 'EMSC' ? 'EMSC-CSEM' : srcLabel, lx, ly);
  }

  // IMPACT DATA (top-right).
  {
    const re = W - 64;
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
    ctx.fillStyle = (() => {
      const v = intensity.toUpperCase();
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
      ['TSUNAMI THREAT', threat, threatColor(threat)],
      ['EVENT TYPE', 'Earthquake', '#60a5fa'],
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
    ry += 4;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 13px Inter, sans-serif';
    ctx.fillText('AFFECTED RADIUS', re, ry);
    ry += 26;
    ctx.fillStyle = '#ffffff';
    ctx.font = '400 19px Inter, sans-serif';
    ctx.fillText(radius, re, ry);
    ctx.textAlign = 'left';
  }

  // SHAKE REPORT (bottom-left): the reported felt intensities, strongest
  // first. Stacked upward from the same baseline as DAMAGE ASSESSMENT so the
  // two bottom panels line up, and below the centred captions.
  {
    const shakeList: ShakeRow[] =
      shakes.length > 0
        ? shakes.slice(0, 5)
        : intensity
          ? [{ area: (eq.location || '').slice(0, 30) || 'Epicenter area', intensity }]
          : [];
    const rows = shakeList.length > 0 ? shakeList.length : 1;
    const lastBaseline = H - 68;
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
      ctx.font = '400 19px Inter, sans-serif';
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
      sy += 38;
    }
  }

  // DAMAGE ASSESSMENT (bottom-right). Anchored below the "ON THIS DAY" /
  // name captions, which sit higher up the frame, so the bottom-right corner
  // is clear for it.
  {
    const dmg = isKnownIntensity(intensity) ? estimateDamage(eq.magnitude, intensity) : null;
    const showUnknown = !dmg && !isNaN(parseFloat(eq.magnitude));
    if (dmg || showUnknown) {
      const bWord = dmg ? sevWord : 'Unknown';
      const bColor = dmg ? sevColor : '#6b7280';
      const dx0 = 648;
      const dmgValY = H - 68;
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
    }
  }

  ctx.restore();
  ctx.textAlign = 'left';
}
