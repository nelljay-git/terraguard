import type { FilteredSample, MotionConfig, MotionFeatures, SignalQuality, Vec3 } from './types.ts';

const average = (values: readonly number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

function stdDev(values: readonly number[], mean: number): number {
  if (!values.length) return 0;
  return Math.sqrt(average(values.map((v) => (v - mean) ** 2)));
}

function magnitude(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/**
 * Calculates explainable signal features from one window of filtered samples.
 * Pure function — safe to unit test and to use in simulated replay.
 */
export function extractFeatures(
  samples: readonly FilteredSample[],
  config: MotionConfig,
): MotionFeatures {
  const empty: MotionFeatures = {
    windowMs: 0, sampleCount: 0, peakAcceleration: 0, rmsAcceleration: 0,
    variance: 0, energy: 0, zeroCrossingRate: 0, dominantFrequencyHz: 0,
    oscillationConsistency: 0, signalRegularity: 0, motionDurationMs: 0,
    angularVelocity: 0, signalQuality: 'POOR', axisReversals: [0, 0, 0],
  };
  if (samples.length < 2) return empty;

  const magnitudes = samples.map((s) => s.magnitude);
  const mean = average(magnitudes);
  const variance = average(magnitudes.map((m) => (m - mean) ** 2));
  const rms = Math.sqrt(average(magnitudes.map((m) => m * m)));
  const peak = Math.max(...magnitudes);
  const energy = magnitudes.reduce((a, m) => a + m * m, 0);

  const windowMs = samples[samples.length - 1].timestampMs - samples[0].timestampMs;
  const seconds = Math.max(windowMs / 1000, 0.001);
  const meanInterval = windowMs / (samples.length - 1);

  const axisReversals: [number, number, number] = [0, 0, 0];
  const lastSign: [number, number, number] = [0, 0, 0];
  const crossingTimesByAxis: number[][] = [[], [], []];
  const axes = ['x', 'y', 'z'] as const;
  for (const s of samples) {
    for (let i = 0; i < 3; i++) {
      const value = s.dynamic[axes[i]];
      const sign = value > config.zeroCrossDeadband
        ? 1 : value < -config.zeroCrossDeadband ? -1 : 0;
      if (sign !== 0) {
        if (lastSign[i] !== 0 && sign !== lastSign[i]) {
          axisReversals[i]++;
          crossingTimesByAxis[i].push(s.timestampMs);
        }
        lastSign[i] = sign;
      }
    }
  }

  // Frequency from axis reversals. Magnitude-based crossings fail for circular
  // motion where total magnitude stays nearly constant. Per axis, a sine wave
  // crosses zero twice per cycle.
  const totalReversals = axisReversals[0] + axisReversals[1] + axisReversals[2];
  const zeroCrossingRate = totalReversals / (3 * seconds);
  const dominantFrequencyHz = zeroCrossingRate / 2;

  // Regularity: how evenly spaced the crossings are on each axis.
  const regularities: number[] = [];
  for (const times of crossingTimesByAxis) {
    if (times.length < 3) continue;
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    const gapMean = average(gaps);
    if (gapMean > 0) regularities.push(Math.max(0, 1 - stdDev(gaps, gapMean) / gapMean));
  }
  const regularity = regularities.length ? average(regularities) : 0;

  // Consistency: local peaks with similar amplitude indicate a repeating pattern.
  const std = stdDev(magnitudes, mean);
  const threshold = mean + 0.5 * std;
  const peakAmplitudes: number[] = [];
  for (let i = 1; i < magnitudes.length - 1; i++) {
    if (magnitudes[i] > magnitudes[i - 1] &&
        magnitudes[i] >= magnitudes[i + 1] &&
        magnitudes[i] > threshold) {
      peakAmplitudes.push(magnitudes[i]);
    }
  }
  let consistency = 0;
  if (peakAmplitudes.length >= 3) {
    const peakMean = average(peakAmplitudes);
    if (peakMean > 0) {
      const cv = stdDev(peakAmplitudes, peakMean) / peakMean;
      consistency = Math.max(0, 1 - cv);
    }
  }

  // Duration of continuous above-noise motion.
  let motionDurationMs = 0;
  let runStart = -1;
  for (let i = 0; i < magnitudes.length; i++) {
    const moving = magnitudes[i] > Math.max(config.zeroCrossDeadband, config.calmPeakMax * 0.6);
    if (moving && runStart < 0) runStart = samples[i].timestampMs;
    if ((!moving || i === magnitudes.length - 1) && runStart >= 0) {
      motionDurationMs += samples[i].timestampMs - runStart;
      runStart = -1;
    }
  }

  let angularSum = 0;
  let angularCount = 0;
  for (const s of samples) {
    if (s.angular) {
      angularSum += magnitude(s.angular);
      angularCount++;
    }
  }
  const angularVelocity = angularCount ? angularSum / angularCount : 0;

  let quality: SignalQuality = 'GOOD';
  const degraded = samples.filter((s) => s.quality === 'DEGRADED').length;
  const poor = samples.filter((s) => s.quality === 'POOR').length;
  if (poor > samples.length * 0.1 || degraded > samples.length * 0.5) quality = 'POOR';
  else if (degraded > samples.length * 0.2 || meanInterval > (1000 / config.targetSampleHz) * config.maxStaleIntervalFactor) {
    quality = 'DEGRADED';
  }

  return {
    windowMs,
    sampleCount: samples.length,
    peakAcceleration: peak,
    rmsAcceleration: rms,
    variance,
    energy,
    zeroCrossingRate,
    dominantFrequencyHz,
    oscillationConsistency: consistency,
    signalRegularity: regularity,
    motionDurationMs,
    angularVelocity,
    signalQuality: quality,
    axisReversals,
  };
}

