// Workout model. Power is always expressed as a fraction of FTP (1.0 = FTP)
// so a workout is rider-independent; convert to watts at ride time.

export type Step =
  | { kind: 'steady'; duration: number; power: number; label?: string }
  | { kind: 'ramp'; duration: number; from: number; to: number; label?: string }
  /** No target: the trainer gives a flat road and the rider rides how they like. Not scored. */
  | { kind: 'free'; duration: number; label?: string };

/**
 * Nominal intensity for free-ride blocks, used only where a number is unavoidable (TSS estimates,
 * chart height, zone colour). Scoring, ERG and the ride screen treat free ride as untargeted.
 */
export const FREE_NOMINAL = 0.5;

export interface Workout {
  id: string;
  name: string;
  description: string;
  steps: Step[];
  /** Free ride on a course: no targets; the course's gradient sets the resistance. */
  freeRide?: boolean;
  /** A ramp test: steps `first`..`last` climb until the rider can't hold them (see core/ramp-test). */
  test?: { kind: 'ramp'; first: number; last: number };
}

/** A step placed on the workout timeline, in seconds from the start. */
export interface Segment {
  index: number;
  kind: Step['kind'];
  start: number;
  end: number;
  from: number;
  to: number;
  label: string;
}

export const isFree = (s: { kind: Step['kind'] } | undefined) => s?.kind === 'free';

export const free = (duration: number, label?: string): Step => ({ kind: 'free', duration, label });

export const steady = (duration: number, power: number, label?: string): Step => ({
  kind: 'steady',
  duration,
  power,
  label,
});

export const ramp = (duration: number, from: number, to: number, label?: string): Step => ({
  kind: 'ramp',
  duration,
  from,
  to,
  label,
});

/** Repeats `steps` n times, labelling each on/off pair "Interval i/n" / "Recover i/n". */
export function repeat(n: number, on: Step, off?: Step): Step[] {
  const out: Step[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({ ...on, label: on.label ?? `Interval ${i}/${n}` });
    if (off && i < n) out.push({ ...off, label: off.label ?? `Recover ${i}/${n}` });
  }
  return out;
}

export const minutes = (m: number) => m * 60;

export function expand(workout: Workout): Segment[] {
  let t = 0;
  return workout.steps.map((step, index) => {
    const from = step.kind === 'steady' ? step.power : step.kind === 'ramp' ? step.from : FREE_NOMINAL;
    const to = step.kind === 'steady' ? step.power : step.kind === 'ramp' ? step.to : FREE_NOMINAL;
    const seg: Segment = {
      index,
      kind: step.kind,
      start: t,
      end: t + step.duration,
      from,
      to,
      label: step.label ?? defaultLabel(step),
    };
    t += step.duration;
    return seg;
  });
}

function defaultLabel(step: Step): string {
  if (step.kind === 'ramp') return step.to > step.from ? 'Ramp up' : 'Ramp down';
  if (step.kind === 'free') return 'Free ride';
  return 'Steady';
}

export const totalDuration = (segments: Segment[]) =>
  segments.length ? segments[segments.length - 1].end : 0;

export function segmentAt(segments: Segment[], t: number): Segment | undefined {
  return segments.find((s) => t >= s.start && t < s.end);
}

/** Target as a fraction of FTP at time t, interpolating ramps. */
export function targetAt(segments: Segment[], t: number): number | null {
  const seg = segmentAt(segments, t);
  if (!seg) return null;
  const p = (t - seg.start) / (seg.end - seg.start);
  return seg.from + (seg.to - seg.from) * p;
}

export const peakFraction = (segments: Segment[]) =>
  segments.reduce((m, s) => Math.max(m, s.from, s.to), 0);
