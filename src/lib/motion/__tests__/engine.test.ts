import assert from 'node:assert/strict';
import test from 'node:test';

import { motionConfig } from '../config.ts';
import { MotionDetectionEngine } from '../engine.ts';
import { MotionStateMachine } from '../stateMachine.ts';
import type { MotionSample } from '../types.ts';

function oscillationSamples(count: number, startTime = 0, dt = 20): MotionSample[] {
  const out: MotionSample[] = [];
  for (let i = 0; i < count; i++) {
    const t = startTime + i * dt;
    const phase = (2 * Math.PI * 4 * t) / 1000;
    out.push({
      timestampMs: t,
      ax: Math.sin(phase) * 3.6,
      ay: Math.cos(phase) * 3.4,
      az: Math.sin(phase * 0.9) * 2.8,
      linear: true,
      source: 'simulated',
    });
  }
  return out;
}

test('state machine rejects IDLE -> MOTION_EVENT_ACCEPTED', () => {
  const sm = new MotionStateMachine();
  assert.equal(sm.current, 'IDLE');
  assert.equal(sm.transition('MOTION_EVENT_ACCEPTED'), false);
  assert.equal(sm.transition('COLLECTING'), true);
  assert.equal(sm.transition('ANALYZING'), true);
  assert.equal(sm.transition('SUSTAINED_MOTION_CANDIDATE'), true);
  assert.equal(sm.transition('MOTION_EVENT_ACCEPTED'), true);
  assert.equal(sm.transition('COOLDOWN'), true);
});

test('sustained oscillation produces exactly one accepted event', () => {
  const engine = new MotionDetectionEngine(motionConfig());
  const samples = oscillationSamples(400);
  const events = samples.map((s) => engine.ingest(s)).filter((e) => e !== null);
  assert.equal(events.length, 1, `got ${events.length}`);
  assert.equal(events[0].classification, 'SUSTAINED_OSCILLATION');
  assert.equal(events[0].accepted, true);
  assert.equal(events[0].simulated, false);
});

test('test mode tags events as simulated', () => {
  const engine = new MotionDetectionEngine(motionConfig(), true);
  const events = oscillationSamples(400)
    .map((s) => engine.ingest(s))
    .filter((e) => e !== null);
  assert.ok(events.length >= 1);
  assert.ok(events.every((e) => e.simulated));
});

test('invalid readings move the engine to ERROR and recover', () => {
  const engine = new MotionDetectionEngine(motionConfig());
  engine.ingest({
    timestampMs: 0, ax: NaN, ay: 0, az: 0, linear: true, source: 'simulated',
  });
  assert.equal(engine.state, 'ERROR');
  engine.ingest({
    timestampMs: 20, ax: 0, ay: 0, az: 0, linear: true, source: 'simulated',
  });
  assert.ok(['COLLECTING', 'IDLE'].includes(engine.state));
});

test('diagnostics expose explainable reasons', () => {
  const engine = new MotionDetectionEngine(motionConfig());
  oscillationSamples(400).forEach((s) => engine.ingest(s));
  const d = engine.getDiagnostics();
  assert.ok(d.classifications > 0);
  assert.ok(d.lastReasons.length > 0);
  assert.ok(d.accepted >= 1);
});
