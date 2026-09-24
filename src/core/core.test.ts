import { describe, expect, it } from 'vitest';
import { classify } from './compliance';
import { parseHeartRate, parseIndoorBikeData, setSimulation, setTargetPower } from './ftms';
import { normalizedPower, trainingStress } from './metrics';
import { Session } from './session';
import { expand, ramp, repeat, steady, targetAt, totalDuration, Workout } from './workout';

const workout: Workout = {
  id: 't',
  name: 'Test',
  description: '',
  steps: [ramp(100, 0.5, 1.0), ...repeat(2, steady(60, 1.0), steady(30, 0.5))],
};

describe('workout', () => {
  it('expands steps onto a timeline', () => {
    const segs = expand(workout);
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, 100],
      [100, 160],
      [160, 190],
      [190, 250],
    ]);
    expect(segs[1].label).toBe('Interval 1/2');
    expect(segs[2].label).toBe('Recover 1/2');
    expect(totalDuration(segs)).toBe(250);
  });

  it('interpolates ramps', () => {
    const segs = expand(workout);
    expect(targetAt(segs, 50)).toBeCloseTo(0.75);
    expect(targetAt(segs, 120)).toBe(1.0);
    expect(targetAt(segs, 999)).toBeNull();
  });
});

describe('compliance', () => {
  it('uses ±5% with a watt floor', () => {
    expect(classify(250, 250)).toBe('on');
    expect(classify(262, 250)).toBe('on');
    expect(classify(264, 250)).toBe('over');
    expect(classify(230, 250)).toBe('under');
    // 5% of 100 W is 5 W, but the 8 W floor applies.
    expect(classify(93, 100)).toBe('on');
  });
});

describe('metrics', () => {
  it('NP of a constant effort equals that effort', () => {
    expect(normalizedPower(Array(600).fill(200))).toBeCloseTo(200);
  });

  it('NP exceeds average power for variable efforts', () => {
    const watts = Array.from({ length: 600 }, (_, i) => (Math.floor(i / 60) % 2 ? 350 : 150));
    expect(normalizedPower(watts)).toBeGreaterThan(250);
  });

  it('one hour at FTP is 100 TSS', () => {
    expect(trainingStress(3600, 250, 250)).toBeCloseTo(100);
  });
});

describe('session', () => {
  it('scores time in band and records 1 Hz samples', () => {
    const s = new Session(workout, 200);
    s.start();
    // Ride the whole thing exactly on target, 0.5 s at a time.
    while (s.status === 'running') s.advance(0.5, { power: s.targetWatts() });
    expect(s.samples).toHaveLength(250);
    const summary = s.summary();
    expect(summary.compliance).toBeGreaterThan(0.97);
    expect(summary.seconds).toBe(250);
  });

  it('flags under-target riding, ignoring the settle window', () => {
    const s = new Session(workout, 200);
    s.start();
    s.skip(); // to Interval 1/2 — ramp ends at 100%, so no target jump and no grace
    for (let i = 0; i < 4; i++) s.advance(0.5, { power: 150 });
    expect(s.snapshot().settling).toBe(false);
    expect(s.stats[1].under).toBeCloseTo(2);

    s.skip(); // to Recover 1/2 — 100% → 50% is a jump, so the first 5 s are grace
    expect(s.snapshot().settling).toBe(true);
    for (let i = 0; i < 20; i++) s.advance(0.5, { power: 60 });
    const snap = s.snapshot();
    expect(snap.band).toBe('under');
    expect(snap.settling).toBe(false);
    // 10 s ridden, first 5 s were grace: only 5 s scored, all under.
    expect(s.stats[2].seconds).toBeCloseTo(5);
    expect(s.stats[2].under).toBeCloseTo(5);
  });
});

describe('ftms', () => {
  it('parses speed, cadence, power and heart rate', () => {
    // flags: speed present (bit0=0), cadence (bit2), power (bit6), HR (bit9)
    const flags = (1 << 2) | (1 << 6) | (1 << 9);
    const v = new DataView(new ArrayBuffer(9));
    v.setUint16(0, flags, true);
    v.setUint16(2, 3250, true); // 32.5 km/h
    v.setUint16(4, 180, true); // 90 rpm
    v.setInt16(6, 247, true);
    v.setUint8(8, 151);
    expect(parseIndoorBikeData(v)).toEqual({ speedKph: 32.5, cadence: 90, power: 247, heartRate: 151 });
  });

  it('skips fields it does not read', () => {
    // no speed (bit0=1), total distance (bit4, 3 bytes), power (bit6)
    const v = new DataView(new ArrayBuffer(7));
    v.setUint16(0, 1 | (1 << 4) | (1 << 6), true);
    v.setInt16(5, 310, true);
    expect(parseIndoorBikeData(v)).toEqual({ power: 310 });
  });

  it('parses 8- and 16-bit heart rate', () => {
    expect(parseHeartRate(new DataView(new Uint8Array([0x00, 142]).buffer))).toBe(142);
    expect(parseHeartRate(new DataView(new Uint8Array([0x01, 0x2c, 0x01]).buffer))).toBe(300);
  });

  it('encodes control point commands little-endian', () => {
    expect([...setTargetPower(260)]).toEqual([0x05, 0x04, 0x01]);
    expect([...setSimulation({ gradePct: 1.5 })]).toEqual([0x11, 0, 0, 150, 0, 40, 51]);
  });
});
