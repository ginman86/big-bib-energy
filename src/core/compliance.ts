// "Am I hitting the target?" — classification and per-segment accounting.

export type Band = 'under' | 'on' | 'over';

export interface Tolerance {
  /** Fraction of target, e.g. 0.05 = ±5%. */
  pct: number;
  /** Floor in watts so low targets (recoveries) aren't impossibly tight. */
  minWatts: number;
}

export const DEFAULT_TOLERANCE: Tolerance = { pct: 0.05, minWatts: 8 };

export const bandHalfWidth = (targetW: number, tol: Tolerance = DEFAULT_TOLERANCE) =>
  Math.max(targetW * tol.pct, tol.minWatts);

export function classify(powerW: number, targetW: number, tol: Tolerance = DEFAULT_TOLERANCE): Band {
  const half = bandHalfWidth(targetW, tol);
  if (powerW < targetW - half) return 'under';
  if (powerW > targetW + half) return 'over';
  return 'on';
}

export interface SegmentStats {
  segmentIndex: number;
  seconds: number;
  on: number;
  under: number;
  over: number;
  /** Time-weighted sums, for averages. */
  powerSum: number;
  targetSum: number;
}

export const emptyStats = (segmentIndex: number): SegmentStats => ({
  segmentIndex,
  seconds: 0,
  on: 0,
  under: 0,
  over: 0,
  powerSum: 0,
  targetSum: 0,
});

export function accumulate(stats: SegmentStats, band: Band, powerW: number, targetW: number, dt: number) {
  stats.seconds += dt;
  stats[band] += dt;
  stats.powerSum += powerW * dt;
  stats.targetSum += targetW * dt;
}

/** Share of time spent in the band, 0..1. */
export const compliance = (s: Pick<SegmentStats, 'seconds' | 'on'>) => (s.seconds > 0 ? s.on / s.seconds : 0);

export const avgPower = (s: SegmentStats) => (s.seconds > 0 ? s.powerSum / s.seconds : 0);

export function combine(all: SegmentStats[]): SegmentStats {
  const total = emptyStats(-1);
  for (const s of all) {
    total.seconds += s.seconds;
    total.on += s.on;
    total.under += s.under;
    total.over += s.over;
    total.powerSum += s.powerSum;
    total.targetSum += s.targetSum;
  }
  return total;
}
