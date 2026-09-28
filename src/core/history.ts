// Completed-ride records and rollups for progress over time.
// Kept storage-agnostic: today it's localStorage, later a backend keyed by Strava athlete id.

import type { HistoryRide } from './progression';
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

// ——— Unified ride history (local + synced) ———

/** A local record in the shape progression uses. */
export function toHistoryRide(r: RideRecord): HistoryRide {
  return {
    id: r.id,
    startedAt: Date.parse(r.startedAt),
    seconds: r.summary.seconds,
    tss: r.summary.tss,
    compliance: r.summary.compliance,
    facts: r.summary.facts,
    workoutId: r.summary.workoutId,
  };
}

/** Rides saved before local and synced copies shared an ID: same workout, starts within 90 s. */
const NEAR_MS = 90_000;
const sameRide = (a: HistoryRide, b: HistoryRide) =>
  a.id === b.id || (a.workoutId !== undefined && a.workoutId === b.workoutId && Math.abs(a.startedAt - b.startedAt) < NEAR_MS);

/**
 * Union of synced and local rides, oldest first. Synced copies win (they're what other devices
 * see); local rides not yet synced are kept and reported so they can be imported.
 */
export function mergeHistory(remote: HistoryRide[], local: HistoryRide[]): { rides: HistoryRide[]; localOnly: HistoryRide[] } {
  const localOnly = local.filter((l) => !remote.some((r) => sameRide(r, l)));
  const rides = [...remote, ...localOnly].sort((a, b) => a.startedAt - b.startedAt);
  return { rides, localOnly };
}

/** Month-to-date rollup for the home screen. */
export function monthTotals(rides: HistoryRide[], now: Date): Totals {
  const from = startOfMonth(now).getTime();
  const month = rides.filter((r) => r.startedAt >= from);
  const n = month.length;
  return {
    rides: n,
    seconds: month.reduce((a, r) => a + r.seconds, 0),
    tss: month.reduce((a, r) => a + r.tss, 0),
    avgCompliance: n ? month.reduce((a, r) => a + r.compliance, 0) / n : 0,
  };
}
