import type { Reading } from '../core/session';

export type ControlMode = 'erg' | 'target';

/**
 * A power source + resistance unit. The app polls latest() each frame rather than
 * subscribing, so real and simulated trainers look identical to the ride loop.
 */
export interface Trainer {
  readonly name: string;
  readonly simulated: boolean;
  /** False for read-only power sources (a plain power meter): Target mode only. */
  readonly controllable: boolean;
  /** How it's controlled, for display: 'FTMS', 'Wahoo', 'Power meter', 'Simulated'. */
  readonly protocol: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  latest(): Reading;
  /** ERG: the trainer holds these watts. */
  setTargetPower(watts: number): Promise<void>;
  /** Target mode: fixed virtual road; the rider must produce the watts. */
  setGrade(gradePct: number): Promise<void>;
  /** Advance internal state by dt seconds of ride time (simulators only). */
  tick?(dt: number): void;
}
