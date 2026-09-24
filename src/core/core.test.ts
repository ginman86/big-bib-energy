import { describe, expect, it } from 'vitest';
import { LevelFilter, powerLevel } from './avatar';
import { classify } from './compliance';
import { ErgGovernor } from './erg';
import { leadTarget, RateMeter, StepResponse } from './latency';
import { CrankCadence, parseCyclingPower, wahooErg, wahooGrade, wahooSimMode, wahooUnlock } from './cps';
import { parseHeartRate, parseIndoorBikeData, setSimulation, setTargetPower } from './ftms';
import { normalizedPower, trainingStress } from './metrics';
import { Session } from './session';
import { expand, ramp, repeat, steady, targetAt, totalDuration, Workout } from './workout';
import { zoneFor } from './zones';

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

describe('avatar', () => {
  it('maps zones to five power levels', () => {
    expect([0.5, 0.7, 0.8, 0.9, 1.0, 1.1, 1.3].map((f) => powerLevel(zoneFor(f)))).toEqual([1, 1, 2, 2, 3, 4, 5]);
  });

  it('powers up quickly and calms down slowly', () => {
    const f = new LevelFilter(600, 1800);
    expect(f.update(3, 0)).toBe(1);
    expect(f.update(3, 599)).toBe(1);
    expect(f.update(3, 600)).toBe(3);
    expect(f.update(1, 1000)).toBe(3);
    expect(f.update(1, 2500)).toBe(3);
    expect(f.update(1, 2800)).toBe(1);
  });

  it('ignores brief blips across a boundary', () => {
    const f = new LevelFilter(600, 1800);
    f.update(2, 0);
    f.update(2, 600);
    expect(f.update(3, 700)).toBe(2);
    expect(f.update(2, 900)).toBe(2); // back before the 600 ms up-delay elapsed
    expect(f.update(2, 5000)).toBe(2);
  });
});

describe('cycling power + wahoo', () => {
  it('parses power and crank data, skipping earlier optional fields', () => {
    // flags: pedal balance (bit0), wheel revs (bit4), crank revs (bit5)
    const v = new DataView(new ArrayBuffer(2 + 2 + 1 + 6 + 4));
    v.setUint16(0, 1 | (1 << 4) | (1 << 5), true);
    v.setInt16(2, 212, true);
    v.setUint8(4, 50);
    v.setUint32(5, 12345, true);
    v.setUint16(9, 999, true);
    v.setUint16(11, 400, true);
    v.setUint16(13, 2048, true);
    expect(parseCyclingPower(v)).toEqual({ power: 212, crank: { revs: 400, time: 2048 } });
  });

  it('parses power-only measurements', () => {
    const v = new DataView(new ArrayBuffer(4));
    v.setInt16(2, 180, true);
    expect(parseCyclingPower(v)).toEqual({ power: 180 });
  });

  it('derives cadence from crank deltas, across uint16 wraparound', () => {
    const c = new CrankCadence();
    expect(c.update({ revs: 65534, time: 65000 }, 0)).toBeUndefined();
    // 3 revs in 2 s (2048 ticks), wrapping both counters: 90 rpm
    expect(c.update({ revs: 1, time: (65000 + 2048) % 65536 }, 2000)).toBe(90);
    // No new crank event: holds, then drops to 0 after 3 s
    expect(c.update({ revs: 1, time: (65000 + 2048) % 65536 }, 3000)).toBe(90);
    expect(c.update({ revs: 1, time: (65000 + 2048) % 65536 }, 5500)).toBe(0);
  });

  it('encodes wahoo commands like GoldenCheetah / Auuki', () => {
    expect([...wahooUnlock()]).toEqual([0x20, 0xee, 0xfc]);
    expect([...wahooErg(260)]).toEqual([0x42, 0x04, 0x01]);
    // 75 kg -> 7500, crr 0.004 -> 40, cw 0.51 -> 510
    expect([...wahooSimMode()]).toEqual([0x43, 0x4c, 0x1d, 40, 0, 0xfe, 0x01]);
    // 0% -> 32768 (0x8000); 1% -> 33096 (0x8148)
    expect([...wahooGrade(0)]).toEqual([0x46, 0x00, 0x80]);
    expect([...wahooGrade(1)]).toEqual([0x46, 0x48, 0x81]);
  });
});

describe('erg soft start', () => {
  const base = { active: true, targetW: 200, powerW: 0 };

  it('stays free until cadence holds above the engage threshold', () => {
    const g = new ErgGovernor();
    expect(g.update({ ...base, nowMs: 0, cadence: 20 })).toEqual({ kind: 'free' });
    expect(g.update({ ...base, nowMs: 500, cadence: 70 })).toEqual({ kind: 'free' });
    expect(g.update({ ...base, nowMs: 1000, cadence: 50 })).toEqual({ kind: 'free' }); // dipped: streak resets
    expect(g.update({ ...base, nowMs: 1500, cadence: 70 })).toEqual({ kind: 'free' });
    expect(g.update({ ...base, nowMs: 3000, cadence: 70, powerW: 80 })).toEqual({ kind: 'erg', watts: 80 });
    expect(g.state).toBe('ramping');
  });

  it('ramps from current power to target, then engages', () => {
    const g = new ErgGovernor();
    g.update({ ...base, nowMs: 0, cadence: 80 });
    g.update({ ...base, nowMs: 1500, cadence: 80, powerW: 100 }); // engage, ramp from 100
    expect(g.update({ ...base, nowMs: 6500, cadence: 80 })).toEqual({ kind: 'erg', watts: 150 });
    expect(g.update({ ...base, nowMs: 11_500, cadence: 80 })).toEqual({ kind: 'erg', watts: 200 });
    expect(g.state).toBe('engaged');
  });

  it('never ramps from absurdly low power', () => {
    const g = new ErgGovernor();
    g.update({ ...base, nowMs: 0, cadence: 80 });
    expect(g.update({ ...base, nowMs: 1500, cadence: 80, powerW: 5 })).toEqual({ kind: 'erg', watts: 60 });
  });

  it('releases on a cadence collapse and when paused', () => {
    const g = new ErgGovernor();
    g.update({ ...base, nowMs: 0, cadence: 80 });
    g.update({ ...base, nowMs: 1500, cadence: 80 });
    g.update({ ...base, nowMs: 20_000, cadence: 80 });
    expect(g.state).toBe('engaged');
    expect(g.update({ ...base, nowMs: 21_000, cadence: 30 }).kind).toBe('erg');
    expect(g.update({ ...base, nowMs: 24_000, cadence: 30 })).toEqual({ kind: 'free' });
    expect(g.state).toBe('released');

    const h = new ErgGovernor();
    h.update({ ...base, nowMs: 0, cadence: 80 });
    h.update({ ...base, nowMs: 1500, cadence: 80 });
    expect(h.update({ ...base, active: false, nowMs: 2000, cadence: 80 })).toEqual({ kind: 'free' });
    expect(h.state).toBe('released');
  });

  it('falls back to power when there is no cadence sensor', () => {
    const g = new ErgGovernor();
    g.update({ ...base, nowMs: 0, powerW: 60 });
    expect(g.update({ ...base, nowMs: 1500, powerW: 60 }).kind).toBe('erg');
  });
});

describe('session unscored time', () => {
  it('does not score time flagged unscored, and reports it as settling', () => {
    const s = new Session(workout, 200);
    s.start();
    s.skip(); // Interval 1/2: no grace window
    const snap = s.advance(2, { power: 50 }, { unscored: true });
    expect(snap.settling).toBe(true);
    expect(s.stats[1].seconds).toBe(0);
    s.advance(2, { power: 50 });
    expect(s.stats[1].under).toBeCloseTo(2);
  });
});

describe('latency', () => {
  it('leads step changes but not ramps', () => {
    const segs = expand(workout); // ramp 0-100 (0.5->1.0), steady 100-160 @1.0, steady 160-190 @0.5, ...
    // Ramp into the steady block ends at 1.0 = same level: no step, no lead.
    expect(leadTarget(segs, 99.5, 1)).toBeCloseTo(targetAt(segs, 99.5)!);
    // 1.0 -> 0.5 at t=160 is a step: commanded 1 s early.
    expect(leadTarget(segs, 159.2, 1)).toBe(0.5);
    expect(leadTarget(segs, 158.5, 1)).toBe(1.0);
  });

  it('measures notification rate and freshness', () => {
    const r = new RateMeter();
    [0, 250, 500, 750, 1000].forEach((t) => r.mark(t));
    expect(r.hz(1000)).toBeCloseTo(4);
    expect(r.ageMs(1100)).toBe(100);
  });

  it('times ERG step responses', () => {
    const s = new StepResponse();
    s.command(150, 0);
    s.command(152, 100); // small change: not a step
    s.reading(150, 200);
    expect(s.samples).toEqual([]);
    s.command(300, 1000); // step
    s.reading(200, 1500);
    s.reading(280, 2500); // within 5% of 300? 15 W band -> no
    s.reading(290, 3100); // yes
    expect(s.last).toBe(2100);
  });
});
