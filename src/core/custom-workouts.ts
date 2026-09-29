// Custom workouts across devices (see custom-items for the merge rules).

import type { Workout } from './workout';

export { mergeCustom } from './custom-items';

export interface CustomEntry {
  id: string;
  workout?: Workout; // absent when deleted
  deleted?: boolean;
  /** ISO timestamp of the last change. */
  updatedAt: string;
}

/** Workouts to show: not deleted, most recently changed first. */
export const liveWorkouts = (entries: CustomEntry[]): Workout[] =>
  entries
    .filter((e) => !e.deleted && e.workout)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((e) => e.workout!);
