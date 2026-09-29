// Ramp test: one-minute steps that climb until the rider can't hold them. FTP ≈ 75% of the best
// one-minute power, the same convention Zwift and TrainerRoad use. Fits ERG well: the trainer
// holds each step, so the test ends at physiology, not pacing.

import type { Sample } from './session';
import { minutes, ramp, Segment, Step, steady, Workout } from './workout';

export const RAMP_START = 0.55;
export const RAMP_INCREMENT = 0.06;
/** Enough to reach ~2× FTP; nobody with a sensible FTP gets there. */
export const RAMP_STEPS = 24;
/** FTP as a fraction of best one-minute power. */
export const RAMP_FTP_FACTOR = 0.75;

/** Below this share of the step's target, the rider is failing. */
export const FAIL_FRACTION = 0.85;
/** ...for this long, and the test is over. */
export const FAIL_SECONDS = 10;

export function rampTestWorkout(): Workout {
  const steps: Step[] = [ramp(minutes(5), 0.45, 0.55, 'Warm up')];
  for (let i = 0; i < RAMP_STEPS; i++) {
    steps.push(steady(60, Math.round((RAMP_START + RAMP_INCREMENT * i) * 100) / 100, `Step ${i + 1}`));
  }
  steps.push(ramp(minutes(5), 0.55, 0.4, 'Cool down'));
  return {
    id: 'ramp-test',
    name: 'Ramp Test',
    description: 'One-minute steps that keep climbing until you can’t. Sets your FTP. Usually 20–25 minutes; best in ERG.',
    steps,
    test: { kind: 'ramp', first: 1, last: RAMP_STEPS },
  };
}

export const inTestRange = (w: Workout, seg: Segment | undefined) => !!w.test && !!seg && seg.index >= w.test.first && seg.index <= w.test.last;

export interface RampTestResult {
  bestMinuteW: number;
  ftp: number;
  /** Last step reached (1-based). */
  steps: number;
  /** Rode every step without failing: the FTP is a floor, not an estimate. */
  topped: boolean;
}

/** `endedAt` is the ride time the test stopped (failure or "I'm done"); undefined if it ran out. */
export function rampTestResult(w: Workout, segments: Segment[], samples: Sample[], endedAt?: number): RampTestResult | undefined {
  if (!w.test) return undefined;
  const start = segments[w.test.first].start;
  const end = endedAt ?? segments[w.test.last].end;
  const watts = samples.filter((s) => s.t >= start && s.t < end).map((s) => s.power);
  if (watts.length < 60) return undefined;
  let sum = watts.slice(0, 60).reduce((a, b) => a + b, 0);
  let best = sum;
  for (let i = 60; i < watts.length; i++) {
    sum += watts[i] - watts[i - 60];
    best = Math.max(best, sum);
  }
  const bestMinuteW = Math.round(best / 60);
  const lastSeg = segments.find((s) => end - 1e-6 >= s.start && end - 1e-6 < s.end);
  return {
    bestMinuteW,
    ftp: Math.round(bestMinuteW * RAMP_FTP_FACTOR),
    steps: lastSeg ? Math.min(w.test.last, lastSeg.index) - w.test.first + 1 : w.test.last - w.test.first + 1,
    topped: endedAt === undefined,
  };
}
