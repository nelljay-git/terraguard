// Strict, UI-independent types for the experimental motion classification engine.
// CONFIDENCE IS CLASSIFICATION CONFIDENCE, NOT EARTHQUAKE PROBABILITY.

export type MotionSource = 'native' | 'simulated' | 'unknown';

export type MotionCategory =
  | 'NORMAL_ACTIVITY'
  | 'SUDDEN_IMPACT'
  | 'PERIODIC_VIBRATION'
  | 'SUSTAINED_OSCILLATION'
  | 'UNKNOWN';

export type SignalQuality = 'GOOD' | 'DEGRADED' | 'POOR';

export type DetectionState =
  | 'IDLE'
  | 'COLLECTING'
  | 'ANALYZING'
  | 'NORMAL_ACTIVITY'
  | 'IMPACT_DETECTED'
  | 'VIBRATION_DETECTED'
  | 'SUSTAINED_MOTION_CANDIDATE'
  | 'MOTION_EVENT_ACCEPTED'
  | 'COOLDOWN'
  | 'ERROR';

/** Raw (or already-linear) motion reading. Timestamps come from the sensor. */
export interface MotionSample {
  timestampMs: number;
  /** m/s². Gravity-included unless `linear` is true. */
  ax: number;
  ay: number;
  az: number;
  /** rad/s, optional ( gyroscope may be unavailable ). */
  gx?: number;
  gy?: number;
  gz?: number;
  /** True when the producer already removed gravity — never subtract twice. */
  linear: boolean;
  source: MotionSource;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface FilteredSample {
  timestampMs: number;
  /** Dynamic acceleration after gravity compensation (m/s²). */
  dynamic: Vec3;
  /** Current gravity estimate (m/s²). Zero when input was already linear. */
  gravity: Vec3;
  magnitude: number;
  angular: Vec3 | null;
  quality: SignalQuality;
  /** True when this sample was clamped as an outlier. */
  outlier: boolean;
}

export interface MotionFeatures {
  windowMs: number;
  sampleCount: number;
  peakAcceleration: number;
  rmsAcceleration: number;
  variance: number;
  energy: number;
  zeroCrossingRate: number;
  dominantFrequencyHz: number;
  /** 0..1 — how consistently peaks repeat with similar amplitude. */
  oscillationConsistency: number;
  /** 0..1 — regularity of zero-crossing intervals. */
  signalRegularity: number;
  motionDurationMs: number;
  angularVelocity: number;
  signalQuality: SignalQuality;
  /** Direction reversals per axis after deadbanding. */
  axisReversals: [number, number, number];
}

export interface ClassificationResult {
  classification: MotionCategory;
  confidence: number;
  reasons: string[];
  features: MotionFeatures;
}

export interface MotionEvent {
  id: string;
  timestampMs: number;
  classification: MotionCategory;
  accepted: boolean;
  confidence: number;
  durationMs: number;
  peakAcceleration: number;
  rmsAcceleration: number;
  dominantFrequencyHz: number;
  reason: string;
  /** True only in TEST MODE — never produces a real notification. */
  simulated: boolean;
}

export interface MotionConfig {
  targetSampleHz: number;
  windowMs: number;
  minSustainedMs: number;
  minConsecutiveSamples: number;
  cooldownMs: number;

  // Filtering
  gravityAlpha: number;
  zeroCrossDeadband: number;
  maxPlausibleAcceleration: number;
  maxStaleIntervalFactor: number;

  // Feature / classification thresholds
  peakAccelMin: number;
  rmsAccelMin: number;
  varianceMin: number;
  reversalMin: number;
  oscillatingAxesMin: number;
  impactPeakMin: number;
  vibrationFrequencyMin: number;
  vibrationFrequencyMax: number;
  vibrationConsistencyMin: number;
  sustainedFrequencyMin: number;
  sustainedFrequencyMax: number;
  sustainedConsistencyMin: number;
  confidenceMin: number;
  calmPeakMax: number;
}

export interface SensorInfo {
  available: boolean;
  source: MotionSource;
  running: boolean;
  received: number;
  dropped: number;
  measuredHz: number;
  lastIntervalMs: number;
}
