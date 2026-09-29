import { describe, expect, it } from 'vitest';
import { bikeModel, gradeAt, lapClimb, VirtualBike } from '../core/course';
import { CATALOG, loadBuiltinCourse } from '.';

describe('built-in courses', () => {
  it.each(CATALOG.map((m) => [m.id, m] as const))('%s is a sane, closed lap', async (_id, meta) => {
    const c = (await loadBuiltinCourse(meta.id))!;
    expect(c.profile[0][0]).toBe(0);
    expect(c.profile[c.profile.length - 1][0]).toBe(c.lapMeters);
    expect(c.profile[c.profile.length - 1][1]).toBe(c.profile[0][1]);
    expect(c.track).toHaveLength(c.profile.length);
    for (let i = 1; i < c.profile.length; i++) expect(c.profile[i][0]).toBeGreaterThan(c.profile[i - 1][0]);
    expect(Math.abs(lapClimb(c) - meta.climbMeters)).toBeLessThanOrEqual(1);
    for (let d = 0; d < c.lapMeters; d += 10) expect(Math.abs(gradeAt(c, d))).toBeLessThan(0.25);
    // 250 W at 75 kg lands between a crawl and a pro's pace.
    const b = new VirtualBike(c, bikeModel(75));
    let t = 0;
    while (b.distance < c.lapMeters && t < 4 * 3600) {
      b.step(250, 1);
      t++;
    }
    const kmh = (c.lapMeters / t) * 3.6;
    expect(kmh).toBeGreaterThan(15);
    expect(kmh).toBeLessThan(42);
  });

  it('Richmond matches the published circuit', async () => {
    const c = (await loadBuiltinCourse('richmond-2015'))!;
    expect(c.lapMeters).toBe(16220);
    expect(lapClimb(c)).toBeGreaterThan(120);
    expect(lapClimb(c)).toBeLessThan(170);
    expect(c.climbs?.map((x) => x.name)).toContain('23rd Street');
  });
});
