// Custom workouts across devices: local copies and the account's copies, merged newest-wins,
// with deletes kept as tombstones so a stale device can't bring a workout back.

import type { Workout } from './workout';

export interface CustomEntry {
  id: string;
  workout?: Workout; // absent when deleted
  deleted?: boolean;
  /** ISO timestamp of the last change. */
  updatedAt: string;
}

export function mergeCustom(local: CustomEntry[], remote: CustomEntry[]): { merged: CustomEntry[]; push: CustomEntry[] } {
  const byId = new Map<string, CustomEntry>();
  for (const r of remote) byId.set(r.id, r);
  const push: CustomEntry[] = [];
  for (const l of local) {
    const r = byId.get(l.id);
    if (!r || Date.parse(l.updatedAt) > Date.parse(r.updatedAt)) {
      byId.set(l.id, l);
      push.push(l);
    }
  }
  return { merged: [...byId.values()], push };
}

/** Workouts to show: not deleted, most recently changed first. */
export const liveWorkouts = (entries: CustomEntry[]): Workout[] =>
  entries
    .filter((e) => !e.deleted && e.workout)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((e) => e.workout!);
