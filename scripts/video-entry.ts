// Free headless video renderer (GitHub Actions + node-canvas + FFmpeg).
// Reuses the exact drawFrame() from src/components/VideoReport.tsx — the
// browser modal and this script render pixel-identical timelines.
//
// Input:  QUAKE_JSON env — { datetime, latitude, longitude, depth,
//           magnitude, location, link?, intensity?, threat?, shakes?,
//           description? }
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
};

const execFileAsync = promisify(execFile);

interface QuakeInput {
  datetime: string;
  latitude: string;
  longitude: string;
  depth: string;
  magnitude: string;
  location: string;
  link?: string;
  intensity?: string;
  threat?: string;
  shakes?: Array<{ area: string; intensity: string }>;
  description?: string;
}

async function main(): Promise<void> {
  const outDir = process.env.OUT_DIR || '/tmp/terraguard-video';
  fs.mkdirSync(outDir, { recursive: true });
  const quake = JSON.parse(process.env.QUAKE_JSON || '{}') as QuakeInput;
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
  const mctx = mosaic.getContext('2d');
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

  // Frames (deterministic timesteps — smoother than realtime capture).
  const total = Math.round(DUR * FPS);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < total; i++) {
    const tt = i / FPS;
    drawFrame(ctx as unknown as CanvasRenderingContext2D, view, quake, quake.intensity ?? '', quake.threat ?? '', quake.shakes ?? [], tt);
    fs.writeFileSync(path.join(outDir, `frame${String(i).padStart(4, '0')}.png`), canvas.toBuffer('image/png'));
    if (i % 120 === 0) console.log(`frame ${i}/${total}`);
  }

  // Encode.
  const mp4 = path.join(outDir, 'out.mp4');
  await execFileAsync('ffmpeg', [
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    path.join(outDir, 'frame%04d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '20',
    mp4,
  ]);
  console.log('mp4:', mp4, fs.statSync(mp4).size, 'bytes');

  // Optional Facebook upload.
  const pageId = process.env.FB_PAGE_ID || '';
  const token = process.env.FB_UPLOAD_TOKEN || '';
  if (pageId && token) {
    const form = new FormData();
    form.append('access_token', token);
    form.append('description', quake.description || `TerraGuard earthquake report M${quake.magnitude} ${quake.location}`);
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
