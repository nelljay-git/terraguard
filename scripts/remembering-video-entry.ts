// Free headless REMEMBERING EARTHQUAKE video renderer.
// Reuses drawRememberingFrame() from src/components/RememberingEarthquake.tsx.
//
// Input:  QUAKE_JSON env
// Output: OUT_DIR/out.mp4 (+ frames), optional Facebook upload.

import { createCanvas, loadImage, registerFont } from 'canvas';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {
  drawRememberingFrame,
  esriTileUrls,
  epicenterMosaicPx,
  W,
  H,
  FPS,
  DUR,
  WAVE_T,
  CIRCLE_T,
  COLS,
  ROWS,
  TILE,
  MOSAIC_D,
} from '../src/components/RememberingEarthquake.js';
import { fetchDyfiPoints, fetchMmiContours, fetchRupture, fetchDyfiShakeText, fetchUsgsCityShakeText } from '../src/lib/dyfi.js';
import { extractShakeRowsByLevel } from '../src/lib/videoMeta.js';

export {
  drawRememberingFrame,
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
  place?: string;
  link?: string;
  intensity?: string;
  threat?: string;
  tsunamiThreat?: string;
  description?: string;
  faultType?: string;
  infoNo?: string;
  usgsEventId?: string;
  source?: string;
  finalReport?: boolean;
  extra?: Record<string, unknown>;
}

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

export function buildRememberingCaption(quake: QuakeInput): string {
  const mag = String(quake.magnitude ?? '?');
  const place = quake.location || quake.place || '';
  const { date, time } = splitDateTime(quake.datetime ?? '');
  const lat = String(quake.latitude ?? '');
  const lng = String(quake.longitude ?? '');
  const detailsUrl = `https://terraguard-ph.pages.dev/details/${detailsSlug(quake.datetime ?? '', lat, lng)}`;
  return [
    `REMEMBERING M${mag} EARTHQUAKE`,
    ``,
    `${date}${time ? ` - ${time}` : ''} | ${place}`,
    ``,
    `A look back at the M${mag} earthquake near ${place}.`,
    `Depth: ${quake.depth ? `${quake.depth} km` : 'N/A'}`,
    ``,
    `Earthquake Visual Report:`,
    detailsUrl,
    ``,
    `Source: USGS`,
    ``,
    `#Earthquake #Remembering #TerraGuardPH`,
  ].join('\n');
}

async function fbAppSecretProof(accessToken: string, appSecret: string): Promise<string | null> {
  try {
    if (!accessToken || !appSecret) return null;
    const { createHmac } = await import('node:crypto');
    return createHmac('sha256', appSecret).update(accessToken).digest('hex');
  } catch {
    return null;
  }
}

async function resolveFbPageToken(
  pageId: string,
  candidates: Array<{ label: string; token: string }>,
): Promise<{ token: string; via: string }> {
  const appSecret = (process.env.FB_APP_SECRET || '').trim();
  for (const c of candidates) {
    if (!c.token) continue;
    try {
      const url = new URL('https://graph.facebook.com/v21.0/me/accounts');
      url.searchParams.set('access_token', c.token);
      url.searchParams.set('fields', 'id,name,access_token');
      url.searchParams.set('limit', '100');
      const proof = await fbAppSecretProof(c.token, appSecret);
      if (proof) url.searchParams.set('appsecret_proof', proof);
      const res = await fetch(url.toString());
      const data = (await res.json().catch(() => ({}))) as {
        data?: Array<{ id?: string; name?: string; access_token?: string }>;
        error?: { message?: string; code?: number };
      };
      if (!res.ok) continue;
      const pages = data.data ?? [];
      const match = pages.find((p) => String(p.id) === String(pageId));
      if (match?.access_token) {
        return { token: String(match.access_token), via: `me/accounts:${c.label}` };
      }
    } catch {
      /* ignore */
    }
  }
  const first = candidates.find((c) => c.token);
  if (first) return { token: first.token, via: `direct:${first.label}` };
  return { token: '', via: 'none' };
}

async function fbPreflight(pageId: string, pageToken: string): Promise<boolean> {
  try {
    const url = new URL(`https://graph.facebook.com/v21.0/${pageId}`);
    url.searchParams.set('fields', 'id,name,category,link');
    url.searchParams.set('access_token', pageToken);
    const proof = await fbAppSecretProof(pageToken, (process.env.FB_APP_SECRET || '').trim());
    if (proof) url.searchParams.set('appsecret_proof', proof);
    const res = await fetch(url.toString());
    const data = (await res.json().catch(() => ({}))) as { id?: string; category?: string };
    return Boolean(res.ok && data.id && data.category);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const outDir = process.env.OUT_DIR || '/tmp/terraguard-remembering';
  fs.mkdirSync(outDir, { recursive: true });
  const quake = JSON.parse(process.env.QUAKE_JSON || '{}') as QuakeInput;
  if (!quake.location && quake.place) quake.location = quake.place;
  const ex = (quake.extra ?? {}) as Record<string, unknown>;
  quake.intensity = quake.intensity || String(ex.intensity ?? '');
  quake.threat = quake.threat || quake.tsunamiThreat || String(ex.threat ?? '') || String(ex.tsunamiThreat ?? '');
  quake.tsunamiThreat = quake.tsunamiThreat || String(ex.tsunamiThreat ?? '') || quake.threat;
  if (!quake.latitude || !quake.longitude) throw new Error('QUAKE_JSON missing latitude/longitude');

  registerFont('public/fonts/oswald-700.ttf', { family: 'Oswald', weight: '700' });
  registerFont('public/fonts/inter-400.ttf', { family: 'Inter', weight: '400' });

  const urls = esriTileUrls(quake as unknown as Parameters<typeof esriTileUrls>[0]);
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
  const { epx, epy } = epicenterMosaicPx(quake as unknown as Parameters<typeof epicenterMosaicPx>[0]);
  const view = {
    mosaic: mosaic as unknown as HTMLCanvasElement,
    exD: (W - COLS * TILE * MOSAIC_D) / 2 + epx * MOSAIC_D,
    eyD: (H - ROWS * TILE * MOSAIC_D) / 2 + epy * MOSAIC_D,
  };

  const dyfi = await fetchDyfiPoints({
    usgsEventId: quake.usgsEventId,
    datetime: quake.datetime,
    source: (quake as { source?: string }).source,
    latitude: quake.latitude,
    longitude: quake.longitude,
  });
  console.log(`dyfi points: ${dyfi.length}`);

  const contours = await fetchMmiContours({ usgsEventId: quake.usgsEventId });
  console.log(`mmi contours: ${contours.length}`);
  if (!quake.intensity) {
    const maxV = contours.reduce((a, c) => Math.max(a, c.value || 0), 0);
    const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][Math.max(1, Math.min(12, Math.round(maxV)))];
    if (roman) quake.intensity = roman;
  }

  const rupture = await fetchRupture({ usgsEventId: quake.usgsEventId });
  console.log(`rupture: ${rupture ? 'yes' : 'no'}`);

  // SHAKE REPORT rows: reported (DYFI) intensities first, then instrumental
  // PAGER city intensities as a fallback. Both are real USGS products, so the
  // list always reflects reported shaking rather than a guess.
  let shakeText = '';
  if (quake.usgsEventId) {
    try {
      shakeText = await fetchDyfiShakeText(quake.usgsEventId);
      if (!shakeText) shakeText = await fetchUsgsCityShakeText(quake.usgsEventId);
    } catch {
      shakeText = '';
    }
  }
  const shakes = extractShakeRowsByLevel(shakeText, 5);
  console.log(`shake rows: ${shakes.length}`);

  const info = {
    intensity: quake.intensity,
    threat: quake.threat,
    source: quake.source || 'usgs',
    shakes,
  };

  const total = Math.round(DUR * FPS);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false } as unknown as Record<string, unknown>);
  for (let i = 0; i < total; i++) {
    const tt = i / FPS;
    drawRememberingFrame(ctx as unknown as CanvasRenderingContext2D, view, quake as unknown as Parameters<typeof drawRememberingFrame>[2], dyfi, contours, rupture, info, tt);
    fs.writeFileSync(path.join(outDir, `frame${String(i).padStart(4, '0')}.png`), canvas.toBuffer('image/png'));
    if (i % 120 === 0) console.log(`frame ${i}/${total}`);
  }

  const mp4 = path.join(outDir, 'out.mp4');
  const sfxDir = path.join(process.cwd(), 'public', 'sounds');
  const sfxPlan = [
    { file: 'intro.mp3', at: 0 },
    { file: 'wave-spread.mp3', at: Math.round(WAVE_T * 1000) },
    { file: 'epicenter-appear.mp3', at: Math.round(CIRCLE_T * 1000) },
  ].filter((s) => {
    const ok = fs.existsSync(path.join(sfxDir, s.file));
    if (!ok) console.error('sfx missing, skipping:', s.file);
    return ok;
  });
  const ffmpegArgs = ['-y', '-framerate', String(FPS), '-i', path.join(outDir, 'frame%04d.png')];
  for (const s of sfxPlan) ffmpegArgs.push('-i', path.join(sfxDir, s.file));
  if (sfxPlan.length > 0) {
    const mix = sfxPlan.map((s, i) => `[${i + 1}:a]adelay=delays=${s.at}:all=1,volume=1.0[a${i}]`).join(';');
    const mixed = sfxPlan.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${sfxPlan.length}:duration=longest:dropout_transition=0,volume=2.2[aout]`;
    ffmpegArgs.push('-filter_complex', `${mix};${mixed}`, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac');
  }
  ffmpegArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'pc', '-crf', '20', '-t', String(DUR), mp4);
  await execFileAsync('ffmpeg', ffmpegArgs);
  console.log('mp4:', mp4, fs.statSync(mp4).size, 'bytes');

  const pageId = (process.env.FB_PAGE_ID || '').trim();
  const uploadToken = (process.env.FB_UPLOAD_TOKEN || '').trim();
  const userToken = (process.env.FB_USER_ACCESS_TOKEN || '').trim();
  if (pageId && (uploadToken || userToken)) {
    try {
      const { token: exchanged } = await resolveFbPageToken(pageId, [
        { label: 'FB_UPLOAD_TOKEN', token: uploadToken },
        { label: 'FB_USER_ACCESS_TOKEN', token: userToken },
      ]);
      const tried = new Set<string>();
      const options: Array<{ token: string; via: string }> = [];
      for (const o of [
        { token: exchanged, via: 'exchanged' },
        { token: uploadToken, via: 'direct:FB_UPLOAD_TOKEN' },
        { token: userToken, via: 'direct:FB_USER_ACCESS_TOKEN' },
      ]) {
        if (o.token && !tried.has(o.token)) {
          tried.add(o.token);
          options.push(o);
        }
      }
      let resolved = '';
      for (const o of options) {
        if (await fbPreflight(pageId, o.token)) {
          resolved = o.token;
          break;
        }
      }
      if (resolved) {
        const proof = await fbAppSecretProof(resolved, (process.env.FB_APP_SECRET || '').trim());
        const form = new FormData();
        form.append('access_token', resolved);
        if (proof) form.append('appsecret_proof', proof);
        form.append('description', quake.description || buildRememberingCaption(quake));
        form.append('source', new Blob([fs.readFileSync(mp4)], { type: 'video/mp4' }), 'remembering.mp4');
        const hosts = ['https://graph-video.facebook.com/v21.0', 'https://graph.facebook.com/v21.0'];
        for (const host of hosts) {
          const res = await fetch(`${host}/${pageId}/videos`, { method: 'POST', body: form });
          const data = (await res.json().catch(() => ({}))) as { id?: string };
          if (res.ok && data.id) {
            console.log('FB video id:', data.id);
            break;
          }
          console.error(`FB upload via ${host} failed:`, data);
        }
      } else {
        console.error('FB upload skipped: no token passed preflight');
      }
    } catch (e) {
      console.error('FB upload failed (non-fatal):', e instanceof Error ? e.message : e);
    }
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
