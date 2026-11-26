import assert from 'node:assert/strict';
import test from 'node:test';

import { motionConfig } from '../config.ts';
import { MotionFilter } from '../filter.ts';
import type { MotionSample } from '../types.ts';

const sample = (t: number, ax: number, ay: number, az: number): MotionSample => ({
  timestampMs: t, ax, ay, az, linear: false, source: 'simulated',
});

test('gravity-included stationary samples produce near-zero dynamic acceleration', () => {
  const filter = new MotionFilter(motionConfig());
  for (let i = 0; i < 100; i++) {
    filter.process(sample(i * 20, 0.05, 9.8, -0.02));
  }
  const out = filter.process(sample(2000, 0, 9.81, 0));
  assert.ok(out);
  assert.ok(out.magnitude < 0.3, `magnitude ${out.magnitude}`);
  assert.ok(out.gravity.y > 8);
});

test('linear samples are not gravity-subtracted twice', () => {
  const filter = new MotionFilter(motionConfig());
  const out = filter.process({
    timestampMs: 0, ax: 3, ay: 0, az: 0, linear: true, source: 'simulated',
  });
  assert.ok(out);
  assert.equal(out.magnitude, 3);
  assert.equal(out.gravity.x, 0);
});

test('invalid readings are dropped and counted', () => {
  const filter = new MotionFilter(motionConfig());
  const bad = filter.process({ timestampMs: 0, ax: NaN, ay: 0, az: 0, linear: false, source: 'simulated' });
  assert.equal(bad, null);
  assert.equal(filter.droppedSamples, 1);
});

test('implausible spikes are clamped and marked degraded', () => {
  const filter = new MotionFilter(motionConfig());
  filter.process(sample(0, 0, 9.81, 0));
  const out = filter.process(sample(20, 1000, 9.81, 0));
  assert.ok(out);
  assert.equal(out.outlier, true);
  assert.equal(out.quality, 'DEGRADED');
  assert.ok(out.magnitude <= 80);
});
