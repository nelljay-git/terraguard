import type { MotionConfig } from './types.ts';

/**
 * Engineering starting points — NOT scientifically validated earthquake
 * thresholds. Sensitivity presets adjust several parameters together rather
 * than multiplying a single acceleration threshold.
 */
export const BASE_MOTION_CONFIG: MotionConfig = {
  targetSampleHz: 50,
  windowMs: 3000,
  minSustainedMs: 1500,
  minConsecutiveSamples: 8,
  cooldownMs: 30_000,

  gravityAlpha: 0.006,
  zeroCrossDeadband: 0.55,
  maxPlausibleAcceleration: 80,
  maxStaleIntervalFactor: 3,

  peakAccelMin: 2.8,
  rmsAccelMin: 1.2,
  varianceMin: 0.8,
  reversalMin: 6,
  oscillatingAxesMin: 2,
  impactPeakMin: 9.8,
  vibrationFrequencyMin: 6,
  vibrationFrequencyMax: 22,
  vibrationConsistencyMin: 0.72,
  sustainedFrequencyMin: 0.8,
  sustainedFrequencyMax: 12,
  sustainedConsistencyMin: 0.38,
  confidenceMin: 0.62,
  calmPeakMax: 1.5,
};

export type Sensitivity = 'low' | 'medium' | 'high';

export const SENSITIVITY_PRESETS: Record<Sensitivity, Partial<MotionConfig>> = {
  // Fewer alerts: stronger/longer evidence required.
  low: {
    peakAccelMin: 4.2,
    rmsAccelMin: 2.0,
    varianceMin: 1.6,
    reversalMin: 10,
    minSustainedMs: 2200,
    sustainedConsistencyMin: 0.5,
    confidenceMin: 0.75,
  },
  medium: {},
  // More alerts: weaker evidence accepted; still requires oscillation + duration.
  high: {
    peakAccelMin: 2.2,
    rmsAccelMin: 0.9,
    varianceMin: 0.5,
    reversalMin: 5,
    minSustainedMs: 1100,
    sustainedConsistencyMin: 0.3,
    confidenceMin: 0.55,
  },
};

export function motionConfig(sensitivity: Sensitivity = 'medium'): MotionConfig {
  return { ...BASE_MOTION_CONFIG, ...SENSITIVITY_PRESETS[sensitivity] };
}

export const MOTION_EVENT_CHANNEL = 'terraguard:motion-sample';
export const MOTION_STATE_CHANNEL = 'terraguard:motion-state';
