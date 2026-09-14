// 3:4 earthquake visual-report card (600x800 PNG) for Facebook auto-posts.
// Self-hosted: satori + resvg via cf-workers-og, Yandex satellite base map,
// magnitude-scaled banner. Called by worker-webhook/src/earthquake.js with
// ?lat=&lng=&mag=&place=&date=&time=&depth= — no feed lookup here.
// NOTE: React.createElement (not JSX) so Pages Functions bundling stays simple.

import { createElement as h } from 'react';
import { ImageResponse } from 'cf-workers-og';

const CARD_W = 600;
const CARD_H = 800;
const MAP_H = 600;

function bannerColor(mag: number): string {
  if (mag >= 7) return '#dc2626';
  if (mag >= 6) return '#ef4444';
  if (mag >= 5) return '#f97316';
  if (mag >= 4) return '#d97706';
  return '#22c55e';
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

function mapTileUrl(lat: number, lng: number, zoom: number): string {
  // Shift the tile center north so the epicenter renders below the title
  // overlays (~64% height) instead of dead-center behind them.
  const span = (360 * MAP_H) / (256 * 2 ** zoom);
  const centerLat = Math.max(-85, Math.min(85, lat + 0.2 * span));
  return (
    `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${centerLat}` +
    `&z=${zoom}&size=650,450&l=sat,skl`
  );
}

export async function onRequest(context: { request: Request }) {
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

  const [fonts] = await Promise.all([loadFonts(url.origin)]);
  const tileUrl = mapTileUrl(lat, lng, zoom);

  const fontList: Array<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }> = [];
  if (fonts.oswald) fontList.push({ name: 'Oswald', data: fonts.oswald, weight: 700, style: 'normal' });
  if (fonts.inter) fontList.push({ name: 'Inter', data: fonts.inter, weight: 400, style: 'normal' });

  // Dark container doubles as the fallback if the tile can't be fetched.
  const mapImg = h('img', { src: tileUrl, width: 650, height: 450, style: { display: 'flex', width: CARD_W, height: MAP_H, objectFit: 'cover', backgroundColor: '#10151c' } });
  // Epicenter renders at ~70% of map height (see tile center shift above):
  // single dot marker centered exactly on it — no stem, no clutter.
  const epiY = Math.round(0.7 * MAP_H);
  const pinTop = epiY - 26;
  const pinBlock = h('div', { style: { display: 'flex', position: 'absolute', left: 274, top: pinTop, width: 44, height: 44, borderRadius: 22, backgroundColor: '#ef4444', border: '4px solid #ffffff', alignItems: 'center', justifyContent: 'center' } },
    h('div', { style: { display: 'flex', width: 14, height: 14, borderRadius: 7, backgroundColor: '#ffffff' } }),
  );

  const card = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: CARD_W, height: CARD_H, backgroundColor: '#0a0d12', color: '#ffffff', fontFamily: fontStack } },
    h(
      'div',
      { style: { display: 'flex', position: 'relative', width: CARD_W, height: MAP_H, overflow: 'hidden' } },
      mapImg,
      h(
        'div',
        { style: { display: 'flex', position: 'absolute', left: 0, top: 0, width: CARD_W, height: MAP_H, flexDirection: 'column', alignItems: 'center' } },
        h('div', { style: { display: 'flex', marginTop: 56, backgroundColor: color, padding: '10px 26px', fontSize: 32, fontWeight: 700, letterSpacing: 1 } }, bannerText),
        h('div', { style: { display: 'flex', marginTop: 10, backgroundColor: 'rgba(0,0,0,0.55)', padding: '6px 16px', fontSize: 24, fontWeight: 700 } }, place.toUpperCase()),
        h('div', { style: { display: 'flex', marginTop: 6, backgroundColor: 'rgba(0,0,0,0.55)', padding: '4px 14px', fontSize: 18, fontFamily: "'Inter',sans-serif" } }, coords),
      ),
      pinBlock,
    ),
    h(
      'div',
      { style: { display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0d12' } },
      h('div', { style: { display: 'flex', fontSize: 25, fontWeight: 700, letterSpacing: 1 } }, `${date.toUpperCase()}${time ? ' - ' + time.toUpperCase() : ''}`),
      h('div', { style: { display: 'flex', marginTop: 8, fontSize: 23, fontWeight: 700, color: '#e5e7eb' } }, `DEPTH: ${depth} KM`),
      h('div', { style: { display: 'flex', marginTop: 14, fontSize: 15, fontFamily: "'Inter',sans-serif", color: '#9ca3af' } }, 'TerraGuard • EMSC Visual Report'),
    ),
  );

  return ImageResponse.create(card, {
    width: CARD_W,
    height: CARD_H,
    fonts: fontList,
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
  });
}
