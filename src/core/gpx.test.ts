import { describe, expect, it } from 'vitest';
import { elevationAt, lapClimb } from './course';
import { FormatError } from './formats';
import { haversine, importGpx } from './gpx';

// A 2 km square-ish loop near Denver: ~0.0045° lat ≈ 500 m.
function gpx(points: [number, number, number?][], name = 'Baker test') {
  return `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><name>${name}</name><trkseg>
    ${points.map(([lat, lon, ele]) => `<trkpt lat="${lat}" lon="${lon}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</trkpt>`).join('\n')}
  </trkseg></trk></gpx>`;
}
const LAT = 39.72;
const LON = -104.99;
const dLon = 0.0045 / Math.cos((LAT * Math.PI) / 180);
const square: [number, number, number][] = [
  [LAT, LON, 1600], [LAT + 0.0045, LON, 1610], [LAT + 0.0045, LON + dLon, 1610], [LAT, LON + dLon, 1600], [LAT + 0.00001, LON + 0.00001, 1600],
];

describe('gpx import', () => {
  it('makes a closed loop course with even spacing and a track', () => {
    const { course, warnings } = importGpx('x.gpx', gpx(square));
    expect(course.name).toBe('Baker test');
    expect(course.id).toMatch(/^gpx-baker-test-[a-z0-9]{6}$/);
    expect(course.kind).toBe('loop');
    expect(course.lapMeters).toBeGreaterThan(1900);
    expect(course.lapMeters).toBeLessThan(2100);
    expect(course.track!.length).toBe(course.profile.length);
    expect(course.profile[1][0] - course.profile[0][0]).toBe(25);
    expect(course.profile[course.profile.length - 1][1]).toBe(course.profile[0][1]);
    expect(lapClimb(course)).toBeGreaterThan(5);
    expect(lapClimb(course)).toBeLessThan(12);
    expect(warnings).toEqual([]);
  });

  it('turns a one-way route into an out-and-back', () => {
    const { course, warnings } = importGpx('climb.gpx', gpx([[LAT, LON, 1800], [LAT + 0.02, LON, 2000]], 'Climb'));
    expect(course.kind).toBe('out-and-back');
    expect(course.lapMeters).toBeCloseTo(2 * haversine({ lat: LAT, lon: LON }, { lat: LAT + 0.02, lon: LON }), -1);
    expect(elevationAt(course, course.lapMeters / 2)).toBeGreaterThan(1950);
    expect(warnings[0]).toMatch(/out and back/);
  });

  it('refuses files without elevation, and non-GPX', () => {
    expect(() => importGpx('x.gpx', gpx(square.map(([a, b]) => [a, b] as [number, number])))).toThrow(/no elevation/);
    expect(() => importGpx('x.gpx', '<workout_file/>')).toThrow(FormatError);
  });

  it('caps glitchy grades', () => {
    const spiky: [number, number, number][] = square.map(([a, b, e], i) => [a, b, i === 1 ? e + 400 : e]);
    const { course } = importGpx('x.gpx', gpx(spiky));
    for (let i = 1; i < course.profile.length; i++) {
      const [d0, e0] = course.profile[i - 1];
      const [d1, e1] = course.profile[i];
      expect(Math.abs(e1 - e0) / (d1 - d0)).toBeLessThanOrEqual(0.3) // ~25%, plus rounding and the lap-closing correction;
    }
  });
});
