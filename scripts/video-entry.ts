// Free headless video renderer (GitHub Actions + node-canvas + FFmpeg).
// Reuses the exact drawFrame() from src/components/VideoReport.tsx — the
// browser modal and this script render pixel-identical timelines.
//
// Input:  QUAKE_JSON env — { datetime, latitude, longitude, depth,
//           magnitude, location, link?, intensity?, threat?, shakes?,
//           description?, usgsEventId?, source? }
// Output: OUT_DIR/out.mp4 (+ frames), optional Facebook upload when
//   FB_PAGE_ID + FB_UPLOAD_TOKEN are set.
//
// Run: OUT_DIR=/tmp/vid QUAKE_JSON='{...}' node dist-video/video-entry.mjs
// (bundle first: npx esbuild scripts/video-entry.ts --bundle
//  --platform=node --format=esm --external:react --external:lucide-react
//  --loader:.css=empty --outfile=dist-video/video-entry.mjs)

import { createCanvas, loadImage, registerFont } from 'canvas';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {
  drawFrame,
  esriTileUrls,
  epicenterMosaicPx,
  W,
  H,
  FPS,
  DUR,
  COLS,
  ROWS,
  TILE,
  MOSAIC_D,
} from '../src/components/VideoReport.js';
import { estimateAffectedRadiusKm, estimateDamage } from '../src/lib/videoMeta.js';
import { fetchDyfiPoints } from '../src/lib/dyfi.js';

// Re-exported so tests/tools can import the shared render pieces from the
// bundled output (esbuild tree-shakes otherwise-unreferenced exports).
export {
  drawFrame,
  esriTileUrls,
  epicenterMosaicPx,
  W,
  H,
  FPS,
  DUR,
  COLS,
  ROWS,
  TILE,
  MOSAIC_D,
}; // note: buildVideoCaption is defined locally below (already exported)

const execFileAsync = promisify(execFile);

interface QuakeInput {
  datetime: string;
  latitude: string;
  longitude: string;
  depth: string;
  magnitude: string;
  location: string;
  place?: string; // alias used by the worker dispatch + manual workflow inputs
  link?: string;
  intensity?: string;
  threat?: string;
  shakes?: Array<{ area: string; intensity: string }>;
  description?: string;
  faultType?: string;
  infoNo?: string;
  tsunamiThreat?: string;
  usgsEventId?: string;
  source?: string;
  // Set by the worker for USGS confirmations: the video IS the final
  // report, so the FB upload uses the FINAL caption, not FLASH.
  finalReport?: boolean;
  // Dispatch payloads nest enrichment here (GitHub caps
  // repository_dispatch at 10 top-level properties); manual JSON may
  // still carry the same fields flat — main() flattens once.
  extra?: {
    intensity?: string;
    threat?: string;
    tsunamiThreat?: string;
    shakes?: Array<{ area: string; intensity: string }>;
    usgsEventId?: string;
  };
}

// b64url slug for the /details link (same scheme the workers use:
// base64 of "datetime-lat-lng", also resolvable for any source).
function detailsSlug(datetime: string, lat: string, lng: string): string {
  return Buffer.from(`${datetime}-${lat}-${lng}`)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function splitDateTime(raw: string): { date: string; time: string } {
  const m = /^(.*?)\s*-\s*(.+)$/.exec(String(raw ?? '').trim());
  if (!m) return { date: String(raw ?? '').trim(), time: '' };
  return { date: m[1].trim(), time: m[2].trim() };
}

function prettifyRange(s: string): string {
  return s.replace(/^~\s*/, '~ ').replace('–', ' - ');
}

// FLASH REPORT caption for the Facebook video post (see sample format).
export function buildVideoCaption(quake: QuakeInput): string {
  const mag = String(quake.magnitude ?? '?');
  const place = quake.location || quake.place || '';
  const { date, time } = splitDateTime(quake.datetime ?? '');
  const agency = { emsc: 'EMSC', usgs: 'USGS', phivolcs: 'PHIVOLCS' }[(quake as { source?: string }).source as string] || 'USGS';
  const lat = String(quake.latitude ?? '');
  const lng = String(quake.longitude ?? '');
  const coords = lat && lng ? `${lat}°N, ${lng}°E` : '';
  const country = (() => {
    const parts = place.split(',').map((s) => s.trim()).filter(Boolean);
    const raw = (parts.length > 1 ? parts[parts.length - 1] : parts[0] || '').replace(/\(.*?\)/g, ' ').trim();
    if (!raw || raw.length > 30 || raw.split(/\s+/).length > 3) return '';
    return raw
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  })();
  const dmg = estimateDamage(quake.magnitude, quake.intensity);
  const detailsUrl = `https://terraguard-ph.pages.dev/details/${detailsSlug(quake.datetime ?? '', lat, lng)}`;
  return [
    `${date}${time ? ` - ${time}` : ''} | Mag ${mag} - ${place} | FLASH REPORT`,
    ``,
    `M${mag} Earthquake`,
    `Location: ${place}`,
    `Country: ${country || 'N/A'}`,
    `Date: ${date}${time ? ` - ${time}` : ''}`,
    `Depth: ${quake.depth ? `${quake.depth} km` : 'N/A'}`,
    `Fault Type: ${quake.faultType || 'N/A'}`,
    `Agency: ${agency}`,
    `Information No.: ${quake.infoNo || 'N/A'}`,
    `Max Intensity: ${quake.intensity || 'N/A'}`,
    `Affected Radius: ${estimateAffectedRadiusKm(quake.magnitude) || 'N/A'}`,
    `Tsunami Threat: ${quake.tsunamiThreat || 'N/A'}`,
    `Event Type: Earthquake`,
    `Economic Losses: ${dmg ? prettifyRange(dmg.losses) : 'N/A'}`,
    `Damage & Fatalities: ${dmg ? '~ ' + dmg.fatalities.replace('–', '-') : 'N/A'}`,
    ...(coords ? [`Coordinates: ${coords}`, ``] : []),
    `Earthquake Visual Report:`,
    detailsUrl,
    ``,
    `Source: ${agency}`,
    ``,
    `#Earthquake #${agency} #TerraGuardPH`,
  ].join('\n');
}

// FINAL REPORT caption for USGS confirmation videos: same wording as the
// worker's USGS FB final (buildUsgsFbMessage in earthquake.js), adapted to
// video-payload fields. Used only when the dispatch sets finalReport.
export function buildFinalCaption(quake: QuakeInput): string {
  const mag = String(quake.magnitude ?? '?');
  const place = quake.location || quake.place || '';
  const { date, time } = splitDateTime(quake.datetime ?? '');
  const timeBare = time.replace(/\s*(UTC|PHT|UST)\s*$/i, '').trim();
  const lat = String(quake.latitude ?? '');
  const lng = String(quake.longitude ?? '');
  const m = parseFloat(mag);
  const prefix = isNaN(m) ? '🌍 ' : m >= 7 ? '🟥 ' : m >= 6 ? '🟥 ' : m >= 5 ? '🟧 ' : m >= 4 ? '🟨 ' : m >= 3 ? '🟦 ' : '🟩 ';
  const detailsUrl = `https://terraguard-ph.pages.dev/details/${detailsSlug(quake.datetime ?? '', lat, lng)}`;
  return [
    `${prefix}USGS FINAL REPORT`,
    ``,
    `A magnitude ${mag} earthquake was recorded near ${place} on ${date}${timeBare ? ` at ${timeBare}` : ''}.`,
    ``,
    `EARTHQUAKE INFORMATION`,
    ``,
    `Magnitude: ${mag}`,
    `Location: ${place}`,
    `Date & Time: ${date}${timeBare ? ` - ${timeBare}` : ''}`,
    `Depth: ${quake.depth ? `${quake.depth} km` : 'N/A'}`,
    ...(lat && lng ? [`Coordinates: ${lat}°N, ${lng}°E`, ``] : []),
    `Cinematic visual report attached — produced from USGS final data.`,
    ``,
    `Earthquake Details:`,
    detailsUrl,
    ``,
    `This is the final report issued by the United States Geological Survey (USGS).`,
    ``,
    `Source: USGS`,
    ``,
    `Join the Terra Guard Discord community for earthquake discussions:`,
    `https://discord.gg/tdGrvnvehP`,
    ``,
    `#Earthquake #USGS #TerraGuard #EarthquakeReport #SeismicActivity #Philippines #EarthquakePH #Lindol #TerraGuardPH`,
  ].join('\n');
}

async function main(): Promise<void> {
  const outDir = process.env.OUT_DIR || '/tmp/terraguard-video';
  fs.mkdirSync(outDir, { recursive: true });
  const quake = JSON.parse(process.env.QUAKE_JSON || '{}') as QuakeInput;
  if (!quake.location && quake.place) quake.location = quake.place;
  // Flatten dispatch `extra` enrichment (flat manual fields win when set).
  const ex = quake.extra ?? {};
  quake.intensity = quake.intensity || ex.intensity || '';
  quake.threat = quake.threat || ex.threat || '';
  quake.tsunamiThreat = quake.tsunamiThreat || ex.tsunamiThreat || quake.threat;
  quake.shakes = quake.shakes ?? ex.shakes ?? [];
  quake.usgsEventId = quake.usgsEventId || ex.usgsEventId;
  quake.finalReport = quake.finalReport || ex.finalReport || false;
  if (!quake.latitude || !quake.longitude) throw new Error('QUAKE_JSON missing latitude/longitude');

  registerFont('public/fonts/oswald-700.ttf', { family: 'Oswald', weight: '700' });
  registerFont('public/fonts/inter-400.ttf', { family: 'Inter', weight: '400' });

  // Tiles (direct Esri URLs — no CORS in node, no proxy needed).
  const urls = esriTileUrls(quake);
  const settled = await Promise.all(
    urls.map(async (u) => {
      try {
        return await loadImage(u);
      } catch (e) {
        console.error('tile failed:', u.slice(0, 80), e instanceof Error ? e.message : e);
        return null;
      }
    }),
  );
  const loaded = settled.filter(Boolean).length;
  console.log(`tiles: ${loaded}/${settled.length}`);
  if (loaded === 0) throw new Error('no map tiles loaded');

  const mosaic = createCanvas(COLS * TILE, ROWS * TILE);
  const mctx = mosaic.getContext('2d', { alpha: false } as unknown as Record<string, unknown>);
  mctx.fillStyle = '#0a0d12';
  mctx.fillRect(0, 0, mosaic.width, mosaic.height);
  settled.forEach((img, i) => {
    if (!img) return;
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    mctx.drawImage(img, c * TILE, r * TILE, TILE, TILE);
  });
  const { epx, epy } = epicenterMosaicPx(quake);
  const view = {
    mosaic: mosaic as unknown as HTMLCanvasElement,
    exD: (W - COLS * TILE * MOSAIC_D) / 2 + epx * MOSAIC_D,
    eyD: (H - ROWS * TILE * MOSAIC_D) / 2 + epy * MOSAIC_D,
  };

  // DYFI felt responses (never fatal — [] keeps the video identical).
  const dyfi = await fetchDyfiPoints({
    usgsEventId: quake.usgsEventId,
    datetime: quake.datetime,
    source: (quake as { source?: string }).source,
    latitude: quake.latitude,
    longitude: quake.longitude,
  });
  console.log(`dyfi points: ${dyfi.length}`);

  // Frames (deterministic timesteps — smoother than realtime capture).
  const total = Math.round(DUR * FPS);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false } as unknown as Record<string, unknown>);
  for (let i = 0; i < total; i++) {
    const tt = i / FPS;
    drawFrame(ctx as unknown as CanvasRenderingContext2D, view, quake, quake.intensity ?? '', quake.threat ?? '', quake.shakes ?? [], dyfi, tt, quake.source);
    fs.writeFileSync(path.join(outDir, `frame${String(i).padStart(4, '0')}.png`), canvas.toBuffer('image/png'));
    if (i % 120 === 0) console.log(`frame ${i}/${total}`);
  }

  // Encode: PNG frames + timed sound effects (repo public/sounds).
  // epicenter-appear @1s (pop), wave-spread @1.5s (shockwave),
  // reports @4s (info cards). Missing SFX files are skipped so one absent
  // file can never kill the video; with none present it renders silent.
  const mp4 = path.join(outDir, 'out.mp4');
  const sfxDir = path.join(process.cwd(), 'public', 'sounds');
  const sfxPlan = [
    { file: 'epicenter-appear.mp3', at: 1000 },
    { file: 'wave-spread.mp3', at: 1500 },
    { file: 'reports.mp3', at: 4000 },
  ].filter((s) => {
    const ok = fs.existsSync(path.join(sfxDir, s.file));
    if (!ok) console.error('sfx missing, skipping:', s.file);
    return ok;
  });
  const ffmpegArgs = [
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    path.join(outDir, 'frame%04d.png'),
  ];
  for (const s of sfxPlan) ffmpegArgs.push('-i', path.join(sfxDir, s.file));
  if (sfxPlan.length > 0) {
    const mix = sfxPlan
      .map((s, i) => `[${i + 1}:a]adelay=delays=${s.at}:all=1,volume=1.0[a${i}]`)
      .join(';');
    // amix normalizes down, volume restores punch.
    const mixed = sfxPlan.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${sfxPlan.length}:duration=longest:dropout_transition=0,volume=2.2[aout]`;
    ffmpegArgs.push(
      '-filter_complex',
      `${mix};${mixed}`,
      '-map',
      '0:v',
      '-map',
      '[aout]',
      '-c:a',
      'aac',
    );
  }
  // Full-range pc + bt709 keeps the MP4 looking like the sRGB canvas preview (no crushed blacks).
  ffmpegArgs.push(
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'pc',
    '-crf', '20', '-shortest', mp4,
  );
  await execFileAsync('ffmpeg', ffmpegArgs);
  console.log('mp4:', mp4, fs.statSync(mp4).size, 'bytes');

  // Optional Facebook upload.
  const pageId = process.env.FB_PAGE_ID || '';
  const token = process.env.FB_UPLOAD_TOKEN || '';
  if (pageId && token) {
    const form = new FormData();
    form.append('access_token', token);
    form.append('description', quake.description || (quake.finalReport ? buildFinalCaption(quake) : buildVideoCaption(quake)));
    form.append('source', new Blob([fs.readFileSync(mp4)], { type: 'video/mp4' }), 'report.mp4');
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/videos`, { method: 'POST', body: form });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !data.id) throw new Error(`FB upload failed: ${data.error?.message ?? res.status}`);
    console.log('FB video id:', data.id);
  } else {
    console.log('FB upload skipped (FB_PAGE_ID / FB_UPLOAD_TOKEN not set)');
  }
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((e) => {
    console.error('FATAL:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
