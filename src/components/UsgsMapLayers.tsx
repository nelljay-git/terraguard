import { useEffect, useState } from 'react';
import { ImageOverlay, CircleMarker, Tooltip, Polyline, Polygon } from 'react-leaflet';
import type { LatLngBoundsExpression, LatLngExpression, PathOptions } from 'leaflet';
import {
  USGS_OVERLAY_ITEMS,
  parseContours,
  mmiColor,
} from '../lib/usgsOverlays';
import type {
  OverlayContext,
  ResolvedLayer,
  MarkerPoint,
  Products,
} from '../lib/usgsOverlays';

interface Props {
  products: Products;
  active: Set<string>;
  lat: number;
  lng: number;
  origin?: string;
  eventTimeMs?: number;
}

export function UsgsMapLayers({ products, active, lat, lng, origin, eventTimeMs }: Props) {
  const ctx: OverlayContext = { eventTimeMs, lat, lng };
  const layers: { key: string; res: ResolvedLayer }[] = [];
  for (const key of active) {
    const item = USGS_OVERLAY_ITEMS.find((i) => i.key === key);
    if (!item) continue;
    const res = item.resolve(products, ctx);
    if (res) layers.push({ key, res });
  }
  return (
    <>
      {layers.map(({ key, res }) => (
        <UsgsLayer key={key} layer={res} lat={lat} lng={lng} origin={origin} />
      ))}
    </>
  );
}

function UsgsLayer({
  layer,
  lat,
  lng,
  origin,
}: {
  layer: ResolvedLayer;
  lat: number;
  lng: number;
  origin?: string;
}) {
  if (layer.type === 'image') {
    return (
      <ImageOverlay
        url={layer.url}
        bounds={layer.bounds as LatLngBoundsExpression}
        opacity={layer.opacity ?? 0.75}
      />
    );
  }
  if (layer.type === 'special') {
    return <SpecialLayer kind={layer.kind} lat={lat} lng={lng} origin={origin} />;
  }
  if (layer.type === 'contours') {
    return <ContourLayer url={layer.url} />;
  }
  if (layer.type === 'faults') {
    return <FaultLayer url={layer.url} />;
  }
  if (layer.type === 'dyfi-grid') {
    return <DyfiGridLayer url={layer.url} />;
  }
  return <MarkerLayer layer={layer} />;
}

function SpecialLayer({
  kind,
  lat,
  lng,
  origin,
}: {
  kind: 'epicenter' | 'info';
  lat: number;
  lng: number;
  origin?: string;
}) {
  if (kind === 'epicenter') {
    const opts: PathOptions = {
      color: '#ff3b30',
      fillColor: '#ff3b30',
      fillOpacity: 0.6,
    };
    return (
      <CircleMarker center={[lat, lng]} radius={6} pathOptions={opts}>
        <Tooltip>Epicenter</Tooltip>
      </CircleMarker>
    );
  }
  const opts: PathOptions = {
    color: '#ffd60a',
    fillColor: '#ffd60a',
    fillOpacity: 0.6,
  };
  return (
    <CircleMarker center={[lat, lng]} radius={5} pathOptions={opts}>
      <Tooltip>{origin ? `Earthquake Information\n${origin}` : 'Earthquake Information'}</Tooltip>
    </CircleMarker>
  );
}

function MarkerLayer({ layer }: { layer: { type: 'markers'; color: string; load: () => Promise<MarkerPoint[]> } }) {
  const [points, setPoints] = useState<MarkerPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    layer
      .load()
      .then((p) => {
        if (!cancelled) setPoints(p);
      })
      .catch(() => {
        if (!cancelled) setPoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [layer]);

  if (!points) return null;
  return (
    <>
      {points.map((pt, i) => {
        const color = pt.color ?? layer.color;
        const opts: PathOptions = {
          color,
          fillColor: color,
          fillOpacity: 0.6,
          weight: 1,
        };
        // Bring the hovered marker above any overlapping ones so its tooltip is
        // always reachable (aftershocks often stack on top of each other).
        const markerOpts: Record<string, unknown> = { ...opts, riseOnHover: true };
        return (
          <CircleMarker
            key={i}
            center={[pt.lat, pt.lng]}
            radius={pt.r ?? 4}
            pathOptions={markerOpts as PathOptions}
          >
            <Tooltip>{pt.meta ?? 'Marker'}</Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

function ContourLayer({ url }: { url: string }) {
  const [lines, setLines] = useState<{ positions: LatLngExpression[]; color: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((gj) => {
        if (cancelled) return;
        setLines(parseContours(gj));
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!lines) return null;
  return (
    <>
      {lines.map((l, i) => (
        <Polyline
          key={i}
          positions={l.positions}
          pathOptions={{ color: l.color || mmiColor(5), weight: 1.5, opacity: 0.8 }}
        />
      ))}
    </>
  );
}

// Renders the USGS finite-fault model (FFM.geojson): a collection of sub-fault
// patches, each colored by its slip on the source map. Coordinates are [lon, lat,
// depth]; we drop the depth for the 2D polygon.
function FaultLayer({ url }: { url: string }) {
  const [patches, setPatches] = useState<
    { rings: LatLngExpression[][]; color: string; slip?: number }[] | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((gj) => {
        if (cancelled) return;
        const out: { rings: LatLngExpression[][]; color: string; slip?: number }[] = [];
        for (const f of gj?.features || []) {
          const rings = geomToRings(f?.geometry);
          if (!rings.length) continue;
          const props = f?.properties || {};
          const slip = parseFloat(props.slip);
          out.push({
            rings,
            color: typeof props.fill === 'string' && props.fill ? props.fill : '#ff7800',
            slip: isNaN(slip) ? undefined : slip,
          });
        }
        setPatches(out);
      })
      .catch(() => {
        if (!cancelled) setPatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!patches) return null;
  return (
    <>
      {patches.map((p, i) => (
        <Polygon
          key={i}
          positions={p.rings}
          pathOptions={{
            color: p.color,
            weight: 1,
            fillColor: p.color,
            fillOpacity: 0.6,
          }}
        >
          {p.slip != null ? <Tooltip>Slip: {p.slip} m</Tooltip> : null}
        </Polygon>
      ))}
    </>
  );
}

function geomToRings(geom: any): LatLngExpression[][] {
  if (!geom) return [];
  if (geom.type === 'Polygon') {
    const ring = (geom.coordinates?.[0] || []).map((c: number[]) => [c[1], c[0]] as LatLngExpression);
    return ring.length ? [ring] : [];
  }
  if (geom.type === 'MultiPolygon') {
    const out: LatLngExpression[][] = [];
    for (const poly of geom.coordinates || []) {
      const ring = (poly?.[0] || []).map((c: number[]) => [c[1], c[0]] as LatLngExpression);
      if (ring.length) out.push(ring);
    }
    return out;
  }
  return [];
}

// DYFI "N km Responses" grid cells: polygons colored by their Community Determined
// Intensity (cdi), with a tooltip naming the location and response count.
function DyfiGridLayer({ url }: { url: string }) {
  const [cells, setCells] = useState<{ rings: LatLngExpression[][]; color: string; tip: string }[] | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((gj) => {
        if (cancelled) return;
        const out: { rings: LatLngExpression[][]; color: string; tip: string }[] = [];
        for (const f of gj?.features || []) {
          const rings = geomToRings(f?.geometry);
          if (!rings.length) continue;
          const props = f?.properties || {};
          const cdiRaw = typeof props.cdi === 'number' ? props.cdi : parseFloat(props.cdi);
          const cdi = isNaN(cdiRaw) ? null : cdiRaw;
          const color = cdi != null ? mmiColor(cdi) : '#ffd166';
          const name = props.name || '';
          const nresp = props.nresp;
          const tip = `MMI ${cdi ?? '?'}${name ? ` - ${name}` : ''}${
            nresp != null ? ` (${nresp} responses)` : ''
          }`;
          out.push({ rings, color, tip });
        }
        setCells(out);
      })
      .catch(() => {
        if (!cancelled) setCells([]);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!cells) return null;
  return (
    <>
      {cells.map((c, i) => (
        <Polygon
          key={i}
          positions={c.rings}
          pathOptions={{ color: c.color, weight: 1, fillColor: c.color, fillOpacity: 0.55 }}
        >
          <Tooltip>{c.tip}</Tooltip>
        </Polygon>
      ))}
    </>
  );
}
