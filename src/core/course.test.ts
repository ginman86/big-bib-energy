import { describe, expect, it } from 'vitest';
import { bikeModel, Course, elevationAt, gradeAt, steadySpeed, VirtualBike } from './course';

const kmh = (ms: number) => ms * 3.6;

describe('bike physics', () => {
  const m = bikeModel(75);

  it('lands on believable speeds', () => {
    // Reference points from standard calculators (e.g. bikecalculator.com, hoods): ±2 km/h.
    expect(kmh(steadySpeed(200, 0, m))).toBeGreaterThan(31);
    expect(kmh(steadySpeed(200, 0, m))).toBeLessThan(35);
    expect(kmh(steadySpeed(300, 0, m))).toBeGreaterThan(36);
    expect(kmh(steadySpeed(300, 0, m))).toBeLessThan(40);
    expect(kmh(steadySpeed(250, 0.08, m))).toBeGreaterThan(9.5);
    expect(kmh(steadySpeed(250, 0.08, m))).toBeLessThan(12.5);
    // Lighter riders climb faster at the same watts.
    expect(steadySpeed(250, 0.08, bikeModel(60))).toBeGreaterThan(steadySpeed(250, 0.08, m));
  });

  it('freewheels downhill and stops uphill', () => {
    expect(kmh(steadySpeed(0, -0.06, m))).toBeGreaterThan(45);
    expect(steadySpeed(0, 0.05, m)).toBe(0);
  });

  it('carries momentum: speed builds rather than jumping', () => {
    const flat: Course = { id: 'f', name: 'f', place: '', lapMeters: 1000, profile: [[0, 0], [1000, 0]] };
    const b = new VirtualBike(flat, m);
    b.step(250, 1);
    expect(kmh(b.speed)).toBeLessThan(15);
    for (let i = 0; i < 120; i++) b.step(250, 1);
    expect(b.lap).toBeGreaterThan(1); // wrapped past the 1 km lap
  });
});

describe('course profile', () => {
  const hill: Course = { id: 'h', name: 'h', place: '', lapMeters: 1000, profile: [[0, 10], [500, 60], [1000, 10]] };

  it('interpolates and wraps laps', () => {
    expect(elevationAt(hill, 250)).toBeCloseTo(35);
    expect(elevationAt(hill, 1250)).toBeCloseTo(35);
    expect(gradeAt(hill, 250)).toBeCloseTo(0.1);
    expect(gradeAt(hill, 750)).toBeCloseTo(-0.1);
  });

  it('counts climbing', () => {
    const b = new VirtualBike(hill, bikeModel());
    for (let i = 0; i < 400 && b.distance < 500; i++) b.step(300, 1);
    expect(b.climbed).toBeGreaterThan(45);
  });
});

describe('altitude', () => {
  it('thins the air: Denver is faster than sea level on the flat', async () => {
    const { airDensity } = await import('./course');
    expect(airDensity(0)).toBeCloseTo(1.225, 3);
    expect(airDensity(1600)).toBeGreaterThan(1.02);
    expect(airDensity(1600)).toBeLessThan(1.06);
    const sea = steadySpeed(200, 0, bikeModel(75));
    const denver = steadySpeed(200, 0, bikeModel(75), 1600);
    expect(denver / sea).toBeGreaterThan(1.03);
    expect(denver / sea).toBeLessThan(1.07);
  });
});
