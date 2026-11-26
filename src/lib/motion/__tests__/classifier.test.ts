import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyMotion } from '../classifier.ts';
import { motionConfig } from '../config.ts';
import { extractFeatures } from '../features.ts';
import type { FilteredSample, MotionCategory } from '../types.ts';

const config = motionConfig();

function makeSamples(
  fn: (t: number) => { x: number; y: number; z: number; g?: number },
  count = 150,
  dt = 20,
): FilteredSample[] {
  const out: FilteredSample[] = [];
  for (let i = 0; i < count; i++) {
    const t = i * dt;
    const v = fn(t);
    const magnitude = Math.hypot(v.x, v.y, v.z);
    out.push({
      timestampMs: t,
      dynamic: { x: v.x, y: v.y, z: v.z },
      gravity: { x: 0, y: 9.81, z: 0 },
      magnitude,
      angular: v.g === undefined ? null : { x: 0, y: 0, z: v.g },
      quality: 'GOOD',
      outlier: false,
    });
  }
  return out;
}

function classify(samples: FilteredSample[]): MotionCategory {
  return classifyMotion(extractFeatures(samples, config), config).classification;
}

test('stationary phone is NORMAL_ACTIVITY or UNKNOWN, never a motion event', () => {
  const samples = makeSamples(() => ({ x: 0.02, y: 0.02, z: 0.01 }));
  const result = classifyMotion(extractFeatures(samples, config), config);
  assert.notEqual(result.classification, 'SUSTAINED_OSCILLATION');
});

test('regular walking-like motion with rotation is NORMAL_ACTIVITY', () => {
  const samples = makeSamples((t) => {
    const v = Math.sin((2 * Math.PI * 2 * t) / 1000) * 1.1;
    return { x: v, y: v * 0.6, z: 0, g: Math.cos((2 * Math.PI * 2 * t) / 1000) * 1.5 };
  });
  assert.equal(classify(samples), 'NORMAL_ACTIVITY');
});

test('isolated impact is SUDDEN_IMPACT, not sustained oscillation', () => {
  const samples = makeSamples((t) => {
    if (t >= 1000 && t < 1040) return { x: 14, y: 12, z: 8 };
    return { x: 0.02, y: 0.01, z: 0.01 };
  });
  const result = classifyMotion(extractFeatures(samples, config), config);
  assert.equal(result.classification, 'SUDDEN_IMPACT');
});

test('high-frequency consistent vibration is PERIODIC_VIBRATION', () => {
  const samples = makeSamples((t) => {
    const v = Math.sin((2 * Math.PI * 14 * t) / 1000) * 1.6;
    return { x: v, y: v, z: v * 0.5 };
  });
  assert.equal(classify(samples), 'PERIODIC_VIBRATION');
});

test('sustained 4 Hz multi-axis oscillation is SUSTAINED_OSCILLATION', () => {
  const samples = makeSamples((t) => {
    const phase = (2 * Math.PI * 4 * t) / 1000;
    return { x: Math.sin(phase) * 3.4, y: Math.cos(phase) * 3.2, z: Math.sin(phase * 0.9) * 2.6 };
  });
  const features = extractFeatures(samples, config);
  const result = classifyMotion(features, config);
  assert.equal(result.classification, 'SUSTAINED_OSCILLATION', JSON.stringify(features));
  assert.ok(result.confidence >= config.confidenceMin);
  assert.ok(result.reasons.length > 0);
});

test('too few samples yields UNKNOWN', () => {
  const samples = makeSamples(() => ({ x: 4, y: 4, z: 4 }), 5);
  assert.equal(classify(samples), 'UNKNOWN');
});
