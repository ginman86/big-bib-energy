// Custom workouts: kept in this browser, and synced to the account when signed in.

import { CustomEntry, liveWorkouts, mergeCustom } from '../core/custom-workouts';
import type { Workout } from '../core/workout';
import { api, ApiError } from './client';

const KEY = 'bbe.workouts';

function readLocal(): CustomEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as CustomEntry[];
  } catch {
    return [];
  }
}

function writeLocal(entries: CustomEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked; the account copy (if signed in) still has it.
  }
}

function upsertLocal(e: CustomEntry) {
  writeLocal([...readLocal().filter((x) => x.id !== e.id), e]);
}

export const localWorkouts = () => liveWorkouts(readLocal());

async function push(e: CustomEntry) {
  try {
    if (e.deleted) await api('DELETE', `/workouts/${e.id}?at=${encodeURIComponent(e.updatedAt)}`);
    else await api('PUT', `/workouts/${e.id}`, { workout: e.workout, updatedAt: e.updatedAt });
  } catch (err) {
    // 409: another device has a newer version; the next sync picks it up.
    if (!(err instanceof ApiError && err.status === 409)) throw err;
  }
}

export async function saveWorkout(w: Workout, signedIn: boolean) {
  const e: CustomEntry = { id: w.id, workout: w, updatedAt: new Date().toISOString() };
  upsertLocal(e);
  if (signedIn) await push(e).catch((err) => console.warn('Workout sync failed', err));
}

export async function deleteWorkout(id: string, signedIn: boolean) {
  const e: CustomEntry = { id, deleted: true, updatedAt: new Date().toISOString() };
  upsertLocal(e);
  if (signedIn) await push(e).catch((err) => console.warn('Workout sync failed', err));
}

/** Merge with the account's workouts; push anything newer here. Returns the live list. */
export async function syncWorkouts(): Promise<Workout[]> {
  const { workouts } = await api<{ workouts: CustomEntry[] }>('GET', '/workouts');
  const { merged, push: pending } = mergeCustom(readLocal(), workouts);
  writeLocal(merged);
  for (const e of pending) await push(e);
  return liveWorkouts(merged);
}
