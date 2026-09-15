// 3:4 earthquake visual-report card (720x900 PNG) for Facebook auto-posts.
// PLAIN-JS PORT of quake-card.ts (no TypeScript, no types) — same logic,
// same layout, same output. Self-hosted: satori + resvg via cf-workers-og,
// Yandex satellite base map, magnitude-scaled banner. Called with
// ?lat=&lng=&mag=&place=&date=&time=&depth= — no feed lookup here.
// NOTE: React.createElement (not JSX) so bundling stays simple.

import { createElement as h } from 'react';
import { ImageResponse } from 'cf-workers-og';

const CARD_W = 720;
const CARD_H = 900;
const MAP_H = 730;

function bannerColor(mag) {
  if (mag >= 7) return '#dc2626';
  if (mag >= 6) return '#ef4444';
  if (mag >= 5) return '#f97316';
  if (mag >= 4) return '#d97706';
  return '#22c55e';
}

let fontCache = null;

async function loadFonts(origin) {
  if (fontCache) return fontCache;
  const get = async (path) => {
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

// Yandex caps static images at 650x450px — upscaling that to 720px looks
// soft. Instead stitch zoom+1 tiles covering the exact same view (~1.8x
// pixel density). Watermark handling: every tile stamps attribution along
// its bottom edge, so rows are overlapped top-to-bottom — each tile covers
// the previous row's watermark strip. Only the bottom row's strip survives
// at the map's bottom edge (same as a plain single-tile map).
// Layout math is done in zoom+1 tile pixels: the cover view is VW1 x VH1,
// rows are spaced ROW_STEP apart with 450px-tall tiles (ROW_STEP < 450
// gives the overlap), 2 columns centered on the view's quadrant centers.
function mapTiles(lat, lng, zoom) {
  // View center shifted north so the epicenter renders at ~70% height.
  const span = (360 * MAP_H) / (256 * 2 ** zoom);
  const clat = Math.max(-85, Math.min(85, lat + 0.2 * span));
  const P = 360 / (256 * 2 ** zoom); // lng degrees per px at zoom
  const s = Math.max(CARD_W / 650, MAP_H / 450); // single-tile cover scale
  const vw = CARD_W / s; // visible tile px, width (at zoom)
  const vh = MAP_H / s; // visible tile px, height (at zoom)
  const P1 = P / 2; // lng degrees per px at zoom+1
  const VW1 = vw * 2; // view width in zoom+1 px
  const VH1 = vh * 2; // view height in zoom+1 px
  const d = CARD_W / VW1; // display scale for zoom+1 tiles
  const tw = 650 * d; // displayed tile width
  const th = 450 * d; // displayed tile height
  const cosLat = Math.cos((clat * Math.PI) / 180);
  const topLat = clat + (VH1 / 2) * P1 * cosLat; // north edge of view
  const ROW_STEP = 225; // < 450 → rows overlap, hiding watermark strips
  const rows = Math.ceil((VH1 - 450) / ROW_STEP) + 1;
  const qx = [CARD_W / 4, (3 * CARD_W) / 4];
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    const rowTop = Math.min(r * ROW_STEP, VH1 - 450); // last row flush with view bottom
    const rowCenter = rowTop + 225;
    const tLat = Math.max(-85, Math.min(85, topLat - rowCenter * P1 * cosLat));
    for (let c = 0; c < 2; c++) {
      const tLng = lng + (c === 0 ? -1 : 1) * ((VW1 / 4) * P1);
      tiles.push({
        url:
          `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${tLng},${tLat}` +
          `&z=${zoom + 1}&size=650,450&l=sat,skl`,
        left: qx[c] - tw / 2,
        top: (rowTop / VH1) * MAP_H,
        w: tw,
        h: th,
      });
    }
  }
  return tiles;
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const q = url.searchParams;

  const lat = parseFloat(q.get('lat') || '');
  const lng = parseFloat(q.get('lng') || '');
  const magRaw = q.get('mag') || '';
  const mag = parseFloat(magRaw);
  if (isNaN(lat) || isNaN(lng) || isNaN(mag)) {
    return new Response('Missing/invalid lat, lng, mag', { status: 400 });
  }

  const place = (q.get('place') || `${lat.toFixed(2)}, ${lng.toFixed(2)}`).slice(0, 90);
  const date = (q.get('date') || '').slice(0, 40);
  const time = (q.get('time') || '').slice(0, 20);
  const depth = (q.get('depth') || '').slice(0, 12);

  const zoom = mag >= 7 ? 6 : mag >= 6 ? 7 : 8;
  const color = bannerColor(mag);
  const bannerText = mag >= 7 ? `MAJOR MAGNITUDE ${magRaw}` : `MAGNITUDE ${magRaw}`;
  const coords = `${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E`;
  const fontStack = "'Oswald','Inter',sans-serif";
  const cx = CARD_W / 2; // horizontal center of map

  const [fonts] = await Promise.all([loadFonts(url.origin)]);
  const tiles = mapTiles(lat, lng, zoom);

  const fontList = [];
  if (fonts.oswald) fontList.push({ name: 'Oswald', data: fonts.oswald, weight: 700, style: 'normal' });
  if (fonts.inter) fontList.push({ name: 'Inter', data: fonts.inter, weight: 400, style: 'normal' });

  // Dark container doubles as the fallback if tiles can't be fetched.
  // 2x2 zoom+1 tiles stitched for ~1.8x pixel density (Yandex caps at 650x450).
  const mapImgs = tiles.map((t) =>
    h('img', { src: t.url, width: 650, height: 450, style: { display: 'flex', position: 'absolute', left: t.left, top: t.top, width: t.w, height: t.h, backgroundColor: '#10151c' } }),
  );
  // Epicenter renders at ~70% of map height (see tile center shift above):
  // dot marker + two expanding rings, all centered exactly on it.
  const epiY = Math.round(0.7 * MAP_H);
  const pinHalf = 31; // half of 52px dot + 2x5px border
  const ring1 = 58; // half of 108px + 2x4px border
  const ring2 = 88; // half of 168px + 2x4px border
  const pinBlock = h('div', { style: { display: 'flex', position: 'absolute', left: 0, top: 0, width: CARD_W, height: MAP_H } },
    h('div', { style: { display: 'flex', position: 'absolute', left: cx - ring2, top: epiY - ring2, width: 168, height: 168, borderRadius: 88, backgroundColor: 'transparent', border: '4px solid rgba(239,68,68,0.35)' } }),
    h('div', { style: { display: 'flex', position: 'absolute', left: cx - ring1, top: epiY - ring1, width: 108, height: 108, borderRadius: 58, backgroundColor: 'transparent', border: '4px solid rgba(239,68,68,0.65)' } }),
    h('div', { style: { display: 'flex', position: 'absolute', left: cx - pinHalf, top: epiY - pinHalf, width: 52, height: 52, borderRadius: 26, backgroundColor: '#ef4444', border: '5px solid #ffffff', alignItems: 'center', justifyContent: 'center' } },
      h('div', { style: { display: 'flex', width: 17, height: 17, borderRadius: 8, backgroundColor: '#ffffff' } }),
    ),
  );

  const card = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: CARD_W, height: CARD_H, backgroundColor: '#0a0d12', color: '#ffffff', fontFamily: fontStack } },
    h(
      'div',
      { style: { display: 'flex', position: 'relative', width: CARD_W, height: MAP_H, overflow: 'hidden', backgroundColor: '#10151c' } },
      ...mapImgs,
      h(
        'div',
        { style: { display: 'flex', position: 'absolute', left: 0, top: 0, width: CARD_W, height: MAP_H, flexDirection: 'column', alignItems: 'center' } },
        h('div', { style: { display: 'flex', marginTop: 36, backgroundColor: color, padding: '12px 31px', fontSize: 38, fontWeight: 700, letterSpacing: 1 } }, bannerText),
        h('div', { style: { display: 'flex', marginTop: 12, backgroundColor: 'rgba(0,0,0,0.55)', padding: '7px 19px', fontSize: 29, fontWeight: 700 } }, place.toUpperCase()),
        h('div', { style: { display: 'flex', marginTop: 7, backgroundColor: 'rgba(0,0,0,0.55)', padding: '5px 17px', fontSize: 22, fontFamily: "'Inter',sans-serif" } }, coords),
      ),
      pinBlock,
    ),
    h(
      'div',
      { style: { display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0d12' } },
      h('div', { style: { display: 'flex', fontSize: 30, fontWeight: 700, letterSpacing: 1 } }, `${date.toUpperCase()}${time ? ' - ' + time.toUpperCase() : ''}`),
      h('div', { style: { display: 'flex', marginTop: 10, fontSize: 28, fontWeight: 700, color: '#e5e7eb' } }, `DEPTH: ${depth} KM`),
      h('div', { style: { display: 'flex', marginTop: 17, fontSize: 18, fontFamily: "'Inter',sans-serif", color: '#9ca3af' } }, 'Terra Guard PH • EMSC Visual Report'),
    ),
  );

  return ImageResponse.create(card, {
    width: CARD_W,
    height: CARD_H,
    fonts: fontList,
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
  });
}
