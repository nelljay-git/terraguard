import type { DetectionState } from './types.ts';

const TRANSITIONS: Record<DetectionState, readonly DetectionState[]> = {
  IDLE: ['COLLECTING', 'ERROR'],
  COLLECTING: ['ANALYZING', 'IDLE', 'ERROR'],
  ANALYZING: [
    'NORMAL_ACTIVITY', 'IMPACT_DETECTED', 'VIBRATION_DETECTED',
    'SUSTAINED_MOTION_CANDIDATE', 'COLLECTING', 'ERROR',
  ],
  NORMAL_ACTIVITY: ['COLLECTING', 'IDLE', 'ERROR'],
  IMPACT_DETECTED: ['COOLDOWN', 'COLLECTING', 'ERROR'],
  VIBRATION_DETECTED: ['COOLDOWN', 'COLLECTING', 'ERROR'],
  SUSTAINED_MOTION_CANDIDATE: ['MOTION_EVENT_ACCEPTED', 'COLLECTING', 'COOLDOWN', 'ERROR'],
  MOTION_EVENT_ACCEPTED: ['COOLDOWN', 'ERROR'],
  COOLDOWN: ['IDLE', 'COLLECTING', 'ERROR'],
  ERROR: ['IDLE', 'COLLECTING'],
};

/**
 * Explicit detection state machine. A single spike can never jump straight
 * from IDLE to MOTION_EVENT_ACCEPTED.
 */
export class MotionStateMachine {
  private state: DetectionState = 'IDLE';

  get current(): DetectionState { return this.state; }

  isValid(from: DetectionState, to: DetectionState): boolean {
    return TRANSITIONS[from].includes(to);
  }

  transition(next: DetectionState): boolean {
    if (!this.isValid(this.state, next)) return false;
    this.state = next;
    return true;
  }

  reset(): void {
    this.state = 'IDLE';
  }
}
