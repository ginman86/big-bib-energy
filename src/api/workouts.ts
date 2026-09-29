// Custom workouts: kept in this browser, and synced to the account when signed in.

import type { Workout } from '../core/workout';
import { customStore } from './custom-store';

const store = customStore<Workout>('bbe.workouts', 'workouts', 'workout');

export const localWorkouts = store.local;
export const saveWorkout = store.save;
export const deleteWorkout = store.remove;
export const syncWorkouts = store.sync;
