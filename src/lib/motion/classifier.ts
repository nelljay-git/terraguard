import type { ClassificationResult, MotionCategory, MotionConfig, MotionFeatures } from './types.ts';

export interface ClassificationContext {
  /** Previously analysed windows, oldest first. Used only as supporting evidence. */
  previousFeatures?: readonly MotionFeatures[];
}

type Scores = Record<MotionCategory, number>;

const EMPTY_SCORES = (): Scores => ({
  NORMAL_ACTIVITY: 0,
  SUDDEN_IMPACT: 0,
  PERIODIC_VIBRATION: 0,
  SUSTAINED_OSCILLATION: 0,
  UNKNOWN: 0,
});

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Rule-based, explainable classifier. Output confidence is classification
 * confidence ONLY — never an earthquake probability.
 */
export function classifyMotion(
  features: MotionFeatures,
  config: MotionConfig,
  context: ClassificationContext = {},
): ClassificationResult {
  const reasons: string[] = [];

  if (features.sampleCount < config.minConsecutiveSamples || features.signalQuality === 'POOR') {
    reasons.push('Insufficient valid samples or poor signal quality');
    return { classification: 'UNKNOWN', confidence: 0.2, reasons, features };
  }

  const scores = EMPTY_SCORES();
  const f = features;

  const oscillatingAxes = f.axisReversals.filter((r) => r >= 2).length;
  const durationOk = f.motionDurationMs >= config.minSustainedMs;
  const amplitudeOk =
    f.peakAcceleration >= config.peakAccelMin && f.rmsAcceleration >= config.rmsAccelMin;
  const consistent = f.oscillationConsistency >= config.sustainedConsistencyMin;
  const frequencyOk =
    f.dominantFrequencyHz >= config.sustainedFrequencyMin &&
    f.dominantFrequencyHz <= config.sustainedFrequencyMax;
  const oscillatory = oscillatingAxes >= config.oscillatingAxesMin && f.zeroCrossingRate >= 1;

  // --- Sudden impact: huge isolated spike, short duration, little oscillation.
  if (f.peakAcceleration >= config.impactPeakMin && f.motionDurationMs < config.minSustainedMs) {
    scores.SUDDEN_IMPACT += 0.85;
    reasons.push('Sharp impulse followed by settling, not sustained motion');
  }

  // --- Periodic vibration: fast, very consistent, low-amplitude oscillation.
  if (
    f.dominantFrequencyHz >= config.vibrationFrequencyMin &&
    f.dominantFrequencyHz <= config.vibrationFrequencyMax &&
    f.oscillationConsistency >= config.vibrationConsistencyMin
  ) {
    scores.PERIODIC_VIBRATION += 0.8;
    reasons.push('High-frequency, highly consistent oscillation');
  }

  // --- Normal activity: regular low-frequency motion with strong rotation
  // (walking/running while holding the phone).
  if (
    f.peakAcceleration < config.impactPeakMin &&
    f.dominantFrequencyHz > 0.5 && f.dominantFrequencyHz < 4 &&
    f.signalRegularity > 0.55 && f.angularVelocity > 0.6
  ) {
    scores.NORMAL_ACTIVITY += 0.72;
    reasons.push('Regular low-frequency motion with strong rotational component');
  }

  // --- Phone handling: short, irregular bursts with orientation changes.
  if (f.motionDurationMs < 1200 && f.oscillationConsistency < 0.4 && f.angularVelocity > 0.4) {
    scores.NORMAL_ACTIVITY += 0.5;
    reasons.push('Short irregular motion with orientation changes');
  }

  // --- Sustained oscillation: all core evidence present.
  if (durationOk && amplitudeOk && oscillatory && frequencyOk && consistent) {
    scores.SUSTAINED_OSCILLATION += 0.88;
    reasons.push('Sustained multi-axis oscillation beyond the minimum duration');
  } else {
    if (!durationOk) reasons.push('Motion did not persist long enough');
    if (!amplitudeOk) reasons.push('Amplitude below configured minimum');
    if (!oscillatory) reasons.push('Too few directional reversals across axes');
    if (!frequencyOk) reasons.push('Dominant frequency outside the oscillatory range');
    if (!consistent) reasons.push('Peak amplitudes were not consistent');
  }

  // Ongoing motion before this window is supporting evidence against a new
  // sustained event, but NOT a mandatory calm precondition.
  const previous = context.previousFeatures ?? [];
  if (previous.length >= 2) {
    const last = previous[previous.length - 1];
    const before = previous[previous.length - 2];
    if (last.peakAcceleration > config.calmPeakMax && before.peakAcceleration > config.calmPeakMax) {
      scores.SUSTAINED_OSCILLATION = Math.max(0, scores.SUSTAINED_OSCILLATION - 0.1);
      reasons.push('Motion was already present in earlier windows');
    }
  }

  if (f.signalQuality === 'DEGRADED') {
    reasons.push('Signal quality degraded — sample intervals or spikes detected');
    scores.UNKNOWN += 0.1;
  }

  let best: MotionCategory = 'UNKNOWN';
  let bestScore = 0;
  let secondScore = 0;
  for (const key of Object.keys(scores) as MotionCategory[]) {
    if (scores[key] > bestScore) {
      secondScore = bestScore;
      bestScore = scores[key];
      best = key;
    } else if (scores[key] > secondScore) {
      secondScore = scores[key];
    }
  }

  // Ambiguous or weak evidence → UNKNOWN by design.
  if (bestScore < config.confidenceMin || bestScore - secondScore < 0.12) {
    reasons.push('Evidence was ambiguous or below the confidence minimum');
    return { classification: 'UNKNOWN', confidence: clamp01(bestScore), reasons, features };
  }

  return {
    classification: best,
    confidence: clamp01(bestScore),
    reasons,
    features,
  };
}
