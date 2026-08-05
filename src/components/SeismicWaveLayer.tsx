import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import { Play, Pause, RotateCcw } from 'lucide-react';
import L from 'leaflet';

export type WavePhase = 'idle' | 'playing' | 'paused' | 'done';

type SeismicWaveLayerProps = {
  lat: number;
  lng: number;
  magnitude: number;
  color: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
};

// Typical crustal travel speeds: P-waves ~6 km/s, S-waves ~3.5 km/s
const P_WAVE_SPEED = 6.0;
const S_WAVE_SPEED = 3.5;

export function SeismicWaveLayer({ lat, lng, magnitude, color, containerRef }: SeismicWaveLayerProps) {
  const map = useMap();
  const [phase, setPhaseState] = useState<WavePhase>('idle');
  const [overlayTarget, setOverlayTarget] = useState<HTMLElement | null>(null);

  const phaseRef = useRef<WavePhase>('idle');
  const elapsedRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const groupRef = useRef<L.LayerGroup | null>(null);
  const circlesRef = useRef<{ p: L.Circle; s: L.Circle; target: L.Circle } | null>(null);

  // HUD elements are updated imperatively during playback so no React
  // re-render happens on the hot path.
  const pDistEl = useRef<HTMLSpanElement | null>(null);
  const sDistEl = useRef<HTMLSpanElement | null>(null);
  const elapsedEl = useRef<HTMLSpanElement | null>(null);
  const progressEl = useRef<HTMLDivElement | null>(null);

  const maxRadiusKm = Math.max(50, magnitude * 30);
  const maxRadiusM = maxRadiusKm * 1000;
  const duration = maxRadiusKm / S_WAVE_SPEED;

  // Build the circles imperatively so animated radius updates via setRadius
  // are never clobbered by React re-renders.
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const p = L.circle([lat, lng], {
      radius: 0,
      color: '#38bdf8',
      weight: 3,
      opacity: 0.9,
      fillColor: '#38bdf8',
      fillOpacity: 0.12,
      interactive: false,
    });
    const s = L.circle([lat, lng], {
      radius: 0,
      color: '#fb923c',
      weight: 3,
      opacity: 0.9,
      fillColor: '#fb923c',
      fillOpacity: 0.12,
      interactive: false,
    });
    const target = L.circle([lat, lng], {
      radius: maxRadiusM,
      color,
      weight: 2,
      opacity: 0,
      dashArray: '6 6',
      fill: false,
      interactive: false,
    });
    p.addTo(group);
    s.addTo(group);
    target.addTo(group);
    groupRef.current = group;
    circlesRef.current = { p, s, target };
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      group.remove();
      groupRef.current = null;
      circlesRef.current = null;
    };
  }, [map, lat, lng, maxRadiusM, color]);

  // The control overlay lives inside the details map container (parent div of
  // the leaflet map), so it floats above the map without joining its panes.
  useEffect(() => {
    setOverlayTarget(containerRef.current);
  }, [containerRef]);

  const setPhase = (next: WavePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const setRadii = (t: number) => {
    const c = circlesRef.current;
    if (!c) return;
    c.p.setRadius(Math.min(t * P_WAVE_SPEED, maxRadiusKm) * 1000);
    c.s.setRadius(Math.min(t * S_WAVE_SPEED, maxRadiusKm) * 1000);
  };

  const updateHud = (t: number) => {
    const pDist = Math.min(t * P_WAVE_SPEED, maxRadiusKm);
    const sDist = Math.min(t * S_WAVE_SPEED, maxRadiusKm);
    if (pDistEl.current) pDistEl.current.textContent = `${Math.round(pDist)}`;
    if (sDistEl.current) sDistEl.current.textContent = `${Math.round(sDist)}`;
    if (elapsedEl.current) elapsedEl.current.textContent = `${t.toFixed(1)}s / ${duration.toFixed(1)}s`;
    if (progressEl.current) progressEl.current.style.width = `${Math.min((t / duration) * 100, 100)}%`;
  };

  const stopRaf = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const startRaf = () => {
    stopRaf();
    const step = () => {
      const t = elapsedRef.current;
      setRadii(t);
      updateHud(t);
      if (t >= duration) {
        setRadii(duration);
        updateHud(duration);
        setPhase('done');
        rafRef.current = null;
        return;
      }
      elapsedRef.current = Math.min(t + 1 / 60, duration);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const resetHud = () => {
    if (pDistEl.current) pDistEl.current.textContent = '0';
    if (sDistEl.current) sDistEl.current.textContent = '0';
    if (elapsedEl.current) elapsedEl.current.textContent = `0.0s / ${duration.toFixed(1)}s`;
    if (progressEl.current) progressEl.current.style.width = '0%';
  };

  const fitToAffectedArea = () => {
    const dLat = maxRadiusKm / 111;
    const cos = Math.cos((lat * Math.PI) / 180) || 0.0001;
    const dLng = maxRadiusKm / (111 * Math.abs(cos));
    map.fitBounds(
      L.latLngBounds([lat - dLat, lng - dLng], [lat + dLat, lng + dLng]),
      { padding: [24, 24] }
    );
  };

  const play = () => {
    const c = circlesRef.current;
    if (!c) return;
    const wasIdle = phaseRef.current === 'idle';
    const wasDone = phaseRef.current === 'done';
    if (wasIdle || wasDone) {
      c.target.setStyle({ opacity: 0.55 });
      elapsedRef.current = 0;
      resetHud();
      if (wasIdle) fitToAffectedArea();
    }
    setPhase('playing');
    startRaf();
  };

  const pause = () => {
    stopRaf();
    if (phaseRef.current === 'playing') setPhase('paused');
  };

  const replay = () => {
    const c = circlesRef.current;
    if (!c) return;
    c.target.setStyle({ opacity: 0.55 });
    elapsedRef.current = 0;
    resetHud();
    setPhase('playing');
    startRaf();
  };

  const handleButtonClick = () => {
    if (phaseRef.current === 'playing') pause();
    else if (phaseRef.current === 'done') replay();
    else play();
  };

  useEffect(() => stopRaf, []);

  const overlay = (
    <div className="wave-control-overlay">
      <button type="button" className="wave-play-btn" onClick={handleButtonClick} title="Animate P-wave and S-wave propagation from the epicenter">
        {phase === 'playing' ? <Pause size={16} /> : phase === 'done' ? <RotateCcw size={16} /> : <Play size={16} />}
      </button>
      {phase === 'playing' && (
        <div className="wave-status">
          <div className="wave-legend">
            <span><i className="wave-dot wave-p" />P-wave <b ref={pDistEl}>0</b> km</span>
            <span><i className="wave-dot wave-s" />S-wave <b ref={sDistEl}>0</b> km</span>
          </div>
          <div className="wave-progress">
            <div className="wave-progress-fill" ref={progressEl} style={{ width: '0%' }} />
          </div>
          <span className="wave-elapsed" ref={elapsedEl}>0.0s / {duration.toFixed(1)}s</span>
        </div>
      )}
    </div>
  );

  return overlayTarget ? createPortal(overlay, overlayTarget) : null;
}
