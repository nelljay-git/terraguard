import assert from 'node:assert/strict';
import test from 'node:test';

import { motionConfig } from '../config.ts';
import { generateAllDatasets } from '../datasets.ts';
import { MotionDetectionEngine } from '../engine.ts';
import type { DatasetName } from '../datasets.ts';

const expectedAccepted: Partial<Record<DatasetName, boolean>> = {
  SUSTAINED_OSCILLATION: true,
  STATIONARY: false,
  WALKING: false,
  RUNNING: false,
  PICKUP: false,
  PUT_DOWN: false,
  ROTATION: false,
  DROP: false,
  VIBRATION: false,
  MACHINERY: false,
  NOISY: false,
  INTERRUPTED: true, // valid sustained oscillation resumes after the gap
  IRREGULAR: false,
};

test('simulated datasets produce the expected experimental-event decisions', () => {
  const config = motionConfig();
  for (const dataset of generateAllDatasets()) {
    const engine = new MotionDetectionEngine(config, true);
    const events = dataset.samples
      .map((s) => engine.ingest(s))
      .filter((e) => e !== null);
    const expected = expectedAccepted[dataset.name] ?? false;
    assert.equal(
      events.length > 0,
      expected,
      `${dataset.name}: expected accepted=${expected}, got ${events.length} (${events.map((e) => e.classification).join(',')})`,
    );
    if (expected) assert.ok(events.every((e) => e.simulated));
  }
});
