import { useEffect, useRef, useState } from 'react';
import { drawRememberingFrame, esriTileUrls, epicenterMosaicPx, W, H, DUR, COLS, ROWS, TILE, MOSAIC_D } from '../components/RememberingEarthquake';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import { fetchDyfiPoints, fetchMmiContours, fetchRupture, fetchDyfiShakeText, fetchUsgsCityShakeText } from '../lib/dyfi';
import type { DyfiPoint, MmiContour, RuptureData } from '../lib/dyfi';
import { extractShakeRowsByLevel } from '../lib/videoMeta';
import type { RememberingInfo } from '../components/RememberingEarthquake';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseEventId(raw: string): string {
  const m = /eventpage\/([A-Za-z0-9]+)/i.exec(raw);
  if (m) return m[1];
  return raw.trim();
}

async function fetchUsgsEvent(id: string): Promise<{ quake: PhivolcsEarthquake; eventId: string } | null> {
  try {
    const res = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const f = Array.isArray(data?.features) ? data.features[0] : data;
    const p = f?.properties;
    const c = f?.geometry?.coordinates;
    if (!p || !Array.isArray(c)) return null;
    const d = new Date(p.time);
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = MONTHS[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    let hour = d.getUTCHours();
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    const ampm = hour >= 12 ? 'PM' : 'AM';
    if (hour === 0) hour = 12;
    else if (hour > 12) hour -= 12;
    const datetime = `${day} ${month} ${year} - ${hour}:${min} ${ampm}`;
    const quake: PhivolcsEarthquake = {
      datetime,
      latitude: String(c[1]),
      longitude: String(c[0]),
      depth: String(c[2] ?? ''),
      magnitude: String(p.mag ?? ''),
      location: String(p.place ?? '').toUpperCase(),
      link: '',
    };
    (quake as { tsunami?: number }).tsunami = typeof p.tsunami === 'number' ? p.tsunami : 0;
    return { quake, eventId: String(f?.id ?? id) };
  } catch {
    return null;
  }
}

const SAMPLE: PhivolcsEarthquake = {
  datetime: '08 September 2017 - 04:49 AM',
  latitude: '15.0222',
  longitude: '-93.8993',
  depth: '47.39',
  magnitude: '8.2',
  location: 'OFFSHORE CHIAPAS, MEXICO',
  link: '',
};

(SAMPLE as { tsunami?: number }).tsunami = 1;

function tileUrls(eq: PhivolcsEarthquake): string[] {
  return esriTileUrls(eq);
}

export default function RememberingDebug() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<{ mosaic: HTMLCanvasElement; exD: number; eyD: number } | null>(null);
  const dyfiRef = useRef<DyfiPoint[]>([]);
  const contoursRef = useRef<MmiContour[]>([]);
  const ruptureRef = useRef<RuptureData | null>(null);
  const infoRef = useRef<RememberingInfo>({ intensity: 'IX', threat: 'Tsunami Advisory', source: 'usgs' });
  const eventIdRef = useRef<string>('us2000ahv0');

  const [quake, setQuake] = useState<PhivolcsEarthquake>(SAMPLE);
  const [inputValue, setInputValue] = useState('us2000ahv0');
  const [status, setStatus] = useState('loading tiles...');
  const [loading, setLoading] = useState(false);

  // Load tiles + DYFI + contours + rupture + shake text whenever `quake` changes.
  useEffect(() => {
    let cancelled = false;
    const urls = tileUrls(quake);
    setLoading(true);
    setStatus('loading tiles...');
    Promise.all(
      urls.map(
        (src) =>
          new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
          }),
      ),
    ).then(async (results) => {
      if (cancelled) return;
      const mosaic = document.createElement('canvas');
      mosaic.width = COLS * TILE;
      mosaic.height = ROWS * TILE;
      const mctx = mosaic.getContext('2d');
      if (mctx) {
        mctx.fillStyle = '#0a0d12';
        mctx.fillRect(0, 0, mosaic.width, mosaic.height);
        results.forEach((img, i) => {
          if (!img) return;
          const c = i % COLS;
          const r = Math.floor(i / COLS);
          mctx.drawImage(img, c * TILE, r * TILE, TILE, TILE);
        });
      }
      const { epx, epy } = epicenterMosaicPx(quake);
      viewRef.current = {
        mosaic,
        exD: (W - COLS * TILE * MOSAIC_D) / 2 + epx * MOSAIC_D,
        eyD: (H - ROWS * TILE * MOSAIC_D) / 2 + epy * MOSAIC_D,
      };

      // Reset data refs for the new event.
      dyfiRef.current = [];
      contoursRef.current = [];
      ruptureRef.current = null;
      const tsunami = (quake as { tsunami?: number }).tsunami;
      const threat = tsunami ? 'Tsunami Advisory' : 'None';
      infoRef.current = { intensity: '', threat, source: 'usgs' };

      try {
        const pts = await fetchDyfiPoints({ usgsEventId: eventIdRef.current, datetime: quake.datetime, source: 'usgs', latitude: quake.latitude, longitude: quake.longitude });
        if (cancelled) return;
        dyfiRef.current = pts;
        setStatus(`preview running (dyfi: ${pts.length})`);
      } catch {
        setStatus('preview running (dyfi: err)');
      }
      try {
        const cs = await fetchMmiContours({ usgsEventId: eventIdRef.current });
        if (cancelled) return;
        contoursRef.current = cs;
        // Derive a max-intensity label from the contours for the panels.
        const maxV = cs.reduce((a, c) => Math.max(a, c.value || 0), 0);
        const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][Math.max(1, Math.min(12, Math.round(maxV)))] || '';
        infoRef.current = { ...infoRef.current, intensity: roman || infoRef.current.intensity };
        setStatus(`preview running (contours: ${cs.length})`);
      } catch {
        setStatus('preview running (contours: err)');
      }
      try {
        const r = await fetchRupture({ usgsEventId: eventIdRef.current });
        if (cancelled) return;
        ruptureRef.current = r;
        setStatus(`preview running (rupture: ${r ? 'yes' : 'no'})`);
      } catch {
        setStatus('preview running (rupture: err)');
      }
      // Shake text -> rows.
      try {
        let text = '';
        try {
          text = await fetchDyfiShakeText(eventIdRef.current);
          if (!text) text = await fetchUsgsCityShakeText(eventIdRef.current);
        } catch {
          text = '';
        }
        if (cancelled) return;
        const rows = extractShakeRowsByLevel(text, 5);
        infoRef.current = { ...infoRef.current, shakes: rows, intensity: infoRef.current.intensity || '' };
        setStatus(`preview running (shake rows: ${rows.length})`);
      } catch {
        setStatus('preview running');
      }
      if (!cancelled) {
        setLoading(false);
        setStatus('preview running');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [quake]);

  const handleLoad = async () => {
    const id = parseEventId(inputValue);
    if (!id) return;
    setLoading(true);
    setStatus(`fetching USGS event ${id}...`);
    const res = await fetchUsgsEvent(id);
    if (!res) {
      setStatus(`could not load event "${id}"`);
      setLoading(false);
      return;
    }
    eventIdRef.current = res.eventId;
    const tsunami = (res.quake as { tsunami?: number }).tsunami;
    const threat = tsunami ? 'Tsunami Advisory' : 'None';
    infoRef.current = { intensity: '', threat, source: 'usgs' };
    setQuake(res.quake);
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const t0Start = performance.now();
    const freezeParam = new URLSearchParams(window.location.search).get('t');
    const freeze = freezeParam != null && !isNaN(parseFloat(freezeParam)) ? parseFloat(freezeParam) : null;
    let t0 = t0Start;
    let started = false;
    let raf = 0;
    const tick = (now: number) => {
      // Don't start the clock until the mosaic tiles have loaded, otherwise
      // the first couple of seconds (and the zoom-in) are skipped/blank.
      if (!viewRef.current) {
        t0 = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      if (!started) { started = true; t0 = now; }
      // Loop with no extra tail: `% DUR` keeps the camera moving right up to
      // the cut instead of freezing the final frame for a second.
      const t = freeze != null ? freeze : ((now - t0) / 1000) % DUR;
      if (viewRef.current) {
        drawRememberingFrame(ctx, viewRef.current, quake, dyfiRef.current, contoursRef.current, ruptureRef.current, infoRef.current, t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [quake]);

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <h2>Remembering Earthquake Debug</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleLoad(); }}
          placeholder="USGS event id or eventpage URL"
          style={{ flex: 1, padding: '6px 8px', fontSize: 14 }}
        />
        <button onClick={handleLoad} disabled={loading} style={{ padding: '6px 12px', fontSize: 14 }}>
          {loading ? 'Loading...' : 'Load'}
        </button>
      </div>
      <p style={{ margin: '4px 0' }}>{status}</p>
      <p style={{ margin: '4px 0', fontSize: 12, color: '#666' }}>
        Current: {quake.magnitude} M — {quake.location} ({quake.latitude}, {quake.longitude}) @ {quake.datetime}
      </p>
      <canvas ref={canvasRef} width={W} height={H} style={{ width: 360, height: 480, border: '1px solid #333' }} />
    </div>
  );
}
