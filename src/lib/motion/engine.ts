import { classifyMotion } from './classifier.ts';
import type { ClassificationContext } from './classifier.ts';
import { MotionFilter } from './filter.ts';
import { extractFeatures } from './features.ts';
import { MotionStateMachine } from './stateMachine.ts';
import type {
  DetectionState, FilteredSample, MotionCategory, MotionConfig, MotionEvent,
  MotionFeatures, MotionSample,
} from './types.ts';

const MAX_HISTORY = 60;
const QUALIFYING_WINDOWS_REQUIRED = 2;

export interface EngineDiagnostics {
  state: DetectionState;
  bufferedSamples: number;
  classifications: number;
  qualifyingWindows: number;
  lastClassification: MotionCategory | null;
  lastConfidence: number;
  lastReasons: string[];
  cooldownRemainingMs: number;
  accepted: number;
  rejected: number;
  testMode: boolean;
}

/**
 * UI-independent detection engine. Owns the rolling window, state machine,
 * deduplication and cooldown. Never sends notifications — it returns accepted
 * events to the caller, tagged `simulated` in TEST MODE.
 */
export class MotionDetectionEngine {
  private config: MotionConfig;
  private filter: MotionFilter;
  private stateMachine = new MotionStateMachine();
  private buffer: FilteredSample[] = [];
  private previousFeatures: MotionFeatures[] = [];
  private history: MotionEvent[] = [];
  private lastAcceptedAt = Number.NEGATIVE_INFINITY;
  private lastSignature = '';
  private qualifyingWindows = 0;
  private classifications = 0;
  private accepted = 0;
  private rejected = 0;
  private testMode: boolean;

  private lastClassification: MotionCategory | null = null;
  private lastConfidence = 0;
  private lastReasons: string[] = [];

  constructor(config: MotionConfig, testMode = false) {
    this.config = config;
    this.filter = new MotionFilter(config);
    this.testMode = testMode;
  }

  setConfig(config: MotionConfig): void {
    this.config = config;
    this.filter = new MotionFilter(config);
    this.reset();
  }

  setTestMode(enabled: boolean): void {
    this.testMode = enabled;
  }

  get isTestMode(): boolean { return this.testMode; }

  reset(): void {
    this.buffer = [];
    this.previousFeatures = [];
    this.stateMachine.reset();
    this.filter.reset();
    this.lastAcceptedAt = Number.NEGATIVE_INFINITY;
    this.lastSignature = '';
    this.qualifyingWindows = 0;
    this.classifications = 0;
    this.accepted = 0;
    this.rejected = 0;
    this.lastClassification = null;
    this.lastConfidence = 0;
    this.lastReasons = [];
  }

  get state(): DetectionState { return this.stateMachine.current; }

  /** Feed one raw sample. Returns an event only when one is accepted. */
  ingest(sample: MotionSample): MotionEvent | null {
    const filtered = this.filter.process(sample);
    if (!filtered) {
      this.stateMachine.transition('ERROR');
      this.lastReasons = ['Invalid or out-of-order sensor reading'];
      return null;
    }
    if (this.stateMachine.current === 'ERROR') this.stateMachine.transition('COLLECTING');
    if (this.stateMachine.current === 'IDLE') this.stateMachine.transition('COLLECTING');

    this.buffer.push(filtered);
    const span = this.buffer.length > 1
      ? filtered.timestampMs - this.buffer[0].timestampMs
      : 0;
    if (span < this.config.windowMs || this.buffer.length < this.config.minConsecutiveSamples) {
      return null;
    }

    this.stateMachine.transition('ANALYZING');
    const features = extractFeatures(this.buffer, this.config);
    const context: ClassificationContext = { previousFeatures: this.previousFeatures };
    const result = classifyMotion(features, this.config, context);

    this.classifications++;
    this.lastClassification = result.classification;
    this.lastConfidence = result.confidence;
    this.lastReasons = result.reasons;

    const event = this.evaluate(features, result.classification, result.confidence, result.reasons);

    this.previousFeatures.push(features);
    if (this.previousFeatures.length > 3) this.previousFeatures.shift();

    // Slide forward by half a window so overlapping patterns are seen without
    // re-analysing the exact same buffer.
    const cutoff = filtered.timestampMs - Math.floor(this.config.windowMs / 2);
    this.buffer = this.buffer.filter((s) => s.timestampMs >= cutoff);

    return event;
  }

  private evaluate(
    features: MotionFeatures,
    classification: MotionCategory,
    confidence: number,
    reasons: string[],
  ): MotionEvent | null {
    const now = features.windowMs > 0
      ? this.buffer[this.buffer.length - 1].timestampMs
      : Date.now();

    let accepted = false;
    let decisionReason = reasons[0] ?? 'No reason recorded';

    switch (classification) {
      case 'NORMAL_ACTIVITY':
        this.qualifyingWindows = 0;
        this.stateMachine.transition('NORMAL_ACTIVITY');
        decisionReason = 'Classified as ordinary activity';
        break;
      case 'SUDDEN_IMPACT':
        this.qualifyingWindows = 0;
        this.stateMachine.transition('IMPACT_DETECTED');
        decisionReason = 'Isolated impact — not sustained motion';
        break;
      case 'PERIODIC_VIBRATION':
        this.qualifyingWindows = 0;
        this.stateMachine.transition('VIBRATION_DETECTED');
        decisionReason = 'Periodic vibration analysed separately';
        break;
      case 'SUSTAINED_OSCILLATION': {
        this.stateMachine.transition('SUSTAINED_MOTION_CANDIDATE');
        this.qualifyingWindows++;
        const cooldownOk = now - this.lastAcceptedAt >= this.config.cooldownMs;
        const signature = `${classification}:${Math.floor(now / this.config.cooldownMs)}`;
        const duplicate = signature === this.lastSignature;
        if (
          this.qualifyingWindows >= QUALIFYING_WINDOWS_REQUIRED &&
          features.motionDurationMs >= this.config.minSustainedMs &&
          confidence >= this.config.confidenceMin &&
          cooldownOk && !duplicate
        ) {
          this.stateMachine.transition('MOTION_EVENT_ACCEPTED');
          this.stateMachine.transition('COOLDOWN');
          this.lastAcceptedAt = now;
          this.lastSignature = signature;
          this.qualifyingWindows = 0;
          accepted = true;
          decisionReason = 'Sustained oscillation confirmed across consecutive windows';
        } else {
          decisionReason = cooldownOk
            ? 'Candidate accepted for additional evidence'
            : 'Cooldown active — duplicate event suppressed';
        }
        break;
      }
      case 'UNKNOWN':
      default:
        this.qualifyingWindows = 0;
        this.stateMachine.transition('COLLECTING');
        decisionReason = reasons[0] ?? 'Insufficient sensor evidence';
        break;
    }

    const event: MotionEvent = {
      id: `motion-${now}-${this.classifications}`,
      timestampMs: now,
      classification,
      accepted,
      confidence,
      durationMs: features.motionDurationMs,
      peakAcceleration: features.peakAcceleration,
      rmsAcceleration: features.rmsAcceleration,
      dominantFrequencyHz: features.dominantFrequencyHz,
      reason: decisionReason,
      simulated: this.testMode,
    };

    this.history.push(event);
    if (this.history.length > MAX_HISTORY) this.history.shift();

    if (accepted) this.accepted++;
    else this.rejected++;

    return accepted ? event : null;
  }

  getHistory(limit = MAX_HISTORY): readonly MotionEvent[] {
    return this.history.slice(-limit);
  }

  getDiagnostics(): EngineDiagnostics {
    const remaining = Math.max(0, this.config.cooldownMs - (Date.now() - this.lastAcceptedAt));
    return {
      state: this.stateMachine.current,
      bufferedSamples: this.buffer.length,
      classifications: this.classifications,
      qualifyingWindows: this.qualifyingWindows,
      lastClassification: this.lastClassification,
      lastConfidence: this.lastConfidence,
      lastReasons: [...this.lastReasons],
      cooldownRemainingMs: remaining,
      accepted: this.accepted,
      rejected: this.rejected,
      testMode: this.testMode,
    };
  }
}
