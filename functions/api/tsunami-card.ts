// Wide world-view tsunami card (960x720 PNG) for Facebook auto-posts.
// Fixed Pacific-centered view (like tsunami warning-center maps): Yandex
// satellite tiles stitched at zoom 3, red star epicenter marker, legend,
// graticule. Called by worker-webhook/src/tsunami.js with ?lat=&lng=.
// NOTE: React.createElement (not JSX) so Pages Functions bundling stays simple.

import { createElement as h } from 'react';
import { ImageResponse } from 'cf-workers-og';

const CARD_W = 960;
const CARD_H = 720;
// Fixed view: 15E -> 285E (=75W), 270 degrees of longitude.
const LON_MIN = 15;
const LON_SPAN = 270;
const LAT_TOP = 73;
const LAT_BOT = -69;
const Z = 3;

function mercY01(lat: number): number {
  const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

const WORLD_PX = 256 * 2 ** Z; // 2048 at z3
const X0 = ((LON_MIN + 180) / 360) * WORLD_PX;
const VIEW_W = (LON_SPAN / 360) * WORLD_PX;
const Y_TOP = mercY01(LAT_TOP) * WORLD_PX;
const VIEW_H = mercY01(LAT_BOT) * WORLD_PX - Y_TOP;
// Display scale + letterbox offsets (shared by tiles, marker, graticule).
const DD = Math.min(CARD_W / VIEW_W, CARD_H / VIEW_H);
const OFF_X = (CARD_W - VIEW_W * DD) / 2;
const OFF_Y = (CARD_H - VIEW_H * DD) / 2;

export interface TsunamiTile {
  url: string;
  left: number;
  top: number;
  w: number;
  h: number;
}

// Grid of overlapping 650x450 tiles covering the fixed view. Overlap also
// hides all but the bottom row's baked-in attribution strips (same trick
// as quake-card.ts). Exported for testing.
export function tsunamiTiles(): TsunamiTile[] {
  // Evenly spaced rows/cols sized so neighbors always overlap (overlap
  // hides watermark strips and guarantees full coverage).
  const cols = Math.max(1, Math.ceil(VIEW_W / 650));
  const rows = Math.max(1, Math.ceil(VIEW_H / 450));
  const stepX = cols > 1 ? (VIEW_W - 650) / (cols - 1) : 0;
  const stepY = rows > 1 ? (VIEW_H - 450) / (rows - 1) : 0;
  const tiles: TsunamiTile[] = [];
  for (let r = 0; r < rows; r++) {
    const tileTop = r * stepY;
    // Inverse mercator: z3-px row center -> latitude for ll=.
    const y01 = (Y_TOP + tileTop + 225) / WORLD_PX;
    const cLat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y01))) * 180) / Math.PI;
    for (let c = 0; c < cols; c++) {
      const tileLeft = c * stepX;
      let tLng = ((X0 + tileLeft + 325) / WORLD_PX) * 360 - 180;
      // Yandex ll= wants -180..180 (it 400s past 180).
      tLng = ((((tLng + 180) % 360) + 360) % 360) - 180;
      tiles.push({
        url:
          `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${tLng},${cLat}` +
          `&z=${Z}&size=650,450&l=sat,skl`,
        left: OFF_X + tileLeft * DD,
        top: OFF_Y + tileTop * DD,
        w: 650 * DD,
        h: 450 * DD,
      });
    }
  }
  return tiles;
}

let fontCache: { oswald: ArrayBuffer | null; inter: ArrayBuffer | null } | null = null;

async function loadFonts(origin: string) {
  if (fontCache) return fontCache;
  const get = async (path: string): Promise<ArrayBuffer | null> => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${origin}${path}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  };
  const [oswald, inter] = await Promise.all([get('/fonts/oswald-700.ttf'), get('/fonts/inter-400.ttf')]);
  fontCache = { oswald, inter };
  return fontCache;
}

export async function onRequest(context: { request: Request }) {
  const { request } = context;
  const url = new URL(request.url);
  const q = url.searchParams;

  const lat = parseFloat(q.get('lat') || '');
  const lng = parseFloat(q.get('lng') || '');
  if (isNaN(lat) || isNaN(lng)) {
    return new Response('Missing/invalid lat, lng', { status: 400 });
  }

  const [fonts] = await Promise.all([loadFonts(url.origin)]);
  const tiles = tsunamiTiles();

  const fontList: Array<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }> = [];
  if (fonts.oswald) fontList.push({ name: 'Oswald', data: fonts.oswald, weight: 700, style: 'normal' });
  if (fonts.inter) fontList.push({ name: 'Inter', data: fonts.inter, weight: 400, style: 'normal' });

  // Epicenter -> card px (lng normalized into view, lat via mercator).
  let elng = lng;
  while (elng < LON_MIN) elng += 360;
  while (elng >= LON_MIN + LON_SPAN) elng -= 360;
  const ex = OFF_X + ((elng - LON_MIN) / LON_SPAN) * VIEW_W * DD;
  const ey = OFF_Y + ((mercY01(lat) * WORLD_PX - Y_TOP) / VIEW_H) * VIEW_H * DD;

  // Bottom axis bar: dark strip holding the credit; also covers the
  // bottom row's baked-in tile watermarks.
  const mapImgs = tiles.map((t) =>
    h('img', { src: t.url, width: 650, height: 450, style: { display: 'flex', position: 'absolute', left: t.left, top: t.top, width: t.w, height: t.h, backgroundColor: '#0e1420' } }),
  );
  const axisBar = h('div', { style: { display: 'flex', position: 'absolute', left: 0, bottom: 0, width: CARD_W, height: 32, backgroundColor: '#0e1420', alignItems: 'center', justifyContent: 'flex-end' } },
    h('div', { style: { display: 'flex', fontSize: 13, fontFamily: "'Inter',sans-serif", color: '#9ca3af', marginRight: 10 } }, '© Yandex · NASA · SCANEX'),
  );

  const card = h(
    'div',
    { style: { display: 'flex', position: 'relative', width: CARD_W, height: CARD_H, overflow: 'hidden', backgroundColor: '#0e1420', color: '#ffffff', fontFamily: "'Oswald','Inter',sans-serif" } },
    ...mapImgs,
    axisBar,
    // Epicenter star.
    h('div', { style: { display: 'flex', position: 'absolute', left: ex - 24, top: ey - 24, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', fontSize: 44, color: '#e11d48' } }, '★'),
    // Legend.
    h('div', { style: { display: 'flex', position: 'absolute', left: 14, bottom: 46, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.92)', padding: '6px 12px', fontSize: 18, color: '#111827' } },
      h('div', { style: { display: 'flex', fontSize: 22, color: '#e11d48', marginRight: 8 } }, '★'),
      'Epicenter',
    ),
  );

  return ImageResponse.create(card, {
    width: CARD_W,
    height: CARD_H,
    fonts: fontList,
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
  });
}
