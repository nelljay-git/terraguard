import type { FilteredSample, MotionConfig, MotionSample, Vec3 } from './types.ts';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function validSample(s: MotionSample): boolean {
  return finite(s.timestampMs) && finite(s.ax) && finite(s.ay) && finite(s.az)
    && (s.gx === undefined || finite(s.gx))
    && (s.gy === undefined || finite(s.gy))
    && (s.gz === undefined || finite(s.gz));
}

/**
 * Gravity compensation, noise/outlier rejection and interval monitoring.
 * Noise filtering is deliberately light: aggressive filtering can remove
 * genuine low-frequency sustained motion.
 */
export class MotionFilter {
  private gravity: Vec3 = { x: 0, y: 0, z: 0 };
  private initialized = false;
  private lastTimestampMs = 0;
  private intervalMs = 0;
  private dropped = 0;
  private outlierCount = 0;

  private readonly config: MotionConfig;

  constructor(config: MotionConfig) {
    this.config = config;
  }

  reset(): void {
    this.gravity = { x: 0, y: 0, z: 0 };
    this.initialized = false;
    this.lastTimestampMs = 0;
    this.intervalMs = 0;
    this.dropped = 0;
    this.outlierCount = 0;
  }

  get measuredIntervalMs(): number { return this.intervalMs; }
  get droppedSamples(): number { return this.dropped; }
  get outliers(): number { return this.outlierCount; }

  process(sample: MotionSample): FilteredSample | null {
    if (!validSample(sample)) {
      this.dropped++;
      return null;
    }

    // Reject out-of-order samples; they would corrupt window timing.
    if (this.lastTimestampMs > 0 && sample.timestampMs < this.lastTimestampMs) {
      this.dropped++;
      return null;
    }

    const dt = this.lastTimestampMs > 0
      ? sample.timestampMs - this.lastTimestampMs
      : 1000 / this.config.targetSampleHz;
    if (this.lastTimestampMs > 0) this.intervalMs = dt;
    this.lastTimestampMs = sample.timestampMs;

    let dynamic: Vec3;
    let gravity: Vec3;

    if (sample.linear) {
      // Producer already removed gravity — never subtract twice.
      gravity = { x: 0, y: 0, z: 0 };
      dynamic = { x: sample.ax, y: sample.ay, z: sample.az };
    } else {
      if (!this.initialized) {
        this.gravity = { x: sample.ax, y: sample.ay, z: sample.az };
        this.initialized = true;
      } else {
        const a = this.config.gravityAlpha;
        this.gravity = {
          x: this.gravity.x + (sample.ax - this.gravity.x) * a,
          y: this.gravity.y + (sample.ay - this.gravity.y) * a,
          z: this.gravity.z + (sample.az - this.gravity.z) * a,
        };
      }
      gravity = { ...this.gravity };
      dynamic = {
        x: sample.ax - this.gravity.x,
        y: sample.ay - this.gravity.y,
        z: sample.az - this.gravity.z,
      };
    }

    let magnitude = Math.hypot(dynamic.x, dynamic.y, dynamic.z);
    let outlier = false;
    if (magnitude > this.config.maxPlausibleAcceleration) {
      // Implausible spike: clamp and mark degraded rather than trusting it.
      const scale = this.config.maxPlausibleAcceleration / magnitude;
      dynamic = { x: dynamic.x * scale, y: dynamic.y * scale, z: dynamic.z * scale };
      magnitude = this.config.maxPlausibleAcceleration;
      outlier = true;
      this.outlierCount++;
    }

    const stale = dt > (1000 / this.config.targetSampleHz) * this.config.maxStaleIntervalFactor;
    const quality = outlier || stale ? 'DEGRADED' : 'GOOD';

    const angular = finite(sample.gx) && finite(sample.gy) && finite(sample.gz)
      ? { x: sample.gx as number, y: sample.gy as number, z: sample.gz as number }
      : null;

    return {
      timestampMs: sample.timestampMs,
      dynamic,
      gravity,
      magnitude,
      angular,
      quality,
      outlier,
    };
  }
}
