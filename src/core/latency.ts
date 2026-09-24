// Measuring and compensating trainer latency.

import { Segment, segmentAt, targetAt } from './workout';

/** A target change bigger than this (fraction of FTP) is a step, not part of a ramp. */
const STEP = 0.03;

/**
 * ERG target with lead: if a step change is coming within `leadS` seconds, command it now,
 * so the trainer's control loop (1–3 s to settle) lands the new power on the boundary.
 * Ramps and gentle transitions are left alone. Returns a fraction of FTP.
 */
export function leadTarget(segments: Segment[], t: number, leadS: number): number | null {
  const cur = segmentAt(segments, t);
  const ahead = segmentAt(segments, t + leadS);
  if (cur && ahead && ahead.index !== cur.index && Math.abs(ahead.from - cur.to) > STEP) return ahead.from;
  return targetAt(segments, t);
}

/** Rolling notification rate and freshness for a sensor. */
export class RateMeter {
  private times: number[] = [];

  constructor(private readonly windowMs = 5000) {}

  mark(nowMs: number) {
    this.times.push(nowMs);
    while (this.times.length && this.times[0] < nowMs - this.windowMs) this.times.shift();
  }

  hz(nowMs: number): number {
    const recent = this.times.filter((t) => t >= nowMs - this.windowMs);
    if (recent.length < 2) return 0;
    return (recent.length - 1) / ((recent[recent.length - 1] - recent[0]) / 1000);
  }

  ageMs(nowMs: number): number | undefined {
    return this.times.length ? nowMs - this.times[this.times.length - 1] : undefined;
  }
}

/**
 * ERG step response: time from commanding a big target change until measured power first
 * lands within tolerance of it. This is what ERG lead should roughly match.
 */
export class StepResponse {
  readonly samples: number[] = [];
  private pending?: { target: number; at: number };
  private lastCommand?: number;

  constructor(
    private readonly minStepW = 25,
    private readonly timeoutMs = 15_000,
  ) {}

  command(watts: number, nowMs: number) {
    if (this.lastCommand !== undefined && Math.abs(watts - this.lastCommand) >= this.minStepW) {
      this.pending = { target: watts, at: nowMs };
    }
    this.lastCommand = watts;
  }

  reading(powerW: number, nowMs: number) {
    const p = this.pending;
    if (!p) return;
    if (nowMs - p.at > this.timeoutMs) {
      this.pending = undefined;
    } else if (Math.abs(powerW - p.target) <= Math.max(p.target * 0.05, 8)) {
      this.samples.push(nowMs - p.at);
      if (this.samples.length > 10) this.samples.shift();
      this.pending = undefined;
    }
  }

  get last(): number | undefined {
    return this.samples[this.samples.length - 1];
  }

  get average(): number | undefined {
    return this.samples.length ? this.samples.reduce((a, b) => a + b, 0) / this.samples.length : undefined;
  }
}
