// Free ride: ride a course with no workout. The trainer runs in simulation mode, taking the
// course's gradient, so hills get hard and descents easy; the rider picks power with the gears.

import type { VirtualBike } from './course';
import { free, Workout } from './workout';

export type FreeRideGoal = { kind: 'open' } | { kind: 'time'; seconds: number } | { kind: 'distance'; meters: number } | { kind: 'laps'; laps: number };

/** Long enough for any ride; the rider ends it (or a goal does) well before. */
const OPEN_SECONDS = 6 * 3600;

export function freeRideWorkout(goal: FreeRideGoal): Workout {
  return {
    id: 'free-ride',
    name: 'Free ride',
    description: '',
    steps: [free(goal.kind === 'time' ? goal.seconds : OPEN_SECONDS, 'Free ride')],
    freeRide: true,
  };
}

/** 0–1 toward the goal (undefined for an open ride). */
export function goalProgress(goal: FreeRideGoal, elapsed: number, bike?: VirtualBike): number | undefined {
  switch (goal.kind) {
    case 'time':
      return Math.min(1, elapsed / goal.seconds);
    case 'distance':
      return bike ? Math.min(1, bike.distance / goal.meters) : undefined;
    case 'laps':
      return bike ? Math.min(1, bike.distance / (goal.laps * bike.course.lapMeters)) : undefined;
    default:
      return undefined;
  }
}

/**
 * Grade to send the trainer: the road's grade scaled by trainer difficulty (Zwift's "trainer
 * difficulty": 50% makes an 8% climb feel like 4%), looking a moment ahead because resistance
 * takes a second or two to change. Clamped to what trainers accept.
 */
export function trainerGrade(bike: VirtualBike, difficulty: number, leadSeconds = 1): number {
  const g = bike.gradeAt(bike.distance + bike.speed * leadSeconds);
  return Math.max(-0.1, Math.min(0.2, g * difficulty));
}

/** The simulated rider in free ride: steady on the flat, digs in uphill, soft-pedals down. */
export const simRiderWatts = (ftp: number, grade: number) => Math.round(ftp * Math.max(0.3, Math.min(1.15, 0.68 + grade * 4.5)));
