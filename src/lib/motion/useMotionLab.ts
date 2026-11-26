import { useCallback, useEffect, useRef, useState } from 'react';

import { generateDataset, type DatasetName } from './datasets.ts';
import { motionConfig, type Sensitivity } from './config.ts';
import { MotionDetectionEngine } from './engine.ts';
import { MotionSensorService } from './sensorService.ts';
import { FCMPlugin } from '../fcm.ts';
import type {
  DetectionState, MotionCategory, MotionEvent, MotionSample, SensorInfo,
} from './types.ts';
import type { EngineDiagnostics } from './engine.ts';

export interface LabSnapshot {
  state: DetectionState;
  classification: MotionCategory | null;
  confidence: number;
  reasons: string[];
  peak: number;
  rms: number;
  frequency: number;
  samplingHz: number;
  ax: number;
  ay: number;
  az: number;
  magnitude: number;
  latestTimestamp: number;
  sensor: SensorInfo;
  engine: EngineDiagnostics;
  history: MotionEvent[];
}

const EMPTY_SNAPSHOT: LabSnapshot = {
  state: 'IDLE',
  classification: null,
  confidence: 0,
  reasons: [],
  peak: 0,
  rms: 0,
  frequency: 0,
  samplingHz: 0,
  ax: 0,
  ay: 0,
  az: 0,
  magnitude: 0,
  latestTimestamp: 0,
  sensor: { available: false, source: 'unknown', running: false, received: 0, dropped: 0, measuredHz: 0, lastIntervalMs: 0 },
  engine: {
    state: 'IDLE', bufferedSamples: 0, classifications: 0, qualifyingWindows: 0,
    lastClassification: null, lastConfidence: 0, lastReasons: [], cooldownRemainingMs: 0,
    accepted: 0, rejected: 0, testMode: false,
  },
  history: [],
};

/**
 * Integration layer between the UI-independent motion engine and the Lab
 * screen. Updates React state at most 4×/second to avoid re-render storms.
 */
export function useMotionLab(onAccepted?: (event: MotionEvent) => void) {
  const engineRef = useRef<MotionDetectionEngine | null>(null);
  const sensorRef = useRef<MotionSensorService | null>(null);
  const recordingRef = useRef<MotionSample[]>([]);
  const lastSampleRef = useRef<MotionSample | null>(null);
  const acceptedRef = useRef(onAccepted);
  acceptedRef.current = onAccepted;

  const [snapshot, setSnapshot] = useState<LabSnapshot>(EMPTY_SNAPSHOT);
  const [testMode, setTestModeState] = useState(true); // Lab starts in TEST MODE.
  const [monitoring, setMonitoring] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sensitivity, setSensitivityState] = useState<Sensitivity>('medium');
  const [lastDataset, setLastDataset] = useState<DatasetName | null>(null);

  if (!engineRef.current) engineRef.current = new MotionDetectionEngine(motionConfig(), true);
  if (!sensorRef.current) sensorRef.current = new MotionSensorService();

  const refresh = useCallback(() => {
    const engine = engineRef.current;
    const sensor = sensorRef.current;
    if (!engine || !sensor) return;
    const d = engine.getDiagnostics();
    const last = engine.getHistory(1)[0];
    const raw = lastSampleRef.current;
    setSnapshot({
      state: engine.state,
      classification: d.lastClassification,
      confidence: d.lastConfidence,
      reasons: d.lastReasons,
      peak: last?.peakAcceleration ?? 0,
      rms: last?.rmsAcceleration ?? 0,
      frequency: last?.dominantFrequencyHz ?? 0,
      samplingHz: sensor.getInfo().measuredHz,
      ax: raw?.ax ?? 0,
      ay: raw?.ay ?? 0,
      az: raw?.az ?? 0,
      magnitude: raw ? Math.hypot(raw.ax, raw.ay, raw.az) : 0,
      latestTimestamp: last?.timestampMs ?? 0,
      sensor: sensor.getInfo(),
      engine: d,
      history: [...engine.getHistory()].reverse(),
    });
  }, []);

  useEffect(() => {
    void FCMPlugin.setMotionTestMode({ enabled: testMode }).catch(() => {});
  }, [testMode]);

  useEffect(() => {
    const level = sensitivity === 'low' ? 0 : sensitivity === 'high' ? 2 : 1;
    void FCMPlugin.setMotionSensitivity({ level }).catch(() => {});
  }, [sensitivity]);

  useEffect(() => {
    const sensor = sensorRef.current;
    if (!sensor) return;
    const unsubscribe = sensor.onSample((sample) => {
      lastSampleRef.current = sample;
      const event = engineRef.current?.ingest(sample);
      if (recordingRef.current.length < 5000) recordingRef.current.push(sample);
      if (event && !engineRef.current?.isTestMode) acceptedRef.current?.(event);
    });
    const timer = setInterval(refresh, 250);
    return () => {
      unsubscribe();
      clearInterval(timer);
      sensor.stop();
      void FCMPlugin.stopShakeDetection().catch(() => {});
    };
  }, [refresh]);

  const startMonitoring = useCallback(async () => {
    const sensor = sensorRef.current;
    if (!sensor) return;
    sensor.attachNativeBridge();
    sensor.start('native');
    setMonitoring(true);
    try {
      await FCMPlugin.startShakeDetection();
    } catch (e) {
      console.warn('[motion] native monitor start failed', e);
    }
    refresh();
  }, [refresh]);

  const stopMonitoring = useCallback(async () => {
    sensorRef.current?.stop();
    setMonitoring(false);
    try {
      await FCMPlugin.stopShakeDetection();
    } catch { /* ignore */ }
    refresh();
  }, [refresh]);

  const simulate = useCallback((name: DatasetName) => {
    const sensor = sensorRef.current;
    if (!sensor) return;
    sensor.stop();
    const dataset = generateDataset(name);
    setLastDataset(name);
    setMonitoring(false);
    sensor.start('simulated');
    sensor.replay(dataset.samples, false, () => {
      setMonitoring(false);
      refresh();
    });
    refresh();
  }, [refresh]);

  const setTestMode = useCallback((enabled: boolean) => {
    setTestModeState(enabled);
    engineRef.current?.setTestMode(enabled);
    refresh();
  }, [refresh]);

  const setSensitivity = useCallback((value: Sensitivity) => {
    setSensitivityState(value);
    engineRef.current?.setConfig(motionConfig(value));
    engineRef.current?.setTestMode(testMode);
    refresh();
  }, [refresh, testMode]);

  const clearHistory = useCallback(() => {
    engineRef.current?.reset();
    engineRef.current?.setTestMode(testMode);
    recordingRef.current = [];
    lastSampleRef.current = null;
    refresh();
  }, [refresh, testMode]);

  const exportJson = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      testMode,
      sensitivity,
      dataset: lastDataset,
      diagnostics: engineRef.current?.getDiagnostics(),
      history: engineRef.current?.getHistory(),
      recording: recordingRef.current,
    };
    return JSON.stringify(payload, null, 2);
  }, [testMode, sensitivity, lastDataset]);

  const setRecordingState = useCallback((value: boolean) => {
    if (!value) recordingRef.current = [];
    setRecording(value);
  }, []);

  return {
    snapshot,
    testMode,
    monitoring,
    recording,
    sensitivity,
    lastDataset,
    startMonitoring,
    stopMonitoring,
    simulate,
    setTestMode,
    setSensitivity,
    clearHistory,
    exportJson,
    setRecordingState,
    refresh,
  };
}
