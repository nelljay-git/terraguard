import { MOTION_EVENT_CHANNEL } from './config.ts';
import type { MotionSample, MotionSource, SensorInfo } from './types.ts';

export type MotionSampleListener = (sample: MotionSample) => void;
type Unsubscribe = () => void;

interface NativeMotionDetail {
  timestampMs?: number;
  ax?: number;
  ay?: number;
  az?: number;
  gx?: number;
  gy?: number;
  gz?: number;
  linear?: boolean;
}

/**
 * Source-agnostic sensor subscription manager. No React dependencies.
 * Samples arrive from the native bridge, a replay dataset, or tests via emit().
 */
export class MotionSensorService {
  private readonly listeners = new Set<MotionSampleListener>();
  private running = false;
  private source: MotionSource = 'unknown';
  private received = 0;
  private dropped = 0;
  private lastTimestampMs = 0;
  private lastIntervalMs = 0;
  private nativeUnsubscribe: Unsubscribe | null = null;
  private replayTimer: ReturnType<typeof setInterval> | null = null;

  start(source: MotionSource = 'native'): void {
    this.running = true;
    this.source = source;
  }

  stop(): void {
    this.running = false;
    if (this.nativeUnsubscribe) {
      this.nativeUnsubscribe();
      this.nativeUnsubscribe = null;
    }
    if (this.replayTimer) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
  }

  isRunning(): boolean { return this.running; }

  onSample(listener: MotionSampleListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Feed a reading into the pipeline. Invalid timestamps are still counted. */
  emit(sample: MotionSample): void {
    if (!this.running) return;
    if (this.lastTimestampMs > 0) {
      this.lastIntervalMs = sample.timestampMs - this.lastTimestampMs;
    }
    this.lastTimestampMs = sample.timestampMs;
    this.received++;
    for (const listener of this.listeners) {
      try {
        listener(sample);
      } catch (e) {
        this.dropped++;
        console.warn('[motion] listener error', e);
      }
    }
  }

  /** Listen for samples forwarded by the native Android foreground service. */
  attachNativeBridge(): boolean {
    if (typeof document === 'undefined') return false;
    if (this.nativeUnsubscribe) return true;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<NativeMotionDetail>).detail;
      if (!detail) return;
      this.emit({
        timestampMs: detail.timestampMs ?? Date.now(),
        ax: detail.ax ?? 0,
        ay: detail.ay ?? 0,
        az: detail.az ?? 0,
        ...(detail.gx !== undefined ? { gx: detail.gx } : {}),
        ...(detail.gy !== undefined ? { gy: detail.gy } : {}),
        ...(detail.gz !== undefined ? { gz: detail.gz } : {}),
        linear: detail.linear ?? false,
        source: 'native',
      });
    };
    document.addEventListener(MOTION_EVENT_CHANNEL, handler);
    this.nativeUnsubscribe = () => document.removeEventListener(MOTION_EVENT_CHANNEL, handler);
    this.source = 'native';
    return true;
  }

  /** Replay recorded/simulated samples at their original cadence. TEST MODE ONLY. */
  replay(samples: readonly MotionSample[], loop = false, done?: () => void): void {
    if (!samples.length) return;
    this.start('simulated');
    let index = 0;
    const step = () => {
      if (!this.running) return;
      this.emit(samples[index]);
      index++;
      if (index >= samples.length) {
        if (loop) index = 0;
        else {
          if (this.replayTimer) clearInterval(this.replayTimer);
          this.replayTimer = null;
          done?.();
        }
      }
    };
    step();
    if (this.replayTimer) clearInterval(this.replayTimer);
    const interval = Math.max(1, this.lastIntervalMs || 20);
    this.replayTimer = setInterval(step, interval);
  }

  getInfo(): SensorInfo {
    const rate = this.lastIntervalMs > 0 ? 1000 / this.lastIntervalMs : 0;
    return {
      available: this.source === 'native' || this.source === 'simulated',
      source: this.source,
      running: this.running,
      received: this.received,
      dropped: this.dropped,
      measuredHz: Number.isFinite(rate) ? Math.round(rate * 10) / 10 : 0,
      lastIntervalMs: this.lastIntervalMs,
    };
  }
}
