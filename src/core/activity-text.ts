// Title and description for a ride shared to Strava.

import { pct } from './format';
import type { RideSummary } from './session';

/** Whole laps of the course, for free-ride titles. */
export const lapsRidden = (s: Pick<RideSummary, 'course'>) =>
  s.course?.lapMeters ? Math.floor(s.course.meters / s.course.lapMeters + 0.02) : 0;

export function rideTitle(s: Pick<RideSummary, 'workoutName' | 'compliance' | 'freeRide' | 'course'>): string {
  if (s.freeRide) {
    const laps = lapsRidden(s);
    return ['Free ride', s.course?.name, laps ? `${laps} lap${laps > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  }
  return `${s.workoutName} · ${pct(s.compliance)} on target`;
}

function verdict(compliance: number): string {
  if (compliance >= 0.9) return 'Dialled in. Big Bib Energy earned 🔥';
  if (compliance >= 0.75) return 'Solid work.';
  if (compliance >= 0.5) return 'Got it done.';
  return 'Ride logged.';
}

export function rideDescription(s: RideSummary): string {
  const load = [`NP ${Math.round(s.normalizedPower)} W`, `TSS ${Math.round(s.tss)}`, `IF ${s.intensityFactor.toFixed(2)}`];
  if (s.avgHeartRate) load.push(`avg HR ${Math.round(s.avgHeartRate)}`);
  if (s.intensity && s.intensity !== 1) load.push(`at ${Math.round(s.intensity * 100)}% difficulty`);
  const lead = s.freeRide ? `Free ride${s.course ? ` on the ${s.course.name} course` : ''}. The road set the resistance.` : verdict(s.compliance);
  return [lead, load.join(' · '), 'Big Bib Energy · bigbib.ginman.dev'].join('\n');
}
