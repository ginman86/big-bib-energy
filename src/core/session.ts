// A ride in progress. Time is driven by the caller via advance(dt, reading),
// which keeps this deterministic, testable, and independent of any clock.

import { accumulate, avgPower, Band, classify, combine, compliance, DEFAULT_TOLERANCE, emptyStats, SegmentStats, Tolerance } from './compliance';
import { intensityFactor, mean, normalizedPower, trainingStress } from './metrics';
import { expand, Segment, segmentAt, targetAt, totalDuration, Workout } from './workout';

export interface Reading {
  power: number;
  cadence?: number;
  heartRate?: number;
}

/** One recorded point per second of ride time. */
export interface Sample {
  t: number;
  power: number;
  target: number;
  cadence?: number;
  heartRate?: number;
}

export type Status = 'ready' | 'running' | 'paused' | 'finished';

export interface Snapshot {
  elapsed: number;
  duration: number;
  segment: Segment | undefined;
  next: Segment | undefined;
  segmentRemaining: number;
  targetW: number;
  /** 3 s smoothed power — what the rider should react to. */
  powerW: number;
  band: Band;
  /** In the grace window after a target change; time isn't scored. */
  settling: boolean;
  cadence?: number;
  heartRate?: number;
  segmentCompliance: number;
  totalCompliance: number;
}

export interface SegmentSummary {
  segment: Segment;
  targetW: number;
  avgPowerW: number;
  compliance: number;
  under: number;
  over: number;
}

export interface RideSummary {
  workoutId: string;
  workoutName: string;
  ftp: number;
  seconds: number;
  avgPower: number;
  normalizedPower: number;
  intensityFactor: number;
  tss: number;
  compliance: number;
  avgHeartRate?: number;
  avgCadence?: number;
  segments: SegmentSummary[];
}

const SMOOTHING_SECONDS = 3;

export class Session {
  readonly segments: Segment[];
  readonly duration: number;
  readonly samples: Sample[] = [];
  readonly stats: SegmentStats[];
  status: Status = 'ready';
  elapsed = 0;

  private window: { t: number; power: number }[] = [];
  private nextSampleAt = 0;
  private last: Reading = { power: 0 };
  private unscored = false;

  constructor(
    readonly workout: Workout,
    readonly ftp: number,
    readonly tolerance: Tolerance = DEFAULT_TOLERANCE,
    readonly graceSeconds = 5,
  ) {
    this.segments = expand(workout);
    this.duration = totalDuration(this.segments);
    this.stats = this.segments.map((s) => emptyStats(s.index));
  }

  start() {
    if (this.status === 'ready' || this.status === 'paused') this.status = 'running';
  }

  pause() {
    if (this.status === 'running') this.status = 'paused';
  }

  finish() {
    this.status = 'finished';
  }

  targetWatts(t = this.elapsed): number {
    const f = targetAt(this.segments, Math.min(t, this.duration - 1e-6));
    return f === null ? 0 : Math.round(f * this.ftp);
  }

  /** Jump to the start of the next segment. */
  skip() {
    const seg = segmentAt(this.segments, this.elapsed);
    if (!seg) return;
    this.elapsed = seg.end;
    this.nextSampleAt = Math.ceil(this.elapsed);
    this.window = [];
    if (this.elapsed >= this.duration) this.finish();
  }

  /** `unscored`: time that shouldn't count against the rider (e.g. ERG still engaging). */
  advance(dt: number, reading: Reading, { unscored = false } = {}): Snapshot {
    this.last = reading;
    this.unscored = unscored;
    if (this.status !== 'running' || dt <= 0) return this.snapshot();

    const seg = segmentAt(this.segments, this.elapsed);
    const targetW = this.targetWatts();

    this.window.push({ t: this.elapsed, power: reading.power });
    while (this.window.length && this.window[0].t < this.elapsed - SMOOTHING_SECONDS) this.window.shift();

    if (seg && !unscored && !this.isSettling(seg)) {
      const band = classify(this.smoothedPower(), targetW, this.tolerance);
      accumulate(this.stats[seg.index], band, reading.power, targetW, dt);
    }

    const end = this.elapsed + dt;
    while (this.nextSampleAt < end && this.nextSampleAt < this.duration) {
      this.samples.push({
        t: this.nextSampleAt,
        power: reading.power,
        target: this.targetWatts(this.nextSampleAt),
        cadence: reading.cadence,
        heartRate: reading.heartRate,
      });
      this.nextSampleAt++;
    }

    this.elapsed = Math.min(end, this.duration);
    if (this.elapsed >= this.duration) this.finish();
    return this.snapshot();
  }

  snapshot(): Snapshot {
    const seg = segmentAt(this.segments, this.elapsed);
    const next = seg ? this.segments[seg.index + 1] : undefined;
    const targetW = this.targetWatts();
    const powerW = this.smoothedPower();
    return {
      elapsed: this.elapsed,
      duration: this.duration,
      segment: seg,
      next,
      segmentRemaining: seg ? seg.end - this.elapsed : 0,
      targetW,
      powerW,
      band: classify(powerW, targetW, this.tolerance),
      settling: this.unscored || (seg ? this.isSettling(seg) : false),
      cadence: this.last.cadence,
      heartRate: this.last.heartRate,
      segmentCompliance: seg ? compliance(this.stats[seg.index]) : 0,
      totalCompliance: compliance(combine(this.stats)),
    };
  }

  summary(): RideSummary {
    const watts = this.samples.map((s) => s.power);
    const np = normalizedPower(watts);
    const hr = this.samples.flatMap((s) => (s.heartRate ? [s.heartRate] : []));
    const cad = this.samples.flatMap((s) => (s.cadence ? [s.cadence] : []));
    return {
      workoutId: this.workout.id,
      workoutName: this.workout.name,
      ftp: this.ftp,
      seconds: this.samples.length,
      avgPower: mean(watts),
      normalizedPower: np,
      intensityFactor: intensityFactor(np, this.ftp),
      tss: trainingStress(this.samples.length, np, this.ftp),
      compliance: compliance(combine(this.stats)),
      avgHeartRate: hr.length ? mean(hr) : undefined,
      avgCadence: cad.length ? mean(cad) : undefined,
      segments: this.segments.map((segment, i) => {
        const s = this.stats[i];
        return {
          segment,
          targetW: s.seconds > 0 ? s.targetSum / s.seconds : Math.round(segment.from * this.ftp),
          avgPowerW: avgPower(s),
          compliance: compliance(s),
          under: s.seconds > 0 ? s.under / s.seconds : 0,
          over: s.seconds > 0 ? s.over / s.seconds : 0,
        };
      }),
    };
  }

  private smoothedPower(): number {
    return this.window.length ? mean(this.window.map((w) => w.power)) : this.last.power;
  }

  /** Grace window at the start of a segment whose target jumps from the previous one. */
  private isSettling(seg: Segment): boolean {
    if (this.elapsed - seg.start >= this.graceSeconds) return false;
    const prev = this.segments[seg.index - 1];
    return !prev || Math.abs(prev.to - seg.from) > 0.03;
  }
}
