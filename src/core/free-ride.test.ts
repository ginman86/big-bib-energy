import { describe, expect, it } from 'vitest';
import { rideTitle } from './activity-text';
import { bikeModel, Course, VirtualBike } from './course';
import { FactsRecorder } from './facts';
import { freeRideWorkout, goalProgress, simRiderWatts, trainerGrade } from './free-ride';
import { Session } from './session';

const hill: Course = { id: 'h', name: 'Hill', place: '', lapMeters: 2000, profile: [[0, 100], [1000, 180], [2000, 100]] };

describe('free ride', () => {
  it('sends the road grade scaled by trainer difficulty, looking a moment ahead', () => {
    const b = new VirtualBike(hill, bikeModel());
    b.distance = 500;
    expect(trainerGrade(b, 1)).toBeCloseTo(0.08, 3);
    expect(trainerGrade(b, 0.5)).toBeCloseTo(0.04, 3);
    expect(trainerGrade(b, 0)).toBe(0);
    b.distance = 1500;
    expect(trainerGrade(b, 1)).toBeCloseTo(-0.08, 3);
    // Near the crest at speed, the lookahead already sees the descent.
    b.distance = 995;
    b.speed = 10;
    expect(trainerGrade(b, 1)).toBeLessThan(0);
  });

  it('ends at a distance goal and counts as finished', () => {
    const goal = { kind: 'distance' as const, meters: 1500 };
    const s = new Session(freeRideWorkout(goal), 250);
    s.bike = new VirtualBike(hill, bikeModel());
    s.start(0);
    while (s.status === 'running' && s.elapsed < 3600) {
      s.advance(1, { power: 250, cadence: 90 });
      if ((goalProgress(goal, s.elapsed, s.bike) ?? 0) >= 1) {
        s.goalReached = true;
        s.finish();
      }
    }
    expect(s.bike.distance).toBeGreaterThanOrEqual(1500);
    expect(s.completed).toBe(true);
    const sum = s.summary();
    expect(sum.freeRide).toBe(true);
    expect(sum.course?.lapMeters).toBe(2000);
  });

  it('a time goal is the workout length', () => {
    expect(new Session(freeRideWorkout({ kind: 'time', seconds: 1800 }), 250).duration).toBe(1800);
    expect(new Session(freeRideWorkout({ kind: 'open' }), 250).duration).toBeGreaterThanOrEqual(6 * 3600);
  });

  it('titles by course and laps; records mode "free" (neutral XP precision)', () => {
    expect(rideTitle({ workoutName: 'Free ride', compliance: 0, freeRide: true, course: { name: 'Montréal 2026 Worlds', meters: 27000, lapMeters: 13438, climbMeters: 0, avgSpeed: 0, maxSpeed: 0 } })).toBe(
      'Free ride · Montréal 2026 Worlds · 2 laps',
    );
    const r = new FactsRecorder();
    r.frame({ dt: 60, running: true, paused: false, mode: 'free', reconnecting: false });
    expect(r.mode).toBe('free');
  });

  it('the simulated rider digs in uphill and eases off down', () => {
    expect(simRiderWatts(250, 0.08)).toBeGreaterThan(simRiderWatts(250, 0));
    expect(simRiderWatts(250, -0.05)).toBeLessThan(simRiderWatts(250, 0));
  });
});
