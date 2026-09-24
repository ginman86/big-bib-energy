// Heart-rate zones anchored on LTHR (lactate threshold heart rate), the HR counterpart of FTP.
// Five zones after Friel's cycling LTHR zones, with 5a–5c merged into one.

import { mean } from './metrics';
import type { Segment } from './workout';

export interface HrZone {
  id: number;
  name: string;
  /** Upper bound (exclusive) as a fraction of LTHR. */
  max: number;
}

export const HR_ZONES: HrZone[] = [
  { id: 1, name: 'Recovery', max: 0.81 },
  { id: 2, name: 'Endurance', max: 0.9 },
  { id: 3, name: 'Tempo', max: 0.94 },
  { id: 4, name: 'Threshold', max: 1.0 },
  { id: 5, name: 'VO2 max', max: Infinity },
];

export type LthrSource = 'entered' | 'max' | 'age' | 'learned';

export interface HrProfile {
  lthr?: number;
  source?: LthrSource;
  /** Highest sustained HR seen in any ride. */
  maxSeen?: number;
}

export function hrZoneFor(bpm: number, lthr: number): HrZone {
  return HR_ZONES.find((z) => bpm / lthr < z.max) ?? HR_ZONES[HR_ZONES.length - 1];
}

/** Tanaka et al.: 208 − 0.7 × age. Better than 220 − age, still ±10 bpm for individuals. */
export const maxHrFromAge = (age: number) => Math.round(208 - 0.7 * age);

/** LTHR typically sits near 90% of max HR. */
export const lthrFromMaxHr = (maxHr: number) => Math.round(maxHr * 0.9);

/** Seconds spent in each zone, indexed zone 1..5 → [0..4]. Samples are 1 Hz. */
export function timeInHrZones(samples: { heartRate?: number }[], lthr: number): number[] {
  const out = HR_ZONES.map(() => 0);
  for (const s of samples) if (s.heartRate) out[hrZoneFor(s.heartRate, lthr).id - 1]++;
  return out;
}

/** Highest 5 s average HR, so a single glitchy reading can't set max HR. */
export function sustainedMaxHr(samples: { heartRate?: number }[]): number | undefined {
  const hr = samples.map((s) => s.heartRate ?? 0);
  let best = 0;
  for (let i = 4; i < hr.length; i++) {
    const w = hr.slice(i - 4, i + 1);
    if (w.every((b) => b > 0)) best = Math.max(best, mean(w));
  }
  return best > 0 ? Math.round(best) : undefined;
}

export interface LthrSuggestion {
  lthr: number;
  /** How many blocks it's based on. */
  blocks: number;
}

/**
 * Estimates LTHR from long, steady, hard blocks the rider actually held. Uses the second
 * half of each block (HR has settled) and scales for intensity: at FTP, HR ≈ LTHR; below it,
 * HR sits proportionally lower (a linear HR–power model anchored ~60% of LTHR at zero power).
 * A heuristic, offered as a suggestion only.
 */
export function suggestLthr(
  samples: { t: number; heartRate?: number }[],
  blocks: { segment: Segment; compliance: number }[],
): LthrSuggestion | undefined {
  const estimates: number[] = [];
  for (const { segment: s, compliance } of blocks) {
    const steady = s.from === s.to;
    if (!steady || s.end - s.start < 8 * 60 || s.from < 0.88 || compliance < 0.7) continue;
    const mid = (s.start + s.end) / 2;
    const hr = samples.filter((x) => x.t >= mid && x.t < s.end && x.heartRate).map((x) => x.heartRate!);
    if (hr.length < (s.end - mid) * 0.8) continue; // too many dropouts
    estimates.push(mean(hr) / (0.6 + 0.4 * Math.min(s.from, 1.05)));
  }
  if (!estimates.length) return undefined;
  return { lthr: Math.round(mean(estimates)), blocks: estimates.length };
}
