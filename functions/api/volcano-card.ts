// Volcano visual-report card (720x900 PNG) for Facebook auto-posts.
// Same family look as quake-card.ts: Yandex satellite close-up, risk-colored
// banner, observation pills, footer. Called by the volcano monitor in
// worker-webhook/src/terraguard.js with
// ?volcano=&level=&risk=&issued=&quakes=&so2=&pdz= — coordinates resolve
// server-side from the built-in PH volcano table (bulletins carry no coords).
// NOTE: React.createElement (not JSX) so Pages Functions bundling stays simple.

import { createElement as h } from 'react';
import { ImageResponse } from 'cf-workers-og';

const CARD_W = 720;
const CARD_H = 900;
const MAP_H = 650;
const KNOWN_ZOOM = 11;
const FALLBACK = { lat: 12.9, lng: 121.8, zoom: 6 };

// Approximate summit coordinates of PH active volcanoes (lat, lng).
const VOLCANO_COORDS: Record<string, [number, number]> = {
  TAAL: [14.002, 120.997],
  MAYON: [13.257, 123.685],
  BULUSAN: [12.769, 124.056],
  KANLAON: [10.412, 123.132],
  PINATUBO: [15.142, 120.35],
  'HIBOK-HIBOK': [9.203, 124.673],
  HIBOKHIBOK: [9.203, 124.673],
  MUSUAN: [7.875, 124.865],
  RAGANG: [7.905, 124.502],
  MAKATURING: [7.647, 124.32],
  MATUTUM: [6.365, 125.071],
  PARKER: [6.102, 124.892],
  APO: [6.987, 125.274],
  BALATUKAN: [8.765, 124.975],
  CABALIAN: [10.285, 125.22],
  MAHAGNAO: [10.879, 124.869],
  BILIRAN: [11.52, 124.54],
  CAGUA: [18.222, 122.123],
  DIDICAS: [19.077, 122.202],
  'BABUYAN CLARO': [19.524, 121.955],
  SMITH: [19.54, 121.914],
  AMBALATUNGAN: [17.32, 121.1],
  PATOC: [17.147, 120.983],
  'SANTO TOMAS': [16.33, 120.55],
  MARIVELES: [14.523, 120.488],
  NATIB: [14.718, 120.424],
  JOLO: [6.013, 121.059],
  'BUD DAJO': [6.013, 121.059],
  'LEONARD KNIASEFF': [7.38, 126.05],
  LATUKAN: [7.65, 124.45],
  CALAYO: [13.95, 120.65],
  CUICO: [13.9, 120.6],
};

function resolveVolcano(name: string): { lat: number; lng: number; zoom: number; known: boolean } {
  const key = String(name || '')
    .toUpperCase()
    .replace(/VOLCANO|VOLC|MT\.?|MOUNT|\(.*?\)/g, '')
    .replace(/[^A-Z -]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!key) return { ...FALLBACK, known: false };
  const hit = VOLCANO_COORDS[key];
  if (hit) return { lat: hit[0], lng: hit[1], zoom: KNOWN_ZOOM, known: true };
  for (const k of Object.keys(VOLCANO_COORDS)) {
    if (key.includes(k) || k.includes(key)) {
      const v = VOLCANO_COORDS[k];
      return { lat: v[0], lng: v[1], zoom: KNOWN_ZOOM, known: true };
    }
  }
  return { ...FALLBACK, known: false };
}

function riskColor(risk: string): string {
  switch (String(risk || '').toUpperCase()) {
    case 'CRITICAL': return '#7f1d1d';
    case 'HIGH': return '#ef4444';
    case 'MODERATE': return '#d97706';
    case 'ELEVATED': return '#3b82f6';
    default: return '#22c55e';
  }
}

export interface VolcanoTile {
  url: string;
  left: number;
  top: number;
  w: number;
  h: number;
}

// Same overlap-stitch as quake-card.ts. Exported for testing.
export function volcanoTiles(lat: number, lng: number, zoom: number): VolcanoTile[] {
  const span = (360 * MAP_H) / (256 * 2 ** zoom);
  const clat = Math.max(-85, Math.min(85, lat + 0.2 * span));
  const P = 360 / (256 * 2 ** zoom);
  const s = Math.max(CARD_W / 650, MAP_H / 450);
  const vw = CARD_W / s;
  const vh = MAP_H / s;
  const P1 = P / 2;
  const VW1 = vw * 2;
  const VH1 = vh * 2;
  const d = CARD_W / VW1;
  const tw = 650 * d;
  const th = 450 * d;
  const cosLat = Math.cos((clat * Math.PI) / 180);
  const topLat = clat + (VH1 / 2) * P1 * cosLat;
  const ROW_STEP = 225;
  const CROP_PX = 40; // push the last row's watermark strip below the viewport
  const rows = Math.ceil((VH1 - 450) / ROW_STEP) + 1;
  const qx = [CARD_W / 4, (3 * CARD_W) / 4];
  const tiles: VolcanoTile[] = [];
  for (let r = 0; r < rows; r++) {
    const rowTop = r === rows - 1 ? VH1 - 450 + CROP_PX : Math.min(r * ROW_STEP, VH1 - 450);
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

  const volcano = (q.get('volcano') || 'Volcano').slice(0, 60);
  const level = (q.get('level') || '?').slice(0, 8);
  const risk = (q.get('risk') || 'MODERATE').slice(0, 16);
  const issued = (q.get('issued') || '').slice(0, 60);
  const quakes = (q.get('quakes') || '').slice(0, 40);
  const so2 = (q.get('so2') || '').slice(0, 40);
  const pdz = (q.get('pdz') || '').slice(0, 20);

  const geo = resolveVolcano(volcano);
  const color = riskColor(risk);
  const fontStack = "'Oswald','Inter',sans-serif";

  const [fonts] = await Promise.all([loadFonts(url.origin)]);
  const tiles = volcanoTiles(geo.lat, geo.lng, geo.zoom);

  const fontList: Array<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }> = [];
  if (fonts.oswald) fontList.push({ name: 'Oswald', data: fonts.oswald, weight: 700, style: 'normal' });
  if (fonts.inter) fontList.push({ name: 'Inter', data: fonts.inter, weight: 400, style: 'normal' });

  const mapImgs = tiles.map((t) =>
    h('img', { src: t.url, width: 650, height: 450, style: { display: 'flex', position: 'absolute', left: t.left, top: t.top, width: t.w, height: t.h, backgroundColor: '#10151c' } }),
  );

  // No summit pin: the volcano fills the close-up frame, a marker would
  // just cover it.
  const pinBlock = null;

  const pills = [
    quakes ? `${quakes} volcanic quakes` : '',
    so2 ? `${so2} t/day SO2` : '',
    pdz ? `${pdz} km danger zone` : '',
  ].filter(Boolean);

  const card = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: CARD_W, height: CARD_H, backgroundColor: '#0a0d12', color: '#ffffff', fontFamily: fontStack } },
    h(
      'div',
      { style: { display: 'flex', position: 'relative', width: CARD_W, height: MAP_H, overflow: 'hidden' } },
      ...mapImgs,
      h(
        'div',
        { style: { display: 'flex', position: 'absolute', left: 0, top: 0, width: CARD_W, height: MAP_H, flexDirection: 'column', alignItems: 'center' } },
        h('div', { style: { display: 'flex', marginTop: 36, backgroundColor: color, padding: '12px 31px', fontSize: 36, fontWeight: 700, letterSpacing: 1 } }, `${volcano.toUpperCase()} VOLCANO`),
        h('div', { style: { display: 'flex', marginTop: 10, backgroundColor: 'rgba(0,0,0,0.55)', padding: '7px 19px', fontSize: 26, fontWeight: 700 } }, `ALERT LEVEL ${level} — ${risk.toUpperCase()}`),
        pills.length > 0
          ? h('div', { style: { display: 'flex', marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' } },
            ...pills.map((p) =>
              h('div', { style: { display: 'flex', marginLeft: 5, marginRight: 5, backgroundColor: 'rgba(0,0,0,0.55)', padding: '5px 14px', fontSize: 17, fontFamily: "'Inter',sans-serif" } }, p),
            ),
          )
          : null,
      ),
      pinBlock,
    ),
    h(
      'div',
      { style: { display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0d12' } },
      h('div', { style: { display: 'flex', fontSize: 26, fontWeight: 700, letterSpacing: 1 } }, issued ? `ISSUED: ${issued.toUpperCase()}` : 'PHIVOLCS VOLCANO BULLETIN'),
      h('div', { style: { display: 'flex', marginTop: 12, fontSize: 15, fontFamily: "'Inter',sans-serif", color: '#9ca3af' } }, 'PHIVOLCS • TerraGuard Volcano Watch'),
    ),
  );

  return ImageResponse.create(card, {
    width: CARD_W,
    height: CARD_H,
    fonts: fontList,
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
  });
}
