// Free headless DAILY EARTH REPORT renderer (GitHub Actions + node-canvas + FFmpeg).
// Reuses the exact drawDailyFrame() from src/components/DailyEarthReport.tsx —
// browser modal and this script render pixel-identical timelines.
//
// Input:  DAILY_JSON env — JSON array of ESMC events (EmscEarthquake[]) OR
//         fetched live from EMSC if env not set (last 24h, capped).
// Output: OUT_DIR/out.mp4 (+ frames), optional Facebook upload when
//   FB_PAGE_ID + FB_UPLOAD_TOKEN are set.
//
// Run: OUT_DIR=/tmp/vid DAILY_JSON='[...]' node dist-video/daily-entry.mjs
// (bundle: npx esbuild scripts/daily-video-entry.ts --bundle
//  --platform=node --format=esm --external:canvas --loader:.css=empty --outfile=dist-video/daily-entry.mjs)

import { createCanvas, loadImage, registerFont } from 'canvas';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {
  drawDailyFrame,
  dailyEsriTileUrls,
  dailyLatLngToDisplayPx,
  dailyLonToDisplayX,
  formatEmscUtc,
  DAILY_W,
  DAILY_H,
  DAILY_FPS,
  DAILY_DUR,
  DAILY_COLS,
  DAILY_ROWS,
  DAILY_TILE,
  DAILY_MOSAIC_D,
  DAILY_WIPE_START,
  DAILY_WIPE_DUR,
  DAILY_HIGHLIGHT_DUR,
  DAILY_INFO_START,
} from '../src/components/DailyEarthReport.js';

export {
  drawDailyFrame,
  dailyEsriTileUrls,
  dailyLatLngToDisplayPx,
  dailyLonToDisplayX,
  formatEmscUtc,
  DAILY_W,
  DAILY_H,
  DAILY_FPS,
  DAILY_DUR,
  DAILY_COLS,
  DAILY_ROWS,
  DAILY_TILE,
  DAILY_MOSAIC_D,
  DAILY_WIPE_START,
  DAILY_WIPE_DUR,
  DAILY_HIGHLIGHT_DUR,
  DAILY_INFO_START,
};

const execFileAsync = promisify(execFile);

// EmscEarthquake shape
interface EmscProps {
  unid: string;
  source_id: string;
  source_catalog: string;
  time: string;
  lastupdate: string;
  lat: number;
  lon: number;
  depth: number;
  mag: number;
  magtype: string;
  flynn_region: string;
  auth: string;
  evtype: string;
}
interface EmscEvent {
  id: string;
  properties: EmscProps;
  geometry: { type: string; coordinates: [number, number, number] };
  type: string;
}

const EMSC_BASE = 'https://www.seismicportal.eu/fdsnws/event/1/query';

async function fetchDailyEmsc(): Promise<EmscEvent[]> {
  // Day filter: 00:05 Sept 23 UTC → query Sept 22 00:00-23:59:59 UTC, no limit
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (now.getUTCHours() < 3) target.setUTCDate(target.getUTCDate() - 1);
  const dayStart = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 0,0,0,0));
  const dayEnd = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 23,59,59,999));
  const params = new URLSearchParams({
    format: 'json',
    limit: '20000',
    orderby: 'time',
    minmag: '1.0',
    starttime: dayStart.toISOString(),
    endtime: dayEnd.toISOString(),
  });
  const url = `${EMSC_BASE}?${params}`;
  const res = await fetch(url);
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`EMSC ${res.status}`);
  const data: any = await res.json();
  const feats: any[] = data.features ?? [];
  let out = feats.map((f:any)=>({ id:f.id, properties:f.properties, geometry:f.geometry, type:f.type } as EmscEvent));
  if (out.length===0) {
    // fallback: last 100 if day empty (e.g. manual mid-day before events)
    const fb = await fetch(`${EMSC_BASE}?format=json&limit=100&orderby=time&minmag=1.0`).then(r=> r.json().catch(()=>({features:[]})) as Promise<any>).catch(()=>({features:[]}));
    out = (fb.features??[]).map((f:any)=>({ id:f.id, properties:f.properties, geometry:f.geometry, type:f.type } as EmscEvent));
  }
  return out; // no cap
}

function buildDailyCaption(events: EmscEvent[]): string {
  const utc = new Date().toUTCString().replace('GMT','UTC');
  const total = events.length;
  const strongest = events.length ? [...events].sort((a,b)=>b.properties.mag - a.properties.mag)[0] : null;
  const dateStr = new Date().toISOString().slice(0,10);
  const lines = [
    `🌍 TERRA GUARD PH — DAILY EARTH REPORT — ${dateStr} (UTC)`,
    ``,
    `Global seismic activity in the last 24 hours (EMSC • UTC): ${total} earthquakes detected (M1.0+).`,
  ];
  if (strongest) {
    lines.push(`Strongest: M${strongest.properties.mag.toFixed(1)} — ${strongest.properties.flynn_region} at ${new Date(strongest.properties.time).toUTCString().replace('GMT','UTC')}`);
  }
  lines.push(``);
  const top = [...events].sort((a,b)=>b.properties.mag - a.properties.mag).slice(0, 5);
  for (const e of top) {
    const ms = Date.parse(e.properties.time);
    const t = isNaN(ms) ? e.properties.time : new Date(ms).toUTCString().replace('GMT','UTC');
    lines.push(`• M${e.properties.mag.toFixed(1)} — ${e.properties.flynn_region} — ${t} — ${Math.round(e.properties.depth)}km — ${e.properties.lat.toFixed(2)}, ${e.properties.lon.toFixed(2)} — ${e.properties.unid}`);
  }
  if (events.length > 5) lines.push(`… and ${events.length - 5} more`);
  lines.push(``);
  lines.push(`All times in UTC. Source: EMSC-CSEM (seismicportal.eu)`);
  lines.push(`#Earthquake #EMSC #TerraGuardPH #DailyEarthReport`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  const outDir = process.env.OUT_DIR || '/tmp/terraguard-daily';
  fs.mkdirSync(outDir, { recursive: true });

  let events: EmscEvent[] = [];
  const rawJson = process.env.DAILY_JSON || process.env.QUAKE_JSON || '';
  if (rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) events = parsed as EmscEvent[];
      else if (parsed && Array.isArray(parsed.events)) events = parsed.events as EmscEvent[];
      else if (parsed && parsed.features) events = parsed.features as EmscEvent[];
      else throw new Error('DAILY_JSON not an array');
    } catch (e) {
      console.error('Failed to parse DAILY_JSON, fetching live', e);
      events = await fetchDailyEmsc();
    }
  } else {
    console.log('No DAILY_JSON env — fetching live EMSC (last 24h)');
    events = await fetchDailyEmsc();
  }
  console.log(`daily events: ${events.length} (full UTC day, no cap)`);

  // Persist for caption/debug
  fs.writeFileSync(path.join(outDir, 'daily.json'), JSON.stringify(events, null, 2));

  try { registerFont('public/fonts/oswald-700.ttf', { family:'Oswald', weight:'700' }); } catch {}
  try { registerFont('public/fonts/inter-400.ttf', { family:'Inter', weight:'400' }); } catch {}

  const urls = dailyEsriTileUrls();
  const settled = await Promise.all(urls.map(async (u)=>{
    try { return await loadImage(u); } catch(e){ console.error('tile failed', u.slice(0,80), e instanceof Error?e.message:e); return null; }
  }));
  const loaded = settled.filter(Boolean).length;
  console.log(`tiles: ${loaded}/${settled.length}`);
  if (loaded === 0) throw new Error('no map tiles loaded');

  const mosaic = createCanvas(DAILY_COLS * DAILY_TILE, DAILY_ROWS * DAILY_TILE);
  const mctx = mosaic.getContext('2d', { alpha:false } as unknown as Record<string,unknown>);
  mctx.fillStyle = '#0a0d12';
  mctx.fillRect(0,0,mosaic.width, mosaic.height);
  settled.forEach((img,i)=>{
    if (!img) return;
    const c = i % DAILY_COLS;
    const r = Math.floor(i / DAILY_COLS);
    mctx.drawImage(img, c * DAILY_TILE, r * DAILY_TILE, DAILY_TILE, DAILY_TILE);
  });
  const D = DAILY_MOSAIC_D;
  const offsetX = (DAILY_W - DAILY_COLS * DAILY_TILE * D) / 2;
  const offsetY = (DAILY_H - DAILY_ROWS * DAILY_TILE * D) / 2;
  const view = { mosaic: mosaic as unknown as HTMLCanvasElement, offsetX, offsetY, D };

  const total = Math.round(DAILY_DUR * DAILY_FPS);
  const canvas = createCanvas(DAILY_W, DAILY_H);
  const ctx = canvas.getContext('2d', { alpha:false } as unknown as Record<string,unknown>);

  // Report date for the info panel (UTC now)
  const reportDateMs = Date.now();

  for (let i=0;i<total;i++) {
    const tt = i / DAILY_FPS;
    drawDailyFrame(ctx as unknown as CanvasRenderingContext2D, view as unknown as any, events as any, tt, reportDateMs);
    fs.writeFileSync(path.join(outDir, `frame${String(i).padStart(4,'0')}.png`), canvas.toBuffer('image/png'));
    if (i % 120 === 0) console.log(`frame ${i}/${total}`);
  }

  // Encode PNG frames + per-circle pop + 3s-delayed daily-report sound
  const mp4 = path.join(outDir, 'out.mp4');
  const circleFile = path.join(process.cwd(), 'public', 'sounds', 'circle-appear.mp3');
  const dailyFile = path.join(process.cwd(), 'public', 'sounds', 'daily-report.mp3');
  const highestFile = path.join(process.cwd(), 'public', 'sounds', 'highest-recorded.mp3');
  const hasCircle = fs.existsSync(circleFile);
  const hasDaily = fs.existsSync(dailyFile);
  const hasHighest = fs.existsSync(highestFile);
  if (!hasCircle) console.error('circle-appear.mp3 missing — circles silent');
  if (!hasDaily) console.error('daily-report.mp3 missing — panel silent');
  if (!hasHighest) console.error('highest-recorded.mp3 missing — highlight silent');
  const circlePlan = hasCircle ? [...events].sort((a,b)=> a.properties.lon - b.properties.lon).map(ev=> ({ file: circleFile, at: Math.round((DAILY_WIPE_START + ((ev.properties.lon+180)/360)*DAILY_WIPE_DUR)*1000), vol: 0.78 })).filter(s=> s.at >=0 && s.at <= DAILY_DUR*1000) : [];
  const topForHighest = [...events].sort((a,b)=> b.properties.mag - a.properties.mag)[0];
  const highestAt = topForHighest ? Math.round((DAILY_WIPE_START + ((topForHighest.properties.lon+180)/360)*DAILY_WIPE_DUR)*1000) : -1;
  const highestPlan = hasHighest && highestAt>=0 ? [{ file: highestFile, at: highestAt, vol: 0.96 }] : [];
  const dailyPlan = hasDaily ? [{ file: dailyFile, at: Math.round(DAILY_INFO_START * 1000), vol: 0.95 }] : [];
  const sfxPlan = [...circlePlan, ...highestPlan, ...dailyPlan];

  const ffmpegArgs = ['-y','-framerate',String(DAILY_FPS),'-i', path.join(outDir,'frame%04d.png')];
  for (const s of sfxPlan) ffmpegArgs.push('-i', s.file);
  if (sfxPlan.length>0) {
    const mix = sfxPlan.map((s,i)=>`[${i+1}:a]adelay=delays=${s.at}:all=1,volume=${s.vol}[a${i}]`).join(';');
    const mixed = sfxPlan.map((_,i)=>`[a${i}]`).join('') + `amix=inputs=${sfxPlan.length}:duration=longest:dropout_transition=0:normalize=0,volume=0.95[aout]`;
    ffmpegArgs.push('-filter_complex', `${mix};${mixed}`, '-map','0:v','-map','[aout]','-c:a','aac');
  }
  ffmpegArgs.push('-c:v','libx264','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','pc','-crf','20','-t',String(DAILY_DUR), mp4);
  await execFileAsync('ffmpeg', ffmpegArgs);
  console.log('mp4:', mp4, fs.statSync(mp4).size, 'bytes');

  // Always write caption for Telegram/artifact (even when FB posts)
  const caption = process.env.DAILY_CAPTION || buildDailyCaption(events);
  fs.writeFileSync(path.join(outDir,'caption.txt'), caption);
  // Optional Facebook upload (uses same caption)
  const pageId = process.env.FB_PAGE_ID || '';
  const token = process.env.FB_UPLOAD_TOKEN || '';
  if (pageId && token) {
    const form = new FormData();
    form.append('access_token', token);
    form.append('description', caption);
    form.append('source', new Blob([fs.readFileSync(mp4)], { type:'video/mp4' }), 'daily-report.mp4');
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/videos`, { method:'POST', body: form });
    const data = await res.json().catch(()=>({})) as { id?:string; error?:{message?:string}};
    if (!res.ok || !data.id) throw new Error(`FB upload failed: ${data.error?.message ?? res.status}`);
    console.log('FB video id:', data.id);
  } else {
    console.log('FB upload skipped (FB_PAGE_ID / FB_UPLOAD_TOKEN not set)');
  }
}

const isMain = (()=>{
  try { return import.meta.url === pathToFileURL(process.argv[1] ?? '').href; } catch { return false; }
})();
if (isMain) {
  main().catch(e=>{
    console.error('FATAL:', e instanceof Error?e.message:e);
    process.exit(1);
  });
}
