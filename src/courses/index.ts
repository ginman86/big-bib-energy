// Course registry: built-in courses (lazy-loaded; the catalog carries what the picker needs) plus
// the rider's imported GPX courses.

import { Course, lapClimb } from '../core/course';
import { CATALOG } from './catalog';
import type { CourseMeta } from './types';

export type { CourseMeta } from './types';
export { CATALOG };

export const DEFAULT_COURSE_ID = 'richmond-2015';

const loaders = import.meta.glob<Course>('./data/*.json', { import: 'default' });
const cache = new Map<string, Course>();

/** A built-in course by ID (undefined if unknown). */
export async function loadBuiltinCourse(id: string): Promise<Course | undefined> {
  const hit = cache.get(id);
  if (hit) return hit;
  const load = loaders[`./data/${id}.json`];
  if (!load) return undefined;
  const c = await load();
  cache.set(id, c);
  return c;
}

/** Picker summary for an imported course (built-ins come precomputed in the catalog). */
export function metaOf(c: Course): CourseMeta {
  const climb = lapClimb(c);
  const per = climb / (c.lapMeters / 1000);
  const preview = Array.from({ length: 60 }, (_, i) => {
    const d = (c.lapMeters * i) / 59;
    const k = c.profile.findIndex((p) => p[0] >= d);
    return c.profile[Math.max(0, k)][1];
  });
  let maxGrade = 0;
  for (let i = 2; i < c.profile.length; i++) {
    const run = c.profile[i][0] - c.profile[i - 2][0];
    if (run > 0) maxGrade = Math.max(maxGrade, Math.abs(c.profile[i][1] - c.profile[i - 2][1]) / run);
  }
  return {
    id: c.id,
    name: c.name,
    place: c.place,
    kind: c.kind ?? 'loop',
    lapMeters: c.lapMeters,
    climbMeters: Math.round(climb),
    maxGrade,
    altitudeM: Math.round(c.profile.reduce((a, p) => a + p[1], 0) / c.profile.length),
    terrain: per < 6 ? 'Flat' : per < 12 ? 'Rolling' : 'Hilly',
    preview,
    custom: true,
  };
}
