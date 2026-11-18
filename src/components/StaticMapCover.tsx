/* StaticMapCover — runtime-rendered dark-gray canvas crop of the epicenter
   region used as the event-report hero background. Composes Esri's keyless
   World Dark Gray Base tiles (Canvas family, no key required) into a flat,
   non-interactive frame. Kept decorative (aria-hidden) and falls back to
   the local Earth plate if tiles are unavailable. */

import { useEffect, useRef, useState } from 'react';
import './StaticMapCover.css';

const TILE_SIZE = 256;
const TILE_URL = (z: number, y: number, x: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`;

type Tile = { x: number; y: number; key: string };
type View = { left: number; top: number; z: number; tiles: Tile[] };

function worldPixels(lng: number, lat: number, z: number) {
  const world = TILE_SIZE * 2 ** z;
  const px = ((lng + 180) / 360) * world;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * world;
  return { px, py };
}

function zoomForWidth(viewW: number) {
  // Extra-wide frame: show ~40° of longitude across the card. Dark Gray
  // Base is only mapped worldwide through z=10 (z≥11 is unavailable outside
  // limited regions, including the Philippines), so cap at 10. Never below z=3.
  const z = Math.round(Math.log2((viewW * 360) / (TILE_SIZE * 40)));
  return Math.max(3, Math.min(10, z));
}

export function StaticMapCover({ lat, lng }: { lat: number; lng: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const compute = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        setView(null);
        return;
      }
      const z = zoomForWidth(w);
      const { px, py } = worldPixels(lng, lat, z);
      // Frame the epicenter right-of-center, vertically centered in the crop.
      const left = px - 0.74 * w;
      const top = py - 0.5 * h;
      const tiles: Tile[] = [];
      const x0 = Math.floor(left / TILE_SIZE);
      const x1 = Math.floor((left + w) / TILE_SIZE);
      const y0 = Math.floor(top / TILE_SIZE);
      const y1 = Math.floor((top + h) / TILE_SIZE);
      const maxTile = 2 ** z - 1;
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (ty < 0 || ty > maxTile) continue;
          const wx = ((tx % (maxTile + 1)) + (maxTile + 1)) % (maxTile + 1);
          tiles.push({ x: wx, y: ty, key: `${z}/${ty}/${tx}` });
        }
      }
      setView({ left, top, z, tiles });
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    // Belt and braces: ResizeObserver can be throttled in backgrounded renderers.
    window.addEventListener('resize', compute, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [lat, lng]);

  return (
    <div ref={ref} className="static-map-cover" aria-hidden="true">
      <div
        className="static-map-cover__fallback"
        style={{ backgroundImage: "url('/assets/darker-earth-cover.jpg')" }}
      />
      {view &&
        view.tiles.map((t) => (
          <img
            key={t.key}
            className="static-map-tile"
            src={TILE_URL(view.z, t.y, t.x)}
            alt=""
            draggable={false}
            decoding="async"
            loading="lazy"
            style={{ left: t.x * TILE_SIZE - view.left, top: t.y * TILE_SIZE - view.top }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.opacity = '0';
            }}
          />
        ))}
    </div>
  );
}
