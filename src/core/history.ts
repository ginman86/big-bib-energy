// Completed-ride records and rollups for progress over time.
// Kept storage-agnostic: today it's localStorage, later a backend keyed by Strava athlete id.

import type { RideSummary } from './session';

export interface RideRecord {
  id: string;
  /** ISO timestamp of ride start. */
  startedAt: string;
  summary: Omit<RideSummary, 'segments'>;
}

export interface Totals {
  rides: number;
  seconds: number;
  tss: number;
  avgCompliance: number;
}

export function totals(records: RideRecord[]): Totals {
  const rides = records.length;
  const seconds = records.reduce((a, r) => a + r.summary.seconds, 0);
  const tss = records.reduce((a, r) => a + r.summary.tss, 0);
  const avgCompliance = rides ? records.reduce((a, r) => a + r.summary.compliance, 0) / rides : 0;
  return { rides, seconds, tss, avgCompliance };
}

export function since(records: RideRecord[], from: Date): RideRecord[] {
  return records.filter((r) => new Date(r.startedAt) >= from);
}

export function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
