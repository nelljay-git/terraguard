// USGS event-product overlays for the /details interactive map.
//
// USGS publishes per-event "products" (ShakeMap, DYFI, finite-fault, ground
// failure, etc.) through the FDSN event API. Each product carries downloadable
// assets — PNG overlays (with geographic bounds in the product properties) and
// GeoJSON/JSON point sets. This module maps the 24 overlay names requested by
// the UI to resolvers that turn those products into renderable map layers.

export type Products = Record<string, any[]> | null;

export interface OverlayContext {
  eventTimeMs?: number;
  lat?: number;
  lng?: number;
}

export interface MarkerPoint {
  lat: number;
  lng: number;
  r?: number;
  color?: string;
  meta?: string;
}

export interface ImageLayer {
  type: 'image';
  url: string;
  bounds: [[number, number], [number, number]];
  opacity?: number;
}
export interface MarkerLayer {
  type: 'markers';
  color: string;
  load: () => Promise<MarkerPoint[]>;
}
export interface ContourLayer {
  type: 'contours';
  url: string;
}
export interface FaultLayer {
  type: 'faults';
  url: string;
}
export interface DyfiGridLayer {
  type: 'dyfi-grid';
  url: string;
}
export interface SpecialLayer {
  type: 'special';
  kind: 'epicenter' | 'info';
}
export type ResolvedLayer = ImageLayer | MarkerLayer | ContourLayer | FaultLayer | DyfiGridLayer | SpecialLayer;

export interface OverlayItem {
  key: string;
  label: string;
  available: (products: Products) => boolean;
  resolve: (products: Products, ctx: OverlayContext) => ResolvedLayer | null;
}

const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-90, -180],
  [90, 180],
];

function num(v: any): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  return null;
}

// Geographic bounds for a product image. USGS stores the extent in the product
// properties (minimum/maximum latitude/longitude) for newer ShakeMap/ground-
// failure products; older ones used latitude/longitude + width/height.
function productBounds(product: any): [[number, number], [number, number]] | null {
  const pr = product?.properties || {};
  const minLat = num(pr['minimum-latitude']);
  const maxLat = num(pr['maximum-latitude']);
  const minLon = num(pr['minimum-longitude']);
  const maxLon = num(pr['maximum-longitude']);
  if (minLat !== null && maxLat !== null && minLon !== null && maxLon !== null) {
    return [[minLat, minLon], [maxLat, maxLon]];
  }
  const lat = num(pr['latitude']);
  const lon = num(pr['longitude']);
  const w = num(pr['width']);
  const h = num(pr['height']);
  if (lat !== null && lon !== null && w !== null && h !== null && w > 0 && h > 0) {
    return [[lat - h / 2, lon - w / 2], [lat + h / 2, lon + w / 2]];
  }
  return null;
}

function firstContentUrl(product: any, re: RegExp): string | null {
  const contents = product?.contents;
  if (!contents) return null;
  for (const c of Object.values<any>(contents)) {
    if (c?.url && re.test(c.url)) return c.url;
  }
  return null;
}

export function mmiColor(mmi: number): string {
  // USGS-style MMI color ramp (I=white -> X+ dark red).
  const stops: [number, string][] = [
    [1, '#ffffff'],
    [2, '#bcbdbc'],
    [3, '#8fd08f'],
    [4, '#3fbf3f'],
    [5, '#ffff3f'],
    [6, '#ffbf3f'],
    [7, '#ff7f3f'],
    [8, '#ff3f3f'],
    [9, '#c43fbf'],
    [10, '#8f3fbf'],
    [11, '#5f3fbf'],
    [12, '#3f3fbf'],
  ];
  let color = stops[0][1];
  for (const [m, c] of stops) {
    if (mmi >= m) color = c;
  }
  return color;
}

// --- Resolver factories -----------------------------------------------------

function imageOverlay(
  productType: string,
  re: RegExp,
  opacity = 0.75,
): (products: Products) => ImageLayer | null {
  return (products) => {
    const prod = (products as any)?.[productType]?.[0];
    if (!prod) return null;
    const url = firstContentUrl(prod, re);
    if (!url) return null;
    const bounds = productBounds(prod) || WORLD_BOUNDS;
    return { type: 'image', url, bounds, opacity };
  };
}

function geojsonMarkers(
  productType: string,
  fileName: string,
  color: string,
  getPoint: (f: any) => MarkerPoint | null,
): (products: Products) => MarkerLayer | null {
  return (products) => {
    const prod = (products as any)?.[productType]?.[0];
    const url = prod?.contents?.[fileName]?.url;
    if (!url) return null;
    return {
      type: 'markers',
      color,
      load: async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) return [];
          const gj = await res.json();
          const feats: any[] = gj?.features || [];
          const pts: MarkerPoint[] = [];
          for (const f of feats) {
            const p = getPoint(f);
            if (p) pts.push(p);
          }
          return pts;
        } catch (e) {
          console.warn(`Failed to load overlay ${fileName}:`, e);
          return [];
        }
      },
    };
  };
}

function contourLayer(fileName: string): (products: Products) => ContourLayer | null {
  return (products) => {
    const prod = (products as any)?.shakemap?.[0];
    const url = prod?.contents?.[fileName]?.url;
    if (!url) return null;
    return { type: 'contours', url };
  };
}

function faultLayer(): (products: Products) => FaultLayer | null {
  return (products) => {
    const prod = (products as any)?.['finite-fault']?.[0];
    const url = prod?.contents?.['FFM.geojson']?.url;
    if (!url) return null;
    return { type: 'faults', url };
  };
}

// DYFI "N km Responses" GeoJSON files are gridded POLYGONS (one cell per response
// area) carrying a `cdi` property, not Point features. Render them as polygons.
function dyfiGridLayer(fileName: string): (products: Products) => DyfiGridLayer | null {
  return (products) => {
    const prod = (products as any)?.dyfi?.[0];
    const url = prod?.contents?.[fileName]?.url;
    if (!url) return null;
    return { type: 'dyfi-grid', url };
  };
}

function aftershockMarkers(days: number, color: string) {
  return (_products: Products, ctx: OverlayContext): MarkerLayer | null => {
    if (ctx.eventTimeMs == null || ctx.lat == null || ctx.lng == null) return null;
    return {
      type: 'markers',
      color,
      load: async () => loadAftershocks(ctx.eventTimeMs!, ctx.lat!, ctx.lng!, days),
    };
  };
}

// --- Point extractors -------------------------------------------------------

function dyfiPoint(f: any): MarkerPoint | null {
  const c = f?.geometry?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const cdi = num(f?.properties?.cdi);
  return {
    lat: c[1],
    lng: c[0],
    r: 4,
    color: cdi != null ? mmiColor(cdi) : '#ffd166',
    meta: cdi != null ? `MMI ${cdi}` : undefined,
  };
}

function stationPoint(f: any): MarkerPoint | null {
  const c = f?.geometry?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const name = f?.properties?.name || f?.properties?.code || '';
  return {
    lat: c[1],
    lng: c[0],
    r: 3,
    color: '#4cc9f0',
    meta: name || undefined,
  };
}

async function loadAftershocks(
  eventTimeMs: number,
  lat: number,
  lng: number,
  days: number,
): Promise<MarkerPoint[]> {
  const t0 = new Date(eventTimeMs);
  if (isNaN(t0.getTime())) return [];
  const start = new Date(t0.getTime() - 24 * 3600 * 1000);
  const end = new Date(t0.getTime() + days * 24 * 3600 * 1000);
  const pad = 5;
  const url =
    'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson' +
    `&starttime=${encodeURIComponent(start.toISOString())}` +
    `&endtime=${encodeURIComponent(end.toISOString())}` +
    `&minlatitude=${lat - pad}&maxlatitude=${lat + pad}` +
    `&minlongitude=${lng - pad}&maxlongitude=${lng + pad}` +
    '&limit=300&orderby=time';
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const gj = await res.json();
    const feats: any[] = gj?.features || [];
    return feats.map((f) => {
      const c = f?.geometry?.coordinates || [0, 0];
      const mag = num(f?.properties?.mag) ?? 0;
      const place = f?.properties?.place || '';
      return {
        lat: c[1],
        lng: c[0],
        r: Math.max(3, mag * 1.6),
        meta: `${mag.toFixed(1)} - ${place}`,
      };
    });
  } catch (e) {
    console.warn('Failed to load aftershocks:', e);
    return [];
  }
}

// --- Catalog ----------------------------------------------------------------

export const USGS_OVERLAY_ITEMS: OverlayItem[] = [
  {
    key: 'earthquake_information',
    label: 'Earthquake Information',
    available: () => true,
    resolve: () => ({ type: 'special', kind: 'info' }),
  },
  {
    key: 'epicenter',
    label: 'Epicenter',
    available: () => true,
    resolve: () => ({ type: 'special', kind: 'epicenter' }),
  },
  {
    key: 'finite_fault',
    label: 'Finite Fault',
    available: (p) => !!p?.['finite-fault'],
    resolve: faultLayer(),
  },
  {
    key: 'historic_seismicity',
    label: 'Historic Seismicity',
    available: () => false,
    resolve: () => null,
  },
  {
    key: 'slab_model',
    label: 'Slab Model',
    available: () => false,
    resolve: () => null,
  },
  {
    key: 'tectonic_plates',
    label: 'Tectonic Plates',
    available: (p) => !!p?.['tectonic-summary'],
    resolve: imageOverlay('tectonic-summary', /\.png$/i),
  },
  {
    key: 'us_faults',
    label: 'US Faults',
    available: () => false,
    resolve: () => null,
  },
  {
    key: 'demographic',
    label: 'Demographic',
    available: () => false,
    resolve: () => null,
  },
  {
    key: 'population_density',
    label: 'Population Density',
    available: () => false,
    resolve: () => null,
  },
  {
    key: 'dyfi',
    label: 'Did You Feel It?',
    available: (p) => !!p?.dyfi,
    resolve: imageOverlay('dyfi', /_ciim\.jpg$/i),
  },
  {
    key: 'dyfi_1km',
    label: '1 km Responses',
    available: (p) => !!p?.dyfi,
    resolve: dyfiGridLayer('dyfi_geo_1km.geojson'),
  },
  {
    key: 'dyfi_10km',
    label: '10 km Responses',
    available: (p) => !!p?.dyfi,
    resolve: dyfiGridLayer('dyfi_geo_10km.geojson'),
  },
  {
    key: 'shakemap',
    label: 'ShakeMap',
    available: (p) => !!p?.shakemap,
    resolve: imageOverlay('shakemap', /download\/intensity_overlay\.png$/i),
  },
  {
    key: 'mmi_contours',
    label: 'MMI Contours',
    available: (p) => !!p?.shakemap,
    resolve: contourLayer('download/cont_mmi.json'),
  },
  {
    key: 'image_overlay',
    label: 'Image Overlay',
    available: (p) => !!p?.shakemap,
    resolve: imageOverlay('shakemap', /download\/intensity\.jpg$/i, 0.9),
  },
  {
    key: 'pga_contours',
    label: 'PGA Contours',
    available: (p) => !!p?.shakemap,
    resolve: imageOverlay('shakemap', /download\/pga\.jpg$/i),
  },
  {
    key: 'pgv_contours',
    label: 'PGV Contours',
    available: (p) => !!p?.shakemap,
    resolve: imageOverlay('shakemap', /download\/pgv\.jpg$/i),
  },
  {
    key: 'dyfi_stations',
    label: 'DYFI Stations',
    available: (p) => !!p?.dyfi,
    resolve: geojsonMarkers('dyfi', 'dyfi_geo.geojson', '#06d6a0', dyfiPoint),
  },
  {
    key: 'stations',
    label: 'Stations',
    available: (p) => !!p?.shakemap,
    resolve: geojsonMarkers('shakemap', 'download/stationlist.json', '#4cc9f0', stationPoint),
  },
  {
    key: 'ground_failure',
    label: 'Ground Failure',
    available: (p) => !!p?.['ground-failure'],
    resolve: imageOverlay('ground-failure', /zhu_2017_general\.png$/i),
  },
  {
    key: 'liquefaction',
    label: 'Liquefaction Estimate',
    available: (p) => !!p?.['ground-failure'],
    resolve: imageOverlay('ground-failure', /jessee_2018\.png$/i),
  },
  {
    key: 'landslide',
    label: 'Landslide Estimate',
    available: (p) => !!p?.['ground-failure'],
    resolve: imageOverlay('ground-failure', /nowicki_2014_global\.png$/i),
  },
  {
    key: 'aftershocks',
    label: 'Aftershocks',
    available: () => true,
    resolve: aftershockMarkers(14, '#f72585'),
  },
  {
    key: 'aftershock_sequence',
    label: 'Aftershock Sequence',
    available: () => true,
    resolve: aftershockMarkers(60, '#b5179e'),
  },
];

// --- Helpers used by the Details page ---------------------------------------

export function extractUsgsEventId(link: string | undefined): string | null {
  if (!link) return null;
  const m = /eventpage\/([^/?#]+)/.exec(link);
  return m ? m[1] : null;
}

export interface UsgsProductBundle {
  products: Record<string, any[]>;
  timeMs: number | null;
  lat: number | null;
  lng: number | null;
}

export async function fetchUsgsProducts(
  eventId: string,
): Promise<UsgsProductBundle | null> {
  try {
    const res = await fetch(
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(eventId)}`,
    );
    if (!res.ok) return null;
    const feature = await res.json();
    const p = feature?.properties || {};
    const coords = feature?.geometry?.coordinates || [];
    const timeMs =
      typeof p.time === 'number'
        ? p.time
        : p.time
          ? Date.parse(p.time as string)
          : null;
    return {
      products: p.products || {},
      timeMs: isNaN(timeMs as number) ? null : (timeMs as number),
      lat: typeof coords[1] === 'number' ? coords[1] : null,
      lng: typeof coords[0] === 'number' ? coords[0] : null,
    };
  } catch (e) {
    console.warn('Failed to fetch USGS products:', e);
    return null;
  }
}

// Parse a USGS MMI contour GeoJSON (FeatureCollection of LineString/
// MultiLineString features, each with properties.mag) into polylines.
export function parseContours(gj: any): { positions: [number, number][]; color: string }[] {
  const feats: any[] = gj?.features || [];
  const out: { positions: [number, number][]; color: string }[] = [];
  for (const f of feats) {
    const mag = num(f?.properties?.mag) ?? num(f?.properties?.value) ?? 0;
    const color = (typeof f?.properties?.color === 'string' && f.properties.color)
      ? f.properties.color
      : mmiColor(mag);
    const geom = f?.geometry;
    if (!geom) continue;
    const coords = geom.coordinates;
    if (geom.type === 'LineString' && Array.isArray(coords)) {
      out.push({ positions: coords.map((c: number[]) => [c[1], c[0]]), color });
    } else if (geom.type === 'MultiLineString' && Array.isArray(coords)) {
      for (const line of coords) {
        if (Array.isArray(line)) {
          out.push({ positions: line.map((c: number[]) => [c[1], c[0]]), color });
        }
      }
    }
  }
  return out;
}
