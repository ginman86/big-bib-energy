import { describe, expect, it } from 'vitest';
import { RAMP_FTP_FACTOR, rampTestWorkout } from './ramp-test';
import { Session } from './session';

const FTP = 250;

/** Rides the test holding every target up to `maxW`, then fades to 70% of the target. */
function ride(maxW: number, dt = 0.5) {
  const s = new Session(rampTestWorkout(), FTP);
  s.start(0);
  let guard = 0;
  while (s.status === 'running' && guard++ < 100_000) {
    const target = s.targetWatts();
    s.advance(dt, { power: target <= maxW ? target : Math.round(target * 0.7), cadence: 90 });
  }
  return s;
}

describe('ramp test', () => {
  it('ends when the rider can’t hold the step, skips to the cool-down and estimates FTP', () => {
    const s = ride(330);
    expect(s.testEndedAt).toBeDefined();
    expect(s.completed).toBe(true); // failing is how a ramp test finishes, not a skip
    const r = s.summary().rampTest!;
    // Steps are 55% + 6% per minute of 250 W: 137, 152, 167, ... The last one held is 317 W (step 13).
    expect(r.steps).toBe(14);
    expect(r.bestMinuteW).toBeGreaterThanOrEqual(317);
    expect(r.bestMinuteW).toBeLessThan(332);
    expect(r.ftp).toBe(Math.round(r.bestMinuteW * RAMP_FTP_FACTOR));
    expect(r.topped).toBe(false);
  });

  it('tolerates a brief dip without ending the test', () => {
    const s = new Session(rampTestWorkout(), FTP);
    s.start(0);
    for (let t = 0; t < 5 * 60 + 30; t++) s.advance(1, { power: s.targetWatts(), cadence: 90 });
    for (let t = 0; t < 6; t++) s.advance(1, { power: 50, cadence: 90 });
    for (let t = 0; t < 30; t++) s.advance(1, { power: s.targetWatts(), cadence: 90 });
    expect(s.testEndedAt).toBeUndefined();
  });

  it('stops pedalling ends it', () => {
    const s = new Session(rampTestWorkout(), FTP);
    s.start(0);
    for (let t = 0; t < 8 * 60; t++) s.advance(1, { power: s.targetWatts(), cadence: 90 });
    for (let t = 0; t < 12; t++) s.advance(1, { power: 180, cadence: 5 });
    // The tenth second of struggling ends it.
    expect(s.testEndedAt).toBe(8 * 60 + 9);
    expect(s.snapshot().segment?.label).toBe('Cool down');
  });

  it('skip during the climb means "I’m done"', () => {
    const s = new Session(rampTestWorkout(), FTP);
    s.start(0);
    for (let t = 0; t < 9 * 60 + 30; t++) s.advance(1, { power: s.targetWatts(), cadence: 90 });
    s.skip();
    expect(s.snapshot().segment?.label).toBe('Cool down');
    expect(s.skippedSeconds).toBe(0);
    expect(s.summary().rampTest?.steps).toBe(5);
  });

  it('no estimate from under a minute of ramp', () => {
    const s = new Session(rampTestWorkout(), FTP);
    s.start(0);
    for (let t = 0; t < 5 * 60 + 20; t++) s.advance(1, { power: s.targetWatts(), cadence: 90 });
    s.skip();
    expect(s.summary().rampTest).toBeUndefined();
  });

  it('ordinary workouts are unaffected', () => {
    const s = new Session({ id: 'x', name: 'x', description: '', steps: [{ kind: 'steady', duration: 120, power: 1 }] }, FTP);
    s.start(0);
    for (let t = 0; t < 60; t++) s.advance(1, { power: 50, cadence: 90 });
    expect(s.elapsed).toBe(60);
    expect(s.summary().rampTest).toBeUndefined();
  });
});

describe('difficulty', () => {
  const w = { id: 'x', name: 'x', description: '', steps: [{ kind: 'steady' as const, duration: 600, power: 0.8 }] };

  it('scales targets, is clamped, and reports a time-weighted average', () => {
    const s = new Session(w, 250);
    s.start(0);
    expect(s.targetWatts()).toBe(200);
    for (let t = 0; t < 300; t++) s.advance(1, { power: 200, cadence: 90 });
    expect(s.setIntensity(1.1)).toBe(1.1);
    expect(s.targetWatts()).toBe(220);
    for (let t = 0; t < 300; t++) s.advance(1, { power: 220, cadence: 90 });
    const sum = s.summary();
    expect(sum.intensity).toBe(1.05);
    expect(sum.compliance).toBeGreaterThan(0.95); // scored against the adjusted target
    expect(s.setIntensity(3)).toBe(1.5);
    expect(s.setIntensity(0.1)).toBe(0.5);
  });

  it('is absent when untouched, and locked for a ramp test', () => {
    const s = new Session(w, 250);
    s.start(0);
    s.advance(1, { power: 200 });
    expect(s.summary().intensity).toBeUndefined();
    expect(new Session(rampTestWorkout(), 250).setIntensity(1.2)).toBe(1);
  });
});
