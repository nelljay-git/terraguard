/* Deterministic seismic trace generator.
   Shared by the dashboard's latest-event card and the event-report masthead so
   both draw the same shape for the same earthquake. The output is purely
   illustrative — it is NOT a recorded or official trace. */

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds an SVG path for a plausible seismic trace:
 * near-flat baseline → P-wave spike group → larger S-wave spike group → decaying coda.
 * Pure + seeded, so the same earthquake always draws the same waveform.
 */
export function buildWaveform(seedKey: string, magnitude: number): string {
  const rand = mulberry32(hashString(seedKey));
  const N = 190;
  const W = 600;
  const BASE = 50;
  // Overall amplitude grows with magnitude, capped so small quakes still read as lines.
  const amp = Math.min(34, 7 + magnitude * 4.2);
  // P and S arrivals — positions jitter slightly per event.
  const pCenter = 0.30 + (rand() - 0.5) * 0.08;
  const sCenter = 0.44 + (rand() - 0.5) * 0.08;
  const gauss = (x: number, c: number, sigma: number) => Math.exp(-((x - c) * (x - c)) / (2 * sigma * sigma));

  const pts: string[] = [];
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)); // 0..1 across the strip
    const px = x * W;
    const envelope =
      0.62 * gauss(x, pCenter, 0.045) +
      1.0 * gauss(x, sCenter, 0.062) +
      0.22 * gauss(x, sCenter + 0.17, 0.1) +   // trailing coda ripple
      0.12 * gauss(x, sCenter + 0.32, 0.09) +  // deep-tail rumble so the line reaches the edge
      0.045;                                    // faint constant floor — the line never flatlines
    // High-frequency carrier with random phase structure, modulated by the envelope
    const carrier =
      Math.sin(x * 26 + rand() * 0.4) * 0.55 +
      Math.sin(x * 47 + rand() * 0.6) * 0.3 +
      (rand() * 2 - 1) * 0.45;
    // Quiet background noise so the baseline breathes
    const ambient = (rand() * 2 - 1) * 0.13 + Math.sin(x * 5.3 + sCenter * 40) * 0.05;
    const y = BASE - (envelope * carrier * amp + ambient * amp);
    pts.push(`${px.toFixed(1)},${Math.max(6, Math.min(94, y)).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}
